import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';
import { planArrivals } from '../src/services/driver-performance.service';

const app = testApp();
const admin = () => ({ Authorization: `Bearer ${supabaseMock.signUserToken('admin-1')}` });
const driver = () => ({ Authorization: `Bearer ${createAccessToken({ sub: 'driver-1', role: 'driver' })}` });
const MINUTE = 60_000;
const at = (base: number, minutes: number) => new Date(base + minutes * MINUTE).toISOString();

describe('planArrivals', () => {
  const start = new Date('2026-09-30T04:00:00.000Z');
  // About 111 km per degree of latitude: 0.1 deg is ~11 km, so legs of 1 : 1
  const stops = [
    { id: 'a', lat: 19.1, lng: 73, serviceMinutes: 0 },
    { id: 'b', lat: 19.2, lng: 73, serviceMinutes: 0 },
  ];

  it('spreads the route duration over the legs by distance', () => {
    const plan = planArrivals(start, { lat: 19, lng: 73 }, stops, 60)!;
    expect(Math.round((plan[0].getTime() - start.getTime()) / MINUTE)).toBe(30);
    expect(Math.round((plan[1].getTime() - start.getTime()) / MINUTE)).toBe(60);
  });

  it('adds service time before the next leg', () => {
    const plan = planArrivals(start, { lat: 19, lng: 73 }, stops.map(s => ({ ...s, serviceMinutes: 10 })), 80)!;
    // 60 minutes of driving over two equal legs, 10 minutes at the first stop
    expect(Math.round((plan[0].getTime() - start.getTime()) / MINUTE)).toBe(30);
    expect(Math.round((plan[1].getTime() - start.getTime()) / MINUTE)).toBe(70);
  });

  it('gives nothing when it cannot be worked out', () => {
    expect(planArrivals(start, { lat: 19, lng: 73 }, stops, null)).toBeNull();
    expect(planArrivals(start, { lat: 19, lng: 73 }, stops, 0)).toBeNull();
    expect(planArrivals(start, { lat: 19, lng: 73 }, [{ id: 'x', lat: null, lng: null, serviceMinutes: 0 }], 30)).toBeNull();
    expect(planArrivals(start, { lat: 19, lng: 73 }, [{ id: 'x', lat: 19, lng: 73, serviceMinutes: 0 }], 30)).toBeNull();
  });
});

describe('planned and actual arrival on a route', () => {
  beforeEach(() => {
    supabaseMock.reset({
      users: [{ id: 'admin-1', role: 'admin', is_active: true }, { id: 'driver-1', role: 'driver', is_active: true }],
      vehicles: [{ id: 'veh-1', driver_id: 'driver-1', latitude: 19, longitude: 73, status: 'available' }],
      depots: [],
      routes: [{ id: 'route-1', vehicle_id: 'veh-1', depot_id: null, status: 'pending', total_duration_minutes: 60 }],
      route_stops: [
        { id: 'stop-1', route_id: 'route-1', delivery_point_id: 'dp-1', sequence: 0, status: 'pending', planned_arrival_at: null, actual_arrival_at: null },
        { id: 'stop-2', route_id: 'route-1', delivery_point_id: 'dp-2', sequence: 1, status: 'pending', planned_arrival_at: null, actual_arrival_at: null },
      ],
      delivery_points: [
        { id: 'dp-1', latitude: 19.1, longitude: 73, service_time_minutes: 0, shipment_id: null },
        { id: 'dp-2', latitude: 19.2, longitude: 73, service_time_minutes: 0, shipment_id: null },
      ],
    });
  });

  const dispatch = (status = 'active') =>
    request(app).patch('/api/v1/routes/route-1/status').set(admin()).send({ status });

  it('stores a planned arrival per stop when the route is dispatched, and keeps it', async () => {
    const before = Date.now();
    expect((await dispatch()).status).toBe(200);
    const stops = supabaseMock.rows('route_stops');
    const first = new Date(stops[0].planned_arrival_at).getTime();
    const second = new Date(stops[1].planned_arrival_at).getTime();
    expect(Math.abs(first - before - 30 * MINUTE)).toBeLessThan(5_000);
    expect(Math.abs(second - before - 60 * MINUTE)).toBeLessThan(5_000);

    const written = supabaseMock.writes('route_stops').length;
    await dispatch('in_progress');
    expect(supabaseMock.rows('route_stops')[0].planned_arrival_at).toBe(stops[0].planned_arrival_at);
    expect(supabaseMock.writes('route_stops').length).toBe(written);
  });

  it('leaves planned arrival empty when the route has no duration', async () => {
    supabaseMock.rows('routes')[0].total_duration_minutes = null;
    expect((await dispatch()).status).toBe(200);
    expect(supabaseMock.rows('route_stops').every(s => s.planned_arrival_at === null)).toBe(true);
  });

  it('records the arrival time when the driver completes a stop, but not when it fails', async () => {
    const complete = (stop_id: string, status: string) =>
      request(app).post('/api/v1/telemetry/driver-ping/complete-stop').set(driver()).send({ stop_id, status });
    const res = await complete('stop-1', 'completed');
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('route_stops')[0].actual_arrival_at).toBeTruthy();
    await complete('stop-2', 'failed');
    expect(supabaseMock.rows('route_stops')[1].actual_arrival_at).toBeNull();
  });
});

