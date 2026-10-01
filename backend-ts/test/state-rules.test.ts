import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { COMPANY_SETTING } from './support/cargo-world';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';

const app = testApp();
const driverAuth = (id = 'driver-1') => ({ Authorization: `Bearer ${createAccessToken({ sub: id, role: 'driver' })}` });
const staff = (id = 'admin-1') => ({ Authorization: `Bearer ${supabaseMock.signUserToken(id)}` });

function reset(over: Record<string, unknown[]> = {}) {
  supabaseMock.reset({
    users: [
      { id: 'admin-1', role: 'admin', is_active: true },
      { id: 'super-1', role: 'superadmin', is_active: true },
      { id: 'vendor-1', role: 'vendor', is_active: true },
      { id: 'driver-1', role: 'driver', is_active: true },
      { id: 'driver-2', role: 'driver', is_active: true },
    ],
    vendor_profiles: [{ id: 'vendor-1', kyc_status: 'approved' }],
    vehicles: [
      { id: 'veh-1', driver_id: 'driver-1', status: 'available', capacity_kg: 1000, current_load_kg: 0, plate_number: 'MH12AB1234' },
      { id: 'veh-2', driver_id: 'driver-2', status: 'available', capacity_kg: 1000, current_load_kg: 0, plate_number: 'MH12AB9999' },
      { id: 'veh-maint', driver_id: null, status: 'maintenance', capacity_kg: 1000 },
    ],
    routes: [{ id: 'route-1', vehicle_id: 'veh-1', status: 'pending' }],
    // the mock does not join tables, so the embedded route is part of the fixture
    route_stops: [{ id: 'stop-1', route_id: 'route-1', delivery_point_id: 'dp-1', status: 'pending', routes: { vehicle_id: 'veh-1' } }],
    delivery_points: [{ id: 'dp-1', shipment_id: 'ship-1' }],
    shipments: [{ id: 'ship-1', status: 'created', priority: 'low', total_items: 1, total_weight_kg: 10, tracking_id: 'RTX-AAAAAA' }],
    shipment_logs: [],
    parcels: [],
    invoices: [],
    payments: [],
    cargo_manifest: [],
    vendor_shipment_requests: [],
    capacity_windows: [],
    driver_confirmations: [],
    sos_alerts: [],
    notifications: [],
    system_settings: [COMPANY_SETTING],
    ...over,
  });
}

beforeEach(() => reset());

describe('PATCH /routes/:id/status', () => {
  const patch = (status: unknown, auth = staff(), id = 'route-1') =>
    request(app).patch(`/api/v1/routes/${id}/status`).set(auth).send({ status });

  it('dispatches a pending route, puts the vehicle on route and tells the driver', async () => {
    const res = await patch('active');
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('routes')[0].status).toBe('active');
    expect(supabaseMock.rows('vehicles')[0].status).toBe('on_route');
    expect(supabaseMock.writes('notifications', 'POST')[0].body).toMatchObject({ user_id: 'driver-1', type: 'route_activated' });
  });

  it('does not re-open a completed or cancelled route', async () => {
    for (const status of ['completed', 'cancelled']) {
      reset({ routes: [{ id: 'route-1', vehicle_id: 'veh-1', status }] });
      const res = await patch('active');
      expect(res.status).toBe(409);
      expect(res.body.detail).toMatch(/can't be changed/);
      expect(supabaseMock.rows('routes')[0].status).toBe(status);
    }
  });

  it('will not jump from pending to completed', async () => {
    expect((await patch('completed')).status).toBe(409);
  });

  it('refuses an unknown status and a missing one', async () => {
    expect((await patch('teleported')).status).toBe(400);
    expect((await patch(undefined)).status).toBe(400);
    expect(supabaseMock.rows('routes')[0].status).toBe('pending');
  });

  it('is idempotent for the status the route already has', async () => {
    reset({ routes: [{ id: 'route-1', vehicle_id: 'veh-1', status: 'active' }] });
    expect((await patch('active')).status).toBe(200);
  });

  it('leaves a vehicle in maintenance alone', async () => {
    reset({ routes: [{ id: 'route-1', vehicle_id: 'veh-maint', status: 'active' }], route_stops: [] });
    expect((await patch('completed')).status).toBe(200);
    expect(supabaseMock.rows('vehicles').find(v => v.id === 'veh-maint')?.status).toBe('maintenance');
  });

  it('refuses to dispatch onto a vehicle in maintenance', async () => {
    reset({ routes: [{ id: 'route-1', vehicle_id: 'veh-maint', status: 'pending' }] });
    expect((await patch('active')).status).toBe(409);
  });

  it('lets a driver start their own route but nothing else', async () => {
    expect((await patch('active', driverAuth())).status).toBe(200);
    reset();
    expect((await patch('cancelled', driverAuth())).status).toBe(403);
    expect((await patch('completed', driverAuth())).status).toBe(403);
    expect((await patch('active', driverAuth('driver-2'))).status).toBe(403);
    expect(supabaseMock.rows('routes')[0].status).toBe('pending');
  });

  it('needs sign-in and refuses vendors', async () => {
    expect((await request(app).patch('/api/v1/routes/route-1/status').send({ status: 'active' })).status).toBe(401);
    expect((await patch('active', staff('vendor-1'))).status).toBe(403);
  });
});

