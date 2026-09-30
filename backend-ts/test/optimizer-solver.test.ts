import { describe, expect, it } from 'vitest';
import { evaluateOrder, improveOrder, measureOrder, solveVrp, SolverInput, SolverJob, SolverVehicle, Visit } from '../src/services/optimizer/vrp-solver';

/** Nodes on a straight road: node i is i km from node 0 (the depot), 1 km takes 1 minute. */
function lineInput(positions: number[], jobs: SolverJob[], vehicles: SolverVehicle[], extra: Partial<SolverInput> = {}): SolverInput {
  const grid = positions.map(a => positions.map(b => Math.abs(a - b)));
  return { durationMin: grid, distanceKm: grid, jobs, vehicles, ...extra };
}

const drop = (id: string, idx: number, weightKg = 10, more: Partial<SolverJob> = {}): SolverJob => ({ id, dropIdx: idx, weightKg, ...more });
const van = (id: string, capacityKg: number): SolverVehicle => ({ id, capacityKg, startIdx: 0, endIdx: 0 });
const dropVisit = (jobId: string, nodeIdx: number): Visit => ({ jobId, kind: 'drop', nodeIdx });

describe('in-process solver: construction', () => {
  it('visits stops along the road in order and comes back, 2 x the far end', () => {
    // depot at 0, stops at 1..5 km
    const input = lineInput([0, 5, 1, 4, 2, 3], [1, 2, 3, 4, 5].map(k => drop(`j${k}`, [5, 1, 4, 2, 3][k - 1])), [van('v', 1000)]);
    const result = solveVrp(input);
    expect(result.unassigned).toEqual([]);
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0].distanceKm).toBe(10);
  });

  it('never loads a vehicle past its capacity and reports what did not fit', () => {
    const jobs = [drop('a', 1, 600), drop('b', 2, 600), drop('c', 3, 300)];
    const result = solveVrp(lineInput([0, 1, 2, 3], jobs, [van('v', 1000)]));
    const carried = result.routes.flatMap(r => r.visits.map(v => v.jobId));
    const kg = carried.reduce((sum, id) => sum + jobs.find(j => j.id === id)!.weightKg, 0);
    expect(kg).toBeLessThanOrEqual(1000);
    expect(result.routes[0].peakLoadKg).toBeLessThanOrEqual(1000);
    expect(result.unassigned).toHaveLength(1);
    expect(result.unassigned[0].reason).toBe('fleet_capacity_full');
  });

  it('splits work over vehicles when one cannot carry it all', () => {
    const jobs = [drop('a', 1, 600), drop('b', 2, 600)];
    const result = solveVrp(lineInput([0, 1, 2], jobs, [van('v1', 700), van('v2', 700)]));
    expect(result.unassigned).toEqual([]);
    expect(result.routes.map(r => r.visits.length)).toEqual([1, 1]);
  });

  it('says a load heavier than every vehicle exceeds capacity, and that no vehicle means no vehicle', () => {
    const heavy = solveVrp(lineInput([0, 1], [drop('a', 1, 5000)], [van('v', 1000)]));
    expect(heavy.unassigned).toEqual([{ jobId: 'a', reason: 'exceeds_vehicle_capacity' }]);
    const none = solveVrp(lineInput([0, 1], [drop('a', 1, 10)], [van('v', 0)]));
    expect(none.unassigned).toEqual([{ jobId: 'a', reason: 'no_vehicle' }]);
  });

  it('picks up before it drops, even when the drop is nearer', () => {
    // depot 0; job x picked up at 6 km, dropped at 1 km; job y dropped at 2 km
    const jobs = [drop('x', 2, 100, { pickupIdx: 1 }), drop('y', 3, 100)];
    const result = solveVrp(lineInput([0, 6, 1, 2], jobs, [van('v', 1000)]));
    const visits = result.routes[0].visits;
    const pickup = visits.findIndex(v => v.jobId === 'x' && v.kind === 'pickup');
    const dropAt = visits.findIndex(v => v.jobId === 'x' && v.kind === 'drop');
    expect(pickup).toBeGreaterThanOrEqual(0);
    expect(pickup).toBeLessThan(dropAt);
    // Both halves of a job always travel together
    expect(new Set(visits.filter(v => v.jobId === 'x').map(v => v.kind))).toEqual(new Set(['pickup', 'drop']));
  });

  it('counts a picked-up load against capacity while it is on board', () => {
    // Two 600 kg jobs, each picked up and dropped; a 1000 kg van must finish one before it picks up the next
    const jobs = [drop('a', 2, 600, { pickupIdx: 1 }), drop('b', 4, 600, { pickupIdx: 3 })];
    const result = solveVrp(lineInput([0, 1, 2, 3, 4], jobs, [van('v', 1000)]));
    expect(result.unassigned).toEqual([]);
    expect(result.routes[0].peakLoadKg).toBeLessThanOrEqual(1000);
    const order = result.routes[0].visits.map(v => `${v.jobId}:${v.kind}`);
    expect(order.indexOf('a:drop')).toBeLessThan(order.indexOf('b:pickup'));
  });

  it('respects a time window and reports a stop it cannot reach in time', () => {
    const jobs = [drop('late', 3, 10, { window: { start: 0, end: 2 } }), drop('ok', 1, 10, { window: { start: 0, end: 100 } })];
    const result = solveVrp(lineInput([0, 1, 3], jobs.map((j, i) => ({ ...j, dropIdx: i === 0 ? 2 : 1 })), [van('v', 1000)]));
    // 3 km takes 3 minutes but the window closes at minute 2
    expect(result.unassigned).toEqual([{ jobId: 'late', reason: 'time_window' }]);
    expect(result.routes[0].visits.map(v => v.jobId)).toEqual(['ok']);
  });
});

