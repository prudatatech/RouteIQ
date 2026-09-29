import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';
import { indianDateKey, startOfIndianDay } from '../src/core/istDate';
import { loadedKg } from '../src/services/fleet-analytics.service';

const app = testApp();
const admin = () => ({ Authorization: `Bearer ${supabaseMock.signUserToken('admin-1')}` });

const midDay = (daysAgo: number) => new Date(startOfIndianDay(daysAgo).getTime() + 12 * 3_600_000).toISOString();

function vehicle(id: string, plate: string, status: string, extra: Record<string, unknown> = {}) {
  return { id, plate_number: plate, status, capacity_kg: 1000, current_load_kg: null, available_capacity_kg: null, ...extra };
}
function route(id: string, vehicleId: string | null, km: number, daysAgo: number, status = 'completed') {
  return { id, vehicle_id: vehicleId, status, total_distance_km: km, created_at: midDay(daysAgo), updated_at: midDay(daysAgo) };
}

beforeEach(() => {
  supabaseMock.reset({
    users: [{ id: 'admin-1', role: 'admin', is_active: true }],
    vehicles: [
      vehicle('v1', 'MH12AB0001', 'on_route', { current_load_kg: 600 }),
      vehicle('v2', 'MH12AB0002', 'idle', { available_capacity_kg: 250 }),
      vehicle('v3', 'MH12AB0003', 'available'),
      vehicle('v4', 'MH12AB0004', 'maintenance'),
      vehicle('v5', 'MH12AB0005', 'offline'),
      vehicle('v6', 'MH12AB0006', 'archived'),
      vehicle('v7', 'TEMP-123456', 'idle'),
      vehicle('v8', 'DRFT-ABCDEF', 'archived'),
    ],
    routes: [
      route('r1', 'v1', 120, 0, 'active'),
      route('r2', 'v1', 80, 3),
      route('r3', 'v2', 50, 3),
      route('r4', 'v2', 999, 40),
      route('r5', 'v1', 70, 1, 'cancelled'),
      route('r6', null, 30, 2),
    ],
    maintenance_alerts: [
      { id: 'a1', vehicle_id: 'v1', alert_type: 'overspeed', severity: 'high', status: 'open', is_resolved: false, is_test: false, created_at: midDay(1) },
      { id: 'a2', vehicle_id: 'v2', alert_type: 'gps_lost', severity: 'medium', status: 'acknowledged', is_resolved: false, is_test: false, created_at: midDay(2) },
      { id: 'a3', vehicle_id: 'v2', alert_type: 'overspeed', severity: 'low', status: 'open', is_resolved: false, is_test: true, created_at: midDay(2) },
    ],
    sos_alerts: [
      { id: 's1', vehicle_id: 'v1', status: 'active', created_at: midDay(1) },
      { id: 's2', vehicle_id: 'v1', status: 'cancelled', created_at: midDay(5) },
      { id: 's3', vehicle_id: 'v2', status: 'resolved', created_at: midDay(60) },
      { id: 's4', vehicle_id: 'v7', status: 'active', created_at: midDay(1) },
    ],
    vendor_shipment_requests: [],
    shipments: [],
  });
});

