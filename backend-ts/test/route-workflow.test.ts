import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';
import { invalidateDriverVehicles } from '../src/core/ownership';

const app = testApp();
const driverAuth = (id = 'driver-1') => ({ Authorization: `Bearer ${createAccessToken({ sub: id, role: 'driver' })}` });
const staff = (id = 'admin-1') => ({ Authorization: `Bearer ${supabaseMock.signUserToken(id)}` });

function reset(over: Record<string, unknown[]> = {}) {
  invalidateDriverVehicles();
  supabaseMock.reset({
    users: [
      { id: 'admin-1', role: 'admin', is_active: true },
      { id: 'driver-1', role: 'driver', is_active: true },
      { id: 'driver-2', role: 'driver', is_active: true },
    ],
    vehicles: [
      { id: 'veh-1', driver_id: 'driver-1', driver_name: 'Ravi', status: 'available', capacity_kg: 1000, current_load_kg: 0, available_capacity_kg: 1000, plate_number: 'MH12AB1234' },
      { id: 'veh-2', driver_id: 'driver-2', status: 'available', capacity_kg: 1000, current_load_kg: 0, plate_number: 'MH12AB9999' },
    ],
    routes: [],
    route_stops: [],
    delivery_points: [],
    shipments: [],
    shipment_logs: [],
    cargo_manifest: [],
    vendor_shipment_requests: [],
    invoices: [],
    notifications: [],
    parcels: [],
    ...over,
  });
}

const vehicle = (id = 'veh-1') => supabaseMock.rows('vehicles').find(v => v.id === id)!;
const manifest = (id: string, over: Record<string, unknown> = {}) => ({
  id, vehicle_id: 'veh-1', vendor_request_id: `req-${id}`, status: 'scheduled', capacity_kg: 100,
  pickup_location: 'Pune', pickup_lat: 18.5, pickup_lng: 73.8, drop_location: 'Mumbai', drop_lat: 19.0, drop_lng: 72.8,
  created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-01T10:00:00Z', ...over,
});

