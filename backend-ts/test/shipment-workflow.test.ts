import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';
import { indianDateKey } from '../src/core/istDate';
import { finalDeliveryPoint } from '../src/core/destination';
import { SHIPMENT_TRANSITIONS, canTransition } from '../src/core/transitions';
import { ShipmentService, releaseShipmentsFromRoute } from '../src/services/shipment.service';

const app = testApp();
const CUSTOMER = '11111111-1111-4111-8111-111111111111';
const BOOKING = '33333333-3333-4333-8333-333333333333';
const VEHICLE = '44444444-4444-4444-8444-444444444444';
const OTHER_VEHICLE = '55555555-5555-4555-8555-555555555555';
const DRIVER = 'driver-1';
const SHIPMENT = 'ship-1';
const DP1 = 'dp-1';
const DP2 = 'dp-2';
const admin = () => ({ Authorization: `Bearer ${supabaseMock.signUserToken('admin-1')}` });
const TODAY = indianDateKey(new Date());
const NOW = new Date().toISOString();

const bookingRow = (over: Record<string, unknown> = {}) => ({
  id: BOOKING, customer_id: CUSTOMER, pickup_name: 'Bhiwandi', pickup_address: 'Bhiwandi, Maharashtra', pickup_lat: 19.3, pickup_lng: 73.06,
  drop_name: 'Pune', drop_address: 'Pune, Maharashtra', drop_lat: 18.52, drop_lng: 73.85, weight_kg: 1500, load_type: 'full',
  vehicle_type: null, pickup_date: TODAY, quoted_price: 2400, quote_details: null, status: 'requested', shipment_id: null,
  tracking_id: null, vehicle_id: null, cancelled_by: null, cancel_reason: null, created_at: NOW, updated_at: NOW, ...over,
});

const dps = [
  { id: DP1, name: 'Stop A', address: 'A', latitude: 18.6, longitude: 73.7, shipment_id: SHIPMENT, status: 'pending', created_at: '2026-09-29T10:00:00.000Z' },
  { id: DP2, name: 'Final drop', address: 'B', latitude: 18.5, longitude: 73.8, shipment_id: SHIPMENT, status: 'pending', created_at: '2026-09-29T10:00:00.001Z' },
];

function shipmentRow(over: Record<string, unknown> = {}) {
  return {
    id: SHIPMENT, tracking_id: 'RTX-AAAA1111', status: 'created', priority: 'medium', origin_name: 'Bhiwandi', origin_address: 'Bhiwandi',
    origin_lat: 19.3, origin_lng: 73.06, total_items: 1, total_weight_kg: 500, freight_charge: null, bid_id: null, metadata: {},
    created_at: NOW, updated_at: NOW, delivery_points: dps, ...over,
  };
}

function reset(extra: Record<string, any[]> = {}) {
  supabaseMock.reset({
    users: [{ id: 'admin-1', role: 'admin', is_active: true }, { id: DRIVER, role: 'driver', is_active: true }],
    customers: [{ id: CUSTOMER, phone: '+919800000001', full_name: 'Asha Rao', company_name: null }],
    customer_bookings: [],
    shipments: [], shipment_logs: [], delivery_points: [], parcels: [], route_stops: [], routes: [],
    vehicles: [
      { id: VEHICLE, plate_number: 'MH04AB1234', vehicle_type: 'truck', capacity_kg: 5000, available_capacity_kg: 5000, status: 'available', driver_id: DRIVER },
      { id: OTHER_VEHICLE, plate_number: 'MH04AB9999', vehicle_type: 'truck', capacity_kg: 5000, available_capacity_kg: 5000, status: 'available', driver_id: null },
    ],
    notifications: [], invoices: [], shipment_hsn: [], capacity_bids: [], capacity_windows: [], cargo_manifest: [], vendor_shipment_requests: [],
    system_settings: [{ key: 'rate_per_km', value: { rate: 20 } }],
    ...extra,
  });
}

