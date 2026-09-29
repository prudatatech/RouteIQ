import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';

const app = testApp();
const admin = () => ({ Authorization: `Bearer ${supabaseMock.signUserToken('admin-1')}` });

const OPEN = {
  id: 'ship-open', tracking_id: 'RTX-OPEN', status: 'created', priority: 'high',
  origin_name: 'Acme Foods', origin_address: 'Pune', origin_lat: 18.5, origin_lng: 73.8,
  total_weight_kg: 1200, created_at: new Date().toISOString(),
  delivery_points: [{ id: 'dp-open', name: 'Mumbai DC', address: 'Mumbai', latitude: 19.07, longitude: 72.87 }],
};
const ROUTED = {
  ...OPEN, id: 'ship-routed', tracking_id: 'RTX-ROUTED',
  delivery_points: [{ id: 'dp-routed', name: 'Nashik', address: 'Nashik', latitude: 20, longitude: 73.7 }],
};
const NO_WEIGHT = {
  ...OPEN, id: 'ship-noweight', tracking_id: 'RTX-NOWEIGHT', total_weight_kg: 0,
  delivery_points: [{ id: 'dp-noweight', name: 'Thane', address: 'Thane', latitude: 19.2, longitude: 72.97 }],
};

beforeEach(() => {
  supabaseMock.reset({
    users: [{ id: 'admin-1', role: 'admin', is_active: true }],
    shipments: [OPEN, ROUTED, NO_WEIGHT],
    route_stops: [{ id: 'rs-1', delivery_point_id: 'dp-routed' }],
  });
});

describe('backhaul pooling', () => {
  it('lists only shipments that are not on a route, without inventing weights', async () => {
    const res = await request(app).get('/api/v1/cargo/open-loads').set(admin());
    expect(res.status).toBe(200);
    const ids = res.body.map((l: any) => l.id);
    expect(ids).toEqual(['ship-open', 'ship-noweight']);
    const open = res.body.find((l: any) => l.id === 'ship-open');
    expect(open).toMatchObject({ destination: 'Mumbai', dest_lat: 19.07, weight_kg: 1200, shipper: 'Acme Foods' });
    expect(res.body.find((l: any) => l.id === 'ship-noweight').weight_kg).toBeNull();
    expect(open).not.toHaveProperty('revenue');
  });

  it('turns down a return load that does not fit the space left', async () => {
    const res = await request(app).post('/api/v1/cargo/backhaul-match').set(admin())
      .send({ opportunity_id: 'ship-open', available_capacity_kg: 500 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rejected');
    expect(res.body).not.toHaveProperty('net_profit_inr');
  });

  it('will not match a load with no recorded weight', async () => {
    const res = await request(app).post('/api/v1/cargo/backhaul-match').set(admin())
      .send({ opportunity_id: 'ship-noweight', available_capacity_kg: 5000 });
    expect(res.status).toBe(422);
  });

  it('needs at least two loads and a vehicle to plan a pool', async () => {
    const one = await request(app).post('/api/v1/cargo/optimize-pooling').set(admin()).send({ shipment_ids: ['ship-open'], vehicle_id: 'v1' });
    expect(one.status).toBe(400);
    const noVehicle = await request(app).post('/api/v1/cargo/optimize-pooling').set(admin()).send({ shipment_ids: ['ship-open', 'ship-noweight'] });
    expect(noVehicle.status).toBe(400);
  });

  it('no longer offers the simulated alarm or the invented price quote', async () => {
    expect((await request(app).post('/api/v1/cargo/trigger-alert').set(admin()).send({ vehicle_id: 'v1' })).status).toBe(404);
    expect((await request(app).get('/api/v1/cargo/pricing-recommendations').set(admin())).status).toBe(404);
  });
});

describe('analytics', () => {
  it('reports driver work without an invented rating or on-time figure', async () => {
    supabaseMock.reset({
      users: [{ id: 'admin-1', role: 'admin', is_active: true }, { id: 'drv-1', full_name: 'Ravi Kumar' }],
      vehicles: [
        { id: 'v1', plate_number: 'MH12AB1234', vehicle_type: 'truck', status: 'on_route', driver_id: 'drv-1' },
        { id: 'v2', plate_number: 'MH12CD5678', vehicle_type: 'truck', status: 'idle', driver_id: null },
      ],
      routes: [
        { vehicle_id: 'v1', status: 'completed', total_distance_km: 120.4 },
        { vehicle_id: 'v1', status: 'cancelled', total_distance_km: 50 },
        { vehicle_id: 'v1', status: 'active', total_distance_km: 80 },
      ],
    });
    const res = await request(app).get('/api/v1/analytics/driver-performance').set(admin());
    expect(res.status).toBe(200);
    const [v1, v2] = res.body;
    expect(v1).toMatchObject({ id: 'v1', driver_name: 'Ravi Kumar', total_routes: 3, completed_routes: 1, completion_pct: 50, total_distance_km: 120 });
    expect(v2).toMatchObject({ id: 'v2', driver_name: null, total_routes: 0, completion_pct: null });
    expect(v1).not.toHaveProperty('rating');
    expect(v1).not.toHaveProperty('on_time_pct');
  });

  it('counts trips and deliveries per Indian calendar day', async () => {
    const now = new Date().toISOString();
    supabaseMock.reset({
      users: [{ id: 'admin-1', role: 'admin', is_active: true }],
      routes: [{ created_at: now, status: 'active' }, { created_at: now, status: 'completed' }],
      shipments: [{ updated_at: now, status: 'delivered' }],
    });
    const res = await request(app).get('/api/v1/analytics/daily-activity?days=7').set(admin());
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(7);
    const today = new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
    expect(res.body[6]).toEqual({ date: today, trips: 2, deliveries: 1 });
    expect(res.body[0]).toMatchObject({ trips: 0, deliveries: 0 });
  });

  it('drops the endpoints that only returned invented figures', async () => {
    for (const path of ['vehicle-health', 'profitable-routes', 'financials']) {
      expect((await request(app).get(`/api/v1/analytics/${path}`).set(admin())).status).toBe(404);
    }
  });
});