describe('vendor loads on the driver route', () => {
  const myRoute = (auth = driverAuth()) => request(app).get('/api/v1/telemetry/driver-ping/my-route').set(auth);
  const complete = (stop_id: string, auth = driverAuth()) =>
    request(app).post('/api/v1/telemetry/driver-ping/complete-stop').set(auth).send({ stop_id });

  it('lists every open load with a pickup and a drop, keeping a pickup pending until it is done', async () => {
    reset({
      cargo_manifest: [
        manifest('m1', { created_at: '2026-09-01T10:00:00Z' }),
        manifest('m2', { status: 'in_transit', created_at: '2026-09-02T10:00:00Z' }),
        manifest('m3', { status: 'delivered' }),
      ],
    });
    const res = await myRoute();
    expect(res.status).toBe(200);
    const stops = res.body.route.stops;
    // the load already on the truck comes first, then the waiting one; the delivered one is left out
    expect(stops.map((s: any) => [s.id, s.status])).toEqual([
      ['m2_pickup', 'completed'], ['m2_drop', 'pending'], ['m1_pickup', 'pending'], ['m1_drop', 'pending'],
    ]);
    expect(stops.map((s: any) => s.sequence)).toEqual([1, 2, 3, 4]);
    expect(res.body.route.status).toBe('active');
    expect(res.body.route.remaining_stops).toBe(3);
  });

  it('tells the vendor once when their load is picked up and once when it is delivered', async () => {
    reset({
      users: [{ id: 'driver-1', role: 'driver', is_active: true }, { id: 'vendor-9', role: 'vendor', is_active: true }],
      cargo_manifest: [manifest('m1')],
      vendor_shipment_requests: [{ id: 'req-m1', vendor_id: 'vendor-9', status: 'assigned', pickup_location: 'Pune', drop_location: 'Mumbai', cost: 5000 }],
    });
    expect((await complete('m1_pickup')).status).toBe(200);
    await complete('m1_pickup');
    expect((await complete('m1_drop')).status).toBe(200);
    const types = supabaseMock.rows('notifications').filter(n => n.user_id === 'vendor-9').map(n => n.type);
    expect(types.length).toBe(2);
  });

  it('keeps the pickup pending after Start Journey, and moves the load in transit at the pickup', async () => {
    reset({ cargo_manifest: [manifest('m1')] });
    expect((await myRoute()).body.route.status).toBe('pending');
    const start = await request(app).post('/api/v1/telemetry/driver-ping/start-route').set(driverAuth()).send({ route_id: 'm1' });
    expect(start.status).toBe(200);
    const after = (await myRoute()).body.route;
    expect(after.status).toBe('active');
    expect(after.stops[0]).toMatchObject({ id: 'm1_pickup', status: 'pending' });
    expect(supabaseMock.rows('cargo_manifest')[0].status).toBe('scheduled');
    expect((await complete('m1_pickup')).status).toBe(200);
    expect(supabaseMock.rows('cargo_manifest')[0].status).toBe('in_transit');
  });

  it('gives the weight back on delivery and frees the vehicle only when nothing else is open', async () => {
    reset({
      cargo_manifest: [manifest('m1', { status: 'in_transit' }), manifest('m2', { status: 'in_transit' })],
      vendor_shipment_requests: [{ id: 'req-m1', status: 'assigned' }, { id: 'req-m2', status: 'assigned' }],
    });
    Object.assign(vehicle(), { status: 'on_route', current_load_kg: 200, available_capacity_kg: 800 });
    const first = await complete('m1_drop');
    expect(first.body).toMatchObject({ route_completed: false, remaining_stops: 1 });
    expect(vehicle()).toMatchObject({ status: 'on_route', current_load_kg: 100, available_capacity_kg: 900 });
    const last = await complete('m2_drop');
    expect(last.body.route_completed).toBe(true);
    expect(vehicle()).toMatchObject({ status: 'available', current_load_kg: 0, available_capacity_kg: 1000 });
  });

  it('rejects a stop of a cancelled load', async () => {
    reset({ cargo_manifest: [manifest('m1', { status: 'cancelled' })] });
    const res = await complete('m1_pickup');
    expect(res.status).toBe(409);
    expect(res.body.detail).toBe('This delivery was cancelled by dispatch.');
  });
});

describe('cancelling a vendor load', () => {
  const cancel = (id = 'm1', auth = staff()) => request(app).patch(`/api/v1/routes/${id}/status`).set(auth).send({ status: 'cancelled' });

  beforeEach(() => {
    reset({
      cargo_manifest: [manifest('m1', { status: 'in_transit' })],
      vendor_shipment_requests: [{ id: 'req-m1', status: 'assigned', assigned_vehicle_id: 'veh-1' }],
    });
    Object.assign(vehicle(), { status: 'on_route', current_load_kg: 100, available_capacity_kg: 900 });
  });

  it('reopens the vendor request, restores the vehicle and tells the driver', async () => {
    const res = await cancel();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'm1', status: 'cancelled', vehicle_status: 'available' });
    expect(supabaseMock.rows('cargo_manifest')[0].status).toBe('cancelled');
    expect(supabaseMock.rows('vendor_shipment_requests')[0]).toMatchObject({ status: 'approved', assigned_vehicle_id: null });
    expect(vehicle()).toMatchObject({ status: 'available', current_load_kg: 0, available_capacity_kg: 1000 });
    const note = supabaseMock.writes('notifications', 'POST').find(w => w.body.user_id === 'driver-1');
    expect(note?.body.type).toBe('route_cancelled');
  });

  it('keeps the vehicle on route when it has another open load', async () => {
    supabaseMock.rows('cargo_manifest').push(manifest('m2'));
    expect((await cancel()).status).toBe(200);
    expect(vehicle().status).toBe('on_route');
  });

  it('is repeatable, and a delivered load cannot be cancelled', async () => {
    expect((await cancel()).status).toBe(200);
    expect((await cancel()).status).toBe(200);
    expect(supabaseMock.writes('notifications', 'POST')).toHaveLength(1);
    supabaseMock.rows('cargo_manifest')[0].status = 'delivered';
    expect((await cancel()).status).toBe(409);
  });

  it('is for staff, and staff cannot use it to complete a load', async () => {
    expect((await cancel('m1', driverAuth())).status).toBe(403);
    const res = await request(app).patch('/api/v1/routes/m1/status').set(staff()).send({ status: 'completed' });
    expect(res.status).toBe(409);
    expect(supabaseMock.rows('cargo_manifest')[0].status).toBe('in_transit');
  });

  it('cannot be optimized', async () => {
    const res = await request(app).post('/api/v1/optimize/reoptimize/m1').set(staff());
    expect(res.status).toBe(409);
  });
});

