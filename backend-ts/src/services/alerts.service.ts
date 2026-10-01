/**
 * Fleet alarms.
 *
 * Alarms are rows in maintenance_alerts. They come from two places:
 *  - device events posted to POST /telematics/webhook (overspeed, harsh braking, ...)
 *  - server-side rules on incoming telemetry (overspeed, low fuel) and a periodic
 *    sweep of active routes (long idle, GPS lost)
 *
 * There is at most one open alarm per vehicle and type (test alarms are kept apart
 * from real ones). A repeat of an open alarm raises its `occurrences` count and does
 * not notify staff again. Test alarms are marked `is_test` and never count in stats
 * or health scores.
 */
import { supabase } from '../core/supabase';
import { wsManager } from '../core/websocket';
import { notificationService } from './notification.service';
import { getAlertThresholds } from './alert-settings.service';
import { haversineKm } from './odometer';
import { lastSeenMs } from '../core/vehicles';
import { carrierStamp } from '../core/org-context';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export const DEVICE_EVENT_TYPES = [
  'overspeed', 'harsh_braking', 'harsh_acceleration', 'tamper', 'low_fuel', 'ignition', 'geofence',
] as const;
export type DeviceEventType = (typeof DEVICE_EVENT_TYPES)[number];

/** Alarms the server raises itself, in addition to the device event types. */
export type AlertType = DeviceEventType | 'long_idle' | 'gps_lost';

export const ALERT_META: Record<AlertType, { label: string; severity: Severity }> = {
  overspeed: { label: 'Overspeed', severity: 'high' },
  harsh_braking: { label: 'Harsh braking', severity: 'medium' },
  harsh_acceleration: { label: 'Harsh acceleration', severity: 'medium' },
  tamper: { label: 'Tamper', severity: 'critical' },
  low_fuel: { label: 'Low fuel', severity: 'high' },
  ignition: { label: 'Ignition', severity: 'low' },
  geofence: { label: 'Geofence', severity: 'medium' },
  long_idle: { label: 'Long idle', severity: 'medium' },
  gps_lost: { label: 'GPS lost', severity: 'high' },
};

export interface RaiseAlertInput {
  vehicleId: string;
  plate: string | null;
  type: AlertType;
  description: string;
  severity?: Severity;
  source: 'webhook' | 'rule';
  isTest?: boolean;
  details?: Record<string, unknown> | null;
}

export interface RaiseAlertResult {
  status: 'created' | 'repeat';
  alert_id: string | null;
}

/** Postgres unique violation: another request opened the same alarm first. */
const isUniqueViolation = (e: { code?: string } | null) => e?.code === '23505';

