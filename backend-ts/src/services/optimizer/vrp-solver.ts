/**
 * margixindia — in-process vehicle routing solver.
 *
 * Used when the Python ML service cannot be reached. Pure: it works on node
 * indexes and a cost matrix, so it is tested without any network.
 *
 *   1. Construction: cheapest insertion, hardest jobs first.
 *   2. Improvement: 2-opt and or-opt inside a route, relocate between routes,
 *      repeated until nothing improves or the time budget is used.
 *
 * Constraints: vehicle capacity (kg, over the whole route including pickups
 * that add load and drops that release it), pickup before drop, and optional
 * time windows (minutes from the route start).
 */

export interface SolverJob {
  id: string;
  /** Node index of the drop. */
  dropIdx: number;
  /** Node index of the pickup. Null or undefined: the load is already on board at the start. */
  pickupIdx?: number | null;
  weightKg: number;
  /** Minutes spent at each of the job's stops. */
  serviceMin?: number;
  /** Arrival window at the drop, minutes from the start. */
  window?: { start: number; end: number } | null;
}

export interface SolverVehicle {
  id: string;
  capacityKg: number;
  startIdx: number;
  /** Where the route ends. Null: the route is open and ends at the last stop. */
  endIdx: number | null;
}

export type UnassignedReason = 'no_vehicle' | 'exceeds_vehicle_capacity' | 'fleet_capacity_full' | 'time_window';

export interface Visit {
  jobId: string;
  kind: 'pickup' | 'drop';
  nodeIdx: number;
}

export interface SolverRoute {
  vehicleId: string;
  visits: Visit[];
  /** Kilometres driven, including the leg back to the end node. */
  distanceKm: number;
  /** Minutes driving. */
  driveMin: number;
  /** Minutes driving plus service time. */
  durationMin: number;
  peakLoadKg: number;
}

export interface SolverInput {
  /** Driving minutes between nodes. This is what the solver minimises. */
  durationMin: number[][];
  distanceKm: number[][];
  jobs: SolverJob[];
  vehicles: SolverVehicle[];
  /** Stop improving at this wall-clock time (Date.now() milliseconds). */
  deadline?: number;
  /** Minute the vehicles leave, for time windows. Default 0. */
  startMinute?: number;
}

export interface SolverResult {
  routes: SolverRoute[];
  unassigned: { jobId: string; reason: UnassignedReason }[];
  improvements: number;
}

const EPS = 1e-6;

interface Evaluation {
  feasible: boolean;
  cost: number;
  distanceKm: number;
  driveMin: number;
  durationMin: number;
  peakLoadKg: number;
}

const INFEASIBLE: Evaluation = { feasible: false, cost: Infinity, distanceKm: Infinity, driveMin: Infinity, durationMin: Infinity, peakLoadKg: Infinity };

class Problem {
  readonly jobById = new Map<string, SolverJob>();
  constructor(readonly input: SolverInput) {
    for (const j of input.jobs) this.jobById.set(j.id, j);
  }

  /**
   * Cost and feasibility of driving `visits` with `vehicle`.
   * Checks that pickups come before their drops, that both halves of a job are present,
   * capacity along the way, and time windows (unless ignored).
   */
  evaluate(vehicle: SolverVehicle, visits: Visit[], ignoreWindows = false): Evaluation {
    const { durationMin, distanceKm } = this.input;
    const pickedUp = new Set<string>();
    const dropped = new Set<string>();
    let load = 0;
    for (const v of visits) {
      const job = this.jobById.get(v.jobId)!;
      if (v.kind === 'drop' && job.pickupIdx == null) load += job.weightKg;
    }
    let peak = load;
    if (load > vehicle.capacityKg + EPS) return INFEASIBLE;

    let t = this.input.startMinute ?? 0;
    let at = vehicle.startIdx;
    let drive = 0;
    let km = 0;
    let service = 0;
    for (const v of visits) {
      const job = this.jobById.get(v.jobId)!;
      const leg = durationMin[at][v.nodeIdx];
      drive += leg;
      km += distanceKm[at][v.nodeIdx];
      t += leg;
      if (v.kind === 'pickup') {
        if (job.pickupIdx == null) return INFEASIBLE;
        pickedUp.add(v.jobId);
        load += job.weightKg;
        if (load > peak) peak = load;
        if (load > vehicle.capacityKg + EPS) return INFEASIBLE;
      } else {
        if (job.pickupIdx != null && !pickedUp.has(v.jobId)) return INFEASIBLE;
        dropped.add(v.jobId);
        load -= job.weightKg;
        if (!ignoreWindows && job.window) {
          if (t < job.window.start) t = job.window.start;
          if (t > job.window.end + EPS) return INFEASIBLE;
        }
      }
      const svc = job.serviceMin ?? 0;
      t += svc;
      service += svc;
      at = v.nodeIdx;
    }
    for (const id of pickedUp) if (!dropped.has(id)) return INFEASIBLE;
    if (vehicle.endIdx != null) {
      drive += durationMin[at][vehicle.endIdx];
      km += distanceKm[at][vehicle.endIdx];
    }
    return { feasible: true, cost: drive, distanceKm: km, driveMin: drive, durationMin: drive + service, peakLoadKg: peak };
  }