const post = (path: string, body: Record<string, unknown> = {}) => request(app).post(`/api/v1${path}`).set(admin()).send(body);
const patch = (path: string, body: Record<string, unknown> = {}) => request(app).patch(`/api/v1${path}`).set(admin()).send(body);
const notesFor = (userId: string) => supabaseMock.rows('notifications').filter(n => n.user_id === userId);
const one = (table: string, id: string) => supabaseMock.rows(table).find(r => r.id === id)!;

describe('the final drop of a shipment', () => {
  it('is the point created last, whatever order the rows arrive in', () => {
    const points = [
      { id: 'last', created_at: '2026-01-01T00:00:00.002Z' },
      { id: 'first', created_at: '2026-01-01T00:00:00.000Z' },
      { id: 'mid', created_at: '2026-01-01T00:00:00.001Z' },
    ];
    expect(finalDeliveryPoint(points)?.id).toBe('last');
    expect(finalDeliveryPoint([{ id: 'a' }, { id: 'b' }])?.id).toBe('b');
    expect(finalDeliveryPoint([])).toBeNull();
  });

  it('is what public tracking shows', async () => {
    reset({ shipments: [shipmentRow({ delivery_points: [dps[1], dps[0]] })] });
    const res = await request(app).get('/api/v1/shipments/track/RTX-AAAA1111');
    expect(res.status).toBe(200);
    expect(res.body.destination).toMatchObject({ name: 'Final drop' });
  });
});

describe('transitions', () => {
  it('lets dispatch assign, take back and reassign a shipment', () => {
    expect(canTransition(SHIPMENT_TRANSITIONS, 'created', 'assigned')).toBe(true);
    expect(canTransition(SHIPMENT_TRANSITIONS, 'assigned', 'created')).toBe(true);
    expect(canTransition(SHIPMENT_TRANSITIONS, 'exception', 'assigned')).toBe(true);
    expect(canTransition(SHIPMENT_TRANSITIONS, 'delivered', 'assigned')).toBe(false);
  });
});

describe('confirming a customer booking', () => {
  beforeEach(() => reset({ customer_bookings: [bookingRow()] }));

  it('copies the quote into the freight charge and carries the pickup date', async () => {
    const res = await post(`/bookings/${BOOKING}/confirm`);
    expect(res.status).toBe(200);
    const shipment = supabaseMock.rows('shipments')[0];
    expect(shipment.freight_charge).toBe(2400);
    expect(shipment.metadata).toMatchObject({ pickup_date: TODAY, dispatch_date: TODAY, customer_booking_id: BOOKING });
    expect(res.body.tracking_id).toBe(shipment.tracking_id);
  });

  it('uses the price staff enter instead of the quote', async () => {
    const res = await post(`/bookings/${BOOKING}/confirm`, { price: 3100.456 });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('shipments')[0].freight_charge).toBe(3100.46);
    expect((await post(`/bookings/${BOOKING}/confirm`, { price: -5 })).status).toBe(400);
  });

  it('invoices the delivery at the quoted price', async () => {
    await post(`/bookings/${BOOKING}/confirm`);
    const id = supabaseMock.rows('shipments')[0].id;
    const { recordCustody } = await import('../src/services/cargo/custody.service');
    await recordCustody({ shipment_id: id }, { kind: 'delivery', receiver_name: 'Ravi', reason: 'Confirmed on the phone' }, { id: 'admin-1', role: 'admin' }, { via: 'verify_pod', impliedPickup: true });
    expect(supabaseMock.rows('invoices')).toHaveLength(1);
    expect(supabaseMock.rows('invoices')[0]).toMatchObject({ shipment_id: id, amount: 2400, price_source: 'freight_charge' });
  });

  it('reuses the shipment a failed earlier attempt left behind instead of making another', async () => {
    reset({
      customer_bookings: [bookingRow()],
      shipments: [shipmentRow({ id: 'orphan', tracking_id: 'RTX-33333333', metadata: { customer_booking_id: BOOKING } })],
    });
    const res = await post(`/bookings/${BOOKING}/confirm`);
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('shipments')).toHaveLength(1);
    expect(res.body).toMatchObject({ shipment_id: 'orphan', tracking_id: 'RTX-33333333', status: 'confirmed' });
    expect(one('shipments', 'orphan').freight_charge).toBe(2400);
  });

  it('does not reuse a cancelled shipment or another booking\'s', async () => {
    reset({
      customer_bookings: [bookingRow()],
      shipments: [shipmentRow({ id: 'old', tracking_id: 'RTX-33333333', status: 'cancelled', metadata: { customer_booking_id: BOOKING } })],
    });
    const res = await post(`/bookings/${BOOKING}/confirm`);
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('shipments')).toHaveLength(2);
    expect(res.body.shipment_id).not.toBe('old');
  });
});