export async function raiseAlert(input: RaiseAlertInput): Promise<RaiseAlertResult> {
  const isTest = !!input.isTest;
  const now = new Date().toISOString();

  const { data: openRows, error: findErr } = await supabase
    .from('maintenance_alerts')
    .select('id, occurrences')
    .eq('vehicle_id', input.vehicleId)
    .eq('alert_type', input.type)
    .eq('is_resolved', false)
    .eq('is_test', isTest)
    .limit(1);
  if (findErr) throw findErr;

  const bumpRepeat = async (id: string, occurrences: number): Promise<RaiseAlertResult> => {
    const { error } = await supabase
      .from('maintenance_alerts')
      .update({ occurrences: occurrences + 1, last_seen_at: now })
      .eq('id', id);
    if (error) throw error;
    return { status: 'repeat', alert_id: id };
  };

  const open = openRows?.[0];
  if (open) return bumpRepeat(open.id, open.occurrences ?? 1);

  const severity = input.severity ?? ALERT_META[input.type].severity;
  const { data: created, error } = await supabase
    .from('maintenance_alerts')
    .insert({
      ...carrierStamp(),
      vehicle_id: input.vehicleId,
      alert_type: input.type,
      severity,
      description: input.description,
      is_resolved: false,
      status: 'open',
      source: input.source,
      is_test: isTest,
      details: input.details ?? null,
      occurrences: 1,
      created_at: now,
      last_seen_at: now,
    })
    .select('id')
    .single();

  if (isUniqueViolation(error)) {
    const { data: again } = await supabase
      .from('maintenance_alerts')
      .select('id, occurrences')
      .eq('vehicle_id', input.vehicleId)
      .eq('alert_type', input.type)
      .eq('is_resolved', false)
      .eq('is_test', isTest)
      .limit(1);
    if (again?.[0]) return bumpRepeat(again[0].id, again[0].occurrences ?? 1);
  }
  if (error || !created) throw error ?? new Error('Alert was not saved');

  const label = ALERT_META[input.type].label;
  const title = `${isTest ? 'Test alert: ' : ''}${label}${input.plate ? ` on ${input.plate}` : ''}`;
  try {
    await notificationService.notifyStaff(title, input.description, 'fleet_alert', {
      alert_id: created.id,
      vehicle_id: input.vehicleId,
      alert_type: input.type,
      is_test: isTest,
    });
    await wsManager.broadcast({
      type: severity === 'critical' ? 'ALERT_CRITICAL' : 'ALERT_WARNING',
      title,
      message: input.description,
      payload: { vehicle_id: input.vehicleId, plate_number: input.plate, alert_id: created.id },
    });
  } catch (e) {
    console.warn('Could not notify staff about a fleet alarm:', (e as Error).message);
  }
  return { status: 'created', alert_id: created.id };
}

/** Close open rule-raised alarms of a type once the condition has cleared. */
export async function autoResolve(vehicleId: string, type: AlertType): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('maintenance_alerts')
    .update({ is_resolved: true, status: 'resolved', resolved_at: now })
    .eq('vehicle_id', vehicleId)
    .eq('alert_type', type)
    .eq('is_resolved', false)
    .eq('source', 'rule')
    .eq('is_test', false);
  if (error) console.warn(`Could not auto-resolve ${type}:`, error.message);
}

// ── Rules on a telemetry ping ───────────────────────────────

export interface PingForRules {
  speedKmph: number | null;
  /** Only when a real device reported a fuel level. */
  fuelPct: number | null;
}

/** Overspeed and low-fuel rules; also clears GPS lost, since a ping has just arrived. */
export async function evaluatePing(vehicle: { id: string; plate_number: string | null }, ping: PingForRules): Promise<void> {
  try {
    const limits = await getAlertThresholds();
    const plate = vehicle.plate_number;
    await autoResolve(vehicle.id, 'gps_lost');

    if (ping.speedKmph != null && ping.speedKmph > limits.overspeed_kmph) {
      await raiseAlert({
        vehicleId: vehicle.id, plate, type: 'overspeed', source: 'rule',
        description: `${plate ?? 'The vehicle'} was going ${Math.round(ping.speedKmph)} km/h. The limit is ${limits.overspeed_kmph} km/h.`,
        details: { speed_kmph: ping.speedKmph, limit_kmph: limits.overspeed_kmph },
      });
    }
    if (ping.fuelPct != null) {
      if (ping.fuelPct < limits.low_fuel_pct) {
        await raiseAlert({
          vehicleId: vehicle.id, plate, type: 'low_fuel', source: 'rule',
          description: `${plate ?? 'The vehicle'} has ${Math.round(ping.fuelPct)}% fuel left. The alert level is ${limits.low_fuel_pct}%.`,
          details: { fuel_level_pct: ping.fuelPct, limit_pct: limits.low_fuel_pct },
        });
      } else {
        await autoResolve(vehicle.id, 'low_fuel');
      }
    }
  } catch (e) {
    // Alarm rules must never make a location update fail.
    console.warn('Alarm rules failed for a ping:', (e as Error).message);
  }
}

// ── Sweep of active routes: GPS lost and long idle ──────────