describe('POST /telemetry/driver-ping/start-route', () => {
  const start = (route_id: unknown, auth = driverAuth()) =>
    request(app).post('/api/v1/telemetry/driver-ping/start-route').set(auth).send({ route_id });

  it('starts a pending route once and accepts a retry', async () => {
    expect((await start('route-1')).status).toBe(200);
    expect((await start('route-1')).status).toBe(200);
    expect(supabaseMock.rows('routes')[0].status).toBe('active');
  });

  it('does not restart a completed route', async () => {
    reset({ routes: [{ id: 'route-1', vehicle_id: 'veh-1', status: 'completed' }] });
    expect((await start('route-1')).status).toBe(409);
    expect(supabaseMock.rows('routes')[0].status).toBe('completed');
  });

  it('sets off for a scheduled load without moving it, and refuses a delivered one', async () => {
    reset({ cargo_manifest: [{ id: 'm1', vehicle_id: 'veh-1', status: 'scheduled' }, { id: 'm2', vehicle_id: 'veh-1', status: 'delivered' }] });
    expect((await start('m1')).status).toBe(200);
    // the load goes in transit at the pickup, not when the journey starts
    expect(supabaseMock.rows('cargo_manifest')[0].status).toBe('scheduled');
    expect(supabaseMock.rows('vehicles')[0].status).toBe('on_route');
    expect((await start('m2')).status).toBe(409);
  });

  it('refuses another driver, a missing id and staff', async () => {
    expect((await start('route-1', driverAuth('driver-2'))).status).toBe(403);
    expect((await start(undefined)).status).toBe(400);
    expect((await start('route-1', staff())).status).toBe(403);
  });
});