describe('assigning a shipment', () => {
  beforeEach(() => reset({
    shipments: [shipmentRow()],
    delivery_points: dps.map(d => ({ ...d })),
    customer_bookings: [bookingRow({ status: 'confirmed', shipment_id: SHIPMENT, tracking_id: 'RTX-AAAA1111' })],
  }));

  it('marks it assigned, logs it, moves the booking, and dispatches the route', async () => {
    const res = await post(`/shipments/${SHIPMENT}/assign`, { vehicle_id: VEHICLE });
    expect(res.status).toBe(200);
    expect(one('shipments', SHIPMENT).status).toBe('assigned');
    const log = supabaseMock.rows('shipment_logs').find(l => l.status === 'assigned')!;
    expect(log.metadata_json).toMatchObject({ vehicle_id: VEHICLE, actor_id: 'admin-1' });
    expect(one('customer_bookings', BOOKING)).toMatchObject({ status: 'assigned', vehicle_id: VEHICLE });
    expect(notesFor(CUSTOMER).some(n => n.title === 'Vehicle assigned')).toBe(true);

    const route = supabaseMock.rows('routes')[0];
    expect(route.status).toBe('active');
    expect(route.started_at).toBeTruthy();
    expect(one('vehicles', VEHICLE).status).toBe('on_route');
    expect(notesFor(DRIVER).some(n => n.type === 'route_activated')).toBe(true);
    expect(supabaseMock.rows('route_stops').map(s => s.sequence).sort()).toEqual([1, 2]);
  });

  it('refuses a vehicle that is in maintenance, too small, or the wrong class', async () => {
    supabaseMock.rows('vehicles').push({ id: 'v-maint', plate_number: 'X1', vehicle_type: 'truck', capacity_kg: 5000, status: 'maintenance' });
    supabaseMock.rows('vehicles').push({ id: 'v-small', plate_number: 'X2', vehicle_type: 'truck', capacity_kg: 100, status: 'available' });
    supabaseMock.rows('vehicles').push({ id: 'v-bike', plate_number: 'X3', vehicle_type: 'bike', capacity_kg: 5000, status: 'available' });
    expect((await post(`/shipments/${SHIPMENT}/assign`, { vehicle_id: 'v-maint' })).status).toBe(409);
    const small = await post(`/shipments/${SHIPMENT}/assign`, { vehicle_id: 'v-small' });
    expect(small.status).toBe(409);
    expect(small.body.detail).toMatch(/kg free/);
    one('shipments', SHIPMENT).required_vehicle_type = 'truck';
    expect((await post(`/shipments/${SHIPMENT}/assign`, { vehicle_id: 'v-bike' })).status).toBe(409);
    expect(one('shipments', SHIPMENT).status).toBe('created');
  });

  it('applies the same checks when a booking is assigned', async () => {
    const SMALL = '66666666-6666-4666-8666-666666666666';
    supabaseMock.rows('vehicles').push({ id: SMALL, plate_number: 'X2', vehicle_type: 'truck', capacity_kg: 100, status: 'available' });
    const res = await post(`/bookings/${BOOKING}/assign`, { vehicle_id: SMALL });
    expect(res.status).toBe(409);
    expect(one('customer_bookings', BOOKING).status).toBe('confirmed');
    const ok = await post(`/bookings/${BOOKING}/assign`, { vehicle_id: VEHICLE });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'assigned', vehicle_id: VEHICLE });
    expect(notesFor(CUSTOMER).filter(n => n.title === 'Vehicle assigned')).toHaveLength(1);
  });

  it('puts a failed delivery back on a vehicle', async () => {
    one('shipments', SHIPMENT).status = 'exception';
    one('customer_bookings', BOOKING).status = 'in_transit';
    const res = await post(`/shipments/${SHIPMENT}/assign`, { vehicle_id: OTHER_VEHICLE });
    expect(res.status).toBe(200);
    expect(one('shipments', SHIPMENT).status).toBe('assigned');
    expect(one('customer_bookings', BOOKING)).toMatchObject({ status: 'assigned', vehicle_id: OTHER_VEHICLE });
  });
});

