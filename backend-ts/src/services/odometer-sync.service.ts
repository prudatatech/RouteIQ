/**
 * Odometer automation.
 *
 * `syncVehicleOdometer` adds the distance a vehicle has driven since its odometer was last
 * updated (`odometer_updated_at`):
 *  1. from its GPS points (gps_points), by haversine over the ordered points with GPS noise
 *     left out (see `cleanPathKm`): weak fixes, jitter while parked, and impossible jumps;
 *  2. when there are no points in that window, from the routes it completed (their planned
 *     distance) and the loads it delivered (straight line pickup to drop, so a minimum).
 * The reading never goes down by itself. Staff can still type a reading, but a lower one needs a
 * reason (`setOdometerReading`). Every change is kept in vehicle_odometer_events.
 */
import { supabase } from '../core/supabase';
import { HttpError } from '../core/errors';
import { cleanPathKm, haversineKm, MAX_ACCURACY_M, roundKm, type PingPoint } from './odometer';

export type OdometerSource = 'gps' | 'routes' | 'manual';

export interface OdometerSyncResult {
  vehicle_id: string;
  plate_number: string;
  /** False when nothing was added (parked, no new data, or no starting reading). */
  changed: boolean;
  before_km: number | null;
  after_km: number | null;
  added_km: number;
  /** Where the added distance came from; `none` when there was nothing to add. */
  source: OdometerSource | 'none';
  points_used: number;
  points_ignored: number;
  /** Start of the window that was counted. */
  since: string | null;
  synced_at: string;
  message: string;
}

/** Most points read in one sync; a longer backlog is worked through over the next syncs. */
export const MAX_POINTS_PER_SYNC = 5000;

const num = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

interface OdoVehicle {
  id: string;
  plate_number: string;
  status: string;
  odometer_km: number | null;
  odometer_updated_at: string | null;
}

async function loadVehicle(vehicleId: string): Promise<OdoVehicle> {
  const { data, error } = await supabase
    .from('vehicles')
    .select('id, plate_number, status, odometer_km, odometer_updated_at')
    .eq('id', vehicleId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'Vehicle not found');
  return data as OdoVehicle;
}

/** Distance from routes completed and loads delivered after `since`. */
async function distanceFromJourneys(vehicleId: string, since: string): Promise<{ km: number; latest: string | null; count: number }> {
  const [routes, loads] = await Promise.all([
    supabase.from('routes').select('id, total_distance_km, completed_at')
      .eq('vehicle_id', vehicleId).eq('status', 'completed').gt('completed_at', since),
    supabase.from('cargo_manifest').select('id, pickup_lat, pickup_lng, drop_lat, drop_lng, updated_at')
      .eq('vehicle_id', vehicleId).in('status', ['delivered', 'completed']).gt('updated_at', since),
  ]);
  if (routes.error) throw routes.error;
  if (loads.error) throw loads.error;
  let km = 0;
  let count = 0;
  let latest: string | null = null;
  const seen = (t: string | null) => { if (t && (!latest || t > latest)) latest = t; };
  // A route planned with no distance counts the distance its driver-pay entry used (driven, else the stops in a line)
  const unplanned = (routes.data ?? []).filter(r => !((num(r.total_distance_km) ?? 0) > 0)).map(r => r.id as string);
  const paid = new Map<string, number>();
  if (unplanned.length > 0) {
    const { data: entries, error: entryErr } = await supabase.from('driver_pay_entries').select('route_id, km').in('route_id', unplanned);
    if (entryErr) throw entryErr;
    for (const e of entries ?? []) paid.set(e.route_id as string, num(e.km) ?? 0);
  }
  for (const r of routes.data ?? []) {
    const planned = num(r.total_distance_km) ?? 0;
    const effective = planned > 0 ? planned : (paid.get(r.id as string) ?? 0);
    if (effective > 0) { km += effective; count++; seen(r.completed_at); }
  }
  for (const l of loads.data ?? []) {
    const aLat = num(l.pickup_lat);
    const aLng = num(l.pickup_lng);
    const bLat = num(l.drop_lat);
    const bLng = num(l.drop_lng);
    if (aLat == null || aLng == null || bLat == null || bLng == null) continue;
    const d = haversineKm({ lat: aLat, lng: aLng }, { lat: bLat, lng: bLng });
    if (Number.isFinite(d) && d > 0) { km += d; count++; seen(l.updated_at); }
  }
  return { km, latest, count };
}