describe('GET /routes with vendor loads', () => {
  const list = (query = '') => request(app).get(`/api/v1/routes${query}`).set(staff());

  beforeEach(() => reset({
    cargo_manifest: [
      manifest('m-sched', { status: 'scheduled' }),
      manifest('m-transit', { status: 'in_transit', updated_at: '2026-09-03T10:00:00Z' }),
      manifest('m-done', { status: 'delivered', updated_at: '2026-09-04T10:00:00Z' }),
      manifest('m-cancel', { status: 'cancelled' }),
    ],
  }));

  it('maps load statuses to route statuses and shows the drop as completed when delivered', async () => {
    const byId = Object.fromEntries((await list()).body.map((r: any) => [r.id, r]));
    expect(byId['m-sched'].status).toBe('pending');
    expect(byId['m-transit'].status).toBe('active');
    expect(byId['m-done'].status).toBe('completed');
    expect(byId['m-cancel'].status).toBe('cancelled');
    expect(byId['m-done'].route_stops.map((s: any) => s.status)).toEqual(['completed', 'completed']);
    expect(byId['m-transit'].route_stops.map((s: any) => s.status)).toEqual(['completed', 'pending']);
    expect(byId['m-done'].completed_at).toBe('2026-09-04T10:00:00Z');
    expect(byId['m-transit'].started_at).toBe('2026-09-03T10:00:00Z');
  });

  it.each([
    ['pending', ['m-sched']], ['active', ['m-transit']], ['completed', ['m-done']], ['cancelled', ['m-cancel']],
  ])('applies the %s filter to loads', async (status, ids) => {
    expect((await list(`?status=${status}`)).body.map((r: any) => r.id)).toEqual(ids);
  });

  it('gives route details the same status and times', async () => {
    const res = await request(app).get('/api/v1/routes/m-done').set(staff());
    expect(res.body).toMatchObject({ id: 'm-done', status: 'completed', is_manifest: true, completed_at: '2026-09-04T10:00:00Z' });
  });
});

