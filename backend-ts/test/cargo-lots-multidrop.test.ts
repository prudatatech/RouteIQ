/**
 * Lots from a multi-drop booking (docs/cargo-plan.md, Lots): 100 cartons go 50 to one consignee,
 * 25 to another and 25 to a third. The master is created with the whole consignment and split
 * into lots A, B and C, each with its own delivery point, consignee and share of the weight,
 * value and freight. The same happens when a customer books several drops and staff confirm it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { invalidateDriverVehicles } from '../src/core/ownership';
import { indianDateKey } from '../src/core/istDate';
import { ID, auth, cargoWorld, one } from './support/cargo-world';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;

beforeEach(() => {
  invalidateDriverVehicles();
  supabaseMock.reset(cargoWorld({ system_settings: [{ key: 'rate_per_km', value: { rate: 20 } }], parcels: [] }));
});

const DROPS = [
  { name: 'Sharma Traders', address: 'Gandhi Maidan, Patna', lat: 25.61, lng: 85.14, consignee_name: 'Sharma Traders', consignee_phone: '9876500001', consignee_gstin: '10ABCDE1234F1Z5', pieces: 50 },
  { name: 'Gupta Stores', address: 'Boring Road, Patna', lat: 25.62, lng: 85.11, consignee_name: 'Gupta Stores', consignee_phone: '9876500002', pieces: 25 },
  { name: 'Patna hub onward', address: 'Bypass Road, Patna', lat: 25.58, lng: 85.18, consignee_name: 'Verma Agencies', consignee_phone: '9876500003', pieces: 25 },
];

function createMultiDrop(over: Record<string, unknown> = {}) {
  return request(app).post(api('/shipments')).set(auth.admin()).send({
    origin_name: 'Bhiwandi warehouse', origin_address: 'Bhiwandi', origin_lat: 19.3, origin_lng: 73.06,
    total_weight_kg: 1000, freight_charge: 10000, declared_value: 300000, drops: DROPS, ...over,
  });
}

describe('multi-drop shipment: 100 cartons to 50 / 25 / 25', () => {
  it('creates the master with one lot per drop, each with its own delivery point and consignee', async () => {
    const res = await createMultiDrop();
    expect(res.status).toBe(201);
    const master = one('shipments', res.body.id);
    expect(master).toMatchObject({ is_master: true, pieces_total: 100, total_items: 100, total_weight_kg: 1000, status: 'created', current_vehicle_id: null });

    const lots = supabaseMock.rows('shipments').filter(s => s.parent_shipment_id === master.id).sort((a, b) => a.lot_seq - b.lot_seq);
    expect(lots.map(l => [l.lot_label, l.tracking_id, l.pieces_total])).toEqual([
      ['A', `${master.tracking_id}-A`, 50],
      ['B', `${master.tracking_id}-B`, 25],
      ['C', `${master.tracking_id}-C`, 25],
    ]);
    expect(lots.every(l => l.split_reason === 'multi_drop' && l.status === 'created' && l.current_holder === 'consignor')).toBe(true);
    expect(lots.map(l => l.consignee_name)).toEqual(['Sharma Traders', 'Gupta Stores', 'Verma Agencies']);
    expect(lots[0].consignee_gstin).toBe('10ABCDE1234F1Z5');

    // Weight, value and freight are shared by pieces and add back up to the whole
    expect(lots.map(l => l.total_weight_kg)).toEqual([500, 250, 250]);
    expect(lots.map(l => l.declared_value)).toEqual([150000, 75000, 75000]);
    expect(lots.map(l => l.freight_share)).toEqual([5000, 2500, 2500]);
    expect(master.freight_share).toBe(0);

    // Each lot has its own delivery point; the master has none
    for (const [i, lot] of lots.entries()) {
      const points = supabaseMock.rows('delivery_points').filter(p => p.shipment_id === lot.id);
      expect(points).toHaveLength(1);
      expect(points[0]).toMatchObject({ address: DROPS[i].address, latitude: DROPS[i].lat, pieces: DROPS[i].pieces, consignee_name: DROPS[i].consignee_name, lot_shipment_id: lot.id });
    }
    expect(supabaseMock.rows('delivery_points').filter(p => p.shipment_id === master.id)).toHaveLength(0);

    // A split event on the master and on each lot, in the custody log and the hash chain
    const splits = supabaseMock.rows('cargo_custody_events').filter(e => e.kind === 'split');
    expect(splits.map(e => e.shipment_id).sort()).toEqual([master.id, ...lots.map(l => l.id)].sort());
    expect(splits.find(e => e.shipment_id === master.id)!.notes).toMatch(/Split into lots A \(50\), B \(25\), C \(25\)/);
    const logs = supabaseMock.rows('shipment_logs').filter(l => l.metadata_json?.custody_kind === 'split');
    expect(logs).toHaveLength(4);

    // The detail answer lists the lots
    expect(res.body.lots.map((l: any) => l.lot_label)).toEqual(['A', 'B', 'C']);
    expect(res.body.lots[1].delivery_points[0].consignee_name).toBe('Gupta Stores');
  });

  it('assigns every lot to the vehicle named at creation, on one route', async () => {
    const res = await createMultiDrop({ vehicle_id: ID.v2 });
    expect(res.status).toBe(201);
    const lots = supabaseMock.rows('shipments').filter(s => s.parent_shipment_id === res.body.id);
    expect(lots.every(l => l.status === 'assigned' && l.current_vehicle_id === ID.v2)).toBe(true);
    const routes = supabaseMock.rows('routes').filter(r => r.vehicle_id === ID.v2);
    expect(routes).toHaveLength(1);
    expect(supabaseMock.rows('route_stops').filter(s => s.route_id === routes[0].id)).toHaveLength(3);
    // The master rolls up to assigned, and never holds a vehicle of its own
    expect(one('shipments', res.body.id)).toMatchObject({ status: 'assigned', current_vehicle_id: null });
  });

  it('takes the weights given per drop when they add up, and refuses them otherwise', async () => {
    const weights = [600, 200, 200];
    const ok = await createMultiDrop({ drops: DROPS.map((d, i) => ({ ...d, weight_kg: weights[i] })) });
    expect(ok.status).toBe(201);
    expect(supabaseMock.rows('shipments').filter(s => s.parent_shipment_id === ok.body.id).map(l => l.total_weight_kg).sort((a, b) => b - a)).toEqual([600, 200, 200]);

    const bad = await createMultiDrop({ drops: DROPS.map((d, i) => ({ ...d, weight_kg: weights[i] + 5 })) });
    expect(bad.status).toBe(400);
    const some = await createMultiDrop({ drops: DROPS.map((d, i) => (i === 0 ? { ...d, weight_kg: 600 } : d)) });
    expect(some.status).toBe(400);
  });

  it('shows the master in the shipments list with a lots summary, and does not count it twice', async () => {
    const res = await createMultiDrop({ vehicle_id: ID.v2 });
    const list = await request(app).get(api('/shipments')).set(auth.admin());
    expect(list.status).toBe(200);
    const master = list.body.find((s: any) => s.id === res.body.id);
    expect(master.is_master).toBe(true);
    expect(master.vehicle_id).toBeNull();
    expect(master.lots_summary).toMatchObject({ count: 3, delivered_lots: 0 });
    expect(master.lots_summary.lots.map((l: any) => l.label)).toEqual(['A', 'B', 'C']);
    const lots = list.body.filter((s: any) => s.parent_shipment_id === res.body.id);
    expect(lots).toHaveLength(3);
    expect(lots.every((l: any) => l.master_tracking_id === master.tracking_id)).toBe(true);

    // The vehicle carries the lots' weight once: 1,000 kg, not 2,000
    expect(one('vehicles', ID.v2).available_capacity_kg).toBe(4000);
    const counts = await request(app).get(api('/dashboard/shipment-counts')).set(auth.admin());
    expect(counts.status).toBe(200);
    // Three lots assigned; the master is left out (s2 of the fleet fixture is assigned too)
    expect(counts.body.counts.assigned).toBe(4);
  });
});

describe('multi-drop customer booking', () => {
  const TODAY = indianDateKey(new Date());
  const booking = (over: Record<string, unknown> = {}) => ({
    pickup_name: 'Bhiwandi', pickup_address: 'Bhiwandi, Maharashtra', pickup_lat: 19.3, pickup_lng: 73.06,
    drop_name: 'Patna', drop_address: 'Bypass Road, Patna', drop_lat: 25.58, drop_lng: 85.18,
    weight_kg: 1000, load_type: 'full', date: TODAY,
    drops: DROPS.map((d, i) => ({ ...d, weight_kg: [500, 250, 250][i] })),
    ...over,
  });

  it('keeps the drops on the booking, and confirming it makes the master and its lots', async () => {
    const made = await request(app).post(api('/customer/bookings')).set(auth.customer()).send(booking());
    expect(made.status).toBe(201);
    expect(made.body.drops).toHaveLength(3);

    const confirmed = await request(app).post(api(`/bookings/${made.body.id}/confirm`)).set(auth.admin()).send({ price: 9000 });
    expect(confirmed.status).toBe(200);
    const master = one('shipments', confirmed.body.shipment_id);
    expect(master).toMatchObject({ is_master: true, pieces_total: 100, freight_charge: 9000 });
    const lots = supabaseMock.rows('shipments').filter(s => s.parent_shipment_id === master.id);
    expect(lots.map(l => l.freight_share).sort((a, b) => b - a)).toEqual([4500, 2250, 2250]);
    expect(lots.every(l => !l.metadata?.customer_booking_id)).toBe(true);

    // The customer sees the lots of their booking in plain words
    const cargo = await request(app).get(api(`/customer/bookings/${made.body.id}/cargo`)).set(auth.customer());
    expect(cargo.status).toBe(200);
    expect(cargo.body.where).toMatchObject({ is_master: true, status: 'created', pieces: { total: 100, delivered: 0 } });
    expect(cargo.body.lots.map((l: any) => l.text)).toEqual([
      'Lot A (50 pieces): going to Sharma Traders, Gandhi Maidan, Patna',
      'Lot B (25 pieces): going to Gupta Stores, Boring Road, Patna',
      'Lot C (25 pieces): going to Verma Agencies, Bypass Road, Patna',
    ]);
    expect(cargo.body.where.lots[0].freight_share).toBeNull();
  });

  it('refuses drops whose weights do not add up to the booking', async () => {
    const res = await request(app).post(api('/customer/bookings')).set(auth.customer()).send(booking({ weight_kg: 900 }));
    expect(res.status).toBe(400);
  });

  it('cancels every lot when the customer cancels before pickup', async () => {
    const made = await request(app).post(api('/customer/bookings')).set(auth.customer()).send(booking());
    const confirmed = await request(app).post(api(`/bookings/${made.body.id}/confirm`)).set(auth.admin()).send({});
    const res = await request(app).post(api(`/customer/bookings/${made.body.id}/cancel`)).set(auth.customer()).send({});
    expect(res.status).toBe(200);
    const lots = supabaseMock.rows('shipments').filter(s => s.parent_shipment_id === confirmed.body.shipment_id);
    expect(lots.every(l => l.status === 'cancelled')).toBe(true);
    expect(one('shipments', confirmed.body.shipment_id).status).toBe('cancelled');
  });
});