/**
 * Add the distance driven since the odometer was last updated. Safe to run repeatedly: the window
 * moves forward each time, and a write is refused if the reading changed while it was being worked out.
 */
export async function syncVehicleOdometer(
  vehicleId: string,
  opts: { userId?: string | null; now?: Date } = {},
): Promise<OdometerSyncResult> {
  const now = opts.now ?? new Date();
  const vehicle = await loadVehicle(vehicleId);
  const before = num(vehicle.odometer_km);
  const since = vehicle.odometer_updated_at;
  const base = { vehicle_id: vehicle.id, plate_number: vehicle.plate_number, before_km: before, since, synced_at: now.toISOString() };

  if (before == null || !since) {
    return {
      ...base, changed: false, after_km: before, added_km: 0, source: 'none', points_used: 0, points_ignored: 0,
      message: 'Enter the dashboard reading first, so we know where to count from.',
    };
  }

  // The last point at or before the window start joins the first point after it to the path
  const [anchorRes, pointsRes] = await Promise.all([
    supabase.from('gps_points').select('latitude, longitude, recorded_at')
      .eq('vehicle_id', vehicleId).lte('recorded_at', since).order('recorded_at', { ascending: false }).limit(1),
    supabase.from('gps_points').select('latitude, longitude, accuracy, recorded_at')
      .eq('vehicle_id', vehicleId).gt('recorded_at', since).order('recorded_at', { ascending: true }).limit(MAX_POINTS_PER_SYNC),
  ]);
  if (anchorRes.error) throw anchorRes.error;
  if (pointsRes.error) throw pointsRes.error;

  const rows = [...(pointsRes.data ?? [])].sort((a, b) => String(a.recorded_at).localeCompare(String(b.recorded_at)));
  const anchorRow = [...(anchorRes.data ?? [])].sort((a, b) => String(b.recorded_at).localeCompare(String(a.recorded_at)))[0];

  let source: OdometerSyncResult['source'] = 'none';
  let addedRaw = 0;
  let used = 0;
  let ignored = 0;
  let watermark: string | null = null;
  let message = 'No new movement recorded since the last update.';

  if (rows.length > 0) {
    const usable: PingPoint[] = [];
    for (const r of rows) {
      const lat = num(r.latitude);
      const lng = num(r.longitude);
      const acc = num(r.accuracy);
      if (lat == null || lng == null || (acc != null && acc > MAX_ACCURACY_M)) { ignored++; continue; }
      usable.push({ lat, lng, at: r.recorded_at });
    }
    const anchorLat = anchorRow ? num(anchorRow.latitude) : null;
    const anchorLng = anchorRow ? num(anchorRow.longitude) : null;
    const anchor = anchorLat != null && anchorLng != null ? { lat: anchorLat, lng: anchorLng, at: anchorRow.recorded_at as string } : null;
    const path = cleanPathKm(anchor, usable);
    addedRaw = path.km;
    used = usable.length - path.rejected;
    ignored += path.rejected;
    source = 'gps';
    watermark = rows[rows.length - 1].recorded_at as string;
    message = addedRaw > 0 ? 'Added the distance driven, counted from GPS.' : 'GPS shows no movement since the last update.';
  } else {
    const journeys = await distanceFromJourneys(vehicleId, since);
    if (journeys.km > 0) {
      addedRaw = journeys.km;
      used = journeys.count;
      source = 'routes';
      watermark = journeys.latest;
      message = 'No GPS points in this period, so the distance of completed trips and loads was added.';
    }
  }

  const added = roundKm(addedRaw);
  const after = roundKm(before + added);
  const patch: Record<string, unknown> = { odometer_km: after, odometer_synced_at: base.synced_at };
  if (source !== 'none') patch.odometer_source = source;
  if (watermark) patch.odometer_updated_at = watermark;

  const { data: written, error } = await supabase
    .from('vehicles').update(patch).eq('id', vehicle.id).eq('odometer_km', before).select('id').maybeSingle();
  if (error) throw error;
  if (!written) throw new HttpError(409, 'The odometer changed while syncing. Try again.');

  if (added > 0) {
    const { error: evErr } = await supabase.from('vehicle_odometer_events').insert({
      vehicle_id: vehicle.id, kind: 'auto_sync', before_km: before, after_km: after, source,
      reason: null, created_by: opts.userId ?? null,
    });
    if (evErr) console.warn('[odometer] Could not record the sync event:', evErr.message);
  }

  return {
    ...base, changed: added > 0, after_km: after, added_km: added, source: added > 0 ? source : 'none',
    points_used: used, points_ignored: ignored, message,
  };
}

