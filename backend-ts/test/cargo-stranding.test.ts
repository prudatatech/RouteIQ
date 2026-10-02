/**
 * The stranding fix (docs/cargo-plan.md, "Never strand cargo"): cancelling a route, releasing a
 * vehicle's work for maintenance, a serious SOS, or cancelling a load must leave goods already on
 * the truck on hold with an open case, still on the vehicle, until a transfer, hub drop or repair.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { invalidateDriverVehicles } from '../src/core/ownership';
import { ID, auth, cargoWorld, one, notesFor } from './support/cargo-world';
import { ShipmentService } from '../src/services/shipment.service';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;

beforeEach(() => {
  invalidateDriverVehicles();
  supabaseMock.reset(cargoWorld());
});

function expectHeldOnV1(kind: 'shipments' | 'cargo_manifest', id: string) {
  expect(one(kind, id)).toMatchObject({ status: 'on_hold', current_holder: 'vehicle', current_vehicle_id: ID.v1 });
  expect(one(kind, id).on_hold_reason).toBeTruthy();
}

describe('cancelling a route with goods on board', () => {
  it('holds the goods on the vehicle with an open case, and puts the unpicked shipment back in the queue', async () => {
    const res = await request(app).patch(api(`/routes/${ID.route1}/status`)).set(auth.admin()).send({ status: 'cancelled' });
    expect(res.status).toBe(200);
    expectHeldOnV1('shipments', ID.s1);
    expect(one('shipments', ID.s2)).toMatchObject({ status: 'created', current_vehicle_id: null });

    const [exc] = supabaseMock.rows('cargo_exceptions');
    expect(exc).toMatchObject({ status: 'open', vehicle_id: ID.v1, route_id: ID.route1, source: 'manual' });
    expect(exc.code).toMatch(/^EXC-/);
    expect(supabaseMock.rows('cargo_exception_items')).toEqual([expect.objectContaining({ exception_id: exc.id, shipment_id: ID.s1, pieces_affected: 10 })]);

    // A hold custody event and a hash-chain entry back it up
    expect(supabaseMock.rows('cargo_custody_events')).toEqual([expect.objectContaining({ kind: 'hold', shipment_id: ID.s1, exception_id: exc.id })]);
    expect(supabaseMock.rows('shipment_logs').some(l => l.shipment_id === ID.s1 && l.status === 'on_hold')).toBe(true);

    // The vehicle keeps its load while goods wait on it: the held shipment and the vendor load (another job, left alone)
    expect(one('vehicles', ID.v1).current_load_kg).toBe(1300);
    expect(one('cargo_manifest', ID.m1).status).toBe('in_transit');
    // Staff and the customer hear about it
    expect(notesFor(ID.admin).some(n => n.type === 'cargo_exception_opened')).toBe(true);
    expect(notesFor(ID.customer).some(n => n.type === 'cargo_exception_opened')).toBe(true);
  });

  it('holds goods when a pending route is deleted', async () => {
    one('routes', ID.route1).status = 'pending';
    one('shipments', ID.s1).status = 'picked_up';
    const res = await request(app).delete(api(`/routes/${ID.route1}`)).set(auth.admin());
    expect(res.status).toBe(200);
    expectHeldOnV1('shipments', ID.s1);
    expect(supabaseMock.rows('cargo_exceptions')).toHaveLength(1);
  });
});

describe('releasing a vehicle\'s work for maintenance', () => {
  it('holds every consignment on board on one case linked to the job', async () => {
    const res = await request(app).post(api(`/fleet/vehicles/${ID.v1}/maintenance`)).set(auth.admin())
      .send({ reason_type: 'breakdown', workshop: 'Sharma Motors', release_work: true });
    expect(res.status).toBe(201);
    expectHeldOnV1('shipments', ID.s1);
    expectHeldOnV1('cargo_manifest', ID.m1);
    const cases = supabaseMock.rows('cargo_exceptions');
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ type: 'vehicle_breakdown', source: 'maintenance', maintenance_job_id: res.body.id, severity: 'high' });
    const items = supabaseMock.rows('cargo_exception_items').map(i => i.shipment_id ?? i.manifest_id).sort();
    expect(items).toEqual([ID.s1, ID.m1].sort());
    expect(res.body.released_work.cargo_exception_id).toBe(cases[0].id);
    // The vendor's request stays with the vehicle; the vendor is told in plain words
    expect(one('vendor_shipment_requests', ID.request1).status).toBe('assigned');
    expect(notesFor(ID.vendor).some(n => /broke down/.test(n.body))).toBe(true);
  });

  it('asks staff to release the work first when goods are on board', async () => {
    one('routes', ID.route1).status = 'completed';
    supabaseMock.rows('cargo_manifest').length = 0;
    const res = await request(app).post(api(`/fleet/vehicles/${ID.v1}/maintenance`)).set(auth.admin()).send({ reason_type: 'tyre' });
    expect(res.status).toBe(409);
    expect(res.body.open_work).toMatchObject({ cargo_on_board: 1, blocking: true });
  });
});

describe('a serious SOS', () => {
  async function raiseSerious(type: 'accident' | 'breakdown') {
    const raised = await request(app).post(api('/telemetry/sos/trigger')).set(auth.driver()).send({ alert_type: type, lat: 18.6, lng: 73.8 });
    expect(raised.status).toBe(200);
    const res = await request(app).patch(api(`/telemetry/sos/${raised.body.id}/details`)).set(auth.driver()).send({ severity: 'serious' });
    expect(res.status).toBe(200);
    return raised.body.id as string;
  }

  it('holds the goods on an accident case linked to the alert', async () => {
    const alertId = await raiseSerious('accident');
    expect(one('vehicles', ID.v1).status).toBe('maintenance');
    expectHeldOnV1('shipments', ID.s1);
    expectHeldOnV1('cargo_manifest', ID.m1);
    const [exc] = supabaseMock.rows('cargo_exceptions');
    expect(exc).toMatchObject({ type: 'vehicle_accident', severity: 'critical', source: 'sos', sos_alert_id: alertId });
    // The route stays as it was: the driver may still be able to continue after a repair
    expect(one('routes', ID.route1).status).toBe('active');
  });

  it('keeps one case when the vehicle then goes to maintenance for the same breakdown', async () => {
    const alertId = await raiseSerious('breakdown');
    // Staff open the job from the SOS: the vehicle is already in maintenance, its route is released
    one('vehicles', ID.v1).status = 'on_route';
    const res = await request(app).post(api(`/fleet/vehicles/${ID.v1}/maintenance`)).set(auth.admin())
      .send({ reason_type: 'breakdown', release_work: true, sos_alert_id: alertId });
    expect(res.status).toBe(201);
    const cases = supabaseMock.rows('cargo_exceptions');
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ sos_alert_id: alertId, maintenance_job_id: res.body.id, type: 'vehicle_breakdown' });
  });

  it('leaves the goods moving for a minor alert', async () => {
    const raised = await request(app).post(api('/telemetry/sos/trigger')).set(auth.driver()).send({ alert_type: 'breakdown' });
    await request(app).patch(api(`/telemetry/sos/${raised.body.id}/details`)).set(auth.driver()).send({ severity: 'minor' });
    expect(one('shipments', ID.s1).status).toBe('in_transit');
    expect(supabaseMock.rows('cargo_exceptions')).toHaveLength(0);
  });
});

describe('cancelling a vendor load', () => {
  it('holds a load on the truck instead of cancelling it', async () => {
    const res = await request(app).patch(api(`/routes/${ID.m1}/status`)).set(auth.admin()).send({ status: 'cancelled' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('on_hold');
    expectHeldOnV1('cargo_manifest', ID.m1);
    expect(supabaseMock.rows('cargo_exception_items')[0]).toMatchObject({ manifest_id: ID.m1, pieces_affected: 4 });
  });
});

describe('staff paths out for stuck cargo', () => {
  it('points re-assigning goods on a truck to the transfer flow', async () => {
    await expect(ShipmentService.assignDriver(ID.s1, ID.v2)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/cargo transfer/) });
    const res = await request(app).post(api(`/shipments/${ID.s1}/assign`)).set(auth.admin()).send({ vehicle_id: ID.v2 });
    expect(res.status).toBe(409);
    expect(res.body.use).toBe('transfer');
  });

  it('will not resolve a case while its goods are still on hold, or release them onto a broken vehicle', async () => {
    await request(app).patch(api(`/routes/${ID.route1}/status`)).set(auth.admin()).send({ status: 'cancelled' });
    const [exc] = supabaseMock.rows('cargo_exceptions');
    const resolve = await request(app).post(api(`/cargo/exceptions/${exc.id}/actions`)).set(auth.admin()).send({ action: 'resolve', resolution: 'no_action' });
    expect(resolve.status).toBe(409);
    expect(resolve.body.detail).toMatch(/still on hold/);

    one('vehicles', ID.v1).status = 'maintenance';
    const release = await request(app).post(api('/cargo/custody')).set(auth.admin()).send({ ref: { shipment_id: ID.s1 }, kind: 'release_hold' });
    expect(release.status).toBe(409);
    expect(release.body.detail).toMatch(/not in service/);
  });

  it('lets staff hold stuck goods and write them off', async () => {
    const hold = await request(app).post(api('/cargo/custody')).set(auth.admin()).send({ ref: { shipment_id: ID.s1 }, kind: 'hold', reason: 'Consignee dispute' });
    expect(hold.status).toBe(201);
    expect(one('shipments', ID.s1)).toMatchObject({ status: 'on_hold', on_hold_reason: 'Consignee dispute' });
    const exc = await request(app).post(api('/cargo/exceptions')).set(auth.admin())
      .send({ type: 'theft', description: 'Truck broken into overnight', items: [{ ref: { shipment_id: ID.s1 }, pieces_affected: 10 }] });
    expect(exc.status).toBe(201);
    const off = await request(app).post(api(`/cargo/exceptions/${exc.body.id}/actions`)).set(auth.admin()).send({ action: 'write_off', pieces: 10, note: 'Stolen' });
    expect(off.status).toBe(200);
    expect(one('shipments', ID.s1)).toMatchObject({ status: 'lost', pieces_short: 10 });
    const done = await request(app).post(api(`/cargo/exceptions/${exc.body.id}/actions`)).set(auth.admin()).send({ action: 'resolve', resolution: 'written_off', note: 'FIR filed' });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: 'resolved', resolution: 'written_off' });
  });

  it('refuses holds and write-offs from drivers', async () => {
    const res = await request(app).post(api('/cargo/custody')).set(auth.driver()).send({ ref: { shipment_id: ID.s1 }, kind: 'hold', reason: 'x' });
    expect(res.status).toBe(403);
  });
});
