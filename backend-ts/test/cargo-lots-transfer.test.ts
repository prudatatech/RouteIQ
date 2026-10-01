/**
 * A partial transfer (docs/cargo-plan.md, Lots): 30 of the 100 cartons on a truck move to another
 * truck. The consignment is split first into a lot that moves (30) and a lot that stays (70); the
 * transfer moves the moving lot whole, and only it needs an e-way bill Part B update. The master
 * refuses custody, transfer and delivery actions, rolls up its lots in where and timeline, and the
 * driver and customer apps list the lots.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { invalidateDriverVehicles } from '../src/core/ownership';
import { ID, auth, cargoWorld, one, shipmentRow } from './support/cargo-world';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const S1 = shipmentRow(ID.s1).tracking_id as string;

beforeEach(() => {
  invalidateDriverVehicles();
  supabaseMock.reset(cargoWorld({
    shipments: [
      shipmentRow(ID.s1, { total_items: 100, pieces_total: 100, total_weight_kg: 1000, freight_charge: 5000 }),
      shipmentRow(ID.s2, { status: 'assigned', current_holder: 'consignor', total_items: 5, pieces_total: 5, total_weight_kg: 500, seal_number: null }),
    ],
  }));
});

const lotsOf = (masterId: string) => supabaseMock.rows('shipments').filter(s => s.parent_shipment_id === masterId).sort((a, b) => a.lot_seq - b.lot_seq);

async function planPartial(pieces = 30) {
  return request(app).post(api('/cargo/transfers')).set(auth.admin())
    .send({ from_vehicle_id: ID.v1, to_vehicle_id: ID.v2, items: [{ ref: { shipment_id: ID.s1 }, pieces }], meet_address: 'Aundh flyover' });
}

describe('partial transfer: 30 of 100 on board', () => {
  it('splits into a moving lot and a staying lot, and plans the transfer of the moving lot', async () => {
    const res = await planPartial();
    expect(res.status).toBe(201);
    const [moving, staying] = lotsOf(ID.s1);
    expect(res.body.splits).toEqual([{
      from: { ref: { shipment_id: ID.s1 }, code: S1 },
      moving: { ref: { shipment_id: moving.id }, code: `${S1}-A`, label: 'A', pieces: 30 },
      staying: { ref: { shipment_id: staying.id }, code: `${S1}-B`, label: 'B', pieces: 70 },
    }]);
    expect(res.body.items).toEqual([expect.objectContaining({ ref: { shipment_id: moving.id }, code: `${S1}-A`, pieces_planned: 30 })]);
    expect(res.body.lots).toEqual({ moving: res.body.splits[0].moving, staying: res.body.splits[0].staying });

    expect(one('shipments', ID.s1)).toMatchObject({ is_master: true, status: 'in_transit', current_holder: 'vehicle', current_vehicle_id: null, freight_share: 0 });
    expect(moving).toMatchObject({ split_reason: 'partial_transfer', status: 'in_transit', current_holder: 'vehicle', current_vehicle_id: ID.v1, pieces_total: 30, total_weight_kg: 300, freight_share: 1500, seal_number: 'SEAL-1' });
    expect(staying).toMatchObject({ status: 'in_transit', current_vehicle_id: ID.v1, pieces_total: 70, total_weight_kg: 700, freight_share: 3500 });

    // The master's stop goes; each lot has its own stop to the same drop on the same route
    expect(one('route_stops', ID.stop1).status).toBe('cancelled');
    for (const lot of [moving, staying]) {
      const [point] = supabaseMock.rows('delivery_points').filter(p => p.shipment_id === lot.id);
      expect(point).toMatchObject({ address: 'Hinjewadi, Pune', lot_shipment_id: lot.id });
      expect(supabaseMock.rows('route_stops').find(s => s.delivery_point_id === point.id)).toMatchObject({ route_id: ID.route1, status: 'pending' });
    }
    // The truck still carries the same weight once: 300 + 700 kg of lots and s2's 500 kg, not the master's 1,000 again
    expect(one('vehicles', ID.v1).available_capacity_kg).toBe(3500);
  });

  it('moves only the moving lot on handover, and marks e-way Part B for that lot alone', async () => {
    const planned = await planPartial();
    const [moving, staying] = lotsOf(ID.s1);
    // Part B is only due on goods that travel on an e-way bill
    supabaseMock.rows('shipments').find(r => r.id === moving.id)!.eway_bill_ref = 'EWB-2001';
    const ref = { shipment_id: moving.id };
    const out = await request(app).post(api(`/cargo/transfers/${planned.body.id}/handover-out`)).set(auth.driver()).send({ items: [{ ref, pieces_out: 30, condition: 'good' }] });
    expect(out.status).toBe(200);
    const inn = await request(app).post(api(`/cargo/transfers/${planned.body.id}/handover-in`)).set(auth.driver(ID.driver2)).send({ items: [{ ref, pieces_in: 30, condition: 'good' }] });
    expect(inn.status).toBe(200);
    expect(inn.body).toMatchObject({ status: 'completed', eway_part_b_required: true });

    expect(one('shipments', moving.id)).toMatchObject({ current_vehicle_id: ID.v2, eway_part_b_required: true, pieces_total: 30 });
    expect(one('shipments', staying.id)).toMatchObject({ current_vehicle_id: ID.v1, eway_part_b_required: false, pieces_total: 70 });

    // The master rolls up: both lots on the move, 100 on board across two trucks
    const where = await request(app).get(api(`/cargo/where/${S1}`)).set(auth.admin());
    expect(where.status).toBe(200);
    expect(where.body).toMatchObject({ is_master: true, status: 'in_transit', current_holder: 'vehicle', vehicle: null, eway_part_b_required: true });
    expect(where.body.pieces).toEqual({ total: 100, delivered: 0, damaged: 0, short: 0, returned: 0, on_board: 100 });
    expect(where.body.lots.map((l: any) => [l.code, l.vehicle?.plate_number, l.pieces.on_board])).toEqual([
      [`${S1}-A`, 'MH12AB0002', 30],
      [`${S1}-B`, 'MH12AB0001', 70],
    ]);
    expect(where.body.totals.progress_text).toBe('0 of 100 delivered · 30 on MH12AB0002 · 70 on MH12AB0001');

    // Part B done for the transfer clears the lot's flag
    await request(app).post(api(`/cargo/transfers/${planned.body.id}/eway`)).set(auth.admin()).send({ eway_part_b_ref: 'EWB-PARTB-1' });
    expect(one('shipments', moving.id).eway_part_b_required).toBe(false);

    // A lot's own e-way bill reference
    const eway = await request(app).post(api('/cargo/lots/eway')).set(auth.admin()).send({ ref: `${S1}-A`, eway_bill_ref: 'EWB-1001' });
    expect(eway.status).toBe(200);
    expect(eway.body).toMatchObject({ code: `${S1}-A`, eway_bill_ref: 'EWB-1001' });
    expect((await request(app).post(api('/cargo/lots/eway')).set(auth.admin()).send({ ref: S1, eway_bill_ref: 'EWB-1' })).status).toBe(409);
  });

  it('merges the master timeline with its lots, each event tagged with its lot', async () => {
    await planPartial();
    const res = await request(app).get(api(`/cargo/timeline/${S1}`)).set(auth.admin());
    expect(res.status).toBe(200);
    const splits = res.body.events.filter((e: any) => e.kind === 'split');
    expect(splits.map((e: any) => e.lot?.label ?? null).sort()).toEqual(['A', 'B', null]);
    expect(splits.find((e: any) => e.lot === null).summary).toMatch(/Split into lots A \(30\), B \(70\)/);
  });

  it('refuses more pieces than are on board, and a second transfer of the moving lot', async () => {
    expect((await planPartial(101)).status).toBe(409);
    await planPartial();
    const [moving] = lotsOf(ID.s1);
    const again = await request(app).post(api('/cargo/transfers')).set(auth.admin()).send({ from_vehicle_id: ID.v1, to_vehicle_id: ID.v3, items: [{ ref: { shipment_id: moving.id }, pieces: 10 }] });
    expect(again.status).toBe(409);
  });
});

describe('a split master refuses to hold goods', () => {
  beforeEach(async () => {
    expect((await planPartial()).status).toBe(201);
  });

  it('refuses custody, transfers, delivery, status changes, assignment and the delivery code with a 409 naming the lots', async () => {
    const custody = await request(app).post(api('/cargo/custody')).set(auth.admin()).send({ ref: { shipment_id: ID.s1 }, kind: 'delivery', receiver_name: 'Ravi', reason: 'Signed paper POD' });
    expect(custody.status).toBe(409);
    expect(custody.body).toMatchObject({ use: 'lots', master: { shipment_id: ID.s1 } });
    expect(custody.body.lots.map((l: any) => l.code)).toEqual([`${S1}-A`, `${S1}-B`]);
    expect(custody.body.detail).toMatch(/split into lots/);

    expect((await request(app).post(api('/cargo/custody')).set(auth.admin()).send({ ref: S1, kind: 'hold', reason: 'Check' })).status).toBe(409);
    const transfer = await request(app).post(api('/cargo/transfers')).set(auth.admin()).send({ from_vehicle_id: ID.v1, to_vehicle_id: ID.v3, items: [{ ref: { shipment_id: ID.s1 }, pieces: 10 }] });
    expect(transfer.status).toBe(409);
    expect(transfer.body.use).toBe('lots');
    expect((await request(app).patch(api(`/shipments/${ID.s1}`)).set(auth.admin()).send({ status: 'created' })).status).toBe(409);
    expect((await request(app).post(api(`/shipments/${ID.s1}/assign`)).set(auth.admin()).send({ vehicle_id: ID.v3 })).status).toBe(409);
    expect((await request(app).post(api('/cargo/otp/send')).set(auth.admin()).send({ ref: { shipment_id: ID.s1 } })).status).toBe(409);
    expect((await request(app).post(api('/cargo/exceptions')).set(auth.admin()).send({ type: 'damage', severity: 'low', description: 'Wet cartons', items: [{ ref: S1 }] })).status).toBe(409);
    // A master can't be split again: its lots can
    expect((await request(app).post(api('/cargo/lots/split')).set(auth.admin()).send({ ref: S1, lots: [{ pieces: 10 }] })).status).toBe(409);
  });

  it('lists lots on the driver app, so the driver sees each lot and its pieces', async () => {
    const res = await request(app).get(api('/cargo/driver/on-board')).set(auth.driver());
    expect(res.status).toBe(200);
    const lots = res.body.items.filter((i: any) => i.lot);
    expect(lots.map((i: any) => i.display)).toEqual([`${S1}-A · 30 pcs`, `${S1}-B · 70 pcs`]);
    expect(lots[0].lot).toEqual({ label: 'A', master: { ref: { shipment_id: ID.s1 }, code: S1 } });
    expect(res.body.items.some((i: any) => i.code === S1)).toBe(false);
    expect(res.body.totals.pieces).toBe(104);
  });

  it('shows the customer the lots of their booking, and lets them track any lot', async () => {
    const res = await request(app).get(api(`/customer/bookings/${ID.booking1}/cargo`)).set(auth.customer());
    expect(res.status).toBe(200);
    expect(res.body.where).toMatchObject({ is_master: true, status: 'in_transit' });
    expect(res.body.lots.map((l: any) => l.text)).toEqual([
      'Lot A (30 pieces): on the way to Hinjewadi warehouse, Hinjewadi, Pune on MH12AB0001',
      'Lot B (30 pieces): on the way to Hinjewadi warehouse, Hinjewadi, Pune on MH12AB0001'.replace('B (30', 'B (70'),
    ]);
    // Redacted for the customer: no freight share, no driver name
    expect(res.body.where.lots[0].freight_share).toBeNull();
    const lot = await request(app).get(api(`/cargo/where/${S1}-B`)).set(auth.customer());
    expect(lot.status).toBe(200);
    expect(lot.body).toMatchObject({ code: `${S1}-B`, is_master: false, lot: { label: 'B', master: { code: S1 } }, lot_label: 'B', master: { ref: { shipment_id: ID.s1 }, code: S1 } });
    // Another customer sees nothing
    expect((await request(app).get(api(`/cargo/where/${S1}-B`)).set(auth.customer(ID.otherCustomer))).status).toBe(404);
  });
});