  visitsOf(job: SolverJob): Visit[] {
    return job.pickupIdx == null
      ? [{ jobId: job.id, kind: 'drop', nodeIdx: job.dropIdx }]
      : [{ jobId: job.id, kind: 'pickup', nodeIdx: job.pickupIdx }, { jobId: job.id, kind: 'drop', nodeIdx: job.dropIdx }];
  }
}

interface WorkingRoute { vehicle: SolverVehicle; visits: Visit[]; cost: number }

/** Every way to put a job's stops into `visits`, pickup first. */
function* insertions(problem: Problem, job: SolverJob, visits: Visit[]): Generator<Visit[]> {
  if (job.pickupIdx == null) {
    const drop: Visit = { jobId: job.id, kind: 'drop', nodeIdx: job.dropIdx };
    for (let i = 0; i <= visits.length; i++) yield [...visits.slice(0, i), drop, ...visits.slice(i)];
    return;
  }
  const [pickup, drop] = problem.visitsOf(job);
  for (let i = 0; i <= visits.length; i++) {
    for (let j = i; j <= visits.length; j++) {
      yield [...visits.slice(0, i), pickup, ...visits.slice(i, j), drop, ...visits.slice(j)];
    }
  }
}

function bestInsertion(problem: Problem, job: SolverJob, routes: WorkingRoute[], ignoreWindows = false, skip?: WorkingRoute):
  { route: WorkingRoute; visits: Visit[]; cost: number; delta: number } | null {
  let best: { route: WorkingRoute; visits: Visit[]; cost: number; delta: number } | null = null;
  for (const route of routes) {
    if (route === skip) continue;
    for (const candidate of insertions(problem, job, route.visits)) {
      const ev = problem.evaluate(route.vehicle, candidate, ignoreWindows);
      if (!ev.feasible) continue;
      const delta = ev.cost - route.cost;
      if (!best || delta < best.delta - EPS) best = { route, visits: candidate, cost: ev.cost, delta };
    }
  }
  return best;
}

function tryImprove(problem: Problem, route: WorkingRoute, candidate: Visit[]): boolean {
  const ev = problem.evaluate(route.vehicle, candidate);
  if (ev.feasible && ev.cost < route.cost - EPS) {
    route.visits = candidate;
    route.cost = ev.cost;
    return true;
  }
  return false;
}

function twoOpt(problem: Problem, route: WorkingRoute): boolean {
  const n = route.visits.length;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const candidate = [...route.visits.slice(0, i), ...route.visits.slice(i, j + 1).reverse(), ...route.visits.slice(j + 1)];
      if (tryImprove(problem, route, candidate)) return true;
    }
  }
  return false;
}

/** Moves a run of 1 to 3 stops to another place in the same route. */
function orOpt(problem: Problem, route: WorkingRoute): boolean {
  const n = route.visits.length;
  for (let len = 1; len <= Math.min(3, n - 1); len++) {
    for (let i = 0; i + len <= n; i++) {
      const segment = route.visits.slice(i, i + len);
      const rest = [...route.visits.slice(0, i), ...route.visits.slice(i + len)];
      for (let k = 0; k <= rest.length; k++) {
        if (k === i) continue;
        const candidate = [...rest.slice(0, k), ...segment, ...rest.slice(k)];
        if (tryImprove(problem, route, candidate)) return true;
      }
    }
  }
  return false;
}

/** Takes a job out of one route and puts it where it fits best in another, when that lowers the total. */
function relocate(problem: Problem, routes: WorkingRoute[]): boolean {
  for (const from of routes) {
    const jobIds = [...new Set(from.visits.map(v => v.jobId))];
    for (const id of jobIds) {
      const job = problem.jobById.get(id)!;
      const without = from.visits.filter(v => v.jobId !== id);
      const evWithout = problem.evaluate(from.vehicle, without);
      if (!evWithout.feasible) continue;
      const removed = from.cost - evWithout.cost;
      const target = bestInsertion(problem, job, routes, false, from);
      if (target && target.delta < removed - EPS) {
        from.visits = without;
        from.cost = evWithout.cost;
        target.route.visits = target.visits;
        target.route.cost = target.cost;
        return true;
      }
    }
  }
  return false;
}

