/**
 * UAT role findings, vendor / 3PL / claims side: ROL-08 (malformed ids), ROL-10 (a load from a place
 * to itself or from 0,0), ROL-11 (a claim ceiling), ROL-13 (PATCH /tpl/:id is partial), ROL-14 (email
 * format), ROL-15 (matching off then on reopens the window), ROL-17 (a floor on a bid).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { invalidateDriverVehicles } from '../src/core/ownership';
import { createAccessToken } from '../src/core/auth';
import { ID, NOW, auth, cargoWorld, one } from './support/cargo-world';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (id: string) => ({ Authorization: `Bearer ${supabaseMock.signUserToken(id)}` });
const BAD = 'not-a-uuid';

describe('malformed ids are a 404 or 400, never a 500 (ROL-08)', () => {
  beforeEach(() => {
    invalidateDriverVehicles();
    supabaseMock.reset(cargoWorld({ users: [
      { id: 'admin-1', role: 'admin', is_active: true }, { id: 'super-1', role: 'superadmin', is_active: true },
      { id: 'driver-1', role: 'driver', is_active: true }, { id: 'vendor-1', role: 'vendor', is_active: true },
    ], tpl_partners: [], vendor_profiles: [] }));
  });

  it('answers 404 for a bad invoice, SOS, request or application id', async () => {
    expect((await request(app).get(api(`/invoices/${BAD}/pdf`)).set(auth.customer())).status).toBe(404);
    expect((await request(app).post(api(`/telemetry/sos/${BAD}/cancel`)).set(auth.driver()).send({})).status).toBe(404);
    expect((await request(app).put(api(`/vendor/shipment-request/${BAD}/cancel`)).set(auth.vendor())).status).toBe(404);
    expect((await request(app).put(api(`/vendor/shipment-request/${BAD}/approve`)).set(auth.admin()).send({ cost: 100 })).status).toBe(404);
    expect((await request(app).patch(api('/tpl/uat_tpl_a1')).send({ companyName: 'X' })).status).toBe(404);
    expect((await request(app).post(api(`/tpl/approve/${BAD}`)).set(bearer('super-1'))).status).toBe(404);
    expect((await request(app).post(api(`/tpl/reject/${BAD}`)).set(bearer('super-1')).send({ reason: 'No' })).status).toBe(404);
  });

  it('answers 400 for a bad vehicle id when assigning a truck', async () => {
    const res = await request(app).put(api(`/vendor/shipment-request/${ID.request1}/assign-vehicle`)).set(auth.admin()).send({ vehicle_id: BAD, cost: 100 });
    expect(res.status).toBe(400);
  });
});

describe('vendor loads (ROL-10)', () => {
  beforeEach(() => {
    supabaseMock.reset({
      users: [{ id: 'vendor-1', role: 'vendor', is_active: true }, { id: 'admin-1', role: 'admin', is_active: true }],
      vendor_profiles: [{ id: 'vendor-1', company_name: 'Acme', kyc_status: 'approved' }],
      vendor_shipment_requests: [], notifications: [],
    });
  });
  const post = (body: object) => request(app).post(api('/vendor/shipment-request')).set(bearer('vendor-1')).send(body);
  const good = { pickup: { address: 'Pune Yard', lat: 18.5, lng: 73.8 }, drop: { address: 'Mumbai Dock', lat: 19, lng: 72.8 }, capacity: 500 };

  it('refuses the same pickup and drop, and 0,0, with a 422', async () => {
    expect((await post({ ...good, drop: { address: 'Same', lat: 18.5, lng: 73.8 } })).status).toBe(422);
    expect((await post({ pickup: { address: 'a', lat: 0, lng: 0 }, drop: { address: 'b', lat: 0, lng: 0 }, capacity: 10 })).status).toBe(422);
    expect((await post({ ...good, pickup: { address: 'a', lat: 0, lng: 0 } })).status).toBe(422);
    expect(supabaseMock.rows('vendor_shipment_requests')).toHaveLength(0);
    expect((await post(good)).status).toBe(200);
  });
});

describe('claims are held to the declared value (ROL-11)', () => {
  beforeEach(() => {
    supabaseMock.reset(cargoWorld());
    Object.assign(one('shipments', ID.s1), { status: 'delivered', current_holder: 'consignee', current_vehicle_id: null, pieces_delivered: 10 });
    supabaseMock.rows('cargo_custody_events').push({ id: 'ev', shipment_id: ID.s1, kind: 'delivery', pieces: 10, photo_paths: [], recorded_role: 'driver', recorded_at: NOW });
  });
  const file = (claimed_amount: number, type = 'damage') => request(app).post(api('/cargo/claims')).set(auth.customer()).send({ ref: { shipment_id: ID.s1 }, claim_type: type, claimed_amount });

  it('refuses more than the declared value (250,000) with a 422, and takes up to it', async () => {
    const over = await file(99_999_999);
    expect(over.status).toBe(422);
    expect(over.body.detail).toMatch(/declared value/);
    expect((await file(250_001)).status).toBe(422);
    expect((await file(250_000)).status).toBe(201);
  });

  it('holds goods with no declared value to the platform limit', async () => {
    supabaseMock.rows('shipment_hsn').length = 0;
    expect((await file(99_999_999, 'delay')).status).toBe(422);
    expect((await file(2000, 'delay')).status).toBe(201);
  });
});

describe('3PL applications (ROL-13, ROL-14)', () => {
  const PID = '11111111-1111-1111-1111-111111111111';
  beforeEach(() => {
    supabaseMock.reset({
      users: [{ id: 'admin-1', role: 'admin', is_active: true }],
      vendor_profiles: [],
      tpl_partners: [{
        id: PID, custom_id: 'acme_3pl', company_name: 'Acme', status: 'pending', email: 'ops@acme.in', pan_number: 'ABCDE1234F',
        msme_status: 'Small', tax_treatment: 'GST', sla_commitment: '4 Hours', bank_account_no: '123456789012', tpl_corridors: [], tpl_documents: [],
      }],
      tpl_documents: [], tpl_corridors: [], notifications: [], ai_agent_logs: [],
    });
  });

  it('ROL-13: an edit of some fields leaves the others as they were', async () => {
    const res = await request(app).patch(api(`/tpl/${PID}`)).send({ verify_pan: 'ABCDE1234F', companyName: 'Acme Freight', slaCommitment: '2 Hours' });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('tpl_partners')[0]).toMatchObject({
      company_name: 'Acme Freight', sla_commitment: '2 Hours', custom_id: 'acme_3pl', msme_status: 'Small', tax_treatment: 'GST', bank_account_no: '123456789012', pan_number: 'ABCDE1234F',
    });
  });

  it('ROL-14: onboarding refuses a malformed email', async () => {
    const body = { custom_id: 'fresh_3pl', companyName: 'Fresh', pan: 'FGHIJ5678K', gst: '27FGHIJ5678K1Z1' };
    for (const email of ['not-an-email', 'a@b', 'a b@c.in']) {
      const res = await request(app).post(api('/tpl/onboard')).send({ ...body, email });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/valid email/);
    }
    expect((await request(app).post(api('/tpl/onboard')).send({ ...body, email: 'hi@fresh.in' })).status).toBe(200);
  });
});

describe('return trips (ROL-15, ROL-17)', () => {
  const driver = { Authorization: `Bearer ${createAccessToken({ sub: 'driver-1', role: 'driver' })}` };
  const toggle = (enabled: boolean) => request(app).post(api('/capacity/driver/toggle-matching')).set(driver).send({ vehicle_id: 'v1', enabled });
  const min = 60_000;
  beforeEach(() => {
    supabaseMock.reset({
      users: [{ id: 'driver-1', role: 'driver', is_active: true }, { id: 'vendor-1', role: 'vendor', is_active: true }, { id: 'admin-1', role: 'admin', is_active: true }],
      vehicles: [{ id: 'v1', driver_id: 'driver-1', plate_number: 'MH12AB1234', vehicle_type: 'truck', status: 'available', capacity_kg: 1000, available_capacity_kg: 800, latitude: 18.53, longitude: 73.86, current_location_name: 'Baner, Pune', bidding_window_open: false }],
      vendor_profiles: [{ id: 'vendor-1', kyc_status: 'approved', company_name: 'Acme', latitude: 18.52, longitude: 73.85, city: 'Pune' }],
      capacity_windows: [], capacity_bids: [], delivery_points: [], routes: [], route_stops: [], notifications: [], shipments: [],
    });
  });

  it('ROL-15: off then on brings back the same window, with its minimum price and its planned end', async () => {
    supabaseMock.rows('capacity_windows').push({
      id: 'w1', vehicle_id: 'v1', opens_at: new Date(Date.now() - min).toISOString(), closes_at: new Date(Date.now() + 20 * min).toISOString(),
      floor_price: 1200, trigger_type: 'return_trip', status: 'open', winning_bid_id: null,
    });
    const planned = supabaseMock.rows('capacity_windows')[0].closes_at;
    expect((await toggle(false)).status).toBe(200);
    expect(supabaseMock.rows('capacity_windows')[0].status).toBe('closed');
    expect((await toggle(true)).status).toBe(200);
    expect(supabaseMock.rows('capacity_windows')).toHaveLength(1);
    expect(supabaseMock.rows('capacity_windows')[0]).toMatchObject({ id: 'w1', status: 'open', floor_price: 1200, closes_at: planned });
    expect(supabaseMock.rows('vehicles')[0].bidding_window_open).toBe(true);
  });

  it('ROL-15: a window whose time has run out is not reopened; a fresh one opens', async () => {
    supabaseMock.rows('capacity_windows').push({
      id: 'old', vehicle_id: 'v1', opens_at: new Date(Date.now() - 40 * min).toISOString(), closes_at: new Date(Date.now() - 5 * min).toISOString(),
      floor_price: 1200, trigger_type: 'return_trip', status: 'closed', winning_bid_id: null,
    });
    expect((await toggle(true)).status).toBe(200);
    expect(supabaseMock.rows('capacity_windows').filter(w => w.status === 'open')).toHaveLength(1);
    expect(supabaseMock.rows('capacity_windows')).toHaveLength(2);
  });

  it('ROL-17: a 1-rupee bid on a window with no minimum price is refused, a fair one is taken', async () => {
    supabaseMock.rows('capacity_windows').push({
      id: 'w1', vehicle_id: 'v1', opens_at: new Date(Date.now() - min).toISOString(), closes_at: new Date(Date.now() + 20 * min).toISOString(),
      floor_price: null, trigger_type: 'return_trip', status: 'open', winning_bid_id: null,
      vehicles: { plate_number: 'MH12AB1234', latitude: 18.53, longitude: 73.86, current_location_name: 'Baner, Pune', available_capacity_kg: 800 },
    });
    const bid = (bid_amount: number) => request(app).post(api('/capacity/bids')).set(bearer('vendor-1')).send({
      window_id: 'w1', bid_amount, weight_kg: 500, dropoff_name: 'Hinjewadi', dropoff_address: 'Hinjewadi, Pune', dropoff_lat: 18.59, dropoff_lng: 73.73,
      eway_bill_ref: '123456789012', load_configuration: 'Palletized',
    });
    const low = await bid(1);
    expect(low.status).toBe(400);
    expect(low.body.error).toMatch(/minimum bid/);
    expect((await bid(2500)).status).toBe(200);
  });
});