describe('route status changes', () => {
  const patch = (status: string, id = 'route-1', auth = staff()) =>
    request(app).patch(`/api/v1/routes/${id}/status`).set(auth).send({ status });
  const stopFixture = (status: string) => [{ id: 'stop-1', route_id: 'route-1', delivery_point_id: 'dp-1', sequence: 1, status }];

  it('refuses Mark completed while stops are pending', async () => {
    reset({ routes: [{ id: 'route-1', vehicle_id: 'veh-1', status: 'active', started_at: '2026-09-01T10:00:00Z' }], route_stops: stopFixture('pending') });
    const res = await patch('completed');
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/still pending/);
    expect(supabaseMock.rows('routes')[0].status).toBe('active');
  });

  it('completes a route whose stops are all decided', async () => {
    reset({ routes: [{ id: 'route-1', vehicle_id: 'veh-1', status: 'active', started_at: '2026-09-01T10:00:00Z' }], route_stops: stopFixture('failed') });
    expect((await patch('completed')).status).toBe(200);
    expect(supabaseMock.rows('routes')[0].completed_at).toBeTruthy();
  });

  it('runs the start side effects for a route created already active', async () => {
    reset({ routes: [{ id: 'route-1', vehicle_id: 'veh-1', status: 'active', started_at: null }], route_stops: stopFixture('pending') });
    const res = await patch('active');
    expect(res.status).toBe(200);
    expect(vehicle().status).toBe('on_route');
    expect(supabaseMock.rows('routes')[0].started_at).toBeTruthy();
    expect(supabaseMock.writes('notifications', 'POST').find(w => w.body.type === 'route_activated')?.body.user_id).toBe('driver-1');
    // a repeat once started changes nothing
    const before = supabaseMock.writes('notifications', 'POST').length;
    expect((await patch('active')).status).toBe(200);
    expect(supabaseMock.writes('notifications', 'POST')).toHaveLength(before);
  });

  it('does not free a vehicle that has another active route, on cancel or delete', async () => {
    reset({
      routes: [
        { id: 'route-1', vehicle_id: 'veh-1', status: 'active', started_at: '2026-09-01T10:00:00Z' },
        { id: 'route-2', vehicle_id: 'veh-1', status: 'active', started_at: '2026-09-01T11:00:00Z' },
        { id: 'route-3', vehicle_id: 'veh-1', status: 'pending' },
      ],
    });
    Object.assign(vehicle(), { status: 'on_route' });
    expect((await patch('cancelled')).status).toBe(200);
    expect(vehicle().status).toBe('on_route');
    expect((await request(app).delete('/api/v1/routes/route-3').set(staff())).status).toBe(200);
    expect(vehicle().status).toBe('on_route');
    expect((await patch('cancelled', 'route-2')).status).toBe(200);
    expect(vehicle().status).toBe('available');
  });

  it('no longer knows an in_progress status', async () => {
    reset({ routes: [{ id: 'route-1', vehicle_id: 'veh-1', status: 'active' }] });
    expect((await patch('in_progress')).status).toBe(400);
  });
});

