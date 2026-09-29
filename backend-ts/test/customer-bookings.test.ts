import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';
import { indianDateKey } from '../src/core/istDate';

const app = testApp();
const CUSTOMER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const BOOKING = '33333333-3333-4333-8333-333333333333';
const VEHICLE = '44444444-4444-4444-8444-444444444444';
const customer = (id = CUSTOMER) => ({ Authorization: `Bearer ${createAccessToken({ sub: id, role: 'customer' })}` });
const admin = () => ({ Authorization: `Bearer ${supabaseMock.signUserToken('admin-1')}` });
const vendor = () => ({ Authorization: `Bearer ${supabaseMock.signUserToken('vendor-1')}` });
const TODAY = indianDateKey(new Date());

const payload = (over: Record<string, unknown> = {}) => ({
  pickup_name: 'Bhiwandi', pickup_address: 'Bhiwandi, Maharashtra', pickup_lat: 19.3, pickup_lng: 73.06,
  drop_name: 'Pune', drop_address: 'Pune, Maharashtra', drop_lat: 18.52, drop_lng: 73.85,
  weight_kg: 1500, load_type: 'full', vehicle_type: 'Tata Ace', date: TODAY, ...over,
});

function bookingRow(over: Record<string, unknown> = {}) {
  return {
    id: BOOKING, customer_id: CUSTOMER, pickup_name: 'Bhiwandi', pickup_address: 'Bhiwandi, Maharashtra', pickup_lat: 19.3, pickup_lng: 73.06,
    drop_name: 'Pune', drop_address: 'Pune, Maharashtra', drop_lat: 18.52, drop_lng: 73.85, weight_kg: 1500, load_type: 'full',
    vehicle_type: null, pickup_date: TODAY, quoted_price: 2400, quote_details: null, status: 'requested', shipment_id: null,
    tracking_id: null, vehicle_id: null, cancelled_by: null, cancel_reason: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    ...over,
  };
}

function reset(bookings: Record<string, unknown>[] = [], rate: number | null = 20) {
  supabaseMock.reset({
    users: [{ id: 'admin-1', role: 'admin', is_active: true }, { id: 'vendor-1', role: 'vendor', is_active: true }],
    customers: [{ id: CUSTOMER, phone: '+919800000001', full_name: 'Asha Rao', company_name: null }, { id: OTHER, phone: '+919800000002', full_name: 'Other', company_name: null }],
    system_settings: rate == null ? [] : [{ key: 'rate_per_km', value: { rate } }],
    customer_bookings: bookings,
    shipments: [], shipment_logs: [], delivery_points: [], parcels: [], route_stops: [], routes: [],
    vehicles: [{ id: VEHICLE, plate_number: 'MH04AB1234', capacity_kg: 5000, available_capacity_kg: 5000, status: 'available' }],
    notifications: [], invoices: [], shipment_hsn: [], capacity_bids: [], capacity_windows: [], cargo_manifest: [], vendor_shipment_requests: [],
  });
}

const post = (path: string, headers: Record<string, string>, body: Record<string, unknown> = {}) => request(app).post(`/api/v1${path}`).set(headers).send(body);
const get = (path: string, headers: Record<string, string>) => request(app).get(`/api/v1${path}`).set(headers);
const notesFor = (userId: string) => supabaseMock.rows('notifications').filter((n) => n.user_id === userId);

describe('customer books a shipment', () => {
  beforeEach(() => reset());

  it('creates a booking priced by the server and tells the customer and staff', async () => {
    const res = await post('/customer/bookings', customer(), payload({ quoted_price: 1, status: 'delivered' }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ customer_id: CUSTOMER, status: 'requested', pickup_name: 'Bhiwandi', weight_kg: 1500, vehicle_type: 'Tata Ace' });
    expect(res.body.quoted_price).toBeGreaterThan(1000);
    expect(notesFor(CUSTOMER)).toHaveLength(1);
    expect(notesFor('admin-1')).toHaveLength(1);
  });

  it('keeps the price empty when no rate is set', async () => {
    reset([], null);
    const res = await post('/customer/bookings', customer(), payload());
    expect(res.status).toBe(201);
    expect(res.body.quoted_price).toBeNull();
  });

  it('validates the request', async () => {
    expect((await post('/customer/bookings', customer(), payload({ pickup_name: '' }))).status).toBe(400);
    expect((await post('/customer/bookings', customer(), payload({ weight_kg: -5 }))).status).toBe(400);
    expect((await post('/customer/bookings', customer(), payload({ date: '2020-01-01' }))).status).toBe(400);
    expect((await post('/customer/bookings', customer(), payload({ date: '2999-01-01' }))).status).toBe(400);
    expect(supabaseMock.rows('customer_bookings')).toHaveLength(0);
  });

  it('needs a customer sign-in', async () => {
    expect((await request(app).post('/api/v1/customer/bookings').send(payload())).status).toBe(401);
    expect((await post('/customer/bookings', vendor(), payload())).status).toBe(403);
  });

  it('limits how many bookings one customer can send an hour', async () => {
    let last = 201;
    for (let i = 0; i < 11; i += 1) last = (await post('/customer/bookings', customer('55555555-5555-4555-8555-555555555555'), payload())).status;
    expect(last).toBe(429);
  });
});