describe('POST /telemetry/driver-ping/complete-stop', () => {
  const complete = (body: Record<string, unknown>, auth = driverAuth()) =>
    request(app).post('/api/v1/telemetry/driver-ping/complete-stop').set(auth).send(body);

  beforeEach(() => reset({
    routes: [{ id: 'route-1', vehicle_id: 'veh-1', status: 'active' }],
    shipments: [{ id: 'ship-1', status: 'in_transit', total_weight_kg: 10 }],
  }));

  it('completes a pending stop, delivers the shipment and frees the vehicle', async () => {
    const res = await complete({ stop_id: 'stop-1', received_by: 'R. Sharma' });
    expect(res.status).toBe(200);
    expect(res.body.route_completed).toBe(true);
    expect(supabaseMock.rows('route_stops')[0].status).toBe('completed');
    expect(supabaseMock.rows('shipments')[0].status).toBe('delivered');
    expect(supabaseMock.rows('routes')[0].status).toBe('completed');
  });

  it('records a repeated completion once', async () => {
    await complete({ stop_id: 'stop-1' });
    const logs = supabaseMock.writes('shipment_logs').length;
    const again = await complete({ stop_id: 'stop-1' });
    expect(again.status).toBe(200);
    expect(supabaseMock.writes('shipment_logs')).toHaveLength(logs);
  });

  it('refuses to turn a completed stop into a failed one, or an unknown status', async () => {
    await complete({ stop_id: 'stop-1' });
    expect((await complete({ stop_id: 'stop-1', status: 'failed' })).status).toBe(409);
    expect((await complete({ stop_id: 'stop-1', status: 'exploded' })).status).toBe(400);
  });

  it('refuses stops of a route that is finished', async () => {
    reset({ routes: [{ id: 'route-1', vehicle_id: 'veh-1', status: 'cancelled' }] });
    supabaseMock.rows('route_stops')[0].routes = { status: 'cancelled' };
    expect((await complete({ stop_id: 'stop-1' })).status).toBe(409);
  });

  it.each([
    ['a latitude out of range', { lat: 999 }],
    ['a name that is too long', { received_by: 'x'.repeat(201) }],
    ['a signature that is too large', { signature_data: 'x'.repeat(400_001) }],
  ])('refuses %s', async (_name, extra) => {
    const res = await complete({ stop_id: 'stop-1', ...extra });
    expect(res.status).toBe(400);
    expect(supabaseMock.rows('route_stops')[0].status).toBe('pending');
  });

  it('refuses another driver\'s stop and non-drivers', async () => {
    expect((await complete({ stop_id: 'stop-1' }, driverAuth('driver-2'))).status).toBe(403);
    expect((await complete({ stop_id: 'stop-1' }, staff())).status).toBe(403);
    expect(supabaseMock.rows('route_stops')[0].status).toBe('pending');
  });

  describe('vendor loads', () => {
    beforeEach(() => reset({
      cargo_manifest: [{ id: 'm1', vehicle_id: 'veh-1', vendor_request_id: 'req-1', status: 'scheduled', capacity_kg: 100 }],
      vendor_shipment_requests: [{ id: 'req-1', vendor_id: 'vendor-1', status: 'assigned' }],
    }));

    it('needs the pickup before the drop', async () => {
      expect((await complete({ stop_id: 'm1_drop' })).status).toBe(409);
      expect(supabaseMock.rows('cargo_manifest')[0].status).toBe('scheduled');
    });

    it('moves the load once per step and does not bill or load twice on a repeat', async () => {
      // the load's weight was reserved on the vehicle when it was assigned
      supabaseMock.rows('vehicles')[0].current_load_kg = 100;
      expect((await complete({ stop_id: 'm1_pickup' })).status).toBe(200);
      expect(supabaseMock.rows('cargo_manifest')[0].status).toBe('in_transit');
      expect(supabaseMock.rows('vehicles')[0].current_load_kg).toBe(100);
      expect((await complete({ stop_id: 'm1_pickup' })).status).toBe(200);
      expect(supabaseMock.rows('vehicles')[0].current_load_kg).toBe(100);
      expect((await complete({ stop_id: 'm1_drop' })).status).toBe(200);
      expect(supabaseMock.rows('cargo_manifest')[0].status).toBe('delivered');
      expect(supabaseMock.rows('vehicles')[0]).toMatchObject({ current_load_kg: 0, available_capacity_kg: 1000, status: 'available' });
      expect((await complete({ stop_id: 'm1_drop' })).status).toBe(200);
      expect(supabaseMock.writes('invoices', 'POST').length).toBeLessThanOrEqual(1);
    });

    it('does not deliver a load when the driver reports the stop failed, and tells staff', async () => {
      const res = await complete({ stop_id: 'm1_pickup', status: 'failed', reason: 'premises_closed' });
      expect(res.status).toBe(200);
      expect(supabaseMock.rows('cargo_manifest')[0].status).toBe('scheduled');
      expect(supabaseMock.writes('notifications', 'POST').length).toBeGreaterThan(0);
    });
  });
});