describe('choosing a vehicle', () => {
  it('lists vehicles in service and never placeholders or maintenance', async () => {
    reset({ shipments: [shipmentRow()], delivery_points: dps.map(d => ({ ...d })) });
    supabaseMock.rows('vehicles').push(
      { id: 'v-temp', plate_number: 'TEMP-ABC123', capacity_kg: 100, status: 'available' },
      { id: 'v-draft', plate_number: 'DRFT-ABC123', capacity_kg: 100, status: 'available' },
      { id: 'v-maint', plate_number: 'MH01', capacity_kg: 100, status: 'maintenance' },
      { id: 'v-off', plate_number: 'MH02', capacity_kg: 100, status: 'offline' },
    );
    const res = await request(app).get(`/api/v1/shipments/${SHIPMENT}/assign-options?mode=any`).set(admin());
    expect(res.status).toBe(200);
    expect(res.body.map((v: any) => v.id).sort()).toEqual([OTHER_VEHICLE, VEHICLE, 'v-off'].sort());
  });

  it('gives a booking whose delivery failed another vehicle, but not one that is simply on its way', async () => {
    reset({
      shipments: [shipmentRow({ status: 'exception' })],
      delivery_points: dps.map(d => ({ ...d })),
      customer_bookings: [bookingRow({ status: 'in_transit', shipment_id: SHIPMENT, tracking_id: 'RTX-AAAA1111', vehicle_id: VEHICLE })],
    });
    const ok = await post(`/bookings/${BOOKING}/assign`, { vehicle_id: OTHER_VEHICLE });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'assigned', vehicle_id: OTHER_VEHICLE });

    reset({
      shipments: [shipmentRow({ status: 'in_transit' })],
      delivery_points: dps.map(d => ({ ...d })),
      customer_bookings: [bookingRow({ status: 'in_transit', shipment_id: SHIPMENT, tracking_id: 'RTX-AAAA1111' })],
    });
    expect((await post(`/bookings/${BOOKING}/assign`, { vehicle_id: OTHER_VEHICLE })).status).toBe(409);
  });

  it('lets a shipment price be cleared', async () => {
    reset({ shipments: [shipmentRow({ freight_charge: 1200 })], delivery_points: dps.map(d => ({ ...d })) });
    const res = await request(app).patch(`/api/v1/shipments/${SHIPMENT}/edit`).set(admin()).send({ freight_charge: null });
    expect(res.status).toBe(200);
    expect(one('shipments', SHIPMENT).freight_charge).toBeNull();
  });
});

describe('a shipment with a vehicle at creation', () => {
  beforeEach(() => reset());

  it('is created assigned, on a route that is dispatched', async () => {
    const res = await post('/shipments/', {
      origin_name: 'Hub', origin_address: 'Bhiwandi', origin_lat: 19.3, origin_lng: 73.06,
      dest_name: 'Store', dest_address: 'Pune', dest_lat: 18.5, dest_lng: 73.8, total_items: 1, total_weight_kg: 50, vehicle_id: VEHICLE,
    });
    expect(res.status).toBe(201);
    expect(supabaseMock.rows('shipments')[0].status).toBe('assigned');
    expect(supabaseMock.rows('routes')[0].status).toBe('active');
    expect(one('vehicles', VEHICLE).status).toBe('on_route');
  });

  it('refuses a load the vehicle cannot carry, before creating anything', async () => {
    const res = await post('/shipments/', {
      origin_lat: 19.3, origin_lng: 73.06, dest_lat: 18.5, dest_lng: 73.8, total_items: 1, total_weight_kg: 9000, vehicle_id: VEHICLE,
    });
    expect(res.status).toBe(409);
    expect(supabaseMock.rows('shipments')).toHaveLength(0);
  });
});