/**
 * A trip just finished: take its distance into the odometer now, not at the next scheduled sync.
 * Does nothing for a vehicle with no starting reading. Never throws, so it cannot stop a trip finishing.
 */
export async function syncOdometerAfterTripSafe(vehicleId: string): Promise<void> {
  try {
    await syncVehicleOdometer(vehicleId);
  } catch (e: any) {
    console.error(`[odometer] Could not sync vehicle ${vehicleId} after a trip:`, e?.message ?? e);
  }
}

/** Sync every vehicle that has a starting reading. One vehicle failing does not stop the rest. */
export async function syncAllOdometers(now: Date = new Date()): Promise<{ checked: number; updated: number; failed: number }> {
  const { data, error } = await supabase.from('vehicles').select('id, status, odometer_km').neq('status', 'archived');
  if (error) throw error;
  const targets = (data ?? []).filter(v => v.odometer_km != null);
  let updated = 0;
  let failed = 0;
  for (const v of targets) {
    try {
      const r = await syncVehicleOdometer(v.id, { now });
      if (r.changed) updated++;
    } catch (e: any) {
      failed++;
      console.error(`[odometer] Sync failed for vehicle ${v.id}:`, e?.message ?? e);
    }
  }
  return { checked: targets.length, updated, failed };
}

/**
 * Staff enter the reading on the dashboard. It may not go down without a reason: a lower reading
 * is kept as a correction with that reason.
 */
export async function setOdometerReading(
  vehicleId: string,
  km: number,
  opts: { reason?: string | null; userId?: string | null; now?: Date } = {},
): Promise<{ id: string; odometer_km: number; odometer_updated_at: string; odometer_source: OdometerSource; kind: 'manual' | 'correction' }> {
  const vehicle = await loadVehicle(vehicleId);
  const current = num(vehicle.odometer_km);
  const reason = opts.reason?.trim() || null;
  const lower = current != null && km < current;
  if (lower && (!reason || reason.length < 3)) {
    throw new HttpError(
      400,
      `${Math.round(km).toLocaleString('en-IN')} km is lower than the current ${Math.round(current!).toLocaleString('en-IN')} km. Add a reason to correct the reading downwards.`,
      { requires_reason: true, current_km: current },
    );
  }
  const at = (opts.now ?? new Date()).toISOString();
  const { error } = await supabase
    .from('vehicles').update({ odometer_km: km, odometer_updated_at: at, odometer_source: 'manual' }).eq('id', vehicle.id);
  if (error) throw error;
  const kind = lower ? 'correction' : 'manual';
  if (current !== km) {
    const { error: evErr } = await supabase.from('vehicle_odometer_events').insert({
      vehicle_id: vehicle.id, kind, before_km: current, after_km: km, source: 'manual', reason, created_by: opts.userId ?? null,
    });
    if (evErr) console.warn('[odometer] Could not record the reading event:', evErr.message);
  }
  return { id: vehicle.id, odometer_km: km, odometer_updated_at: at, odometer_source: 'manual', kind };
}
