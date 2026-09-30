/**
 * margixindia — the optimize call: ML service first, in-process solver when it is not there.
 *
 * `planOptimization` returns a solution in the ML service's shape, the engine that
 * produced it, and for every route the stop order before and after (for the map).
 */
import { finalDeliveryPoint } from '../../core/destination';
import { haversineKm, isValidPoint, LatLng } from '../geo';
import { buildCostMatrix, CostMatrix } from './matrix';
import { logFallback, mlPost } from './ml-client';
import { measureOrder, solveVrp, SolverInput, SolverJob, SolverVehicle, UnassignedReason, Visit } from './vrp-solver';

export type OptimizerEngine = 'ml-service' | 'fallback-road-matrix' | 'fallback-estimated';
export type UnassignedWhy = UnassignedReason | 'no_location';

/** Minutes at each stop, the same the ML service is sent. */
export const STOP_SERVICE_MIN = 15;
/** A shipment whose pickup is this close to the depot is treated as loaded at the depot. */
export const PICKUP_MIN_DISTANCE_KM = 1;
/** The in-process solver never searches longer than this, whatever budget was asked for. */
const MAX_LOCAL_SEARCH_SECONDS = 5;
/** Extra time allowed for an ML optimize call beyond the solver's own time budget. */
const ML_TIMEOUT_MARGIN_SECONDS = 15;

export interface PlanNode {
  kind: 'pickup' | 'drop';
  seq: number;
  shipment_id: string;
  delivery_point_id: string | null;
  tracking_id: string | null;
  label: string | null;
  lat: number;
  lng: number;
}

export interface UnassignedShipment {
  shipment_id: string;
  tracking_id: string | null;
  weight_kg: number;
  reason: UnassignedWhy;
  message: string;
}

interface NodeInfo {
  kind: 'depot' | 'pickup' | 'drop';
  shipmentId?: string;
  deliveryPointId?: string | null;
  label?: string | null;
  lat: number;
  lng: number;
}