describe('POST /telemetry/driver-ping/break', () => {
  const brk = (body: Record<string, unknown>, auth = driverAuth()) =>
    request(app).post('/api/v1/telemetry/driver-ping/break').set(auth).send(body);

  it('sets the vehicle idle on a break and back on route after when it has an active route', async () => {
    reset({ routes: [{ id: 'route-1', vehicle_id: 'veh-1', status: 'active' }] });
    expect((await brk({ is_break: true })).status).toBe(200);
    expect(supabaseMock.rows('vehicles')[0].status).toBe('idle');
    expect((await brk({ is_break: false })).status).toBe(200);
    expect(supabaseMock.rows('vehicles')[0].status).toBe('on_route');
  });

  it('makes a vehicle with no route available after a break, not on route', async () => {
    reset({ routes: [] });
    expect((await brk({ is_break: true })).status).toBe(200);
    expect((await brk({ is_break: false })).status).toBe(200);
    expect(supabaseMock.rows('vehicles')[0].status).toBe('available');
  });

  it('cannot bring a vehicle out of maintenance', async () => {
    reset({ vehicles: [{ id: 'veh-1', driver_id: 'driver-1', status: 'maintenance' }] });
    expect((await brk({ is_break: false })).status).toBe(200);
    expect(supabaseMock.rows('vehicles')[0].status).toBe('maintenance');
  });

  it('needs a yes or no and a driver', async () => {
    expect((await brk({})).status).toBe(400);
    expect((await brk({ is_break: 'yes' })).status).toBe(400);
    expect((await brk({ is_break: true }, staff())).status).toBe(403);
  });
});

describe('POST /telemetry/driver-ping', () => {
  const ping = (body: Record<string, unknown>, auth = driverAuth()) =>
    request(app).post('/api/v1/telemetry/driver-ping').set(auth).send(body);

  it('skips points that are not real positions and a future timestamp', async () => {
    const res = await ping({ pings: [
      { lat: 999, lng: 10 }, { lat: 'north', lng: 10 }, { lat: 0, lng: 0 },
      { lat: 18.5, lng: 73.8, speed: 5, timestamp: '2999-01-01T00:00:00Z' },
    ] });
    expect(res.status).toBe(200);
    expect(res.body.pings_processed).toBe(1);
    const stored = supabaseMock.writes('telemetry', 'POST')[0].body as { timestamp: string };
    expect(new Date(stored.timestamp).getFullYear()).toBeLessThan(2100);
  });

  it('refuses a batch that is too large', async () => {
    const pings = Array.from({ length: 201 }, () => ({ lat: 18.5, lng: 73.8 }));
    expect((await ping({ pings })).status).toBe(400);
  });

  it('keeps a vehicle in maintenance in maintenance', async () => {
    reset({ vehicles: [{ id: 'veh-1', driver_id: 'driver-1', status: 'maintenance', current_load_kg: 500 }] });
    expect((await ping({ lat: 18.5, lng: 73.8 })).status).toBe(200);
    expect(supabaseMock.rows('vehicles')[0].status).toBe('maintenance');
  });

  it('is for drivers', async () => {
    expect((await ping({ lat: 18.5, lng: 73.8 }, staff())).status).toBe(403);
    expect((await request(app).post('/api/v1/telemetry/driver-ping').send({ lat: 1, lng: 1 })).status).toBe(401);
  });
});