const IDLE_SPEED_KMPH = 3;
/** The vehicle is "in one place" when every ping in the window is within this distance. */
const IDLE_RADIUS_KM = 0.1;
/** The telemetry window must start within this share of the idle limit to count as covering it. */
const IDLE_COVERAGE = 0.2;

export async function runAlertSweep(nowMs: number = Date.now()): Promise<{ gpsLost: number; idle: number }> {
  const limits = await getAlertThresholds();
  const result = { gpsLost: 0, idle: 0 };

  const { data: routes, error } = await supabase
    .from('routes')
    .select('id, vehicle_id, started_at, vehicles(id, plate_number, status, last_heartbeat, last_sync)')
    .eq('status', 'active');
  if (error) throw error;

  for (const route of routes ?? []) {
    const v: any = Array.isArray(route.vehicles) ? route.vehicles[0] : route.vehicles;
    if (!v) continue;
    const plate: string | null = v.plate_number ?? null;

    const lastPing = lastSeenMs(v); // newer of heartbeat and sync: the same "last seen" the fleet views use
    const lostSince = lastPing ?? (route.started_at ? Date.parse(route.started_at) : null);

    if (lostSince != null && nowMs - lostSince > limits.gps_lost_minutes * 60_000) {
      const minutes = Math.round((nowMs - lostSince) / 60_000);
      await raiseAlert({
        vehicleId: v.id, plate, type: 'gps_lost', source: 'rule',
        description: lastPing
          ? `${plate ?? 'The vehicle'} is on an active trip but has sent no location for ${minutes} minutes.`
          : `${plate ?? 'The vehicle'} is on an active trip but has never sent a location.`,
        details: { last_ping_at: lastPing ? new Date(lastPing).toISOString() : null, limit_minutes: limits.gps_lost_minutes },
      });
      result.gpsLost++;
      continue;
    }

    if (v.status !== 'on_route') continue; // on a break, or not moving for another known reason
    const since = new Date(nowMs - limits.idle_minutes * 60_000).toISOString();
    const { data: pings, error: pErr } = await supabase
      .from('telemetry')
      .select('latitude, longitude, speed_kmph, timestamp')
      .eq('vehicle_id', v.id)
      .gte('timestamp', since)
      .order('timestamp', { ascending: true })
      .limit(500);
    if (pErr) throw pErr;
    const rows = pings ?? [];
    if (rows.length < 2) {
      await autoResolve(v.id, 'long_idle');
      continue;
    }
    const first = Date.parse(rows[0].timestamp);
    const covers = first - Date.parse(since) <= limits.idle_minutes * 60_000 * IDLE_COVERAGE;
    const anchor = { lat: rows[0].latitude, lng: rows[0].longitude };
    const stationary = rows.every(r => (r.speed_kmph ?? 0) <= IDLE_SPEED_KMPH
      && haversineKm(anchor, { lat: r.latitude, lng: r.longitude }) <= IDLE_RADIUS_KM);

    if (covers && stationary) {
      await raiseAlert({
        vehicleId: v.id, plate, type: 'long_idle', source: 'rule',
        description: `${plate ?? 'The vehicle'} has not moved for at least ${limits.idle_minutes} minutes during an active trip.`,
        details: { limit_minutes: limits.idle_minutes, latitude: anchor.lat, longitude: anchor.lng },
      });
      result.idle++;
    } else if (!stationary) {
      await autoResolve(v.id, 'long_idle');
    }
  }
  return result;
}

// ── Reading and updating alarms ─────────────────────────────

export interface AlertRow {
  id: string;
  vehicle_id: string;
  plate_number: string | null;
  type: string;
  severity: string | null;
  message: string | null;
  status: 'open' | 'acknowledged' | 'resolved';
  source: string | null;
  is_test: boolean;
  occurrences: number;
  details: Record<string, unknown> | null;
  created_at: string;
  last_seen_at: string | null;
  acknowledged_at: string | null;
  resolved_at: string | null;
}

/** Exactly what toAlertRow reads. */
const ALERT_COLUMNS = 'id, vehicle_id, alert_type, severity, description, status, is_resolved, source, is_test, occurrences, details, created_at, last_seen_at, acknowledged_at, resolved_at, vehicles(plate_number)';