describe('POST /shipments/:id/rating', () => {
  beforeEach(() => {
    supabaseMock.reset({
      users: [{ id: 'admin-1', role: 'admin', is_active: true }],
      vehicles: [{ id: 'veh-1', driver_id: 'driver-1' }],
      routes: [{ id: 'route-1', vehicle_id: 'veh-1', created_at: '2026-09-30T00:00:00Z' }],
      route_stops: [{ id: 'stop-1', route_id: 'route-1', delivery_point_id: 'dp-1', created_at: '2026-09-30T00:00:00Z' }],
      delivery_points: [{ id: 'dp-1', shipment_id: 'ship-1' }, { id: 'dp-2', shipment_id: 'ship-2' }],
      shipments: [
        { id: 'ship-1', status: 'delivered', driver_rating: null },
        { id: 'ship-2', status: 'in_transit', driver_rating: null },
        { id: 'ship-3', status: 'delivered', driver_rating: null },
      ],
    });
  });

  const rate = (id: string, body: object, headers: Record<string, string> = admin()) =>
    request(app).post(`/api/v1/shipments/${id}/rating`).set(headers).send(body);

  it('saves the rating with the vehicle and driver that carried the shipment', async () => {
    const res = await rate('ship-1', { rating: 4, note: 'On time, careful' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ driver_rating: 4, driver_rating_note: 'On time, careful' });
    expect(supabaseMock.rows('shipments')[0]).toMatchObject({ rated_vehicle_id: 'veh-1', rated_driver_id: 'driver-1', driver_rated_by: 'admin-1' });
  });

  it('can be changed later', async () => {
    await rate('ship-1', { rating: 2 });
    expect((await rate('ship-1', { rating: 5 })).body.driver_rating).toBe(5);
  });

  it.each([0, 6, 3.5, 'x'])('rejects rating %s', async value => {
    expect((await rate('ship-1', { rating: value })).status).toBe(400);
  });

  it('needs a delivered shipment that has a driver', async () => {
    expect((await rate('ship-2', { rating: 3 })).status).toBe(409);
    expect((await rate('ship-3', { rating: 3 })).status).toBe(409);
    expect((await rate('nope', { rating: 3 })).status).toBe(404);
  });

  it('is staff only', async () => {
    expect((await rate('ship-1', { rating: 3 }, driver())).status).toBe(403);
  });
});

describe('GET /analytics/driver-performance', () => {
  const base = Date.parse('2026-09-30T04:00:00.000Z');

  function seed(window?: unknown) {
    supabaseMock.reset({
      users: [{ id: 'admin-1', role: 'admin', is_active: true }, { id: 'driver-1', role: 'driver', full_name: 'Asha', is_active: true }],
      vehicles: [
        { id: 'veh-1', plate_number: 'MH01AA0001', vehicle_type: 'truck', status: 'available', driver_id: 'driver-1' },
        { id: 'veh-2', plate_number: 'MH01AA0002', vehicle_type: 'truck', status: 'available', driver_id: null },
      ],
      routes: [{ id: 'route-1', vehicle_id: 'veh-1', status: 'completed', total_distance_km: 40 }],
      route_stops: [
        // 20 minutes late: inside the 30 minute window
        { id: 's1', route_id: 'route-1', status: 'completed', planned_arrival_at: at(base, 0), actual_arrival_at: at(base, 20) },
        // 45 minutes late
        { id: 's2', route_id: 'route-1', status: 'completed', planned_arrival_at: at(base, 0), actual_arrival_at: at(base, 45) },
        // early
        { id: 's3', route_id: 'route-1', status: 'completed', planned_arrival_at: at(base, 60), actual_arrival_at: at(base, 50) },
        // no plan: counted as a delivery, left out of on-time
        { id: 's4', route_id: 'route-1', status: 'completed', planned_arrival_at: null, actual_arrival_at: at(base, 70) },
        // not completed
        { id: 's5', route_id: 'route-1', status: 'failed', planned_arrival_at: at(base, 0), actual_arrival_at: null },
      ],
      shipments: [
        { id: 'a', rated_vehicle_id: 'veh-1', driver_rating: 5 },
        { id: 'b', rated_vehicle_id: 'veh-1', driver_rating: 4 },
        { id: 'c', rated_vehicle_id: 'veh-1', driver_rating: null },
      ],
      system_settings: window === undefined ? [] : [{ key: 'on_time_window_minutes', value: window }],
    });
  }

  const get = async () => (await request(app).get('/api/v1/analytics/driver-performance').set(admin())).body as any[];
  const row = (rows: any[], id: string) => rows.find(r => r.id === id);

  it('works out on-time percentage with the default 30 minute window and the average rating', async () => {
    seed()
    const veh1 = row(await get(), 'veh-1');
    expect(veh1).toMatchObject({ deliveries: 4, timed_deliveries: 3, on_time_deliveries: 2, on_time_pct: 66.7, avg_rating: 4.5, rating_count: 2 });
  });

  it('uses the window from settings', async () => {
    seed(60);
    expect(row(await get(), 'veh-1')).toMatchObject({ on_time_deliveries: 3, on_time_pct: 100 });
    seed({ minutes: 10 });
    expect(row(await get(), 'veh-1')).toMatchObject({ on_time_deliveries: 1 });
  });

  it('shows no figures, not zeros or invented ones, for a vehicle with no history', async () => {
    seed();
    expect(row(await get(), 'veh-2')).toMatchObject({ deliveries: 0, timed_deliveries: 0, on_time_pct: null, avg_rating: null, rating_count: 0 });
  });
});
