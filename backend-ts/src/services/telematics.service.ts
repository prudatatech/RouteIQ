/**
 * Device events from the telematics webhook (and the staff "Send test alarm").
 *
 * Both go through processDeviceEvents, so a test alarm exercises the same
 * vehicle lookup, alarm and notification path as a real device event.
 */
import { z } from 'zod';
import { supabase } from '../core/supabase';
import { ALERT_META, DEVICE_EVENT_TYPES, raiseAlert, type DeviceEventType } from './alerts.service';

export const DeviceEventSchema = z.object({
  event: z.enum(DEVICE_EVENT_TYPES),
  /** The tracker's id, matched to the vehicle's GPS device id (spark_id). */
  device_id: z.string().trim().min(1).max(100).optional(),
  vehicle_id: z.string().uuid().optional(),
  plate_number: z.string().trim().min(1).max(20).optional(),
  timestamp: z.string().datetime({ offset: true }).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  speed_kmph: z.number().min(0).max(400).optional(),
  fuel_level_pct: z.number().min(0).max(100).optional(),
  /** ignition: on or off */
  state: z.enum(['on', 'off']).optional(),
  /** geofence: entered or left, and the fence name */
  direction: z.enum(['enter', 'exit']).optional(),
  geofence: z.string().trim().max(100).optional(),
  message: z.string().trim().max(200).optional(),
  test: z.boolean().optional(),
}).refine(e => e.device_id || e.vehicle_id || e.plate_number, {
  message: 'Send device_id, vehicle_id or plate_number to say which vehicle this is',
});
export type DeviceEvent = z.infer<typeof DeviceEventSchema>;

export interface EventResult {
  index: number;
  status: 'created' | 'repeat' | 'unknown_vehicle' | 'invalid';
  alert_id?: string | null;
  detail?: string;
}

interface VehicleRef { id: string; plate_number: string | null }

async function findVehicle(e: DeviceEvent): Promise<VehicleRef | null> {
  let q = supabase.from('vehicles').select('id, plate_number');
  if (e.vehicle_id) q = q.eq('id', e.vehicle_id);
  else if (e.device_id) q = q.eq('spark_id', e.device_id);
  else q = q.eq('plate_number', e.plate_number!);
  const { data, error } = await q.limit(1);
  if (error) throw error;
  return (data?.[0] as VehicleRef | undefined) ?? null;
}

function describe(e: DeviceEvent, plate: string | null): string {
  if (e.message) return e.message;
  const who = plate ?? 'The vehicle';
  const speed = e.speed_kmph != null ? ` at ${Math.round(e.speed_kmph)} km/h` : '';
  switch (e.event as DeviceEventType) {
    case 'overspeed': return `${who} is overspeeding${speed}.`;
    case 'harsh_braking': return `${who} braked hard${speed}.`;
    case 'harsh_acceleration': return `${who} accelerated hard${speed}.`;
    case 'tamper': return `${who} reported tampering with the tracker.`;
    case 'low_fuel': return e.fuel_level_pct != null ? `${who} has ${Math.round(e.fuel_level_pct)}% fuel left.` : `${who} reported low fuel.`;
    case 'ignition': return `${who} ignition turned ${e.state ?? 'on or off'}.`;
    case 'geofence': return `${who} ${e.direction === 'exit' ? 'left' : e.direction === 'enter' ? 'entered' : 'crossed'} ${e.geofence ? `the ${e.geofence} area` : 'a geofence'}.`;
  }
}

/**
 * Validates and records device events. Invalid events and unknown vehicles are
 * reported per event and do not stop the others. `forceTest` marks every event as a test.
 */
export async function processDeviceEvents(rawEvents: unknown[], opts: { forceTest?: boolean } = {}): Promise<EventResult[]> {
  const results: EventResult[] = [];
  for (const [index, raw] of rawEvents.entries()) {
    const parsed = DeviceEventSchema.safeParse(raw);
    if (!parsed.success) {
      results.push({ index, status: 'invalid', detail: parsed.error.issues[0]?.message ?? 'Invalid event' });
      continue;
    }
    const e = parsed.data;
    const isTest = opts.forceTest || e.test === true;
    const vehicle = await findVehicle(e);
    if (!vehicle) {
      results.push({ index, status: 'unknown_vehicle', detail: 'No vehicle matches this device_id, vehicle_id or plate_number' });
      continue;
    }

    // A fuel level a real device reports is kept on the vehicle for health scores.
    if (e.fuel_level_pct != null && !isTest) {
      await supabase.from('vehicles')
        .update({ fuel_level_pct: e.fuel_level_pct, fuel_reported_at: e.timestamp ?? new Date().toISOString() })
        .eq('id', vehicle.id);
    }

    const r = await raiseAlert({
      vehicleId: vehicle.id,
      plate: vehicle.plate_number,
      type: e.event,
      severity: ALERT_META[e.event].severity,
      description: describe(e, vehicle.plate_number),
      source: 'webhook',
      isTest,
      details: {
        event_at: e.timestamp ?? null,
        latitude: e.latitude ?? null,
        longitude: e.longitude ?? null,
        speed_kmph: e.speed_kmph ?? null,
        fuel_level_pct: e.fuel_level_pct ?? null,
        state: e.state ?? null,
        direction: e.direction ?? null,
        geofence: e.geofence ?? null,
      },
    });
    results.push({ index, status: r.status, alert_id: r.alert_id });
  }
  return results;
}
