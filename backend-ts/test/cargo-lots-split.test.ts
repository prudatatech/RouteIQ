/**
 * Splitting and merging lots (docs/cargo-plan.md, Lots): nested splits keep the tree flat,
 * conservation of pieces, weight, value and freight with the rounding remainder on the last lot,
 * the single-holder rule, merge rules, a hub cross-dock, the remainder after a partial delivery,
 * and vendor loads.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { invalidateDriverVehicles } from '../src/core/ownership';
import { allocate, childLabel, lotLabel } from '../src/services/cargo/lots.service';
import { ID, auth, cargoWorld, one, shipmentRow } from './support/cargo-world';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const S1 = shipmentRow(ID.s1).tracking_id as string;

function world(s1: Record<string, unknown> = {}) {
  invalidateDriverVehicles();
  supabaseMock.reset(cargoWorld({
    shipments: [
      shipmentRow(ID.s1, { total_items: 100, pieces_total: 100, total_weight_kg: 1000, freight_charge: 5000, ...s1 }),
      shipmentRow(ID.s2, { status: 'assigned', current_holder: 'consignor', total_items: 5, pieces_total: 5, total_weight_kg: 500, seal_number: null }),
    ],
  }));
}

beforeEach(() => world());

const split = (body: object) => request(app).post(api('/cargo/lots/split')).set(auth.admin()).send(body);
const merge = (refs: unknown[]) => request(app).post(api('/cargo/lots/merge')).set(auth.admin()).send({ refs });
const lotsOf = (masterId: string, kind: 'shipments' | 'cargo_manifest' = 'shipments') =>
  supabaseMock.rows(kind).filter(s => (s.parent_shipment_id ?? s.parent_manifest_id) === masterId).sort((a, b) => a.lot_seq - b.lot_seq);
const sum = (rows: any[], f: (r: any) => number) => Math.round(rows.reduce((s, r) => s + (Number(f(r)) || 0), 0) * 100) / 100;

describe('labels', () => {
  it('names lots A to Z then AA, and lots of a lot A1, A2 then A1.1', () => {
    expect([1, 2, 26, 27, 28].map(lotLabel)).toEqual(['A', 'B', 'Z', 'AA', 'AB']);
    expect([childLabel('A', 1), childLabel('A', 2), childLabel('A1', 1), childLabel('AB', 3)]).toEqual(['A1', 'A2', 'A1.1', 'AB3']);
  });
});

describe('conservation and rounding', () => {
  it('shares by pieces, with the rounding remainder on the last lot', () => {
    expect(allocate(100, [1, 1, 1], [null, null, null], { tolerance: 0.5, label: 'kg' })).toEqual([33.33, 33.33, 33.34]);
    expect(allocate(1000, [1, 1, 1], [undefined, 400, undefined], { tolerance: 1, label: '₹' })).toEqual([300, 400, 300]);
    // Named figures within the tolerance: the last lot absorbs the difference
    expect(allocate(100, [2, 2, 1], [40, 40, 20.3], { tolerance: 0.5, label: 'kg' })).toEqual([40, 40, 20]);
    expect(() => allocate(100, [2, 2, 1], [40, 40, 21], { tolerance: 0.5, label: 'kg' })).toThrow(/add up to 101/);
    expect(() => allocate(100, [2, 2, 1], [80, 40, null], { tolerance: 0.5, label: 'kg' })).toThrow(/more than/);
  });

  it('conserves pieces, weight, declared value and freight across the lots', async () => {
    world({ total_items: 3, pieces_total: 3, total_weight_kg: 100, freight_charge: 1000 });
    const res = await split({ ref: S1, lots: [{ pieces: 1 }, { pieces: 1 }] });
    expect(res.status).toBe(201);
    expect(res.body.lots.map((l: any) => [l.label, l.pieces, l.weight_kg, l.freight_share, l.declared_value])).toEqual([
      ['A', 1, 33.33, 333.33, 83333.33],
      ['B', 1, 33.33, 333.33, 83333.33],
      ['C', 1, 33.34, 333.34, 83333.34],
    ]);
    const lots = lotsOf(ID.s1);
    expect(sum(lots, l => l.pieces_total)).toBe(3);
    expect(sum(lots, l => l.total_weight_kg)).toBe(100);
    expect(sum(lots, l => l.freight_share)).toBe(1000);
    // The declared value comes from the HSN lines (2,50,000) and is kept on the master
    expect(sum(lots, l => l.declared_value)).toBe(250000);
    expect(one('shipments', ID.s1)).toMatchObject({ declared_value: 250000, freight_share: 0, pieces_total: 3 });
  });

  it('refuses lots that hold more than is held, or weights that do not add up', async () => {
    expect((await split({ ref: S1, lots: [{ pieces: 60 }, { pieces: 50 }] })).status).toBe(409);
    expect((await split({ ref: S1, lots: [{ pieces: 50, weight_kg: 600 }, { pieces: 50, weight_kg: 300 }] })).status).toBe(400);
    expect((await split({ ref: S1, lots: [{ pieces: 100 }] })).status).toBe(400);
    expect(lotsOf(ID.s1)).toHaveLength(0);
  });
});

describe('nested split', () => {
  it('splits a lot into A1 and A2 under the same master, keeping the tree flat', async () => {
    expect((await split({ ref: S1, lots: [{ pieces: 60 }] })).status).toBe(201);
    const res = await split({ ref: `${S1}-A`, lots: [{ pieces: 20 }] });
    expect(res.status).toBe(201);
    expect(res.body.master).toEqual({ ref: { shipment_id: ID.s1 }, code: S1 });
    expect(res.body.source.code).toBe(`${S1}-A`);
    expect(res.body.lots.map((l: any) => [l.code, l.pieces])).toEqual([[`${S1}-A1`, 20], [`${S1}-A2`, 40]]);

    const lots = lotsOf(ID.s1);
    expect(lots.map(l => [l.lot_label, l.status, l.pieces_total, l.parent_shipment_id])).toEqual([
      ['A', 'cancelled', 0, ID.s1],
      ['B', 'in_transit', 40, ID.s1],
      ['A1', 'in_transit', 20, ID.s1],
      ['A2', 'in_transit', 40, ID.s1],
    ]);
    expect(sum(lots, l => l.pieces_total)).toBe(100);
    expect(sum(lots, l => l.total_weight_kg)).toBe(1000);
    expect(sum(lots, l => l.freight_share)).toBe(5000);

    // Split events on the master, the lot split again, and each new lot
    const splitOf = (id: string) => supabaseMock.rows('cargo_custody_events').filter(e => e.kind === 'split' && e.shipment_id === id);
    expect(splitOf(ID.s1)).toHaveLength(2);
    expect(splitOf(lots[0].id)).toHaveLength(2);
    expect(splitOf(lots[2].id)).toHaveLength(1);
    expect(splitOf(ID.s1)[1].notes).toMatch(/Lot A split into lots A1 \(20\), A2 \(40\)/);

    // A1 split again: A1.1 and A1.2
    const deeper = await split({ ref: `${S1}-A1`, lots: [{ pieces: 5 }] });
    expect(deeper.body.lots.map((l: any) => l.label)).toEqual(['A1.1', 'A1.2']);
    const where = await request(app).get(api(`/cargo/where/${S1}`)).set(auth.admin());
    expect(where.body.totals).toMatchObject({ lots: 4, held: 100, by_holder: { vehicle: 100, hub: 0, consignor: 0 } });
  });
});

describe('the single-holder rule', () => {
  it('refuses to split goods whose lots are with different holders', async () => {
    const planned = await request(app).post(api('/cargo/transfers')).set(auth.admin())
      .send({ from_vehicle_id: ID.v1, to_vehicle_id: ID.v2, items: [{ ref: { shipment_id: ID.s1 }, pieces: 30 }] });
    const moving = { shipment_id: planned.body.items[0].ref.shipment_id };
    // Being handed over: its pieces are in two places
    await request(app).post(api(`/cargo/transfers/${planned.body.id}/handover-out`)).set(auth.driver()).send({ items: [{ ref: moving, pieces_out: 30 }] });
    const midway = await split({ ref: moving, lots: [{ pieces: 10 }] });
    expect(midway.status).toBe(409);
    expect(midway.body.detail).toMatch(/being handed over/);
    await request(app).post(api(`/cargo/transfers/${planned.body.id}/handover-in`)).set(auth.driver(ID.driver2)).send({ items: [{ ref: moving, pieces_in: 30 }] });

    const res = await split({ ref: S1, lots: [{ pieces: 10 }] });
    expect(res.status).toBe(409);
    expect(res.body.detail).toBe(`The goods of ${S1} are with more than one holder (30 on MH12AB0002, 70 on MH12AB0001). Only goods with one holder in one place can be split: split one of its lots instead.`);
    expect(res.body.lots.map((l: any) => l.code)).toEqual([`${S1}-A`, `${S1}-B`]);
    // Each lot has one holder, so a lot can be split
    expect((await split({ ref: `${S1}-B`, lots: [{ pieces: 10 }] })).status).toBe(201);
  });

  it('refuses delivered goods and goods without a count', async () => {
    world({ status: 'delivered', current_holder: 'consignee', pieces_delivered: 100 });
    expect((await split({ ref: S1, lots: [{ pieces: 10 }] })).status).toBe(409);
    world({ pieces_total: null, total_items: 0 });
    expect((await split({ ref: S1, lots: [{ pieces: 10 }] })).status).toBe(409);
  });

  it('is for staff', async () => {
    expect((await request(app).post(api('/cargo/lots/split')).set(auth.driver()).send({ ref: S1, lots: [{ pieces: 10 }] })).status).toBe(403);
  });
});

describe('merge', () => {
  it('merges lots in the same place for the same consignee and drop, adding the counts back up', async () => {
    await split({ ref: S1, lots: [{ pieces: 30 }] });
    const res = await merge([`${S1}-A`, `${S1}-B`]);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ code: `${S1}-A`, label: 'A', pieces: 100 });
    const [a, b] = lotsOf(ID.s1);
    expect(a).toMatchObject({ pieces_total: 100, total_weight_kg: 1000, freight_share: 5000, status: 'in_transit' });
    expect(b).toMatchObject({ pieces_total: 0, status: 'cancelled', current_vehicle_id: null });
    // B's stop is gone; A keeps its stop, now for all 100
    const bPoint = supabaseMock.rows('delivery_points').find(p => p.shipment_id === b.id)!;
    expect(supabaseMock.rows('route_stops').find(s => s.delivery_point_id === bPoint.id)!.status).toBe('cancelled');
    expect(supabaseMock.rows('delivery_points').find(p => p.shipment_id === a.id)).toMatchObject({ pieces: 100 });
    const merges = supabaseMock.rows('cargo_custody_events').filter(e => e.kind === 'merge');
    expect(merges.map(e => e.shipment_id).sort()).toEqual([ID.s1, a.id, b.id].sort());
    expect(one('shipments', ID.s1).status).toBe('in_transit');
  });

  it('refuses lots of other consignments, in other places, to other consignees, or that have left', async () => {
    await split({ ref: S1, lots: [{ pieces: 30 }, { pieces: 20, consignee_name: 'Kulkarni Stores', drop: { address: 'Baner, Pune', lat: 18.56, lng: 73.78 } }] });
    // Different consignee and drop
    const other = await merge([`${S1}-A`, `${S1}-B`]);
    expect(other.status).toBe(409);
    expect(other.body.detail).toMatch(/different consignees/);
    // Not a lot of the same consignment
    expect((await merge([`${S1}-A`, { shipment_id: ID.s2 }])).status).toBe(409);
    // A lot that departed since the split
    await request(app).post(api('/cargo/custody')).set(auth.driver()).send({ ref: `${S1}-C`, kind: 'departed' });
    const left = await merge([`${S1}-A`, `${S1}-C`]);
    expect(left.status).toBe(409);
    expect(left.body.detail).toMatch(/has moved since it was split/);
  });

  it('refuses lots on different vehicles', async () => {
    const planned = await request(app).post(api('/cargo/transfers')).set(auth.admin())
      .send({ from_vehicle_id: ID.v1, to_vehicle_id: ID.v2, items: [{ ref: { shipment_id: ID.s1 }, pieces: 30 }] });
    const moving = planned.body.items[0].ref;
    await request(app).post(api(`/cargo/transfers/${planned.body.id}/handover-out`)).set(auth.driver()).send({ items: [{ ref: moving, pieces_out: 30 }] });
    await request(app).post(api(`/cargo/transfers/${planned.body.id}/handover-in`)).set(auth.driver(ID.driver2)).send({ items: [{ ref: moving, pieces_in: 30 }] });
    const res = await merge([`${S1}-A`, `${S1}-B`]);
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/not with the same holder in the same place/);
  });
});

describe('hub cross-dock', () => {
  beforeEach(() => world({ status: 'at_hub', current_holder: 'hub', current_vehicle_id: null, current_depot_id: ID.depot }));

  it('splits goods at a hub into outbound lots, each with its own next drop or vehicle', async () => {
    const res = await split({
      ref: S1, reason: 'hub_crossdock',
      lots: [
        { pieces: 40, consignee_name: 'Kulkarni Stores', consignee_phone: '9800011111', drop: { name: 'Kulkarni Stores', address: 'Baner, Pune', lat: 18.56, lng: 73.78 }, to_vehicle_id: ID.v2 },
        { pieces: 30, to_vehicle_id: ID.v3 },
      ],
    });
    expect(res.status).toBe(201);
    const [a, b, c] = lotsOf(ID.s1);
    expect([a, b, c].map(l => [l.lot_label, l.status, l.current_holder, l.current_depot_id, l.pieces_total])).toEqual([
      ['A', 'at_hub', 'hub', ID.depot, 40],
      ['B', 'at_hub', 'hub', ID.depot, 30],
      ['C', 'at_hub', 'hub', ID.depot, 30],
    ]);
    // Lot A's new drop is on the collecting vehicle's route already
    const aPoint = supabaseMock.rows('delivery_points').find(p => p.shipment_id === a.id)!;
    expect(aPoint).toMatchObject({ address: 'Baner, Pune', consignee_name: 'Kulkarni Stores' });
    const aStop = supabaseMock.rows('route_stops').find(s => s.delivery_point_id === aPoint.id)!;
    expect(one('routes', aStop.route_id).vehicle_id).toBe(ID.v2);

    // Hub inventory lists the lots, never the master
    const inventory = await request(app).get(api(`/cargo/hubs/${ID.depot}/inventory`)).set(auth.admin());
    expect(inventory.body.items.map((i: any) => i.code).sort()).toEqual([`${S1}-A`, `${S1}-B`, `${S1}-C`]);

    // The driver of the planned vehicle collects lot A with hub_out
    const out = await request(app).post(api('/cargo/custody')).set(auth.driver(ID.driver2)).send({ ref: `${S1}-A`, kind: 'hub_out', depot_id: ID.depot });
    expect(out.status).toBe(201);
    expect(one('shipments', a.id)).toMatchObject({ status: 'in_transit', current_holder: 'vehicle', current_vehicle_id: ID.v2 });
    // The master rolls up: some on the move, the rest at the hub
    expect(one('shipments', ID.s1)).toMatchObject({ status: 'in_transit', current_holder: 'vehicle' });
  });

  it('refuses a cross-dock of goods not at a hub, and a hub as the next stop of goods at a hub', async () => {
    world();
    expect((await split({ ref: S1, reason: 'hub_crossdock', lots: [{ pieces: 10 }] })).status).toBe(409);
    world({ status: 'at_hub', current_holder: 'hub', current_vehicle_id: null, current_depot_id: ID.depot });
    expect((await split({ ref: S1, reason: 'hub_crossdock', lots: [{ pieces: 10, to_depot_id: ID.depot }] })).status).toBe(400);
  });
});

describe('the remainder after a partial delivery', () => {
  beforeEach(() => world({ total_items: 10, pieces_total: 10, total_weight_kg: 1000 }));

  it('splits the refused pieces into a lot for another consignee, and bills each part once', async () => {
    const partial = await request(app).post(api('/cargo/custody')).set(auth.driver()).send({
      ref: { shipment_id: ID.s1 }, kind: 'partial_delivery', pieces: 7, pieces_refused: 3, receiver_name: 'Store manager', photo_paths: [`cargo/${ID.s1}/photo_1.jpg`],
    });
    expect(partial.status).toBe(201);
    // The same consignee's re-attempt needs no split: a remainder lot names who and where
    expect((await split({ ref: S1, reason: 'partial_delivery_remainder', lots: [{ pieces: 3 }] })).status).toBe(400);

    const res = await split({
      ref: S1, reason: 'partial_delivery_remainder',
      lots: [{ pieces: 3, consignee_name: 'Kulkarni Stores', drop: { name: 'Kulkarni Stores', address: 'Baner, Pune', lat: 18.56, lng: 73.78 } }],
    });
    expect(res.status).toBe(201);
    // All 3 held pieces make one lot: the master keeps the 7 delivered
    expect(res.body.lots).toHaveLength(1);
    const [lot] = lotsOf(ID.s1);
    expect(lot).toMatchObject({ status: 'in_transit', current_holder: 'vehicle', current_vehicle_id: ID.v1, pieces_total: 3, freight_share: 1500, consignee_name: 'Kulkarni Stores', delivery_attempts: 0 });
    // The master keeps its 7 delivered pieces and the freight for them
    expect(one('shipments', ID.s1)).toMatchObject({ is_master: true, pieces_total: 10, pieces_delivered: 7, freight_share: 3500 });
    // The refused case now covers the lot, so the master shows the problem
    const refused = supabaseMock.rows('cargo_exceptions').find(e => e.type === 'refused')!;
    expect(supabaseMock.rows('cargo_exception_items').some(i => i.exception_id === refused.id && i.shipment_id === lot.id)).toBe(true);
    expect(one('shipments', ID.s1).status).toBe('exception');

    // The lot is delivered to its consignee: the master is delivered, and each part billed once
    const delivered = await request(app).post(api('/cargo/custody')).set(auth.admin()).send({ ref: `${S1}-A`, kind: 'delivery', receiver_name: 'Mr Kulkarni', reason: 'Signed paper POD' });
    expect(delivered.status).toBe(201);
    expect(one('shipments', ID.s1).status).toBe('delivered');
    const invoices = supabaseMock.rows('invoices');
    expect(invoices.map(i => [i.shipment_id, i.amount, i.price_source]).sort()).toEqual([
      [ID.s1, 3500, 'lot_freight_share'],
      [lot.id, 1500, 'lot_freight_share'],
    ].sort());
  });

  it('needs something delivered first', async () => {
    expect((await split({ ref: S1, reason: 'partial_delivery_remainder', lots: [{ pieces: 3, consignee_name: 'Kulkarni Stores' }] })).status).toBe(409);
  });
});

describe('vendor loads', () => {
  const CM = 'CM-AA110000';

  it('splits a load into CM-XXXXXXXX-A lots, bills each lot and completes the request when all are delivered', async () => {
    const res = await split({ ref: CM, lots: [{ pieces: 1 }] });
    expect(res.status).toBe(201);
    expect(res.body.master).toEqual({ ref: { manifest_id: ID.m1 }, code: CM });
    expect(res.body.lots.map((l: any) => [l.code, l.pieces, l.weight_kg, l.freight_share])).toEqual([[`${CM}-A`, 1, 75, 2000], [`${CM}-B`, 3, 225, 6000]]);
    expect(one('cargo_manifest', ID.m1)).toMatchObject({ is_master: true, vehicle_id: null, current_vehicle_id: null, status: 'in_transit' });
    const [a, b] = lotsOf(ID.m1, 'cargo_manifest');
    expect(a).toMatchObject({ vehicle_id: ID.v1, current_vehicle_id: ID.v1, vendor_request_id: ID.request1, capacity_kg: 75 });

    // A lot code resolves, and the vendor can follow the load and its lots
    const where = await request(app).get(api(`/cargo/where/${CM}-B`)).set(auth.vendor());
    expect(where.status).toBe(200);
    expect(where.body).toMatchObject({ code: `${CM}-B`, lot: { label: 'B', master: { code: CM } } });
    const master = await request(app).get(api(`/cargo/lots/${CM}`)).set(auth.vendor());
    expect(master.body.lots.map((l: any) => l.code)).toEqual([`${CM}-A`, `${CM}-B`]);

    const deliver = (ref: string) => request(app).post(api('/cargo/custody')).set(auth.admin()).send({ ref, kind: 'delivery', receiver_name: 'Dock clerk', reason: 'Signed paper POD' });
    expect((await deliver(`${CM}-A`)).status).toBe(201);
    expect(one('vendor_shipment_requests', ID.request1).status).toBe('assigned');
    expect(one('cargo_manifest', ID.m1).status).toBe('in_transit');
    expect((await deliver(`${CM}-B`)).status).toBe(201);
    expect(one('cargo_manifest', ID.m1)).toMatchObject({ status: 'delivered', current_holder: 'consignee' });
    expect(one('vendor_shipment_requests', ID.request1).status).toBe('completed');
    // One invoice per lot for its share; none for the master, which kept nothing of its own
    expect(supabaseMock.rows('invoices').map(i => [i.manifest_id, i.amount]).sort()).toEqual([[a.id, 2000], [b.id, 6000]].sort());
    // The master refuses custody of its own
    expect((await deliver(CM)).status).toBe(409);
  });
});
