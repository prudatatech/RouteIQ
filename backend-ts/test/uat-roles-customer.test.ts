/**
 * UAT role findings, customer side: ROL-01 (a booking honours its Idempotency-Key), ROL-02 (the cargo
 * view carries the rating given), ROL-03 (a multi-drop rating reaches each lot's driver), ROL-09 and
 * ROL-10 (an impossible date and the same pickup and drop are refused with 422).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { invalidateDriverVehicles } from '../src/core/ownership';
import { indianDateKey } from '../src/core/istDate';
import { ID, NOW, auth, cargoWorld, notesFor, one, shipmentRow } from './support/cargo-world';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const TODAY = indianDateKey(new Date());
const MASTER = '51000000-0000-4000-8000-0000000000a0';
const LOT_A = '51000000-0000-4000-8000-0000000000a1';
const LOT_B = '51000000-0000-4000-8000-0000000000a2';

const payload = (over: Record<string, unknown> = {}) => ({
  pickup_name: 'Bhiwandi', pickup_address: 'Bhiwandi, Maharashtra', pickup_lat: 19.3, pickup_lng: 73.06,
  drop_name: 'Pune', drop_address: 'Pune, Maharashtra', drop_lat: 18.52, drop_lng: 73.85,
  weight_kg: 1500, load_type: 'full', vehicle_type: 'Tata Ace', date: TODAY, ...over,
});

describe('booking and quote checks', () => {
  beforeEach(() => {
    invalidateDriverVehicles();
    supabaseMock.reset(cargoWorld({ customer_bookings: [], shipments: [], system_settings: [{ key: 'rate_per_km', value: { rate: 20 } }] }));
  });
  const book = (body: object, key?: string) => {
    const r = request(app).post(api('/customer/bookings')).set(auth.customer());
    if (key) r.set('Idempotency-Key', key);
    return r.send(body);
  };

  it('ROL-01: the same key returns the first booking, a new key books again', async () => {
    const first = await book(payload(), 'uat-dup-0000001');
    const again = await book(payload(), 'uat-dup-0000001');
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(first.body.id);
    expect(supabaseMock.rows('customer_bookings')).toHaveLength(1);
    const other = await book(payload(), 'uat-dup-0000002');
    expect(other.body.id).not.toBe(first.body.id);
    expect(supabaseMock.rows('customer_bookings')).toHaveLength(2);
  });

  it('ROL-09: a date that does not exist is a 422, not a 500', async () => {
    const quote = await request(app).post(api('/customer/quote')).set(auth.customer()).send(payload({ date: '2999-11-31' }));
    expect(quote.status).toBe(422);
    expect(quote.body.detail).toBe('Choose a valid pickup date');
    expect((await book(payload({ date: '2999-02-30' }))).status).toBe(422);
    expect(supabaseMock.rows('customer_bookings')).toHaveLength(0);
  });

  it('ROL-10: the same pickup and drop, or 0,0, is a 422', async () => {
    const same = payload({ drop_lat: 19.3, drop_lng: 73.06 });
    expect((await request(app).post(api('/customer/quote')).set(auth.customer()).send(same)).status).toBe(422);
    expect((await book(same)).status).toBe(422);
    expect((await book(payload({ pickup_lat: 0, pickup_lng: 0 }))).status).toBe(422);
    expect((await request(app).post(api('/customer/quote')).set(auth.customer()).send(payload({ drop_lat: 0, drop_lng: 0 }))).status).toBe(422);
    expect(supabaseMock.rows('customer_bookings')).toHaveLength(0);
  });
});

const lotRow = (id: string, label: string, seq: number, over: Record<string, unknown> = {}) => shipmentRow(id, {
  tracking_id: `RTX-MULTI-${label}`, parent_shipment_id: MASTER, lot_label: label, lot_seq: seq, status: 'delivered', current_holder: 'consignee',
  current_vehicle_id: null, freight_share: 2500, freight_charge: null, total_items: 5, pieces_total: 5, pieces_delivered: 5, ...over,
});
const delivery = (shipment: string, vehicle: string) => ({
  id: `ev-${shipment}`, shipment_id: shipment, kind: 'delivery', from_vehicle_id: vehicle, pieces: 5, photo_paths: [], recorded_role: 'driver', recorded_at: NOW,
});

describe('the rating of a delivered booking', () => {
  beforeEach(() => {
    invalidateDriverVehicles();
    supabaseMock.reset(cargoWorld({
      shipments: [
        shipmentRow(MASTER, { tracking_id: 'RTX-MULTI', is_master: true, status: 'delivered', current_holder: 'consignee', current_vehicle_id: null, freight_share: 0, freight_charge: 5000, pieces_total: 10, pieces_delivered: 10 }),
        lotRow(LOT_A, 'A', 1), lotRow(LOT_B, 'B', 2),
      ],
      customer_bookings: [{ id: ID.booking1, customer_id: ID.customer, shipment_id: MASTER, tracking_id: 'RTX-MULTI', status: 'delivered', pickup_name: 'Bhiwandi', drop_name: 'Patna', created_at: NOW, updated_at: NOW }],
      cargo_custody_events: [delivery(LOT_A, ID.v1), delivery(LOT_B, ID.v2)],
      delivery_points: [], route_stops: [],
    }));
  });
  const cargo = () => request(app).get(api(`/customer/bookings/${ID.booking1}/cargo`)).set(auth.customer());
  const rate = (rating: number) => request(app).post(api(`/customer/bookings/${ID.booking1}/confirm-receipt`)).set(auth.customer()).send({ rating, comment: 'Careful' });

  it('ROL-02: the cargo view carries no rating until given, then the rating', async () => {
    expect((await cargo()).body.rating).toBeNull();
    expect((await rate(4)).status).toBe(200);
    expect((await cargo()).body.rating).toMatchObject({ rating: 4, comment: 'Careful' });
    expect((await rate(5)).status).toBe(409);
  });

  it('ROL-03: each delivered lot carries the rating with its own truck and driver, and each driver is told', async () => {
    expect((await rate(4)).status).toBe(200);
    expect(one('shipments', LOT_A)).toMatchObject({ driver_rating: 4, rated_vehicle_id: ID.v1, rated_driver_id: ID.driver1 });
    expect(one('shipments', LOT_B)).toMatchObject({ driver_rating: 4, rated_vehicle_id: ID.v2, rated_driver_id: ID.driver2 });
    // The booking holds the rating, but no truck, so no driver's average counts it twice
    expect(one('shipments', MASTER).driver_rating).toBe(4);
    expect(one('shipments', MASTER).rated_vehicle_id ?? null).toBeNull();
    expect(one('shipments', MASTER).rated_driver_id ?? null).toBeNull();
    const told = (id: string) => notesFor(id).filter(n => n.type === 'delivery_rated');
    expect(told(ID.driver1)).toHaveLength(1);
    expect(told(ID.driver1)[0].data).toMatchObject({ shipment_id: LOT_A, rating: 4 });
    expect(told(ID.driver2)).toHaveLength(1);
    expect(told(ID.admin)).toHaveLength(1);
  });
});

describe('CR10b: the rating of a single-drop booking', () => {
  const SINGLE = ID.s1;
  beforeEach(() => {
    invalidateDriverVehicles();
    // Delivered by completing its route stop: no custody delivery event, the shipment holds no truck any more
    supabaseMock.reset(cargoWorld({
      shipments: [shipmentRow(SINGLE, { status: 'delivered', current_holder: 'consignee', current_vehicle_id: null })],
      customer_bookings: [{ id: ID.booking1, customer_id: ID.customer, shipment_id: SINGLE, tracking_id: 'RTX-SINGLE', status: 'delivered', pickup_name: 'Bhiwandi', drop_name: 'Pune', created_at: NOW, updated_at: NOW }],
      cargo_custody_events: [],
      delivery_points: [{ id: ID.dp1, shipment_id: SINGLE, name: 'Pune', address: 'Pune', latitude: 18.5, longitude: 73.8, demand_kg: 1000, status: 'delivered', created_at: NOW }],
      route_stops: [{ id: ID.stop1, route_id: ID.route1, delivery_point_id: ID.dp1, sequence: 1, status: 'completed' }],
      routes: [{ id: ID.route1, vehicle_id: ID.v1, status: 'completed', started_at: NOW, created_at: NOW }],
    }));
  });

  it('stores the truck and driver that delivered it and tells that driver once', async () => {
    const res = await request(app).post(api(`/customer/bookings/${ID.booking1}/confirm-receipt`)).set(auth.customer()).send({ rating: 5 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ rating: 5, comment: null, claim: null });
    expect(one('shipments', SINGLE)).toMatchObject({ driver_rating: 5, rated_vehicle_id: ID.v1, rated_driver_id: ID.driver1 });
    expect(notesFor(ID.driver1).filter(n => n.type === 'delivery_rated')).toHaveLength(1);
  });
});
