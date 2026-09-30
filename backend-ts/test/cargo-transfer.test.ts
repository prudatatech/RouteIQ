/**
 * A transfer end to end: a serious breakdown holds the goods, staff pick a relief vehicle,
 * the drivers count the goods out and in (two pieces go missing), and the goods, loads and
 * remaining stops move to the relief truck.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { invalidateDriverVehicles } from '../src/core/ownership';
import { ID, auth, cargoWorld, one, notesFor } from './support/cargo-world';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const V5 = 'a1000000-0000-4000-8000-000000000005';

beforeEach(() => {
  invalidateDriverVehicles();
  supabaseMock.reset(cargoWorld());
});

async function breakdown(): Promise<string> {
  const raised = await request(app).post(api('/telemetry/sos/trigger')).set(auth.driver()).send({ alert_type: 'breakdown', lat: 18.6, lng: 73.8 });
  await request(app).patch(api(`/telemetry/sos/${raised.body.id}/details`)).set(auth.driver()).send({ severity: 'serious' });
  const [exc] = supabaseMock.rows('cargo_exceptions');
  expect(exc).toBeTruthy();
  return exc.id;
}

describe('relief vehicles', () => {
  it('ranks operating vehicles by distance, then free capacity for the goods, then cargo types', async () => {
    const excId = await breakdown();
    // Nearest of all, but too small for 1,300 kg
    supabaseMock.rows('vehicles').push({ id: V5, plate_number: 'MH12AB0005', vehicle_type: 'van', status: 'available', driver_id: null, capacity_kg: 100, available_capacity_kg: 100, latitude: 18.601, longitude: 73.801, cargo_types: ['general'] });
    // A placeholder plate and an unapproved vehicle never show
    supabaseMock.rows('vehicles').push({ id: 'a1000000-0000-4000-8000-000000000006', plate_number: 'TEMP-1234', status: 'available', latitude: 18.6, longitude: 73.8, capacity_kg: 9000 });
    supabaseMock.rows('vehicles').push({ id: 'a1000000-0000-4000-8000-000000000007', plate_number: 'MH12AB0007', status: 'pending_approval', latitude: 18.6, longitude: 73.8, capacity_kg: 9000 });

    const res = await request(app).get(api(`/cargo/exceptions/${excId}/relief-vehicles`)).set(auth.admin());
    expect(res.status).toBe(200);
    expect(res.body.affected_kg).toBe(1300);
    expect(res.body.vehicles.map((v: any) => v.vehicle.id)).toEqual([V5, ID.v2, ID.v3]);
    const [nearest, v2, v3] = res.body.vehicles;
    expect(nearest).toMatchObject({ fits: false });
    expect(v2).toMatchObject({ fits: true, cargo_match: true, free_kg: 5000 });
    expect(v3).toMatchObject({ fits: false, cargo_match: false, free_kg: 800 });
    expect(v2.distance_km).toBe(v3.distance_km);
    expect(v2.eta_minutes).toBeGreaterThan(0);
  });

  it('is for staff', async () => {
    const excId = await breakdown();
    expect((await request(app).get(api(`/cargo/exceptions/${excId}/relief-vehicles`)).set(auth.driver())).status).toBe(403);
  });
});

describe('transshipment to a relief truck', () => {
  it('moves the goods, loads and stops to the relief truck, with a shortage on handover-in', async () => {
    const excId = await breakdown();
    expect(one('shipments', ID.s1).status).toBe('on_hold');

    // Too small a truck is refused
    const tooSmall = await request(app).post(api(`/cargo/exceptions/${excId}/actions`)).set(auth.admin()).send({ action: 'transship', to_vehicle_id: ID.v3 });
    expect(tooSmall.status).toBe(409);
    expect(tooSmall.body.detail).toMatch(/800 kg free/);

    const planned = await request(app).post(api(`/cargo/exceptions/${excId}/actions`)).set(auth.admin())
      .send({ action: 'transship', to_vehicle_id: ID.v2, meet_lat: 18.61, meet_lng: 73.81, meet_address: 'Aundh flyover' });
    expect(planned.status).toBe(200);
    const transfer = planned.body.transfer;
    expect(transfer).toMatchObject({ status: 'planned', from_vehicle_id: ID.v1, to_vehicle_id: ID.v2, exception_id: excId });
    expect(transfer.code).toMatch(/^TRF-/);
    expect(planned.body.exception.status).toBe('action_planned');
    expect(notesFor(ID.driver1).some(n => n.type === 'cargo_transfer_planned')).toBe(true);
    expect(notesFor(ID.driver2).some(n => n.type === 'cargo_transfer_planned')).toBe(true);

    // The same goods cannot go on a second transfer
    const again = await request(app).post(api('/cargo/transfers')).set(auth.admin())
      .send({ from_vehicle_id: ID.v1, to_vehicle_id: ID.v3, items: [{ ref: { shipment_id: ID.s1 }, pieces: 10 }] });
    expect(again.status).toBe(409);

    const items = [{ ref: { shipment_id: ID.s1 } }, { ref: { manifest_id: ID.m1 } }];
    // Handover out: only the from-driver (or staff)
    const outBody = { items: [{ ...items[0], pieces_out: 10, condition: 'good' }, { ...items[1], pieces_out: 4, condition: 'good' }] };
    expect((await request(app).post(api(`/cargo/transfers/${transfer.id}/handover-out`)).set(auth.driver(ID.driver2)).send(outBody)).status).toBe(403);
    expect((await request(app).post(api(`/cargo/transfers/${transfer.id}/handover-in`)).set(auth.driver(ID.driver2)).send(outBody)).status).toBe(409);
    const out = await request(app).post(api(`/cargo/transfers/${transfer.id}/handover-out`)).set(auth.driver()).send(outBody);
    expect(out.status).toBe(200);
    expect(out.body.status).toBe('in_progress');

    // Handover in: only the to-driver (or staff); two pieces of the shipment are missing
    const inBody = { items: [{ ...items[0], pieces_in: 8, condition: 'good' }, { ...items[1], pieces_in: 4, condition: 'good' }] };
    expect((await request(app).post(api(`/cargo/transfers/${transfer.id}/handover-in`)).set(auth.driver()).send(inBody)).status).toBe(403);
    const done = await request(app).post(api(`/cargo/transfers/${transfer.id}/handover-in`)).set(auth.driver(ID.driver2)).send(inBody);
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: 'completed', eway_part_b_required: true });
    expect(done.body.exceptions_opened).toHaveLength(1);

    // The goods are on the relief truck, counted
    expect(one('shipments', ID.s1)).toMatchObject({ status: 'in_transit', current_holder: 'vehicle', current_vehicle_id: ID.v2, pieces_total: 10, pieces_short: 2, on_hold_reason: null });
    expect(one('cargo_manifest', ID.m1)).toMatchObject({ status: 'in_transit', vehicle_id: ID.v2, current_vehicle_id: ID.v2 });
    const shortage = supabaseMock.rows('cargo_exceptions').find(e => e.type === 'shortage')!;
    expect(shortage).toMatchObject({ status: 'open', severity: 'high' });
    expect(supabaseMock.rows('cargo_exception_items').find(i => i.exception_id === shortage.id)).toMatchObject({ shipment_id: ID.s1, pieces_affected: 2 });

    // The remaining drop is now a stop on a new route for the relief truck; the old stop is closed
    const newRouteId = done.body.new_route_id;
    expect(newRouteId).toBeTruthy();
    expect(one('routes', newRouteId)).toMatchObject({ vehicle_id: ID.v2, status: 'pending' });
    expect(supabaseMock.rows('route_stops').find(s => s.route_id === newRouteId)).toMatchObject({ delivery_point_id: ID.dp1, status: 'pending' });
    expect(one('route_stops', ID.stop1).status).toBe('cancelled');

    // Loads follow: the vendor load's weight leaves the broken truck for the relief truck
    expect(one('vehicles', ID.v1).current_load_kg).toBe(0);
    expect(one('vehicles', ID.v2).current_load_kg).toBe(300);

    // Custody trail: handover out and in on both consignments, in the hash chain for the shipment
    const kinds = supabaseMock.rows('cargo_custody_events').filter(e => e.shipment_id === ID.s1).map(e => e.kind);
    expect(kinds).toEqual(['hold', 'handover_out', 'handover_in']);
    expect(supabaseMock.rows('cargo_custody_events').filter(e => e.manifest_id === ID.m1).map(e => e.kind)).toEqual(['hold', 'handover_out', 'handover_in']);
    expect(supabaseMock.rows('shipment_logs').filter(l => l.shipment_id === ID.s1).length).toBeGreaterThanOrEqual(3);

    // The breakdown case is settled by the transfer; the owners hear in plain words
    expect(one('cargo_exceptions', excId)).toMatchObject({ status: 'resolved', resolution: 'transshipped' });
    expect(notesFor(ID.customer).some(n => n.type === 'cargo_transfer_completed' && /another truck after a breakdown/.test(n.body))).toBe(true);
    expect(notesFor(ID.vendor).some(n => n.type === 'cargo_transfer_completed')).toBe(true);
    expect(notesFor(ID.admin).some(n => n.type === 'cargo_transfer_completed' && /e-way bill Part B/.test(n.body))).toBe(true);

    // E-way bill Part B is recorded against the transfer
    const eway = await request(app).post(api(`/cargo/transfers/${transfer.id}/eway`)).set(auth.admin()).send({ eway_part_b_ref: 'EWB-PARTB-991' });
    expect(eway.status).toBe(200);
    expect(eway.body).toMatchObject({ eway_part_b_ref: 'EWB-PARTB-991' });
    expect(eway.body.eway_part_b_updated_at).toBeTruthy();

    // The relief driver now sees the goods on board
    const board = await request(app).get(api('/cargo/driver/on-board')).set(auth.driver(ID.driver2));
    expect(board.status).toBe(200);
    expect(board.body.items.map((i: any) => i.code).sort()).toEqual([one('shipments', ID.s1).tracking_id, `CM-${ID.m1.slice(0, 8).toUpperCase()}`].sort());
    expect(board.body.items.find((i: any) => i.ref.shipment_id === ID.s1)).toMatchObject({ pieces_on_board: 8, expected_condition: 'good' });
  });

  it('moves goods to a hub, where hub staff count them in', async () => {
    const excId = await breakdown();
    const planned = await request(app).post(api(`/cargo/exceptions/${excId}/actions`)).set(auth.admin()).send({ action: 'move_to_hub', depot_id: ID.depot });
    expect(planned.status).toBe(200);
    const t = planned.body.transfer;
    expect(t).toMatchObject({ to_depot_id: ID.depot, to_vehicle_id: null });
    await request(app).post(api(`/cargo/transfers/${t.id}/handover-out`)).set(auth.driver())
      .send({ items: [{ ref: { shipment_id: ID.s1 }, pieces_out: 10 }, { ref: { manifest_id: ID.m1 }, pieces_out: 4 }] });
    // A driver cannot receive at a hub
    const inBody = { items: [{ ref: { shipment_id: ID.s1 }, pieces_in: 10 }, { ref: { manifest_id: ID.m1 }, pieces_in: 4 }] };
    expect((await request(app).post(api(`/cargo/transfers/${t.id}/handover-in`)).set(auth.driver(ID.driver2)).send(inBody)).status).toBe(403);
    const done = await request(app).post(api(`/cargo/transfers/${t.id}/handover-in`)).set(auth.admin()).send(inBody);
    expect(done.status).toBe(200);
    expect(done.body.eway_part_b_required).toBe(false);
    expect(one('shipments', ID.s1)).toMatchObject({ status: 'at_hub', current_holder: 'hub', current_depot_id: ID.depot, current_vehicle_id: null });
    expect(one('cargo_manifest', ID.m1)).toMatchObject({ status: 'on_hold', current_holder: 'hub', current_depot_id: ID.depot });
    expect(one('cargo_exceptions', excId)).toMatchObject({ status: 'resolved', resolution: 'moved_to_hub' });
  });

  it('cancels a planned transfer, but not one mid-handover', async () => {
    const excId = await breakdown();
    const { body } = await request(app).post(api(`/cargo/exceptions/${excId}/actions`)).set(auth.admin()).send({ action: 'transship', to_vehicle_id: ID.v2 });
    const cancel = await request(app).post(api(`/cargo/transfers/${body.transfer.id}/cancel`)).set(auth.admin()).send({ reason: 'Repair was quick' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe('cancelled');
    expect(one('shipments', ID.s1)).toMatchObject({ status: 'on_hold', current_vehicle_id: ID.v1 });

    const second = await request(app).post(api('/cargo/transfers')).set(auth.admin())
      .send({ exception_id: excId, from_vehicle_id: ID.v1, to_vehicle_id: ID.v2, items: [{ ref: { shipment_id: ID.s1 }, pieces: 10 }] });
    expect(second.status).toBe(201);
    await request(app).post(api(`/cargo/transfers/${second.body.id}/handover-out`)).set(auth.admin()).send({ items: [{ ref: { shipment_id: ID.s1 }, pieces_out: 10 }] });
    expect((await request(app).post(api(`/cargo/transfers/${second.body.id}/cancel`)).set(auth.admin()).send({})).status).toBe(409);
  });

  it('refuses part of a consignment, goods not on the vehicle, and the same vehicle', async () => {
    const plan = (body: object) => request(app).post(api('/cargo/transfers')).set(auth.admin()).send(body);
    expect((await plan({ from_vehicle_id: ID.v1, to_vehicle_id: ID.v2, items: [{ ref: { shipment_id: ID.s1 }, pieces: 4 }] })).status).toBe(409);
    expect((await plan({ from_vehicle_id: ID.v1, to_vehicle_id: ID.v2, items: [{ ref: { shipment_id: ID.s2 }, pieces: 5 }] })).status).toBe(409);
    expect((await plan({ from_vehicle_id: ID.v1, to_vehicle_id: ID.v1, items: [{ ref: { shipment_id: ID.s1 }, pieces: 10 }] })).status).toBe(400);
    expect((await plan({ from_vehicle_id: ID.v1, to_vehicle_id: ID.vMaint, items: [{ ref: { shipment_id: ID.s1 }, pieces: 10 }] })).status).toBe(409);
    expect((await plan({ from_vehicle_id: ID.v1, items: [{ ref: { shipment_id: ID.s1 }, pieces: 10 }] })).status).toBe(400);
  });
});

describe('continue after repair', () => {
  it('releases the hold and restores the route on the same vehicle once it is back in service', async () => {
    const excId = await breakdown();
    const early = await request(app).post(api(`/cargo/exceptions/${excId}/actions`)).set(auth.admin()).send({ action: 'continue_after_repair' });
    expect(early.status).toBe(409);
    one('vehicles', ID.v1).status = 'available';
    const res = await request(app).post(api(`/cargo/exceptions/${excId}/actions`)).set(auth.admin()).send({ action: 'continue_after_repair', note: 'Clutch replaced' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'resolved', resolution: 'repaired_continue' });
    expect(one('shipments', ID.s1)).toMatchObject({ status: 'in_transit', current_vehicle_id: ID.v1 });
    expect(one('cargo_manifest', ID.m1)).toMatchObject({ status: 'in_transit' });
    expect(one('route_stops', ID.stop1).status).toBe('pending');
    expect(notesFor(ID.customer).some(n => /back on the road/.test(n.body))).toBe(true);
  });
});