describe('GET /fleet/analytics', () => {
  it('reports utilisation and the status breakdown for the real fleet only', async () => {
    const res = await request(app).get('/api/v1/fleet/analytics?days=30').set(admin());
    expect(res.status).toBe(200);
    // v6 is archived, v7 and v8 are placeholders: none of them is fleet
    expect(res.body.total_vehicles).toBe(5);
    expect(res.body.by_status).toEqual({ on_route: 1, idle: 2, maintenance: 1, offline: 1 });
    expect(res.body.utilisation_pct).toBe(20);
  });

  it('adds up the distance of routes dispatched in the period, per day and per vehicle', async () => {
    const res = await request(app).get('/api/v1/fleet/analytics?days=30').set(admin());
    const { distance } = res.body;
    // r1 + r2 + r3 + r6; the cancelled route and the one from 40 days ago are out
    expect(distance.total_km).toBe(280);
    expect(distance.routes).toBe(4);
    expect(distance.per_day).toHaveLength(30);
    const day = (n: number) => distance.per_day.find((d: { date: string }) => d.date === indianDateKey(startOfIndianDay(n)));
    expect(day(0)).toMatchObject({ distance_km: 120, routes: 1 });
    expect(day(3)).toMatchObject({ distance_km: 130, routes: 2 });
    expect(day(4)).toMatchObject({ distance_km: 0, routes: 0 });
    expect(distance.top_vehicles.map((v: { plate_number: string; distance_km: number }) => [v.plate_number, v.distance_km]))
      .toEqual([['MH12AB0001', 200], ['MH12AB0002', 50]]);
    expect(res.body.active_in_period).toBe(2);
    expect(res.body.active_in_period_pct).toBe(40);
  });

  it('honours the period', async () => {
    const res = await request(app).get('/api/v1/fleet/analytics?days=2').set(admin());
    expect(res.body.days).toBe(2);
    expect(res.body.distance.total_km).toBe(120);
    expect(res.body.distance.per_day).toHaveLength(2);
    const capped = await request(app).get('/api/v1/fleet/analytics?days=9999').set(admin());
    expect(capped.body.days).toBe(90);
  });

  it('reports load against capacity', async () => {
    const res = await request(app).get('/api/v1/fleet/analytics').set(admin());
    // 5 vehicles x 1000 kg; v1 carries 600, v2 carries 1000 - 250 = 750
    expect(res.body.capacity).toEqual({ total_kg: 5000, loaded_kg: 1350, loaded_pct: 27 });
  });

  it('includes fleet alerts and SOS counts, leaving out test alerts and non-fleet vehicles', async () => {
    const res = await request(app).get('/api/v1/fleet/analytics').set(admin());
    expect(res.body.alerts).toMatchObject({ open: 1, acknowledged: 1 });
    expect(res.body.alerts.last_30_days_by_type).toEqual({ overspeed: 1, gps_lost: 1 });
    expect(res.body.sos).toEqual({ total: 3, last_30_days: 2, open: 1, cancelled: 1 });
  });

  it('returns zeros and nulls, not an error, for an empty fleet', async () => {
    supabaseMock.reset({
      users: [{ id: 'admin-1', role: 'admin', is_active: true }],
      vehicles: [], routes: [], maintenance_alerts: [], sos_alerts: [],
    });
    const res = await request(app).get('/api/v1/fleet/analytics').set(admin());
    expect(res.status).toBe(200);
    expect(res.body.total_vehicles).toBe(0);
    expect(res.body.utilisation_pct).toBeNull();
    expect(res.body.capacity.loaded_pct).toBeNull();
    expect(res.body.distance.total_km).toBe(0);
    expect(res.body.sos.total).toBe(0);
  });

  it('is staff only', async () => {
    const driver = createAccessToken({ sub: 'driver-1', role: 'driver' });
    expect((await request(app).get('/api/v1/fleet/analytics').set({ Authorization: `Bearer ${driver}` })).status).toBe(403);
  });

  it('loadedKg prefers the reported load, then capacity minus free space', () => {
    expect(loadedKg({ capacity_kg: 1000, current_load_kg: 300, available_capacity_kg: 100 })).toBe(300);
    expect(loadedKg({ capacity_kg: 1000, current_load_kg: null, available_capacity_kg: 100 })).toBe(900);
    expect(loadedKg({ capacity_kg: 1000, current_load_kg: null, available_capacity_kg: null })).toBe(0);
  });
});

describe('GET /analytics/fleet-overview fleet counts', () => {
  it('counts available vehicles as idle and leaves out placeholders and archived vehicles', async () => {
    const res = await request(app).get('/api/v1/analytics/fleet-overview').set(admin());
    expect(res.status).toBe(200);
    expect(res.body.total_vehicles).toBe(5);
    expect(res.body.running_vehicles).toBe(1);
    expect(res.body.idle_vehicles).toBe(2);
    expect(res.body.fleet_utilisation_pct).toBe(20);
  });
});
