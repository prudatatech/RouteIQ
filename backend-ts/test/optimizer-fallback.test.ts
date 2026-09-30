import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { settings } from '../src/core/config';
import { externalHttp } from '../src/core/http';
import { resetMlHealth } from '../src/services/optimizer/ml-client';

const app = testApp();
const admin = () => ({ Authorization: `Bearer ${supabaseMock.signUserToken('admin-1')}` });

const DEPOT = '22222222-2222-4222-8222-222222222222';
const BIG = '11111111-1111-4111-8111-111111111111';
const SMALL = '11111111-1111-4111-8111-111111111112';
const S1 = '00000000-0000-4000-8000-000000000001';
const S2 = '00000000-0000-4000-8000-000000000002';
const S3 = '00000000-0000-4000-8000-000000000003';
const HEAVY = '00000000-0000-4000-8000-000000000004';

const shipment = (id: string, tracking: string, kg: number, lat: number, lng: number, created: string) => ({
  id, tracking_id: tracking, status: 'created', total_weight_kg: kg, created_at: created,
  delivery_points: [{ id: `dp-${tracking}`, name: `Stop ${tracking}`, latitude: lat, longitude: lng, created_at: created }],
});

function seed() {
  supabaseMock.reset({
    users: [{ id: 'admin-1', role: 'admin', is_active: true }],
    depots: [{ id: DEPOT, name: 'Depot', latitude: 21.14, longitude: 79.08 }],
    vehicles: [
      { id: BIG, plate_number: 'MH12AB1234', status: 'available', capacity_kg: 5000, fuel_efficiency_kmpl: 5, driver_id: null },
      { id: SMALL, plate_number: 'MH12AB9999', status: 'available', capacity_kg: 1000, fuel_efficiency_kmpl: 5, driver_id: null },
    ],
    // Booked far, near, mid: a poor order to drive them in
    shipments: [
      shipment(S1, 'T1', 200, 21.60, 79.08, '2026-09-29T08:00:00Z'),
      shipment(S2, 'T2', 200, 21.20, 79.08, '2026-09-29T08:01:00Z'),
      shipment(S3, 'T3', 200, 21.40, 79.08, '2026-09-29T08:02:00Z'),
      shipment(HEAVY, 'T4', 9000, 21.30, 79.10, '2026-09-29T08:03:00Z'),
    ],
    delivery_points: [], routes: [], route_stops: [], notifications: [], shipment_logs: [], customer_bookings: [], telemetry: [],
  });
}

const post = (extra: Record<string, unknown> = {}) =>
  request(app).post('/api/v1/optimize').set(admin()).send({
    depot_id: DEPOT, vehicle_ids: [BIG, SMALL], shipment_ids: [S1, S2, S3, HEAVY], consider_weather: false, ...extra,
  });

const globalFetch = globalThis.fetch;

