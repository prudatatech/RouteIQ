/**
 * margixindia — Which driver had which vehicle, and when.
 *
 * `driver_vehicle_assignments` is written by a database trigger whenever
 * vehicles.driver_id changes. Trips, earnings and performance belong to the
 * driver who had the vehicle at the time, not to whoever holds it now, so a
 * vehicle that was archived or handed to someone else still counts for the
 * right driver.
 */
import { supabase } from '../core/supabase';
import { selectIn } from './finance.service';
import { getOnTimeWindowMinutes } from './driver-performance.service';

export interface AssignmentWindow { vehicle_id: string; from: number; to: number }

export interface DriverWindows {
  windows: AssignmentWindow[];
  vehicleIds: string[];
  /** Vehicles the driver has right now. */
  currentVehicles: any[];
}

/**
 * Every window in which the driver had a vehicle. A vehicle the driver holds now
 * but that has no history row (data from before the trigger) counts for all time.
 */
export async function driverWindows(driverId: string, currentColumns = 'id, plate_number, vehicle_type, status'): Promise<DriverWindows> {
  const [history, current] = await Promise.all([
    supabase.from('driver_vehicle_assignments').select('vehicle_id, assigned_at, unassigned_at').eq('driver_id', driverId),
    supabase.from('vehicles').select(currentColumns).eq('driver_id', driverId),
  ]);
  if (history.error) throw new Error(`Failed to read assignments: ${history.error.message}`);
  if (current.error) throw new Error(`Failed to read vehicles: ${current.error.message}`);

  const windows: AssignmentWindow[] = (history.data ?? []).map((r: any) => ({
    vehicle_id: r.vehicle_id,
    from: r.assigned_at ? Date.parse(r.assigned_at) : -Infinity,
    to: r.unassigned_at ? Date.parse(r.unassigned_at) : Infinity,
  }));
  const currentVehicles = (current.data ?? []) as any[];
  for (const v of currentVehicles) {
    if (!windows.some(w => w.vehicle_id === v.id)) windows.push({ vehicle_id: v.id, from: -Infinity, to: Infinity });
  }
  return { windows, vehicleIds: [...new Set(windows.map(w => w.vehicle_id))], currentVehicles };
}

/** True when `at` (an ISO time) falls inside one of the driver's windows on that vehicle. */
export function inWindows(windows: AssignmentWindow[], vehicleId: string, at: string | null | undefined): boolean {
  const t = at ? Date.parse(at) : NaN;
  // A trip with no usable time only counts for a vehicle the driver has always had
  if (!Number.isFinite(t)) return windows.some(w => w.vehicle_id === vehicleId && w.from === -Infinity && w.to === Infinity);
  return windows.some(w => w.vehicle_id === vehicleId && t >= w.from && t <= w.to);
}

export interface DriverStats {
  deliveries: number;
  timed_deliveries: number;
  on_time_deliveries: number;
  on_time_pct: number | null;
  avg_rating: number | null;
  rating_count: number;
}

/** On-time and rating figures for one driver, counting only what happened while they had the vehicle. */
export async function getDriverStats(driverId: string, windows: AssignmentWindow[], vehicleIds: string[]): Promise<DriverStats> {
  const stats: DriverStats = { deliveries: 0, timed_deliveries: 0, on_time_deliveries: 0, on_time_pct: null, avg_rating: null, rating_count: 0 };
  if (vehicleIds.length === 0) return stats;
  const windowMs = (await getOnTimeWindowMinutes()) * 60_000;

  const routes = await selectIn<any>('routes', 'vehicle_id', vehicleIds, 'id, vehicle_id');
  const vehicleByRoute = new Map(routes.map(r => [r.id, r.vehicle_id]));
  const stops = await selectIn<any>('route_stops', 'route_id', routes.map(r => r.id),
    'route_id, status, planned_arrival_at, actual_arrival_at', q => q.eq('status', 'completed'));
  for (const s of stops) {
    if (!inWindows(windows, vehicleByRoute.get(s.route_id), s.actual_arrival_at)) continue;
    stats.deliveries += 1;
    if (s.planned_arrival_at && s.actual_arrival_at) {
      stats.timed_deliveries += 1;
      if (Date.parse(s.actual_arrival_at) <= Date.parse(s.planned_arrival_at) + windowMs) stats.on_time_deliveries += 1;
    }
  }

  const rated = await selectIn<any>('shipments', 'rated_vehicle_id', vehicleIds,
    'rated_vehicle_id, driver_rating, driver_rated_at', q => q.not('driver_rating', 'is', null));
  let sum = 0;
  for (const r of rated) {
    if (r.driver_rating == null || !inWindows(windows, r.rated_vehicle_id, r.driver_rated_at)) continue;
    stats.rating_count += 1;
    sum += Number(r.driver_rating);
  }
  if (stats.timed_deliveries > 0) stats.on_time_pct = Math.round((stats.on_time_deliveries / stats.timed_deliveries) * 1000) / 10;
  if (stats.rating_count > 0) stats.avg_rating = Math.round((sum / stats.rating_count) * 10) / 10;
  return stats;
}