function toAlertRow(a: any): AlertRow {
  return {
    id: a.id,
    vehicle_id: a.vehicle_id,
    plate_number: a.vehicles?.plate_number ?? null,
    type: a.alert_type,
    severity: a.severity ?? null,
    message: a.description ?? null,
    status: a.is_resolved ? 'resolved' : a.status === 'acknowledged' ? 'acknowledged' : 'open',
    source: a.source ?? null,
    is_test: !!a.is_test,
    occurrences: a.occurrences ?? 1,
    details: a.details ?? null,
    created_at: a.created_at,
    last_seen_at: a.last_seen_at ?? null,
    acknowledged_at: a.acknowledged_at ?? null,
    resolved_at: a.resolved_at ?? null,
  };
}

export async function listAlerts(opts: {
  status?: 'active' | 'resolved' | 'all';
  type?: string;
  vehicleId?: string;
  limit?: number;
}): Promise<AlertRow[]> {
  let q = supabase
    .from('maintenance_alerts')
    .select(ALERT_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(Math.min(opts.limit ?? 200, 500));
  if (opts.status === 'resolved') q = q.eq('is_resolved', true);
  else if (opts.status !== 'all') q = q.eq('is_resolved', false);
  if (opts.type) q = q.eq('alert_type', opts.type);
  if (opts.vehicleId) q = q.eq('vehicle_id', opts.vehicleId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(toAlertRow);
}

export async function acknowledgeAlert(id: string, userId: string): Promise<AlertRow | 'not_found' | 'resolved'> {
  const { data: existing, error } = await supabase.from('maintenance_alerts').select('id, is_resolved').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!existing) return 'not_found';
  if (existing.is_resolved) return 'resolved';
  const { data, error: uErr } = await supabase
    .from('maintenance_alerts')
    .update({ status: 'acknowledged', acknowledged_at: new Date().toISOString(), acknowledged_by: userId })
    .eq('id', id)
    .select(ALERT_COLUMNS)
    .single();
  if (uErr) throw uErr;
  return toAlertRow(data);
}

export async function resolveAlert(id: string, userId: string): Promise<AlertRow | 'not_found'> {
  const { data: existing, error } = await supabase.from('maintenance_alerts').select('id').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!existing) return 'not_found';
  const { data, error: uErr } = await supabase
    .from('maintenance_alerts')
    .update({ is_resolved: true, status: 'resolved', resolved_at: new Date().toISOString(), resolved_by: userId })
    .eq('id', id)
    .select(ALERT_COLUMNS)
    .single();
  if (uErr) throw uErr;
  return toAlertRow(data);
}

/** Counts for the alerts view. Test alarms are left out. */
export async function alertSummary(): Promise<{
  open: number;
  acknowledged: number;
  by_severity: Record<string, number>;
  last_30_days_by_type: Record<string, number>;
}> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [openRes, recentRes] = await Promise.all([
    supabase.from('maintenance_alerts').select('severity, status').eq('is_resolved', false).eq('is_test', false),
    supabase.from('maintenance_alerts').select('alert_type').eq('is_test', false).gte('created_at', since),
  ]);
  if (openRes.error) throw openRes.error;
  if (recentRes.error) throw recentRes.error;
  const out = { open: 0, acknowledged: 0, by_severity: {} as Record<string, number>, last_30_days_by_type: {} as Record<string, number> };
  for (const a of openRes.data ?? []) {
    if (a.status === 'acknowledged') out.acknowledged++;
    else out.open++;
    const sev = a.severity ?? 'unknown';
    out.by_severity[sev] = (out.by_severity[sev] ?? 0) + 1;
  }
  for (const a of recentRes.data ?? []) {
    out.last_30_days_by_type[a.alert_type] = (out.last_30_days_by_type[a.alert_type] ?? 0) + 1;
  }
  return out;
}
