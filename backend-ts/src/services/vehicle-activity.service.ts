/**
 * margixindia — What a vehicle is doing right now
 *
 * Derived from real records, nothing is stored:
 *  - carrying: an active route, a cargo manifest in transit, or a load on board
 *    (current_load_kg). Says which load or manifest, from where to where, and how full.
 *  - idle: reporting but not on a job; "since" comes from the GPS history
 *    (how long it has stayed in one place).
 *  - offline: not heard from within the GPS-lost limit (isLive, core/vehicles.ts).
 *    Any work it holds is still listed.
 */
import { supabase } from '../core/supabase';
import { HttpError } from '../core/errors';
import { isLive, lastSeenMs } from '../core/vehicles';
import { haversineKm } from './odometer';
import { getAlertThresholds } from './alert-settings.service';
import { loadTrack } from './gps-history.service';
import { selectIn } from './finance.service';

export type ActivityState = 'carrying' | 'idle' | 'offline';

/** A vehicle within this distance of where it stopped is still "in the same place". */
export const STATIONARY_RADIUS_M = 100;
/** How far back the GPS history is read to find where the vehicle last moved. */
const HISTORY_HOURS = 24;

export interface ActivityJob {
  kind: 'route' | 'manifest';
  id: string;
  status: string;
  from: string | null;
  to: string | null;
  /** Route only: the next stop still to do. */
  next_stop: string | null;
  stops_total: number | null;
  stops_done: number | null;
  weight_kg: number | null;
  tracking_ids: string[];
  started_at: string | null;
}

export interface VehicleActivity {
  vehicle_id: string;
  plate_number: string;
  state: ActivityState;
  vehicle_status: string;
  live: boolean;
  last_seen_at: string | null;
  /** carrying: when the job started; idle: when it stopped; offline: when it was last heard from. */
  since: string | null;
  position: { lat: number; lng: number } | null;
  place_name: string | null;
  load: {
    percent_full: number | null;
    load_kg: number | null;
    capacity_kg: number | null;
    /** Where the percentage comes from: the vehicle's reported load, the driver's declared %, or the manifests on board. */
    basis: 'reported' | 'declared' | 'manifest' | null;
  };
  jobs: ActivityJob[];
  /** Where and for how long the vehicle has stayed in one place, from the GPS history. */
  stationary: { since: string; minutes: number; at_least: boolean } | null;
  /** The last time the GPS history shows it moving out of where it now is. */
  last_moved_at: string | null;
}

interface HistoryPoint { lat: number; lng: number; at: string }

/**
 * How long the newest point has stayed in one place. Walks back from the newest
 * point while points stay within `radiusM` of it. `atLeast` is true when every
 * point in the history was in that place, so it may have been there longer.
 * `movedAt` is the time of the newest point outside the radius.
 */
export function stationarySince(
  points: HistoryPoint[],
  radiusM: number = STATIONARY_RADIUS_M,
): { since: string; movedAt: string | null; atLeast: boolean } | null {
  if (points.length === 0) return null;
  const ordered = [...points].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const newest = ordered[ordered.length - 1];
  let earliest = newest;
  for (let i = ordered.length - 2; i >= 0; i--) {
    if (haversineKm(newest, ordered[i]) * 1000 > radiusM) {
      return { since: earliest.at, movedAt: ordered[i].at, atLeast: false };
    }
    earliest = ordered[i];
  }
  return { since: earliest.at, movedAt: null, atLeast: true };
}

/** How full the vehicle is, as a whole percentage, and what the figure is based on. */
export function loadPercent(input: {
  capacityKg: number | null;
  currentLoadKg: number | null;
  declaredPercent: number | null;
  manifestKg: number | null;
}): { percent_full: number | null; load_kg: number | null; basis: 'reported' | 'declared' | 'manifest' | null } {
  const cap = input.capacityKg != null && input.capacityKg > 0 ? input.capacityKg : null;
  if (input.currentLoadKg != null && input.currentLoadKg > 0) {
    return { percent_full: cap ? Math.round((input.currentLoadKg / cap) * 100) : null, load_kg: input.currentLoadKg, basis: 'reported' };
  }
  if (input.declaredPercent != null && input.declaredPercent > 0) {
    return { percent_full: Math.round(input.declaredPercent), load_kg: cap ? Math.round((input.declaredPercent / 100) * cap) : null, basis: 'declared' };
  }
  if (input.manifestKg != null && input.manifestKg > 0) {
    return { percent_full: cap ? Math.round((input.manifestKg / cap) * 100) : null, load_kg: input.manifestKg, basis: 'manifest' };
  }
  return { percent_full: null, load_kg: null, basis: null };
}

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const placeOf = (dp: any): string | null => dp?.name || dp?.address || null;