describe('SOS', () => {
  const trigger = (body: Record<string, unknown>, auth = driverAuth()) =>
    request(app).post('/api/v1/telemetry/sos/trigger').set(auth).send(body);

  it('tells staff and validates the position', async () => {
    expect((await trigger({ lat: 18.5, lng: 73.8, alert_type: 'accident' })).status).toBe(200);
    const recipients = supabaseMock.writes('notifications', 'POST').map(w => w.body.user_id).sort();
    expect(recipients).toEqual(['admin-1', 'super-1']);
    expect((await trigger({ lat: 999, lng: 73.8 })).status).toBe(400);
    expect((await trigger({ lat: 'here', lng: 73.8 })).status).toBe(400);
  });

  it('is for drivers only', async () => {
    expect((await trigger({}, staff('vendor-1'))).status).toBe(403);
    expect((await request(app).post('/api/v1/telemetry/sos/trigger').send({})).status).toBe(401);
  });

  it('rejects an unknown alert type on the vehicle SOS endpoint', async () => {
    const res = await request(app).post('/api/v1/vehicles/veh-1/sos').set(driverAuth()).send({ alert_type: 'lol' });
    expect(res.status).toBe(400);
    expect(supabaseMock.rows('sos_alerts')).toHaveLength(0);
  });
});

describe('PATCH /shipments/:id', () => {
  const patch = (body: Record<string, unknown>, auth = staff()) =>
    request(app).patch('/api/v1/shipments/ship-1').set(auth).send(body);

  const custody = (body: Record<string, unknown>, auth = staff()) =>
    request(app).post('/api/v1/cargo/custody').set(auth).send({ ref: 'RTX-AAAAAA', ...body });

  it('picks up through PATCH, and leaves every later move to the custody events', async () => {
    expect((await patch({ status: 'picked_up' })).status).toBe(200);
    expect(supabaseMock.rows('shipments')[0]).toMatchObject({ status: 'picked_up', current_holder: 'vehicle', current_vehicle_id: 'veh-1' });
    for (const status of ['in_transit', 'delivered', 'out_for_delivery', 'at_hub', 'on_hold', 'returned', 'lost']) {
      const res = await patch({ status, received_by: 'R. Sharma' });
      expect(res.status).toBe(409);
      expect(res.body.use).toBe('cargo_custody');
    }
    expect((await custody({ kind: 'departed' })).status).toBe(201);
    expect((await custody({ kind: 'delivery', receiver_name: 'R. Sharma', reason: 'Confirmed on the phone' })).status).toBe(201);
    expect(supabaseMock.rows('shipments')[0]).toMatchObject({ status: 'delivered', current_holder: 'consignee', current_vehicle_id: null });
  });

  it('will not move a delivered or cancelled shipment', async () => {
    for (const status of ['delivered', 'cancelled']) {
      reset({ shipments: [{ id: 'ship-1', status }] });
      const res = await patch({ status: 'in_transit' });
      expect(res.status).toBe(409);
      expect(supabaseMock.rows('shipments')[0].status).toBe(status);
    }
  });

  it('will not cancel a shipment already on the road', async () => {
    reset({ shipments: [{ id: 'ship-1', status: 'in_transit' }] });
    expect((await patch({ status: 'cancelled' })).status).toBe(409);
  });

  it('does not bill or log twice when a delivered shipment is delivered again', async () => {
    reset({ shipments: [{ id: 'ship-1', status: 'in_transit', total_items: 1, total_weight_kg: 10, tracking_id: 'RTX-AAAAAA', freight_charge: 500 }] });
    expect((await custody({ kind: 'delivery', receiver_name: 'A', reason: 'Confirmed on the phone' })).status).toBe(201);
    const logs = supabaseMock.writes('shipment_logs').length;
    expect((await custody({ kind: 'delivery', receiver_name: 'A', reason: 'Confirmed on the phone' })).status).toBe(409);
    expect(supabaseMock.writes('shipment_logs')).toHaveLength(logs);
    expect(supabaseMock.rows('invoices')).toHaveLength(1);
  });

  it('refuses unknown statuses, vendors, and cancelling by a driver', async () => {
    expect((await patch({ status: 'teleported' })).status).toBe(400);
    reset();
    expect((await patch({ status: 'picked_up' }, staff('vendor-1'))).status).toBe(403);
    expect((await patch({ status: 'cancelled' }, driverAuth())).status).toBe(403);
    expect(supabaseMock.rows('shipments')[0].status).toBe('created');
  });

  it('sends a driver to the delivery sheet, which needs a receiver name and proof', async () => {
    reset({ shipments: [{ id: 'ship-1', status: 'in_transit', total_items: 1, tracking_id: 'RTX-AAAAAA', current_holder: 'vehicle', current_vehicle_id: 'veh-1' }] });
    expect((await patch({ status: 'delivered', received_by: 'R. Sharma' }, driverAuth())).status).toBe(403);
    expect((await custody({ kind: 'delivery', photo_paths: ['cargo/ship-1/photo_a.jpg'] }, driverAuth())).status).toBe(400);
    expect((await custody({ kind: 'delivery', receiver_name: 'R. Sharma' }, driverAuth())).status).toBe(400);
    expect((await custody({ kind: 'delivery', receiver_name: 'R. Sharma', photo_paths: ['cargo/ship-1/photo_a.jpg'] }, driverAuth())).status).toBe(201);
    expect(supabaseMock.rows('shipments')[0]).toMatchObject({ status: 'delivered', received_by: 'R. Sharma', photo_url: 'cargo/ship-1/photo_a.jpg' });
  });
});

