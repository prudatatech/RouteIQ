/**
 * margixindia — drop order for one vehicle, solved in-process.
 * Used for pooled loads when the ML service is not there.
 */
import { LatLng } from '../geo';
import { buildCostMatrix } from './matrix';
import { OptimizerEngine, STOP_SERVICE_MIN } from './optimize-engine';
import { solveVrp, SolverJob } from './vrp-solver';

/**
 * Best drop order for one vehicle leaving and returning to `depot`.
 * Null when the loads do not all fit in the vehicle.
 */
export async function orderDropsInProcess(
  depot: LatLng,
  vehicle: { id: string; capacityKg: number },
  loads: { id: string; lat: number; lng: number; weightKg: number }[],
): Promise<{ order: string[]; engine: OptimizerEngine } | null> {
  const points = [depot, ...loads.map(l => ({ lat: l.lat, lng: l.lng }))];
  const matrix = await buildCostMatrix(points, { traffic: true });
  const jobs: SolverJob[] = loads.map((l, i) => ({ id: l.id, dropIdx: i + 1, weightKg: l.weightKg, serviceMin: STOP_SERVICE_MIN }));
  const result = solveVrp({
    durationMin: matrix.durationMin,
    distanceKm: matrix.distanceKm,
    jobs,
    vehicles: [{ id: vehicle.id, capacityKg: vehicle.capacityKg, startIdx: 0, endIdx: 0 }],
    deadline: Date.now() + 3000,
  });
  const route = result.routes[0];
  if (!route || result.unassigned.length > 0) return null;
  return { order: route.visits.map(v => v.jobId), engine: matrix.estimated ? 'fallback-estimated' : 'fallback-road-matrix' };
}
