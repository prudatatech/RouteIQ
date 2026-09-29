/**
 * margixindia — Driver performance
 *
 * Three real inputs, and nothing else:
 *   - planned arrival per route stop, worked out when a route is dispatched
 *   - actual arrival, stamped when the driver completes the stop
 *   - a 1 to 5 rating that staff give a delivered shipment
 * A stop counts as on time when it was reached no later than the planned
 * arrival plus the window in system_settings ('on_time_window_minutes', 30 by
 * default). Stops without a planned arrival (added after dispatch, or a route
 * with no duration) are left out of the on-time figure, not counted as late.
 */
import { supabase } from '../core/supabase';
import { HttpError } from '../core/errors';
import { selectIn } from './finance.service';

export const ON_TIME_WINDOW_KEY = 'on_time_window_minutes';
export const DEFAULT_ON_TIME_WINDOW_MINUTES = 30;

export async function getOnTimeWindowMinutes(): Promise<number> {
  const { data, error } = await supabase.from('system_settings').select('value').eq('key', ON_TIME_WINDOW_KEY).maybeSingle();
  if (error) throw new Error(`Failed to read on-time window: ${error.message}`);
  const raw: any = data?.value;
  const n = Number(raw && typeof raw === 'object' ? (raw.minutes ?? raw.value) : raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_ON_TIME_WINDOW_MINUTES;
}

const toRad = (d: number) => (d * Math.PI) / 180;
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

export interface PlanStop { id: string; lat: number | null; lng: number | null; serviceMinutes: number }

/**
 * Planned arrival for each stop, in order. The route's total duration (which
 * includes stop service time) is spread over the legs in proportion to their
 * straight-line length, then each stop's own service time is added before the
 * next leg. Returns null when it cannot be worked out (no duration, missing
 * coordinates, or no distance), so no time is invented.
 */
export function planArrivals(
  startAt: Date,
  start: { lat: number; lng: number } | null,
  stops: PlanStop[],
  totalDurationMinutes: number | null,
): Date[] | null {
  const total = Number(totalDurationMinutes);
  if (stops.length === 0 || !Number.isFinite(total) || total <= 0) return null;
  if (stops.some(s => s.lat == null || s.lng == null)) return null;

  const legs: number[] = [];
  let prev = start;
  for (const s of stops) {
    legs.push(prev ? haversineKm(prev.lat, prev.lng, s.lat!, s.lng!) : 0);
    prev = { lat: s.lat!, lng: s.lng! };
  }
  const totalKm = legs.reduce((a, b) => a + b, 0);
  if (totalKm <= 0) return null;

  const service = stops.reduce((a, s) => a + (s.serviceMinutes || 0), 0);
  const travelMinutes = total - service > 0 ? total - service : total;

  const out: Date[] = [];
  let elapsed = 0;
  stops.forEach((s, i) => {
    elapsed += (legs[i] / totalKm) * travelMinutes;
    out.push(new Date(startAt.getTime() + elapsed * 60_000));
    elapsed += total - service > 0 ? (s.serviceMinutes || 0) : 0;
  });
  return out;
}

/**
 * Called when a route is dispatched. Writes planned_arrival_at on its stops once;
 * a route whose stops already have one is left alone, so repeated status changes
 * do not move the plan. Never throws: dispatch must not fail because of this.
 */
export async function stampPlannedArrivals(routeId: string, startAt = new Date()): Promise<number> {
  try {
    const { data: route, error } = await supabase
      .from('routes')
      .select('id, total_duration_minutes, depot_id, vehicle_id')
      .eq('id', routeId)
      .maybeSingle();
    if (error || !route) return 0;

    const { data: rows, error: stopsErr } = await supabase
      .from('route_stops')
      .select('id, sequence, status, planned_arrival_at, delivery_point_id')
      .eq('route_id', routeId)
      .order('sequence', { ascending: true });
    if (stopsErr || !rows) return 0;
    if (rows.some((r: any) => r.planned_arrival_at)) return 0;

    const pending = rows.filter((r: any) => r.status === 'pending');
    if (pending.length === 0) return 0;

    let start: { lat: number; lng: number } | null = null;
    if (route.depot_id) {
      const { data: depot } = await supabase.from('depots').select('latitude, longitude').eq('id', route.depot_id).maybeSingle();
      if (depot?.latitude != null && depot?.longitude != null) start = { lat: Number(depot.latitude), lng: Number(depot.longitude) };
    }
    if (!start && route.vehicle_id) {
      const { data: vehicle } = await supabase.from('vehicles').select('latitude, longitude').eq('id', route.vehicle_id).maybeSingle();
      if (vehicle?.latitude != null && vehicle?.longitude != null) start = { lat: Number(vehicle.latitude), lng: Number(vehicle.longitude) };
    }

    const points = await selectIn<any>('delivery_points', 'id', pending.map((r: any) => r.delivery_point_id), 'id, latitude, longitude, service_time_minutes');
    const pointById = new Map(points.map(p => [p.id, p]));

    const plan = planArrivals(
      startAt,
      start,
      pending.map((r: any) => {
        const p = pointById.get(r.delivery_point_id);
        return {
          id: r.id,
          lat: p?.latitude != null ? Number(p.latitude) : null,
          lng: p?.longitude != null ? Number(p.longitude) : null,
          serviceMinutes: Number(p?.service_time_minutes) || 0,
        };
      }),
      route.total_duration_minutes,
    );
    if (!plan) return 0;

    for (let i = 0; i < pending.length; i++) {
      const { error: updErr } = await supabase
        .from('route_stops')
        .update({ planned_arrival_at: plan[i].toISOString() })
        .eq('id', pending[i].id)
        .is('planned_arrival_at', null);
      if (updErr) console.error(`[driver-performance] Failed to store planned arrival for stop ${pending[i].id}: ${updErr.message}`);
    }
    return pending.length;
  } catch (e: any) {
    console.error(`[driver-performance] Could not plan arrivals for route ${routeId}: ${e.message}`);
    return 0;
  }
}

/** Staff rate a delivered shipment; the rating stays with the vehicle and driver that carried it. */
export async function rateDelivery(shipmentId: string, rating: number, note: string | null, ratedBy: string) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, 'Rating must be a whole number from 1 to 5');
  const cleanNote = note ? String(note).trim().slice(0, 500) || null : null;

  const { data: shipment, error } = await supabase.from('shipments').select('id, status').eq('id', shipmentId).maybeSingle();
  if (error) throw new Error(`Failed to load shipment: ${error.message}`);
  if (!shipment) throw new HttpError(404, 'Shipment not found');
  if (shipment.status !== 'delivered') throw new HttpError(409, 'A shipment can be rated once it is delivered');

  const { data: points, error: pErr } = await supabase.from('delivery_points').select('id').eq('shipment_id', shipmentId);
  if (pErr) throw new Error(`Failed to load delivery points: ${pErr.message}`);
  const pointIds = (points ?? []).map((p: any) => p.id);
  const stops = pointIds.length
    ? await selectIn<any>('route_stops', 'delivery_point_id', pointIds, 'id, route_id, actual_arrival_at, created_at')
    : [];
  const routeIds = [...new Set(stops.map(s => s.route_id).filter(Boolean))];
  const routes = routeIds.length ? await selectIn<any>('routes', 'id', routeIds, 'id, vehicle_id, created_at') : [];
  // Latest route that carried it (a re-planned delivery may have been on several)
  const carrier = routes.filter(r => r.vehicle_id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  if (!carrier) throw new HttpError(409, 'This delivery is not linked to a vehicle, so there is no driver to rate');

  const { data: vehicle } = await supabase.from('vehicles').select('id, driver_id').eq('id', carrier.vehicle_id).maybeSingle();

  const { data: updated, error: updErr } = await supabase
    .from('shipments')
    .update({
      driver_rating: rating,
      driver_rating_note: cleanNote,
      driver_rated_at: new Date().toISOString(),
      driver_rated_by: ratedBy,
      rated_vehicle_id: carrier.vehicle_id,
      rated_driver_id: vehicle?.driver_id ?? null,
    })
    .eq('id', shipmentId)
    .select('id, driver_rating, driver_rating_note, driver_rated_at')
    .single();
  if (updErr) throw new Error(`Failed to save rating: ${updErr.message}`);
  return updated;
}