describe('PATCH /shipments/:id/edit', () => {
  const edit = (body: Record<string, unknown>, auth = staff()) =>
    request(app).patch('/api/v1/shipments/ship-1/edit').set(auth).send(body);

  it('changes only priority, items and weight', async () => {
    const res = await edit({ priority: 'high', total_items: 3, total_weight_kg: 40, status: 'delivered', tracking_id: 'RTX-HACKED1', received_by: 'me' });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('shipments')[0]).toMatchObject({ priority: 'high', total_items: 3, total_weight_kg: 40, status: 'created', tracking_id: 'RTX-AAAAAA' });
    expect(supabaseMock.rows('shipments')[0].received_by).toBeUndefined();
  });

  it.each([
    ['a negative weight', { total_weight_kg: -1 }],
    ['an unknown priority', { priority: 'whenever' }],
    ['a fractional item count', { total_items: 1.5 }],
  ])('refuses %s', async (_name, body) => {
    expect((await edit(body)).status).toBe(400);
  });

  it('will not edit a delivered shipment', async () => {
    reset({ shipments: [{ id: 'ship-1', status: 'delivered' }] });
    expect((await edit({ priority: 'high' })).status).toBe(409);
  });

  it('is for staff', async () => {
    expect((await edit({ priority: 'high' }, driverAuth())).status).toBe(403);
    expect((await edit({ priority: 'high' }, staff('vendor-1'))).status).toBe(403);
  });
});

describe('capacity windows', () => {
  const open = (body: Record<string, unknown>, auth = driverAuth()) =>
    request(app).post('/api/v1/capacity/driver/open-backhaul-window').set(auth).send(body);
  const GOOD = { vehicle_id: 'veh-1', available_capacity_kg: 400, trigger_type: 'return_trip' };

  it('opens a window for the driver\'s own vehicle', async () => {
    expect((await open(GOOD)).status).toBe(200);
    expect(supabaseMock.writes('capacity_windows', 'POST')).toHaveLength(1);
  });

  it.each([
    ['negative space', { available_capacity_kg: -5 }],
    ['zero space', { available_capacity_kg: 0 }],
    ['more space than the vehicle holds', { available_capacity_kg: 5000 }],
    ['text instead of a number', { available_capacity_kg: 'lots' }],
    ['a dispatch window from a driver', { trigger_type: 'superadmin_dispatch' }],
    ['an unknown trigger', { trigger_type: 'whenever' }],
  ])('refuses %s', async (_name, change) => {
    const res = await open({ ...GOOD, ...change });
    expect(res.status).toBe(400);
    expect(supabaseMock.writes('capacity_windows', 'POST')).toHaveLength(0);
  });

  it('refuses another driver\'s vehicle and a vehicle in maintenance', async () => {
    expect((await open(GOOD, driverAuth('driver-2'))).status).toBe(403);
    expect((await open({ ...GOOD, vehicle_id: 'veh-maint' }, staff())).status).toBe(409);
  });

  it('return-trip cannot set a nonsense price or an endless window', async () => {
    const trip = (body: Record<string, unknown>) => request(app).post('/api/v1/vehicles/veh-1/return-trip').set(driverAuth()).send(body);
    expect((await trip({ floor_price: -10 })).status).toBe(400);
    expect((await trip({ floor_price: 'free' })).status).toBe(400);
    expect((await trip({ closes_at: new Date(Date.now() + 5 * 86400_000).toISOString() })).status).toBe(400);
    expect((await trip({ opens_at: new Date(Date.now() + 3600_000).toISOString(), closes_at: new Date(Date.now() + 60_000).toISOString() })).status).toBe(400);
    expect(supabaseMock.writes('capacity_windows', 'POST')).toHaveLength(0);
    expect((await trip({ floor_price: 250 })).status).toBe(201);
  });

  it('toggle-matching needs a real yes or no', async () => {
    const toggle = (body: Record<string, unknown>) => request(app).post('/api/v1/capacity/driver/toggle-matching').set(driverAuth()).send(body);
    expect((await toggle({ vehicle_id: 'veh-1', enabled: 'maybe' })).status).toBe(400);
  });
});

