import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { buildDemand, buildForecast, cityFromAddress } from '../src/services/demand.service';

const app = testApp();
const admin = () => ({ Authorization: `Bearer ${supabaseMock.signUserToken('admin-1')}` });
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

describe('cityFromAddress', () => {
  it('takes the part before the state', () => {
    expect(cityFromAddress('Andheri East, Mumbai, Maharashtra 400093, India')).toBe('Mumbai');
    expect(cityFromAddress('Bhiwandi, Maharashtra 421302')).toBe('Bhiwandi');
    expect(cityFromAddress('Pune')).toBe('Pune');
    expect(cityFromAddress('  ')).toBeNull();
    expect(cityFromAddress(null)).toBeNull();
  });
});

describe('buildDemand', () => {
  it('counts loads and vehicles per city, biggest gap first, and reports what has no city', () => {
    const { rows, loadsWithoutCity, vehiclesWithoutCity } = buildDemand(['Pune', 'pune', 'Mumbai', null], ['Mumbai', 'Mumbai', null, null]);
    expect(rows).toEqual([
      { city: 'Pune', open_loads: 2, available_vehicles: 0, gap: 2 },
      { city: 'Mumbai', open_loads: 1, available_vehicles: 2, gap: -1 },
    ]);
    expect(loadsWithoutCity).toBe(1);
    expect(vehiclesWithoutCity).toBe(2);
  });
});

describe('buildForecast', () => {
  const today = '2026-09-30';
  const load = (day: string, origin = 'Pune', destination = 'Mumbai') => ({ origin, destination, day });

  it('projects the average of the last 7 days, and skips corridors with too little history', () => {
    const rows = buildForecast([
      load('2026-09-30'), load('2026-09-29'), load('2026-09-29'), load('2026-09-25'), // 4 in the last 7 days
      load('2026-09-05'), // older, still history
      load('2026-09-30', 'Surat', 'Pune'), load('2026-09-29', 'Surat', 'Pune'), // 2 loads: not enough
    ], today);
    expect(rows).toEqual([
      { origin: 'Pune', destination: 'Mumbai', loads_last_28_days: 5, daily_average: 0.57, expected_next_7_days: 4 },
    ]);
  });

  it('is empty when there is no history', () => {
    expect(buildForecast([], today)).toEqual([]);
    expect(buildForecast([load('2026-09-30', 'Pune', null as unknown as string)], today)).toEqual([]);
  });
});

describe('GET /analytics/demand', () => {
  beforeEach(() => {
    supabaseMock.reset({
      users: [{ id: 'admin-1', role: 'admin', is_active: true }, { id: 'driver-1', role: 'driver', is_active: true }],
      shipments: [
        { id: 's1', status: 'created', origin_name: 'Hub', origin_address: 'MIDC, Pune, Maharashtra 411019', created_at: daysAgo(1) },
        { id: 's2', status: 'created', origin_name: 'Hub', origin_address: 'MIDC, Pune, Maharashtra 411019', created_at: daysAgo(2) },
        { id: 's3', status: 'delivered', origin_name: 'Hub', origin_address: 'MIDC, Pune, Maharashtra 411019', created_at: daysAgo(3) },
      ],
      delivery_points: [
        { id: 'd1', shipment_id: 's1', address: 'Andheri, Mumbai, Maharashtra 400093' },
        { id: 'd2', shipment_id: 's2', address: 'Andheri, Mumbai, Maharashtra 400093' },
        { id: 'd3', shipment_id: 's3', address: 'Andheri, Mumbai, Maharashtra 400093' },
      ],
      vendor_shipment_requests: [],
      vehicles: [
        { id: 'v1', status: 'available', current_location_name: 'Pune, Maharashtra' },
        { id: 'v2', status: 'available', current_location_name: null },
        { id: 'v3', status: 'on_route', current_location_name: 'Pune, Maharashtra' },
      ],
    });
  });

  it('reads open loads, available vehicles and the forecast from the tables', async () => {
    const res = await request(app).get('/api/v1/analytics/demand').set(admin());
    expect(res.status).toBe(200);
    expect(res.body.demand).toEqual([{ city: 'Pune', open_loads: 2, available_vehicles: 1, gap: 1 }]);
    expect(res.body.vehicles_without_city).toBe(1);
    expect(res.body.forecast).toHaveLength(1);
    expect(res.body.forecast[0]).toMatchObject({ origin: 'Pune', destination: 'Mumbai', loads_last_28_days: 3 });
  });

  it('is empty, not invented, when there is nothing', async () => {
    supabaseMock.reset({
      users: [{ id: 'admin-1', role: 'admin', is_active: true }],
      shipments: [], delivery_points: [], vendor_shipment_requests: [], vehicles: [],
    });
    const res = await request(app).get('/api/v1/analytics/demand').set(admin());
    expect(res.body).toMatchObject({ demand: [], forecast: [], loads_without_city: 0, vehicles_without_city: 0 });
  });

  it('is staff only', async () => {
    const driver = { Authorization: `Bearer ${supabaseMock.signUserToken('driver-1')}` };
    expect((await request(app).get('/api/v1/analytics/demand').set(driver)).status).toBe(403);
  });
});
