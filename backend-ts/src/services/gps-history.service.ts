/**
 * margixindia — GPS history (gps_points)
 *
 * Every accepted position, from any source (driver app, telemetry API, the
 * SparkGPS feed and push, a phone tracking link, a vehicle edit), is written
 * to gps_points through recordGpsPoints so the track of a vehicle is complete.
 * A point that adds nothing (under 20 m and under 30 s from the previous one)
 * is skipped, so a stationary vehicle or a chatty device does not flood the table.
 */
import { supabase } from '../core/supabase';
import { haversineKm, segmentKm } from './odometer';

/** A new point closer than this to the previous one is dropped, unless enough time has passed. */
export const GPS_MIN_DISTANCE_M = 20;
/** A new point sooner than this after the previous one is dropped, unless it moved far enough. */
export const GPS_MIN_INTERVAL_MS = 30_000;

/** Readings older than this, or further in the future than the slack, are stamped with the server time. */
const FIX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const FIX_MAX_FUTURE_MS = 5 * 60 * 1000;

export type GpsSource = 'driver_app' | 'telemetry' | 'spark_push' | 'spark_sync' | 'phone_link' | 'gps_api' | 'vehicle_update';

export interface GpsFix {
  latitude: number;
  longitude: number;
  /** ISO time the position was taken. */
  recorded_at: string;
  accuracy?: number | null;
  speed_kmph?: number | null;
  heading?: number | null;
}

interface PreviousPoint {
  latitude: number;
  longitude: number;
  recorded_at: string;
}

/** A real position: in range, and not 0,0 (how a missing fix usually arrives). */
export function isRealPosition(lat: unknown, lng: unknown): boolean {
  const la = Number(lat);
  const lo = Number(lng);
  return lat != null && lng != null && lat !== '' && lng !== ''
    && Number.isFinite(la) && Number.isFinite(lo)
    && Math.abs(la) <= 90 && Math.abs(lo) <= 180 && !(la === 0 && lo === 0);
}

/** The time a fix was taken, or now when it is missing, unreadable, from the future or older than a week. */
export function fixTime(value: unknown, now: number = Date.now()): string {
  const parsed = typeof value === 'string' || typeof value === 'number' ? new Date(value).getTime() : NaN;
  if (!Number.isFinite(parsed) || parsed > now + FIX_MAX_FUTURE_MS || parsed < now - FIX_MAX_AGE_MS) return new Date(now).toISOString();
  return new Date(parsed).toISOString();
}

/** Whether `next` should be stored after `prev`: it is far enough away, or late enough. */
export function shouldRecordPoint(prev: PreviousPoint | null, next: Pick<GpsFix, 'latitude' | 'longitude' | 'recorded_at'>): boolean {
  if (!prev) return true;
  const gapMs = Math.abs(Date.parse(next.recorded_at) - Date.parse(prev.recorded_at));
  if (!Number.isFinite(gapMs)) return true;
  if (gapMs >= GPS_MIN_INTERVAL_MS) return true;
  const metres = haversineKm(
    { lat: Number(prev.latitude), lng: Number(prev.longitude) },
    { lat: next.latitude, lng: next.longitude },
  ) * 1000;
  return metres >= GPS_MIN_DISTANCE_M;
}

async function latestPoint(vehicleId: string): Promise<PreviousPoint | null> {
  const { data, error } = await supabase
    .from('gps_points')
    .select('latitude, longitude, recorded_at')
    .eq('vehicle_id', vehicleId)
    .order('recorded_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  const rows = ((data ?? []) as PreviousPoint[]).slice().sort((a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at));
  return rows[0] ?? null;
}

const rounded = (n: number | null | undefined, digits: number): number | null =>
  n == null || !Number.isFinite(Number(n)) ? null : Math.round(Number(n) * 10 ** digits) / 10 ** digits;

/**
 * Store the fixes of one vehicle in gps_points, oldest first, skipping the ones
 * the throttle drops and any that are not real positions. Returns how many rows
 * were written. A failure is logged, never thrown: losing a history point must
 * not reject the position update that carried it.
 */
export async function recordGpsPoints(vehicleId: string, fixes: GpsFix[], source: GpsSource): Promise<number> {
  const real = fixes.filter(f => isRealPosition(f.latitude, f.longitude));
  if (real.length === 0) return 0;
  try {
    const ordered = [...real].sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at));
    let previous = await latestPoint(vehicleId);
    const rows: Record<string, unknown>[] = [];
    for (const fix of ordered) {
      if (!shouldRecordPoint(previous, fix)) continue;
      rows.push({
        vehicle_id: vehicleId,
        latitude: fix.latitude,
        longitude: fix.longitude,
        accuracy: rounded(fix.accuracy, 1),
        speed_kmph: rounded(fix.speed_kmph, 1),
        heading: rounded(fix.heading, 0),
        source,
        recorded_at: fix.recorded_at,
      });
      previous = fix;
    }
    if (rows.length === 0) return 0;
    const { error } = await supabase.from('gps_points').insert(rows);
    if (error) throw error;
    return rows.length;
  } catch (e) {
    console.error(`Could not record GPS history for vehicle ${vehicleId}:`, e instanceof Error ? e.message : e);
    return 0;
  }
}