export async function getVehicleActivity(vehicleId: string, now: number = Date.now()): Promise<VehicleActivity> {
  const { data: vehicle, error: vErr } = await supabase
    .from('vehicles')
    .select('id, plate_number, status, latitude, longitude, last_heartbeat, last_sync, current_location_name, capacity_kg, current_load_kg, declared_load_percentage')
    .eq('id', vehicleId)
    .maybeSingle();
  if (vErr) throw vErr;
  if (!vehicle) throw new HttpError(404, 'Vehicle not found');

  const [limits, routesRes, manifestsRes] = await Promise.all([
    getAlertThresholds(),
    supabase
      .from('routes')
      .select('id, status, started_at, depots(name), route_stops(id, sequence, status, delivery_points(name, address, shipment_id))')
      .eq('vehicle_id', vehicleId)
      .eq('status', 'active'),
    supabase
      .from('cargo_manifest')
      .select('id, status, pickup_location, drop_location, capacity_kg, updated_at')
      .eq('vehicle_id', vehicleId)
      .eq('status', 'in_transit'),
  ]);
  if (routesRes.error) throw routesRes.error;
  if (manifestsRes.error) throw manifestsRes.error;

  // Shipments on the active routes' stops, by tracking id
  const stopPoints = (routesRes.data ?? []).flatMap((r: any) => (r.route_stops ?? []).map((s: any) => ({ routeId: r.id as string, dp: one<any>(s.delivery_points) })));
  const shipmentIds = stopPoints.map(s => s.dp?.shipment_id).filter(Boolean) as string[];
  const shipments = shipmentIds.length ? await selectIn<any>('shipments', 'id', shipmentIds, 'id, tracking_id') : [];
  const trackingById = new Map(shipments.map(s => [s.id as string, s.tracking_id as string]));

  const jobs: ActivityJob[] = [];
  for (const r of (routesRes.data ?? []) as any[]) {
    const stops = [...(r.route_stops ?? [])].sort((a: any, b: any) => (a.sequence ?? 0) - (b.sequence ?? 0));
    const isDone = (s: any) => ['completed', 'delivered', 'skipped', 'failed'].includes(String(s.status));
    const done = stops.filter(isDone);
    const pending = stops.filter((s: any) => !isDone(s));
    const lastDone = done[done.length - 1];
    jobs.push({
      kind: 'route',
      id: r.id,
      status: r.status,
      from: one<any>(r.depots)?.name ?? placeOf(one<any>(lastDone?.delivery_points)),
      to: placeOf(one<any>(stops[stops.length - 1]?.delivery_points)),
      next_stop: placeOf(one<any>(pending[0]?.delivery_points)),
      stops_total: stops.length,
      stops_done: done.length,
      weight_kg: null,
      tracking_ids: [...new Set(stops.map((s: any) => trackingById.get(one<any>(s.delivery_points)?.shipment_id)).filter(Boolean) as string[])],
      started_at: r.started_at ?? null,
    });
  }
  for (const m of (manifestsRes.data ?? []) as any[]) {
    jobs.push({
      kind: 'manifest',
      id: m.id,
      status: m.status,
      from: m.pickup_location ?? null,
      to: m.drop_location ?? null,
      next_stop: null,
      stops_total: null,
      stops_done: null,
      weight_kg: num(m.capacity_kg),
      tracking_ids: [],
      started_at: m.updated_at ?? null,
    });
  }

  const live = isLive(vehicle, limits.gps_lost_minutes, now);
  const seen = lastSeenMs(vehicle);
  const lastSeenAt = seen != null ? new Date(seen).toISOString() : null;
  const manifestKg = jobs.filter(j => j.kind === 'manifest').reduce((sum, j) => sum + (j.weight_kg ?? 0), 0);
  const currentLoadKg = num(vehicle.current_load_kg);
  const loaded = jobs.length > 0 || (currentLoadKg ?? 0) > 0;
  const load = loadPercent({
    capacityKg: num(vehicle.capacity_kg),
    currentLoadKg,
    declaredPercent: num(vehicle.declared_load_percentage),
    manifestKg,
  });

  // Where it has stayed, from the GPS history
  let stationary: VehicleActivity['stationary'] = null;
  let lastMovedAt: string | null = null;
  if (live) {
    const track = await loadTrack(vehicleId, new Date(now - HISTORY_HOURS * 3_600_000), new Date(now), 1000);
    const found = stationarySince(track.points.map(p => ({ lat: p.lat, lng: p.lng, at: p.at })));
    if (found) {
      stationary = { since: found.since, minutes: Math.max(0, Math.round((now - Date.parse(found.since)) / 60_000)), at_least: found.atLeast };
      lastMovedAt = found.movedAt;
    }
  }

  const state: ActivityState = !live ? 'offline' : loaded ? 'carrying' : 'idle';
  const jobStart = jobs.map(j => (j.started_at ? Date.parse(j.started_at) : NaN)).filter(Number.isFinite);
  const since = state === 'offline'
    ? lastSeenAt
    : state === 'carrying'
      ? (jobStart.length ? new Date(Math.min(...jobStart)).toISOString() : null)
      : stationary?.since ?? null;

  const lat = num(vehicle.latitude);
  const lng = num(vehicle.longitude);
  return {
    vehicle_id: vehicle.id,
    plate_number: vehicle.plate_number,
    state,
    vehicle_status: String(vehicle.status),
    live,
    last_seen_at: lastSeenAt,
    since,
    position: lat != null && lng != null ? { lat, lng } : null,
    place_name: vehicle.current_location_name ?? null,
    load: { ...load, capacity_kg: num(vehicle.capacity_kg) },
    jobs,
    stationary,
    last_moved_at: lastMovedAt,
  };
}
