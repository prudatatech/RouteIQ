/**
 * margixindia — reroute evaluation without the ML service.
 *
 * Takes a vehicle's pending stops, measures the order they are in now from the
 * vehicle's position, and re-solves them with the in-process solver. The new
 * order is only offered when it is not longer than the current one.
 */
import { supabase } from '../../core/supabase';
import { isValidPoint, LatLng } from '../geo';
import { buildCostMatrix, CostMatrix } from './matrix';
import { measureOrder, solveVrp, SolverInput, SolverJob, SolverVehicle, Visit } from './vrp-solver';
import { STOP_SERVICE_MIN } from './optimize-engine';

export interface RerouteDecision {
  engine: 'ml-service' | 'fallback-road-matrix' | 'fallback-estimated';
  vehicle_id: string;
  route_id: string;
  trigger: string;
  saved_minutes: number;
  saved_km: number | null;
  /** Delivery point ids in the order to drive them. */
  new_stop_sequence: string[];
  old_stop_sequence: string[];
  old_eta_minutes: number | null;
  new_eta_minutes: number | null;
  old_distance_km: number | null;
  new_distance_km: number | null;
  estimated: boolean;
  matrix_source: CostMatrix['source'] | null;
}

export type RerouteEvaluation =
  | { ok: true; decision: RerouteDecision }
  | { ok: false; reason: 'no_route' | 'too_few_stops' | 'no_position' };

const r1 = (n: number) => Math.round(n * 10) / 10;

async function vehiclePosition(vehicleId: string): Promise<LatLng | null> {
  const { data: tele } = await supabase
    .from('telemetry')
    .select('latitude, longitude')
    .eq('vehicle_id', vehicleId)
    .order('timestamp', { ascending: false })
    .limit(1)
    .maybeSingle();
  const fromTelemetry = { lat: Number(tele?.latitude), lng: Number(tele?.longitude) };
  if (isValidPoint(fromTelemetry)) return fromTelemetry;
  const { data: vehicle } = await supabase.from('vehicles').select('latitude, longitude').eq('id', vehicleId).maybeSingle();
  const fromVehicle = { lat: Number(vehicle?.latitude), lng: Number(vehicle?.longitude) };
  return isValidPoint(fromVehicle) ? fromVehicle : null;
}

/**
 * Re-solves the remaining stops of the vehicle's open route.
 * The decision's `saved_minutes` is 0 when the current order is already the best found.
 */
export async function evaluateRerouteLocal(vehicleId: string, options: { traffic?: boolean; routeId?: string } = {}): Promise<RerouteEvaluation> {
  let routeQuery = supabase
    .from('routes')
    .select('id, status, vehicle_id')
    .eq('vehicle_id', vehicleId)
    .in('status', ['active', 'pending']);
  if (options.routeId) routeQuery = routeQuery.eq('id', options.routeId);
  const { data: routes } = await routeQuery.order('created_at', { ascending: false });
  const route = (routes ?? []).find((r: any) => r.status === 'active') ?? (routes ?? [])[0];
  if (!route) return { ok: false, reason: 'no_route' };

  const { data: stopRows } = await supabase
    .from('route_stops')
    .select('id, sequence, status, delivery_point_id, delivery_points(id, latitude, longitude)')
    .eq('route_id', route.id)
    .eq('status', 'pending')
    .order('sequence', { ascending: true });
  const stops = (stopRows ?? [])
    .map((s: any) => {
      const dp = Array.isArray(s.delivery_points) ? s.delivery_points[0] : s.delivery_points;
      return { id: String(s.delivery_point_id), point: { lat: Number(dp?.latitude), lng: Number(dp?.longitude) } };
    })
    .filter(s => isValidPoint(s.point));
  if (stops.length < 2) return { ok: false, reason: 'too_few_stops' };

  const start = await vehiclePosition(vehicleId);
  if (!start) return { ok: false, reason: 'no_position' };

  const points = [start, ...stops.map(s => s.point)];
  const matrix = await buildCostMatrix(points, { traffic: options.traffic ?? true, estimateTrafficFactor: 1.1 });
  const jobs: SolverJob[] = stops.map((s, i) => ({ id: s.id, dropIdx: i + 1, weightKg: 0, serviceMin: STOP_SERVICE_MIN }));
  const vehicle: SolverVehicle = { id: vehicleId, capacityKg: Number.MAX_SAFE_INTEGER, startIdx: 0, endIdx: null };
  const input: SolverInput = { durationMin: matrix.durationMin, distanceKm: matrix.distanceKm, jobs, vehicles: [vehicle], deadline: Date.now() + 3000 };

  const dropOf = (id: string): Visit => ({ jobId: id, kind: 'drop', nodeIdx: jobs.find(j => j.id === id)!.dropIdx });
  const currentOrder = stops.map(s => s.id);
  const current = measureOrder(input, vehicle, currentOrder.map(dropOf));
  const solved = solveVrp(input).routes[0];
  const better = solved && solved.durationMin < current.durationMin - 0.05;
  const chosen = better ? { order: solved.visits.map(v => v.jobId), figures: solved } : { order: currentOrder, figures: current };

  return {
    ok: true,
    decision: {
      engine: matrix.estimated ? 'fallback-estimated' : 'fallback-road-matrix',
      vehicle_id: vehicleId,
      route_id: route.id,
      trigger: 'Re-solved the remaining stops from the vehicle\'s current position',
      saved_minutes: better ? r1(current.durationMin - solved.durationMin) : 0,
      saved_km: better ? r1(current.distanceKm - solved.distanceKm) : 0,
      new_stop_sequence: chosen.order,
      old_stop_sequence: currentOrder,
      old_eta_minutes: r1(current.durationMin),
      new_eta_minutes: r1(chosen.figures.durationMin),
      old_distance_km: r1(current.distanceKm),
      new_distance_km: r1(chosen.figures.distanceKm),
      estimated: matrix.estimated,
      matrix_source: matrix.source,
    },
  };
}