export interface PreparedProblem {
  points: LatLng[];
  nodes: NodeInfo[];
  jobs: SolverJob[];
  vehicles: SolverVehicle[];
  skipped: { shipmentId: string }[];
  /** Shipment id -> how it is described to the user. */
  meta: Map<string, { trackingId: string | null; weightKg: number }>;
  /** Shipment ids in the order they were booked: the "current order" the optimizer is compared with. */
  bookingOrder: string[];
  maxCapacityKg: number;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Turns depot, shipments and vehicles into solver input.
 * A shipment is one job: its final delivery point is the drop, and its origin is a pickup when it is
 * away from the depot and `withPickups` is on (the in-process solver plans them; the ML service does not).
 */
export function prepareProblem(depot: { latitude: unknown; longitude: unknown }, shipments: any[], vehicles: any[], withPickups: boolean): PreparedProblem {
  const depotPoint: LatLng = { lat: num(depot.latitude), lng: num(depot.longitude) };
  const points: LatLng[] = [depotPoint];
  const nodes: NodeInfo[] = [{ kind: 'depot', lat: depotPoint.lat, lng: depotPoint.lng }];
  const jobs: SolverJob[] = [];
  const skipped: { shipmentId: string }[] = [];
  const meta = new Map<string, { trackingId: string | null; weightKg: number }>();

  const booked = [...shipments].sort((a, b) => {
    const ta = Date.parse(a.created_at ?? '');
    const tb = Date.parse(b.created_at ?? '');
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
    return String(a.id).localeCompare(String(b.id));
  });

  for (const s of booked) {
    const weightKg = num(s.total_weight_kg ?? s.weight_kg);
    meta.set(s.id, { trackingId: s.tracking_id ?? null, weightKg });
    const dp = finalDeliveryPoint<any>(s.delivery_points);
    const drop: LatLng = { lat: Number(dp?.latitude ?? s.latitude), lng: Number(dp?.longitude ?? s.longitude) };
    if (!isValidPoint(drop)) { skipped.push({ shipmentId: s.id }); continue; }

    let pickupIdx: number | null = null;
    const origin: LatLng = { lat: Number(s.origin_lat), lng: Number(s.origin_lng) };
    if (withPickups && isValidPoint(origin) && haversineKm(origin, depotPoint) > PICKUP_MIN_DISTANCE_KM) {
      pickupIdx = points.length;
      points.push(origin);
      nodes.push({ kind: 'pickup', shipmentId: s.id, deliveryPointId: null, label: s.origin_name ?? s.origin_address ?? null, lat: origin.lat, lng: origin.lng });
    }
    const dropIdx = points.length;
    points.push(drop);
    nodes.push({ kind: 'drop', shipmentId: s.id, deliveryPointId: dp?.id ?? null, label: dp?.name ?? dp?.address ?? null, lat: drop.lat, lng: drop.lng });
    jobs.push({ id: s.id, dropIdx, pickupIdx, weightKg, serviceMin: STOP_SERVICE_MIN });
  }

  const solverVehicles: SolverVehicle[] = vehicles.map(v => ({ id: v.id, capacityKg: num(v.capacity_kg), startIdx: 0, endIdx: 0 }));
  return {
    points,
    nodes,
    jobs,
    vehicles: solverVehicles,
    skipped,
    meta,
    bookingOrder: booked.map(s => s.id),
    maxCapacityKg: solverVehicles.reduce((m, v) => Math.max(m, v.capacityKg), 0),
  };
}

function visitsFor(prep: PreparedProblem, jobIds: string[], withPickups: boolean): Visit[] {
  const byId = new Map(prep.jobs.map(j => [j.id, j]));
  return jobIds.flatMap((id): Visit[] => {
    const job = byId.get(id);
    if (!job) return [];
    return job.pickupIdx != null && withPickups
      ? [{ jobId: id, kind: 'pickup', nodeIdx: job.pickupIdx }, { jobId: id, kind: 'drop', nodeIdx: job.dropIdx }]
      : [{ jobId: id, kind: 'drop', nodeIdx: job.dropIdx }];
  });
}

export function planNodes(prep: PreparedProblem, visits: Visit[]): PlanNode[] {
  return visits.map((v, i) => {
    const node = prep.nodes[v.nodeIdx];
    return {
      kind: v.kind,
      seq: i + 1,
      shipment_id: v.jobId,
      delivery_point_id: node.deliveryPointId ?? null,
      tracking_id: prep.meta.get(v.jobId)?.trackingId ?? null,
      label: node.label ?? null,
      lat: node.lat,
      lng: node.lng,
    };
  });
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface RouteView {
  vehicle_id: string;
  /** The order the optimizer chose. */
  plan: PlanNode[];
  /** The same stops in the order they were booked. */
  before: { plan: PlanNode[]; total_distance_km: number; total_duration_minutes: number };
  after: { total_distance_km: number; total_duration_minutes: number };
  saved_km: number;
  saved_minutes: number;
}

function compare(prep: PreparedProblem, input: SolverInput, routes: { vehicleId: string; visits: Visit[] }[], withPickups: boolean): RouteView[] {
  const rank = new Map(prep.bookingOrder.map((id, i) => [id, i]));
  return routes.map(({ vehicleId, visits }) => {
    const vehicle = prep.vehicles.find(v => v.id === vehicleId)!;
    const jobIds = [...new Set(visits.map(v => v.jobId))].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
    const beforeVisits = visitsFor(prep, jobIds, withPickups);
    const before = measureOrder(input, vehicle, beforeVisits);
    const after = measureOrder(input, vehicle, visits);
    return {
      vehicle_id: vehicleId,
      plan: planNodes(prep, visits),
      before: { plan: planNodes(prep, beforeVisits), total_distance_km: r1(before.distanceKm), total_duration_minutes: r1(before.durationMin) },
      after: { total_distance_km: r1(after.distanceKm), total_duration_minutes: r1(after.durationMin) },
      saved_km: r1(before.distanceKm - after.distanceKm),
      saved_minutes: r1(before.durationMin - after.durationMin),
    };
  });
}

export function unassignedMessage(reason: UnassignedWhy, weightKg: number, maxCapacityKg: number): string {
  const kg = (n: number) => `${Math.round(n).toLocaleString('en-IN')} kg`;
  switch (reason) {
    case 'exceeds_vehicle_capacity': return `It weighs ${kg(weightKg)}, more than the largest selected vehicle can carry (${kg(maxCapacityKg)}).`;
    case 'fleet_capacity_full': return 'The selected vehicles are already full, so there is no capacity left for it.';
    case 'no_vehicle': return 'None of the selected vehicles has a capacity recorded, so nothing can be planned onto them.';
    case 'time_window': return 'No vehicle can reach it inside its time window.';
    case 'no_location': return 'Its delivery point has no valid coordinates.';
  }
}

function unassignedList(prep: PreparedProblem, reasons: Map<string, UnassignedWhy>): UnassignedShipment[] {
  return [...reasons].map(([id, reason]) => {
    const m = prep.meta.get(id);
    return {
      shipment_id: id,
      tracking_id: m?.trackingId ?? null,
      weight_kg: m?.weightKg ?? 0,
      reason,
      message: unassignedMessage(reason, m?.weightKg ?? 0, prep.maxCapacityKg),
    };
  });
}

export interface OptimizeArgs {
  depot: { id: string; latitude: unknown; longitude: unknown };
  shipments: any[];
  vehicles: any[];
  /** The exact body the ML service is sent. */
  mlPayload: { traffic_factor: number; weather_factor: number; algorithm: string };
  considerTraffic: boolean;
  maxSolveSeconds: number;
}

export interface OptimizeOutcome {
  /** In the ML service's shape, so the caller saves it the same way whichever engine produced it. */
  solution: any;
  engine: OptimizerEngine;
  /** Why the ML service was not used, and how distances were measured. Null when nothing needs saying. */
  engineNote: string | null;
  matrixSource: CostMatrix['source'] | null;
  /** True when any distance is straight-line x road factor rather than a routed value. */
  estimated: boolean;
  routes: RouteView[];
  unassigned: UnassignedShipment[];
  savedKm: number;
  savedMinutes: number;
  beforeKm: number;
}

function withEngineFigures(views: RouteView[]) {
  const savedKm = r1(views.reduce((s, v) => s + v.saved_km, 0));
  const savedMinutes = r1(views.reduce((s, v) => s + v.saved_minutes, 0));
  const beforeKm = r1(views.reduce((s, v) => s + v.before.total_distance_km, 0));
  return { savedKm, savedMinutes, beforeKm };
}

export async function planOptimization(args: OptimizeArgs): Promise<OptimizeOutcome> {
  const { mlPayload } = args;
  let mlSolution: any = null;
  let mlReason: string | null = null;
  try {
    const body = await mlPost('/optimize', mlPayload, { timeoutMs: (args.maxSolveSeconds + ML_TIMEOUT_MARGIN_SECONDS) * 1000, probe: true });
    if (!Array.isArray(body?.routes)) throw new Error('the reply had no routes');
    mlSolution = body;
  } catch (e) {
    mlReason = (e as Error).message;
    logFallback('optimize', e, 'the in-process solver');
  }

  if (mlSolution) return describeMlSolution(args, mlSolution);
  return solveInProcess(args, mlReason);
}

/** ML result: keep its routes, add the before/after view and the unassigned reasons. */
async function describeMlSolution(args: OptimizeArgs, solution: any): Promise<OptimizeOutcome> {
  const prep = prepareProblem(args.depot, args.shipments, args.vehicles, false);
  const matrix = await buildCostMatrix(prep.points, { traffic: args.considerTraffic, estimateTrafficFactor: args.mlPayload.traffic_factor });
  const input: SolverInput = { durationMin: matrix.durationMin, distanceKm: matrix.distanceKm, jobs: prep.jobs, vehicles: prep.vehicles };

  const known = new Set(prep.jobs.map(j => j.id));
  const routes = (solution.routes as any[])
    .filter(r => Array.isArray(r.stop_ids) && r.stop_ids.length > 0)
    .map(r => ({ vehicleId: r.vehicle_id as string, visits: visitsFor(prep, (r.stop_ids as string[]).filter(id => known.has(id)), false) }))
    .filter(r => prep.vehicles.some(v => v.id === r.vehicleId));
  const views = compare(prep, input, routes, false);

  const assigned = new Set(routes.flatMap(r => r.visits.map(v => v.jobId)));
  const reasons = new Map<string, UnassignedWhy>();
  for (const s of prep.skipped) reasons.set(s.shipmentId, 'no_location');
  const usable = prep.vehicles.filter(v => v.capacityKg > 0);
  for (const j of prep.jobs) {
    if (assigned.has(j.id)) continue;
    reasons.set(j.id, usable.length === 0 ? 'no_vehicle' : j.weightKg > prep.maxCapacityKg ? 'exceeds_vehicle_capacity' : 'fleet_capacity_full');
  }

  const figures = withEngineFigures(views);
  return {
    solution,
    engine: 'ml-service',
    engineNote: matrix.estimated ? 'Before and after are compared with straight-line distances (no road-routing key set).' : null,
    matrixSource: matrix.source,
    estimated: matrix.estimated,
    routes: views,
    unassigned: unassignedList(prep, reasons),
    ...figures,
  };
}

async function solveInProcess(args: OptimizeArgs, mlReason: string | null): Promise<OptimizeOutcome> {
  const started = Date.now();
  const prep = prepareProblem(args.depot, args.shipments, args.vehicles, true);
  const { traffic_factor: trafficFactor, weather_factor: weatherFactor } = args.mlPayload;
  const matrix = await buildCostMatrix(prep.points, { traffic: args.considerTraffic, estimateTrafficFactor: trafficFactor });
  // Weather is not in any routing provider's numbers, so it always scales the durations
  const input: SolverInput = {
    durationMin: matrix.durationMin.map(row => row.map(v => v * weatherFactor)),
    distanceKm: matrix.distanceKm,
    jobs: prep.jobs,
    vehicles: prep.vehicles,
    deadline: Date.now() + Math.min(args.maxSolveSeconds, MAX_LOCAL_SEARCH_SECONDS) * 1000,
  };
  const result = prep.jobs.length > 0 ? solveVrp(input) : { routes: [], unassigned: [], improvements: 0 };

  const views = compare(prep, input, result.routes.map(r => ({ vehicleId: r.vehicleId, visits: r.visits })), true);
  const figures = withEngineFigures(views);
  const efficiencyOf = (stops: number, km: number) => (stops ? Math.min(1, stops / (km / 5 + 1)) : 0);

  const byVehicle = new Map(args.vehicles.map(v => [v.id, v]));
  const routes = result.routes.map(r => {
    const drops = r.visits.filter(v => v.kind === 'drop');
    const efficiency = Number(byVehicle.get(r.vehicleId)?.fuel_efficiency_kmpl) || 10;
    return {
      vehicle_id: r.vehicleId,
      stop_ids: drops.map(v => v.jobId),
      total_distance_km: r2(r.distanceKm),
      total_duration_minutes: r1(r.durationMin),
      estimated_fuel_liters: r2(r.distanceKm / efficiency),
      // Routed durations already contain traffic; the estimate scales by the traffic factor
      traffic_delay_minutes: 0,
      weather_condition: 'clear',
      efficiency_score: r2(efficiencyOf(drops.length, r.distanceKm)),
    };
  });

  const reasons = new Map<string, UnassignedWhy>();
  for (const s of prep.skipped) reasons.set(s.shipmentId, 'no_location');
  for (const u of result.unassigned) reasons.set(u.jobId, u.reason);

  const totalKm = routes.reduce((s, r) => s + r.total_distance_km, 0);
  const engine: OptimizerEngine = matrix.estimated ? 'fallback-estimated' : 'fallback-road-matrix';
  const note = [
    mlReason ? `The ML service was not used (${mlReason}).` : null,
    matrix.estimated
      ? matrix.note
      : `Distances and times are road figures from ${matrix.source === 'mapbox' ? 'Mapbox' : 'TomTom'}.`,
  ].filter(Boolean).join(' ');

  return {
    solution: {
      routes,
      total_distance_km: r2(totalKm),
      total_fuel_liters: r2(routes.reduce((s, r) => s + r.estimated_fuel_liters, 0)),
      solve_time_seconds: (Date.now() - started) / 1000,
      savings_vs_naive_pct: figures.beforeKm > 0 ? r1((figures.savedKm / figures.beforeKm) * 100) : null,
      solver_status: 'in_process',
      algorithm: 'cheapest-insertion+2opt',
    },
    engine,
    engineNote: note || null,
    matrixSource: matrix.source,
    estimated: matrix.estimated,
    routes: views,
    unassigned: unassignedList(prep, reasons),
    ...figures,
  };
}