describe('releaseShipmentsFromRoute', () => {
  beforeEach(() => reset({
    shipments: [
      shipmentRow({ status: 'assigned' }),
      shipmentRow({ id: 'ship-2', tracking_id: 'RTX-BBBB2222', status: 'in_transit' }),
    ],
    delivery_points: [...dps.map(d => ({ ...d })), { id: 'dp-3', name: 'Other', address: 'C', latitude: 1, longitude: 1, shipment_id: 'ship-2', status: 'pending', created_at: NOW }],
    routes: [{ id: 'route-1', vehicle_id: VEHICLE, status: 'cancelled' }],
    route_stops: [
      { id: 'st1', route_id: 'route-1', delivery_point_id: DP1, sequence: 1, status: 'pending' },
      { id: 'st2', route_id: 'route-1', delivery_point_id: DP2, sequence: 2, status: 'pending' },
      { id: 'st3', route_id: 'route-1', delivery_point_id: 'dp-3', sequence: 3, status: 'pending' },
    ],
    customer_bookings: [bookingRow({ status: 'assigned', shipment_id: SHIPMENT, tracking_id: 'RTX-AAAA1111', vehicle_id: VEHICLE })],
  }));

  it('sends assigned shipments back to created and holds goods already on board on a cargo case', async () => {
    const released = await releaseShipmentsFromRoute('route-1', { id: 'admin-1', role: 'admin' });
    expect(released).toEqual([SHIPMENT]);
    expect(one('shipments', SHIPMENT).status).toBe('created');
    // Never stranded: the goods on the truck wait on hold, still on the vehicle, with an open case
    expect(one('shipments', 'ship-2')).toMatchObject({ status: 'on_hold', current_holder: 'vehicle' });
    expect(supabaseMock.rows('cargo_exceptions')).toHaveLength(1);
    expect(supabaseMock.rows('cargo_exception_items')[0]).toMatchObject({ shipment_id: 'ship-2' });
    expect(supabaseMock.rows('shipment_logs').find(l => l.shipment_id === SHIPMENT && l.status === 'created')?.metadata_json).toMatchObject({ released_from_route: 'route-1' });
    expect(one('customer_bookings', BOOKING)).toMatchObject({ status: 'confirmed', vehicle_id: null });
    expect(notesFor(CUSTOMER).some(n => n.title === 'Finding you another vehicle')).toBe(true);
    expect(one('route_stops', 'st1').status).toBe('cancelled');
    expect(one('route_stops', 'st3').status).toBe('pending');
  });
});