describe('stop confirmations', () => {
  const CONF = { id: 'conf-1', vehicle_id: 'veh-1', route_stop_id: 'stop-1', action: null, delivered_at: null, responded_at: null };
  const post = (path: string, auth = driverAuth()) =>
    request(app).post(`/api/v1/capacity/driver/${path}`).set(auth).send({ confirmation_id: 'conf-1' });

  beforeEach(() => reset({ driver_confirmations: [{ ...CONF }] }));

  it('confirms a pending prompt once', async () => {
    expect((await post('confirm-stop')).status).toBe(200);
    expect(supabaseMock.rows('driver_confirmations')[0]).toMatchObject({ action: 'confirmed' });
    expect((await post('confirm-stop')).status).toBe(409);
  });

  it('cannot flag a prompt that was already answered', async () => {
    await post('confirm-stop');
    expect((await post('flag-stop')).status).toBe(409);
    expect(supabaseMock.rows('driver_confirmations')[0].action).toBe('confirmed');
  });

  it('is limited to the driver of the vehicle', async () => {
    expect((await post('confirm-stop', driverAuth('driver-2'))).status).toBe(403);
    expect((await post('confirm-stop', staff())).status).toBe(403);
  });
});

describe('marketplace bids', () => {
  it('lets only one driver take a load', async () => {
    reset({
      routes: [{ id: 'route-1', vehicle_id: 'veh-1', status: 'active', route_stops: [] }, { id: 'route-2', vehicle_id: 'veh-2', status: 'active', route_stops: [] }],
      shipments: [{ id: 'ship-1', status: 'created', total_weight_kg: 10, origin_name: 'X', delivery_points: [{ id: 'dp-9' }] }],
    });
    const bid = (auth: Record<string, string>) => request(app).post('/api/v1/marketplace/bid').set(auth).send({ shipment_id: 'ship-1' });
    expect((await bid(driverAuth('driver-1'))).status).toBe(200);
    const second = await bid(driverAuth('driver-2'));
    expect([400, 409]).toContain(second.status);
    expect(supabaseMock.writes('route_stops', 'POST')).toHaveLength(1);
  });
});

describe('PATCH /users/:id', () => {
  it('will not let an admin change their own role or switch themselves off, and audits other changes', async () => {
    const patch = (id: string, body: Record<string, unknown>, auth = staff('super-1')) =>
      request(app).patch(`/api/v1/users/${id}`).set(auth).send(body);
    expect((await patch('super-1', { is_active: false })).status).toBe(409);
    expect((await patch('super-1', { role: 'driver' })).status).toBe(409);
    reset({ ai_agent_logs: [] });
    expect((await patch('driver-2', { is_active: false })).status).toBe(200);
    expect(supabaseMock.writes('ai_agent_logs', 'POST')[0].body).toMatchObject({ action: 'user_updated' });
  });
});