export interface VehicleDriverStats {
  deliveries: number;
  timed_deliveries: number;
  on_time_deliveries: number;
  on_time_pct: number | null;
  avg_rating: number | null;
  rating_count: number;
}

/** On-time and rating figures per vehicle, from completed stops and staff ratings. */
export async function getVehicleDriverStats(vehicleIds: string[]): Promise<Map<string, VehicleDriverStats>> {
  const out = new Map<string, VehicleDriverStats>();
  const blank = (): VehicleDriverStats => ({ deliveries: 0, timed_deliveries: 0, on_time_deliveries: 0, on_time_pct: null, avg_rating: null, rating_count: 0 });
  for (const id of vehicleIds) out.set(id, blank());
  if (vehicleIds.length === 0) return out;

  const windowMs = (await getOnTimeWindowMinutes()) * 60_000;

  const routes = await selectIn<any>('routes', 'vehicle_id', vehicleIds, 'id, vehicle_id');
  const vehicleByRoute = new Map(routes.map(r => [r.id, r.vehicle_id]));
  const stops = await selectIn<any>('route_stops', 'route_id', routes.map(r => r.id), 'route_id, status, planned_arrival_at, actual_arrival_at', q => q.eq('status', 'completed'));
  for (const s of stops) {
    const stat = out.get(vehicleByRoute.get(s.route_id));
    if (!stat) continue;
    stat.deliveries += 1;
    if (s.planned_arrival_at && s.actual_arrival_at) {
      stat.timed_deliveries += 1;
      if (new Date(s.actual_arrival_at).getTime() <= new Date(s.planned_arrival_at).getTime() + windowMs) stat.on_time_deliveries += 1;
    }
  }

  const rated = await selectIn<any>('shipments', 'rated_vehicle_id', vehicleIds, 'rated_vehicle_id, driver_rating', q => q.not('driver_rating', 'is', null));
  const sums = new Map<string, number>();
  for (const r of rated) {
    const stat = out.get(r.rated_vehicle_id);
    if (!stat || r.driver_rating == null) continue;
    stat.rating_count += 1;
    sums.set(r.rated_vehicle_id, (sums.get(r.rated_vehicle_id) ?? 0) + Number(r.driver_rating));
  }

  for (const [id, stat] of out) {
    if (stat.timed_deliveries > 0) stat.on_time_pct = Math.round((stat.on_time_deliveries / stat.timed_deliveries) * 1000) / 10;
    if (stat.rating_count > 0) stat.avg_rating = Math.round(((sums.get(id) ?? 0) / stat.rating_count) * 10) / 10;
  }
  return out;
}