describe('complete-stop on a route', () => {
  const complete = (body: Record<string, unknown>, auth = driverAuth()) =>
    request(app).post('/api/v1/telemetry/driver-ping/complete-stop').set(auth).send(body);

  beforeEach(() => reset({
    routes: [
      { id: 'route-1', vehicle_id: 'veh-1', status: 'active', started_at: '2026-09-01T10:00:00Z' },
      { id: 'route-2', vehicle_id: 'veh-1', status: 'active', started_at: '2026-09-01T11:00:00Z' },
    ],
    route_stops: [
      { id: 'stop-1', route_id: 'route-1', delivery_point_id: 'dp-1', sequence: 1, status: 'pending', routes: { status: 'active', vehicle_id: 'veh-1' } },
      { id: 'stop-2', route_id: 'route-2', delivery_point_id: 'dp-2', sequence: 1, status: 'pending', routes: { status: 'active', vehicle_id: 'veh-1' } },
    ],
    delivery_points: [{ id: 'dp-1', shipment_id: 'ship-1' }, { id: 'dp-2', shipment_id: 'ship-2' }],
    shipments: [
      { id: 'ship-1', status: 'in_transit', priority: 'low', total_items: 1, total_weight_kg: 10, tracking_id: 'RTX-1' },
      { id: 'ship-2', status: 'in_transit', priority: 'low', total_items: 1, total_weight_kg: 10, tracking_id: 'RTX-2' },
    ],
  }));

  it('completes the route through the shared path and keeps the vehicle on route for its other route', async () => {
    Object.assign(vehicle(), { status: 'on_route', current_load_kg: 20 });
    const res = await complete({ stop_id: 'stop-1' });
    expect(res.body).toMatchObject({ status: 'completed', route_completed: true });
    expect(supabaseMock.rows('routes')[0]).toMatchObject({ status: 'completed' });
    expect(vehicle()).toMatchObject({ status: 'on_route', current_load_kg: 20 });
    await complete({ stop_id: 'stop-2' });
    expect(vehicle()).toMatchObject({ status: 'available', current_load_kg: 0 });
  });

  it('answers with the failed outcome and tells staff, with the route and shipment', async () => {
    const res = await complete({ stop_id: 'stop-1', status: 'failed', reason: 'premises_closed' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('failed');
    const note = supabaseMock.writes('notifications', 'POST').find(w => w.body.type === 'stop_failed');
    expect(note?.body.user_id).toBe('admin-1');
    expect(note?.body.data).toEqual({ route_id: 'route-1', shipment_id: 'ship-1' });
  });

  it('rejects a stop whose shipment dispatch cancelled, closes it and drops it from my-route', async () => {
    supabaseMock.rows('shipments')[0].status = 'cancelled';
    const res = await complete({ stop_id: 'stop-1' });
    expect(res.status).toBe(409);
    expect(res.body.detail).toBe('This delivery was cancelled by dispatch.');
    expect(supabaseMock.rows('route_stops')[0].status).toBe('cancelled');
    expect(supabaseMock.writes('shipment_logs')).toHaveLength(0);
    expect(supabaseMock.rows('routes')[0].status).toBe('completed');
    // a stop already marked cancelled gets the same answer
    expect((await complete({ stop_id: 'stop-1' })).body.detail).toBe('This delivery was cancelled by dispatch.');
  });

  it('leaves a cancelled stop, and one whose shipment was cancelled, out of my-route', async () => {
    // the mock does not join tables: the route carries its stops
    supabaseMock.rows('routes').splice(1, 1);
    supabaseMock.rows('shipments')[1].status = 'cancelled';
    supabaseMock.rows('routes')[0].route_stops = [
      { id: 'stop-1', sequence: 1, status: 'pending', delivery_points: { id: 'dp-1', shipment_id: 'ship-1', name: 'A' } },
      { id: 'stop-x', sequence: 2, status: 'cancelled', delivery_points: { id: 'dp-x', name: 'B' } },
      { id: 'stop-y', sequence: 3, status: 'pending', delivery_points: { id: 'dp-2', shipment_id: 'ship-2', name: 'C' } },
    ];
    const res = await request(app).get('/api/v1/telemetry/driver-ping/my-route').set(driverAuth());
    expect(res.body.route.stops.map((s: any) => s.id)).toEqual(['stop-1']);
  });
});

describe('driver position pings', () => {
  const ping = () => request(app).post('/api/v1/telemetry/driver-ping').set(driverAuth()).send({ lat: 19.1, lng: 74.2, speed: 20 });

  it('keeps a loaded vehicle available when it has no route, and on route when it has one', async () => {
    reset();
    Object.assign(vehicle(), { status: 'available', current_load_kg: 300 });
    expect((await ping()).status).toBe(200);
    expect(vehicle().status).toBe('available');

    reset({ routes: [{ id: 'route-1', vehicle_id: 'veh-1', status: 'active' }] });
    expect((await ping()).status).toBe(200);
    expect(vehicle().status).toBe('on_route');
  });

  it('puts a vehicle whose route ended back to available, and leaves a break alone', async () => {
    reset();
    Object.assign(vehicle(), { status: 'on_route' });
    await ping();
    expect(vehicle().status).toBe('available');
    Object.assign(vehicle(), { status: 'idle' });
    await ping();
    expect(vehicle().status).toBe('idle');
  });

  it('keeps a vehicle on route while it has set off for a waiting pickup', async () => {
    reset({ cargo_manifest: [manifest('m1')] });
    Object.assign(vehicle(), { status: 'on_route' });
    await ping();
    expect(vehicle().status).toBe('on_route');
  });
});