describe('customer sees only their own bookings', () => {
  beforeEach(() => reset([bookingRow(), bookingRow({ id: '66666666-6666-4666-8666-666666666666', customer_id: OTHER })]));

  it('lists own bookings', async () => {
    const res = await get('/customer/bookings', customer());
    expect(res.body.map((b: any) => b.id)).toEqual([BOOKING]);
  });

  it('hides another customer\'s booking', async () => {
    expect((await get('/customer/bookings/66666666-6666-4666-8666-666666666666', customer())).status).toBe(404);
    expect((await post('/customer/bookings/66666666-6666-4666-8666-666666666666/cancel', customer())).status).toBe(404);
  });

  it('shows a booking without tracking until a shipment exists', async () => {
    const res = await get(`/customer/bookings/${BOOKING}`, customer());
    expect(res.status).toBe(200);
    expect(res.body.booking.id).toBe(BOOKING);
    expect(res.body.tracking).toBeNull();
  });
});

describe('staff handle bookings', () => {
  beforeEach(() => reset([bookingRow()]));

  it('is for staff only', async () => {
    expect((await get('/bookings', customer())).status).toBe(403);
    expect((await get('/bookings', vendor())).status).toBe(403);
    expect((await request(app).get('/api/v1/bookings')).status).toBe(401);
  });

  it('lists bookings with who booked', async () => {
    const res = await get('/bookings?status=requested', admin());
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ id: BOOKING, customer: { name: 'Asha Rao', phone: '+919800000001' } });
    expect((await get('/bookings?status=nope', admin())).status).toBe(400);
  });

  it('confirms into a real shipment and notifies the customer', async () => {
    const res = await post(`/bookings/${BOOKING}/confirm`, admin());
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('confirmed');
    expect(res.body.tracking_id).toMatch(/^RTX-/);
    const [shipment] = supabaseMock.rows('shipments');
    expect(shipment).toMatchObject({ tracking_id: res.body.tracking_id, origin_name: 'Bhiwandi', total_weight_kg: 1500 });
    expect(shipment.metadata).toMatchObject({ source: 'customer_app', customer_booking_id: BOOKING });
    expect(supabaseMock.rows('delivery_points')[0]).toMatchObject({ name: 'Pune', shipment_id: shipment.id });
    expect(notesFor(CUSTOMER).some((n) => n.title === 'Booking confirmed')).toBe(true);
    expect((await post(`/bookings/${BOOKING}/confirm`, admin())).status).toBe(409);
    expect(supabaseMock.rows('shipments')).toHaveLength(1);
  });

  it('assigns a vehicle after confirming, not before', async () => {
    expect((await post(`/bookings/${BOOKING}/assign`, admin(), { vehicle_id: VEHICLE })).status).toBe(409);
    await post(`/bookings/${BOOKING}/confirm`, admin());
    expect((await post(`/bookings/${BOOKING}/assign`, admin(), { vehicle_id: 'nope' })).status).toBe(400);
    // The mock returns embedded relations as written, so attach the delivery point the way the database join would.
    supabaseMock.rows('shipments')[0].delivery_points = supabaseMock.rows('delivery_points');
    const res = await post(`/bookings/${BOOKING}/assign`, admin(), { vehicle_id: VEHICLE });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'assigned', vehicle_id: VEHICLE });
    expect(notesFor(CUSTOMER).some((n) => n.title === 'Vehicle assigned')).toBe(true);
  });

  it('cancels with a reason and tells the customer', async () => {
    expect((await post(`/bookings/${BOOKING}/cancel`, admin(), {})).status).toBe(400);
    const res = await post(`/bookings/${BOOKING}/cancel`, admin(), { reason: 'No truck on this route' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'cancelled', cancelled_by: 'staff', cancel_reason: 'No truck on this route' });
    expect(notesFor(CUSTOMER).some((n) => n.body.includes('No truck on this route'))).toBe(true);
  });

  it('follows the shipment to in transit and delivered', async () => {
    await post(`/bookings/${BOOKING}/confirm`, admin());
    const shipmentId = supabaseMock.rows('shipments')[0].id;
    await request(app).patch(`/api/v1/shipments/${shipmentId}`).set(admin()).send({ status: 'in_transit' });
    expect(supabaseMock.rows('customer_bookings')[0].status).toBe('in_transit');
    await request(app).patch(`/api/v1/shipments/${shipmentId}`).set(admin()).send({ status: 'delivered', received_by: 'R. Sharma' });
    expect(supabaseMock.rows('customer_bookings')[0].status).toBe('delivered');
    expect(notesFor(CUSTOMER).map((n) => n.title)).toEqual(expect.arrayContaining(['Your shipment is on its way', 'Your shipment was delivered']));
  });
});

describe('customer cancels before pickup', () => {
  beforeEach(() => reset([bookingRow()]));

  it('cancels a requested booking and tells staff', async () => {
    const res = await post(`/customer/bookings/${BOOKING}/cancel`, customer(), { reason: 'Plans changed' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'cancelled', cancelled_by: 'customer', cancel_reason: 'Plans changed' });
    expect(notesFor('admin-1').some((n) => n.title === 'Customer cancelled a booking')).toBe(true);
    expect((await post(`/customer/bookings/${BOOKING}/cancel`, customer())).status).toBe(409);
  });

  it('cancels the shipment too once confirmed', async () => {
    await post(`/bookings/${BOOKING}/confirm`, admin());
    const res = await post(`/customer/bookings/${BOOKING}/cancel`, customer());
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('shipments')[0].status).toBe('cancelled');
    expect(supabaseMock.rows('customer_bookings')[0].status).toBe('cancelled');
  });

  it('is refused after pickup', async () => {
    reset([bookingRow({ status: 'in_transit' })]);
    const res = await post(`/customer/bookings/${BOOKING}/cancel`, customer());
    expect(res.status).toBe(409);
    expect(supabaseMock.rows('customer_bookings')[0].status).toBe('in_transit');
  });
});