describe('optimize with the ML service down', () => {
  beforeEach(() => {
    seed();
    resetMlHealth();
    settings.MAPBOX_ACCESS_TOKEN = '';
    settings.TOMTOM_API_KEY = '';
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
      if (String(input).includes('127.0.0.1:8001')) throw new TypeError('fetch failed');
      return globalFetch(input, init);
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    settings.MAPBOX_ACCESS_TOKEN = '';
  });

  it('still plans routes, labelled as an estimate when no routing key is set', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body.engine).toBe('fallback-estimated');
    expect(res.body.estimated).toBe(true);
    expect(res.body.matrix_source).toBe('estimated');
    expect(res.body.engine_note).toMatch(/ML service: /);
    expect(res.body.algorithm).toBe('cheapest-insertion+2opt');
    expect(res.body.routes.length).toBeGreaterThan(0);

    // Everything that fits is on a saved route; the 9 t load fits no vehicle and says why
    const planned = res.body.routes.flatMap((r: any) => r.plan.map((n: any) => n.shipment_id));
    expect(planned.sort()).toEqual([S1, S2, S3].sort());
    expect(res.body.unassigned).toHaveLength(1);
    expect(res.body.unassigned[0]).toMatchObject({ shipment_id: HEAVY, tracking_id: 'T4', reason: 'exceeds_vehicle_capacity' });
    expect(res.body.unassigned[0].message).toMatch(/9,000 kg/);

    expect(supabaseMock.rows('routes').length).toBe(res.body.routes.length);
  });

  it('shows the booked order beside the optimized one and reports what it saved', async () => {
    const res = await post({ vehicle_ids: [BIG] });
    const route = res.body.routes[0];
    expect(route.before.plan.map((n: any) => n.tracking_id)).toEqual(['T1', 'T2', 'T3']);
    expect(route.plan.map((n: any) => n.tracking_id)).toEqual(['T2', 'T3', 'T1']);
    expect(route.plan.map((n: any) => n.seq)).toEqual([1, 2, 3]);
    expect(route.saved_km).toBeGreaterThan(0);
    expect(route.saved_minutes).toBeGreaterThan(0);
    expect(res.body.saved_km).toBe(route.saved_km);
    expect(res.body.depot).toMatchObject({ id: DEPOT });
    // Saved routes carry the optimized order
    const stops = supabaseMock.rows('route_stops').sort((a: any, b: any) => a.sequence - b.sequence);
    expect(stops.map((s: any) => s.delivery_point_id)).toEqual(['dp-T2', 'dp-T3', 'dp-T1']);
  });

  it('is labelled a road matrix when Mapbox answers', async () => {
    settings.MAPBOX_ACCESS_TOKEN = 'pk.test';
    vi.spyOn(externalHttp, 'getJson').mockImplementation(async (url: string) => {
      const coords = new URL(url).pathname.split('/').pop()!.split(';');
      const q = new URL(url).searchParams;
      const sources = q.get('sources')!.split(';').map(Number);
      const destinations = q.get('destinations')!.split(';').map(Number);
      const km = (a: number, b: number) => {
        const [x1, y1] = coords[a].split(',').map(Number);
        const [x2, y2] = coords[b].split(',').map(Number);
        return Math.hypot((x1 - x2) * 100, (y1 - y2) * 110) * 1.4;
      };
      return {
        code: 'Ok',
        distances: sources.map(s => destinations.map(d => km(s, d) * 1000)),
        durations: sources.map(s => destinations.map(d => (km(s, d) / 50) * 3600)),
      };
    });
    const res = await post();
    expect(res.body.engine).toBe('fallback-road-matrix');
    expect(res.body.estimated).toBe(false);
    expect(res.body.matrix_source).toBe('mapbox');
    expect(res.body.engine_note).toMatch(/health check/);
  });

  it('answers ETA with the physics estimate and says it is one', async () => {
    const res = await request(app).post('/api/v1/optimize/eta').set(admin()).send({ distance_km: 60 });
    expect(res.status).toBe(200);
    expect(res.body.engine).toBe('fallback-estimated');
    expect(res.body.estimated_minutes).toBeGreaterThan(0);
  });

  it('answers ETA from a Mapbox traffic duration when both ends are given', async () => {
    settings.MAPBOX_ACCESS_TOKEN = 'pk.test';
    const http = vi.spyOn(externalHttp, 'getJson').mockResolvedValue({ routes: [{ duration: 3600, duration_typical: 3000, distance: 55000 }] });
    const res = await request(app).post('/api/v1/optimize/eta').set(admin())
      .send({ distance_km: 50, origin: { lat: 21.14, lng: 79.08 }, destination: { lat: 21.6, lng: 79.08 } });
    expect(String(http.mock.calls[0][0])).toContain('driving-traffic');
    expect(res.body).toMatchObject({ engine: 'fallback-road-matrix', estimated_minutes: 60, traffic_impact_minutes: 10, distance_km: 55 });
  });

  describe('re-optimizing a route', () => {
    const ROUTE = '33333333-3333-4333-8333-333333333333';
    beforeEach(() => {
      const dp = (id: string, lat: number) => ({ id, latitude: lat, longitude: 79.08, name: id });
      supabaseMock.reset({
        users: [{ id: 'admin-1', role: 'admin', is_active: true }],
        vehicles: [{ id: BIG, plate_number: 'MH12AB1234', status: 'on_route', capacity_kg: 5000, latitude: 21.14, longitude: 79.08 }],
        routes: [{ id: ROUTE, vehicle_id: BIG, status: 'active', total_distance_km: 200, total_duration_minutes: 300, created_at: '2026-09-29T08:00:00Z' }],
        delivery_points: [dp('dpA', 21.6), dp('dpB', 21.2), dp('dpC', 21.4)],
        // Embedded relations are returned as written, so the stops carry their points
        route_stops: [
          { id: 'rs1', route_id: ROUTE, delivery_point_id: 'dpA', sequence: 1, status: 'pending', delivery_points: dp('dpA', 21.6) },
          { id: 'rs2', route_id: ROUTE, delivery_point_id: 'dpB', sequence: 2, status: 'pending', delivery_points: dp('dpB', 21.2) },
          { id: 'rs3', route_id: ROUTE, delivery_point_id: 'dpC', sequence: 3, status: 'pending', delivery_points: dp('dpC', 21.4) },
        ],
        telemetry: [], notifications: [],
      });
    });

    it('re-solves the pending stops and reorders them', async () => {
      const res = await request(app).post(`/api/v1/optimize/reoptimize/${ROUTE}`).set(admin());
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.engine).toBe('fallback-estimated');
      expect(res.body.saved_minutes).toBeGreaterThan(0);
      expect(res.body.old_stop_sequence).toEqual(['dpA', 'dpB', 'dpC']);
      expect(res.body.new_stop_sequence).toEqual(['dpB', 'dpC', 'dpA']);
      const seq = Object.fromEntries(supabaseMock.rows('route_stops').map((s: any) => [s.delivery_point_id, s.sequence]));
      expect(seq).toEqual({ dpB: 1, dpC: 2, dpA: 3 });
      // The route's totals fall by what the re-solve saved, not replaced by the remaining-stops figure
      const route = supabaseMock.rows('routes')[0];
      expect(route.total_distance_km).toBeLessThan(200);
      expect(route.total_distance_km).toBeGreaterThan(100);
    });

    it('offers a better order as a suggestion from the incubator', async () => {
      const res = await request(app).post(`/api/v1/optimize/incubate/${BIG}`).set(admin());
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'suggested', engine: 'fallback-estimated' });
      expect(res.body.saved_minutes).toBeGreaterThanOrEqual(5);
    });
  });
});