/**
 * Make `fix` the vehicle's current position (and last-seen time) unless the
 * vehicle already reported something newer, adding the distance driven to the
 * odometer. Returns whether the vehicle row changed.
 */
export async function moveVehicleTo(
  vehicle: { id: string; latitude?: number | null; longitude?: number | null; last_heartbeat?: string | null; odometer_km?: number | null },
  fix: Pick<GpsFix, 'latitude' | 'longitude' | 'recorded_at'>,
): Promise<boolean> {
  const seen = vehicle.last_heartbeat ? Date.parse(vehicle.last_heartbeat) : NaN;
  if (Number.isFinite(seen) && seen > Date.parse(fix.recorded_at)) return false;
  const patch: Record<string, unknown> = { latitude: fix.latitude, longitude: fix.longitude, last_heartbeat: fix.recorded_at };
  if (vehicle.latitude != null && vehicle.longitude != null) {
    const km = segmentKm(
      { lat: Number(vehicle.latitude), lng: Number(vehicle.longitude), at: vehicle.last_heartbeat },
      { lat: fix.latitude, lng: fix.longitude, at: fix.recorded_at },
    );
    if (km > 0) {
      patch.odometer_km = Math.round(((Number(vehicle.odometer_km) || 0) + km) * 1000) / 1000;
      patch.odometer_updated_at = fix.recorded_at;
    }
  }
  const { error } = await supabase.from('vehicles').update(patch).eq('id', vehicle.id);
  if (error) throw error;
  return true;
}

export interface TrackPoint {
  lat: number;
  lng: number;
  at: string;
  speed_kmph: number | null;
  heading: number | null;
  accuracy: number | null;
}

export interface Track {
  vehicle_id: string;
  from: string;
  to: string;
  count: number;
  /** True when the window held more points than `limit`: the oldest were left out. */
  truncated: boolean;
  distance_km: number;
  points: TrackPoint[];
}

export const TRACK_DEFAULT_HOURS = 24;
export const TRACK_MAX_HOURS = 24 * 7;
export const TRACK_DEFAULT_LIMIT = 1000;
export const TRACK_MAX_LIMIT = 5000;
/** The database returns at most this many rows per request. */
const PAGE = 1000;

/** Total length of a track in km, ignoring GPS jitter under the recording distance. */
export function trackDistanceKm(points: { lat: number; lng: number }[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = haversineKm(points[i - 1], points[i]);
    if (d * 1000 >= GPS_MIN_DISTANCE_M) total += d;
  }
  return Math.round(total * 10) / 10;
}

/** The newest `limit` points of a vehicle between `from` and `to`, oldest first. */
export async function loadTrack(vehicleId: string, from: Date, to: Date, limit: number = TRACK_DEFAULT_LIMIT): Promise<Track> {
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const collected: Record<string, any>[] = [];
  // Fetch newest first in pages, so a long window keeps its most recent points.
  for (let offset = 0; offset < limit + 1; offset += PAGE) {
    const size = Math.min(PAGE, limit + 1 - offset);
    const { data, error } = await supabase
      .from('gps_points')
      .select('latitude, longitude, recorded_at, accuracy, speed_kmph, heading')
      .eq('vehicle_id', vehicleId)
      .gte('recorded_at', from.toISOString())
      .lte('recorded_at', to.toISOString())
      .order('recorded_at', { ascending: false })
      .range(offset, offset + size - 1);
    if (error) throw error;
    const page = data ?? [];
    collected.push(...page);
    if (page.length < size) break;
  }
  const inWindow = collected
    .filter(r => {
      const t = Date.parse(r.recorded_at);
      return Number.isFinite(t) && t >= fromMs && t <= toMs;
    })
    .sort((a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at));
  const truncated = inWindow.length > limit;
  const points: TrackPoint[] = inWindow.slice(0, limit).reverse().map(r => ({
    lat: Number(r.latitude),
    lng: Number(r.longitude),
    at: new Date(r.recorded_at).toISOString(),
    speed_kmph: r.speed_kmph == null ? null : Number(r.speed_kmph),
    heading: r.heading == null ? null : Number(r.heading),
    accuracy: r.accuracy == null ? null : Number(r.accuracy),
  }));
  return {
    vehicle_id: vehicleId,
    from: from.toISOString(),
    to: to.toISOString(),
    count: points.length,
    truncated,
    distance_km: trackDistanceKm(points),
    points,
  };
}