describe('staff cancel or deliver a shipment on a route', () => {
  beforeEach(() => reset({
    shipments: [shipmentRow({ status: 'assigned' })],
    delivery_points: dps.map(d => ({ ...d })),
    routes: [{ id: 'route-1', vehicle_id: VEHICLE, status: 'active', started_at: NOW }],
    route_stops: [
      { id: 'st1', route_id: 'route-1', delivery_point_id: DP1, sequence: 1, status: 'pending' },
      { id: 'st2', route_id: 'route-1', delivery_point_id: DP2, sequence: 2, status: 'pending' },
    ],
    customer_bookings: [bookingRow({ status: 'assigned', shipment_id: SHIPMENT, tracking_id: 'RTX-AAAA1111', vehicle_id: VEHICLE })],
  }));
  beforeEach(() => { one('vehicles', VEHICLE).status = 'on_route'; });

  it('cancels its stops, finishes the empty route, frees the vehicle and tells the driver', async () => {
    const res = await patch(`/shipments/${SHIPMENT}`, { status: 'cancelled' });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('route_stops').map(s => s.status)).toEqual(['cancelled', 'cancelled']);
    expect(one('routes', 'route-1').status).toBe('cancelled');
    expect(one('vehicles', VEHICLE).status).toBe('available');
    expect(notesFor(DRIVER).some(n => n.body === 'Dispatch cancelled the delivery to Final drop.')).toBe(true);
    expect(one('customer_bookings', BOOKING).status).toBe('cancelled');
  });

  it('completes its stops when dispatch confirms the delivery', async () => {
    const res = await post('/cargo/verify-pod', { tracking_id: 'RTX-AAAA1111', recipient_name: 'Ravi', reason: 'Confirmed on the phone' });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('route_stops').every(s => s.status === 'completed' && s.actual_arrival_at)).toBe(true);
    expect(one('routes', 'route-1').status).toBe('completed');
    expect(notesFor(DRIVER).some(n => /marked the delivery to Final drop as delivered/.test(n.body))).toBe(true);
  });

  it('un-assigning it takes it off the route and puts the booking back to confirmed', async () => {
    const res = await patch(`/shipments/${SHIPMENT}`, { status: 'created' });
    expect(res.status).toBe(200);
    expect(one('shipments', SHIPMENT).status).toBe('created');
    expect(one('customer_bookings', BOOKING).status).toBe('confirmed');
    expect(supabaseMock.rows('route_stops').every(s => s.status === 'cancelled')).toBe(true);
  });
});

describe('a failed delivery', () => {
  beforeEach(() => reset({
    shipments: [shipmentRow({ status: 'in_transit' })],
    delivery_points: dps.map(d => ({ ...d })),
    customer_bookings: [bookingRow({ status: 'in_transit', shipment_id: SHIPMENT, tracking_id: 'RTX-AAAA1111', vehicle_id: VEHICLE })],
  }));

  it('tells the customer and keeps the booking status, which the apps read next to shipment_status', async () => {
    await ShipmentService.updateShipmentStatus(SHIPMENT, 'exception', null, null, null, null, { id: DRIVER, role: 'driver' });
    expect(notesFor(CUSTOMER).some(n => n.title === 'Delivery attempt failed')).toBe(true);
    expect(one('customer_bookings', BOOKING).status).toBe('in_transit');
    const { getCustomerBooking, listCustomerBookings } = await import('../src/services/customer-bookings.service');
    expect((await listCustomerBookings(CUSTOMER))[0].shipment_status).toBe('exception');
    expect((await getCustomerBooking(CUSTOMER, BOOKING)).booking.shipment_status).toBe('exception');
  });
});

describe('cancelling a booking', () => {
  it('leaves the booking as it was when the shipment has already moved on', async () => {
    reset({
      shipments: [shipmentRow({ status: 'picked_up' })],
      delivery_points: dps.map(d => ({ ...d })),
      customer_bookings: [bookingRow({ status: 'assigned', shipment_id: SHIPMENT, tracking_id: 'RTX-AAAA1111', vehicle_id: VEHICLE })],
    });
    const res = await post(`/bookings/${BOOKING}/cancel`, { reason: 'changed my mind' });
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/already been picked up/);
    expect(one('customer_bookings', BOOKING)).toMatchObject({ status: 'assigned', cancelled_by: null, cancel_reason: null });
    expect(one('shipments', SHIPMENT).status).toBe('picked_up');
  });

  it('cancels booking and shipment together otherwise', async () => {
    reset({
      shipments: [shipmentRow({ status: 'assigned' })],
      delivery_points: dps.map(d => ({ ...d })),
      customer_bookings: [bookingRow({ status: 'assigned', shipment_id: SHIPMENT, tracking_id: 'RTX-AAAA1111' })],
    });
    expect((await post(`/bookings/${BOOKING}/cancel`, { reason: 'changed my mind' })).status).toBe(200);
    expect(one('shipments', SHIPMENT).status).toBe('cancelled');
    expect(one('customer_bookings', BOOKING)).toMatchObject({ status: 'cancelled', cancelled_by: 'staff' });
  });
});