describe('optimize with the ML service up', () => {
  beforeEach(() => {
    seed();
    resetMlHealth();
    settings.MAPBOX_ACCESS_TOKEN = '';
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
      const url = String(input);
      if (url.endsWith('/health')) return new Response('{}', { status: 200 });
      if (url.includes('/optimize')) {
        return new Response(JSON.stringify({
          routes: [{ vehicle_id: BIG, stop_ids: [S1, S2, S3], total_distance_km: 200, total_duration_minutes: 300, estimated_fuel_liters: 40 }],
          total_distance_km: 200, total_fuel_liters: 40, solve_time_seconds: 1, savings_vs_naive_pct: 12,
        }), { status: 200 });
      }
      return globalFetch(input, init);
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is labelled ml-service and still explains what it left out', async () => {
    const res = await post();
    expect(res.body.engine).toBe('ml-service');
    expect(res.body.estimated_savings_pct).toBe(12);
    expect(res.body.routes[0].plan).toHaveLength(3);
    expect(res.body.unassigned.map((u: any) => u.shipment_id)).toEqual([HEAVY]);
    expect(res.body.unassigned[0].reason).toBe('exceeds_vehicle_capacity');
  });

  it('uses the fallback when the ML service answers with an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
      if (String(input).endsWith('/health')) return new Response('{}', { status: 200 });
      if (String(input).includes('/optimize')) return new Response('boom', { status: 500 });
      return globalFetch(input, init);
    }));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body.engine).toBe('fallback-estimated');
  });
});