export function solveVrp(input: SolverInput): SolverResult {
  const problem = new Problem(input);
  const deadline = input.deadline ?? Infinity;
  const unassigned: SolverResult['unassigned'] = [];
  const usable = input.vehicles.filter(v => v.capacityKg > 0);
  const maxCapacity = usable.reduce((m, v) => Math.max(m, v.capacityKg), 0);
  const routes: WorkingRoute[] = usable.map(vehicle => ({ vehicle, visits: [], cost: 0 }));
  const startCost = new Map<string, number>();
  for (const r of routes) startCost.set(r.vehicle.id, problem.evaluate(r.vehicle, []).cost);
  for (const r of routes) r.cost = startCost.get(r.vehicle.id) ?? 0;

  // Hardest first: heaviest, then furthest from where the vehicles start.
  const anchor = usable[0]?.startIdx ?? 0;
  const order = [...input.jobs].sort((a, b) =>
    (b.weightKg - a.weightKg) || (input.durationMin[anchor][b.dropIdx] - input.durationMin[anchor][a.dropIdx]));

  for (const job of order) {
    if (usable.length === 0) { unassigned.push({ jobId: job.id, reason: 'no_vehicle' }); continue; }
    if (job.weightKg > maxCapacity + EPS) { unassigned.push({ jobId: job.id, reason: 'exceeds_vehicle_capacity' }); continue; }
    const best = bestInsertion(problem, job, routes);
    if (best) {
      best.route.visits = best.visits;
      best.route.cost = best.cost;
      continue;
    }
    // Why it did not fit: would it fit if the time window were ignored?
    const fitsWithoutWindow = job.window ? bestInsertion(problem, job, routes, true) : null;
    unassigned.push({ jobId: job.id, reason: fitsWithoutWindow ? 'time_window' : 'fleet_capacity_full' });
  }

  let improvements = 0;
  let improved = true;
  while (improved && Date.now() < deadline) {
    improved = false;
    for (const route of routes) {
      if (Date.now() >= deadline) break;
      while (route.visits.length > 1 && Date.now() < deadline && (twoOpt(problem, route) || orOpt(problem, route))) {
        improvements++;
        improved = true;
      }
    }
    if (Date.now() < deadline && routes.length > 1 && relocate(problem, routes)) {
      improvements++;
      improved = true;
    }
  }

  return {
    routes: routes
      .filter(r => r.visits.length > 0)
      .map(r => {
        const ev = problem.evaluate(r.vehicle, r.visits);
        return {
          vehicleId: r.vehicle.id,
          visits: r.visits,
          distanceKm: ev.distanceKm,
          driveMin: ev.driveMin,
          durationMin: ev.durationMin,
          peakLoadKg: ev.peakLoadKg,
        };
      }),
    unassigned,
    improvements,
  };
}

/**
 * 2-opt and or-opt on one given route until neither shortens it. The order is returned unchanged
 * when it breaks a constraint to begin with.
 */
export function improveOrder(input: SolverInput, vehicle: SolverVehicle, visits: Visit[]): Visit[] {
  const problem = new Problem(input);
  const start = problem.evaluate(vehicle, visits);
  if (!start.feasible) return visits;
  const route: WorkingRoute = { vehicle, visits, cost: start.cost };
  const deadline = input.deadline ?? Infinity;
  while (Date.now() < deadline && (twoOpt(problem, route) || orOpt(problem, route))) { /* keep improving */ }
  return route.visits;
}

/** Cost of visiting `visits` in exactly this order, or null when the order breaks a constraint. */
export function evaluateOrder(input: SolverInput, vehicle: SolverVehicle, visits: Visit[]): Omit<SolverRoute, 'vehicleId' | 'visits'> | null {
  const ev = new Problem(input).evaluate(vehicle, visits);
  return ev.feasible
    ? { distanceKm: ev.distanceKm, driveMin: ev.driveMin, durationMin: ev.durationMin, peakLoadKg: ev.peakLoadKg }
    : null;
}

/** Same as evaluateOrder but ignoring capacity and windows: the plain length of a sequence, for a "before" figure. */
export function measureOrder(input: SolverInput, vehicle: SolverVehicle, visits: Visit[]): { distanceKm: number; driveMin: number; durationMin: number } {
  const jobById = new Map(input.jobs.map(j => [j.id, j]));
  let at = vehicle.startIdx;
  let km = 0;
  let drive = 0;
  let service = 0;
  for (const v of visits) {
    km += input.distanceKm[at][v.nodeIdx];
    drive += input.durationMin[at][v.nodeIdx];
    service += jobById.get(v.jobId)?.serviceMin ?? 0;
    at = v.nodeIdx;
  }
  if (vehicle.endIdx != null) {
    km += input.distanceKm[at][vehicle.endIdx];
    drive += input.durationMin[at][vehicle.endIdx];
  }
  return { distanceKm: km, driveMin: drive, durationMin: drive + service };
}