describe('vehicle capacity', () => {
  beforeEach(() => reset({
    shipments: [shipmentRow({ status: 'exception' }), shipmentRow({ id: 'ship-2', status: 'assigned', total_weight_kg: 300 }), shipmentRow({ id: 'ship-3', status: 'delivered', total_weight_kg: 900 })],
    delivery_points: [
      { id: 'a', shipment_id: SHIPMENT, status: 'failed' },
      { id: 'b', shipment_id: 'ship-2', status: 'pending' },
      { id: 'c', shipment_id: 'ship-3', status: 'completed' },
    ],
    routes: [{ id: 'route-1', vehicle_id: VEHICLE, status: 'active' }],
    route_stops: [
      { id: 's1', route_id: 'route-1', delivery_point_id: 'a', sequence: 1, status: 'failed' },
      { id: 's2', route_id: 'route-1', delivery_point_id: 'b', sequence: 2, status: 'pending' },
      { id: 's3', route_id: 'route-1', delivery_point_id: 'c', sequence: 3, status: 'completed' },
    ],
  }));

  it('counts assigned and failed loads, not delivered ones', async () => {
    await ShipmentService.recalculateVehicleCapacity(VEHICLE);
    expect(one('vehicles', VEHICLE).available_capacity_kg).toBe(5000 - 500 - 300);
  });

  it('never moves a vehicle in maintenance, or one with a running route', async () => {
    supabaseMock.rows('routes').length = 0;
    supabaseMock.rows('route_stops').length = 0;
    one('vehicles', VEHICLE).status = 'maintenance';
    await ShipmentService.recalculateVehicleCapacity(VEHICLE);
    expect(one('vehicles', VEHICLE)).toMatchObject({ status: 'maintenance', available_capacity_kg: 5000 });

    one('vehicles', VEHICLE).status = 'on_route';
    supabaseMock.rows('routes').push({ id: 'route-2', vehicle_id: VEHICLE, status: 'active' });
    await ShipmentService.recalculateVehicleCapacity(VEHICLE);
    expect(one('vehicles', VEHICLE).status).toBe('on_route');
  });

  it('frees a vehicle stuck on_route with nothing left to run', async () => {
    supabaseMock.rows('routes').length = 0;
    one('vehicles', VEHICLE).status = 'on_route';
    await ShipmentService.recalculateVehicleCapacity(VEHICLE);
    expect(one('vehicles', VEHICLE).status).toBe('available');
  });
});

describe('cancelling or deleting a route through the API', () => {
  const routeFixture = (status: string) => reset({
    shipments: [shipmentRow({ status: 'assigned' })],
    delivery_points: dps.map(d => ({ ...d })),
    routes: [{ id: 'route-1', vehicle_id: VEHICLE, status, started_at: status === 'active' ? NOW : null }],
    route_stops: [
      { id: 'st1', route_id: 'route-1', delivery_point_id: DP1, sequence: 1, status: 'pending' },
      { id: 'st2', route_id: 'route-1', delivery_point_id: DP2, sequence: 2, status: 'pending' },
    ],
    customer_bookings: [bookingRow({ status: 'assigned', shipment_id: SHIPMENT, tracking_id: 'RTX-AAAA1111', vehicle_id: VEHICLE })],
  });

  it('puts the shipments back in the queue and tells the driver when an active route is cancelled', async () => {
    routeFixture('active');
    one('vehicles', VEHICLE).status = 'on_route';
    const res = await request(app).patch('/api/v1/routes/route-1/status').set(admin()).send({ status: 'cancelled' });
    expect(res.status).toBe(200);
    expect(one('shipments', SHIPMENT).status).toBe('created');
    expect(one('customer_bookings', BOOKING).status).toBe('confirmed');
    expect(one('vehicles', VEHICLE).status).toBe('available');
    expect(notesFor(DRIVER).some(n => n.type === 'route_cancelled')).toBe(true);
  });

  it('puts the shipments back in the queue when a pending route is deleted', async () => {
    routeFixture('pending');
    const res = await request(app).delete('/api/v1/routes/route-1').set(admin());
    expect(res.status).toBe(200);
    expect(one('shipments', SHIPMENT).status).toBe('created');
    expect(supabaseMock.rows('routes')).toHaveLength(0);
  });
});