describe('in-process solver: improvement', () => {
  it('2-opt turns a zig-zag order into the short one', () => {
    const positions = [0, 1, 2, 3, 4, 5];
    const jobs = [1, 2, 3, 4, 5].map(k => drop(`j${k}`, k));
    const vehicle = van('v', 1000);
    const input = lineInput(positions, jobs, [vehicle]);
    const bad = [3, 1, 5, 2, 4].map(k => dropVisit(`j${k}`, k));
    const before = measureOrder(input, vehicle, bad);
    const improved = improveOrder(input, vehicle, bad);
    const after = measureOrder(input, vehicle, improved);
    expect(after.distanceKm).toBeLessThan(before.distanceKm);
    // On a line the best closed tour is out to the end and back
    expect(after.distanceKm).toBe(10);
  });

  it('does not accept a reordering that puts a drop before its pickup', () => {
    const jobs = [drop('x', 1, 10, { pickupIdx: 2 })];
    const vehicle = van('v', 1000);
    const input = lineInput([0, 1, 5], jobs, [vehicle]);
    const start: Visit[] = [{ jobId: 'x', kind: 'pickup', nodeIdx: 2 }, { jobId: 'x', kind: 'drop', nodeIdx: 1 }];
    const improved = improveOrder(input, vehicle, start);
    expect(improved.map(v => v.kind)).toEqual(['pickup', 'drop']);
    expect(evaluateOrder(input, vehicle, [start[1], start[0]])).toBeNull();
  });

  it('an open route ends at its last stop', () => {
    const vehicle: SolverVehicle = { id: 'v', capacityKg: 1000, startIdx: 0, endIdx: null };
    const jobs = [drop('a', 1), drop('b', 2)];
    const input = lineInput([0, 1, 2], jobs, [vehicle]);
    const result = solveVrp(input);
    expect(result.routes[0].distanceKm).toBe(2);
    expect(result.routes[0].visits.map(v => v.jobId)).toEqual(['a', 'b']);
  });
});
