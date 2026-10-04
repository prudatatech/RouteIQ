import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';

const app = testApp();
const base = '/api/v1/public';
const FORBIDDEN = ['plate', 'plate_number', 'vehicle_id', 'driver', 'driver_name', 'driver_phone', 'phone', 'email', 'gstin', 'lat', 'lng', 'latitude', 'longitude', 'user_id'];

/** Every object key (at any depth) that is a forbidden one. */
function forbiddenKeys(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => forbiddenKeys(v, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => [...(FORBIDDEN.includes(k.toLowerCase()) ? [`${path}.${k}`] : []), ...forbiddenKeys(v, `${path}.${k}`)]);
  }
  return [];
}

const soon = new Date(Date.now() - 60_000).toISOString();
const later = new Date(Date.now() + 3 * 3_600_000).toISOString();

function seed() {
  supabaseMock.reset({
    system_settings: [{ key: 'rate_per_km', value: { rate: 20 } }],
    organizations: [
      { id: 'o1', kind: 'logistic_company', status: 'active', name: 'Alpha Logistics', city: 'Pune', gstin: '27AAAAA0000A1Z5', phone: '9999999999', email: 'a@x.in' },
      { id: 'o2', kind: 'logistic_company', status: 'pending', name: 'Pending Carriers', city: 'Pune' },
      { id: 'o3', kind: 'logistic_company', status: 'suspended', name: 'Suspended Freight', city: 'Delhi' },
      { id: 'o4', kind: 'vendor', status: 'active', name: 'A Vendor Org', city: 'Pune' },
    ],
    vehicles: [
      { id: 'v1', carrier_org_id: 'o1', plate_number: 'MH12AB1234', vehicle_type: 'truck', status: 'available', capacity_kg: 9000, available_capacity_kg: 4000, current_location_name: 'Hinjewadi, Pune, Maharashtra', latitude: 18.5, longitude: 73.8, driver_name: 'Ramesh', driver_phone: '8888888888' },
      { id: 'v2', carrier_org_id: 'o2', plate_number: 'MH12ZZ0002', vehicle_type: 'tempo', status: 'available', available_capacity_kg: 1000, current_location_name: 'Pune' },
      { id: 'v3', carrier_org_id: 'o3', plate_number: 'DL01ZZ0003', vehicle_type: 'truck', status: 'available', available_capacity_kg: 2000, current_location_name: 'Delhi' },
    ],
    capacity_windows: [
      { id: 'w1', carrier_org_id: 'o1', vehicle_id: 'v1', status: 'open', winning_bid_id: null, opens_at: soon, closes_at: later, floor_price: 8000, vehicles: { vehicle_type: 'truck', capacity_kg: 9000, available_capacity_kg: 4000, current_location_name: 'Hinjewadi, Pune, Maharashtra', plate_number: 'MH12AB1234', latitude: 18.5, longitude: 73.8 } },
      { id: 'w2', carrier_org_id: 'o2', vehicle_id: 'v2', status: 'open', winning_bid_id: null, opens_at: soon, closes_at: later, floor_price: 1000, vehicles: { vehicle_type: 'tempo', available_capacity_kg: 1000, current_location_name: 'Pune' } },
      { id: 'w3', carrier_org_id: 'o3', vehicle_id: 'v3', status: 'open', winning_bid_id: null, opens_at: soon, closes_at: later, floor_price: 1000, vehicles: { vehicle_type: 'truck', available_capacity_kg: 2000, current_location_name: 'Delhi' } },
    ],
    routes: [{ id: 'r1', vehicle_id: 'v1', depot_id: 'd1', created_at: '2026-09-01T00:00:00Z' }],
    depots: [
      { id: 'd1', carrier_org_id: 'o1', name: 'Mumbai hub', address: 'Andheri, Mumbai, Maharashtra 400093', latitude: 19.1, longitude: 72.8 },
      { id: 'd2', carrier_org_id: 'o2', name: 'Pending depot', address: 'Nagpur, Maharashtra' },
    ],
    shipments: [
      { id: 's1', carrier_org_id: 'o1', status: 'delivered' },
      { id: 's2', carrier_org_id: 'o1', status: 'delivered' },
      { id: 's3', carrier_org_id: 'o1', status: 'in_transit' },
      { id: 's4', carrier_org_id: 'o2', status: 'delivered' },
    ],
    price_quotes: [],
  });
}

beforeEach(seed);

describe('GET /public/spare-space', () => {
  it('lists open space of active companies in the agreed shape, without signing in', async () => {
    const res = await request(app).get(`${base}/spare-space`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toEqual({
      id: 'w1',
      company: { id: 'o1', name: 'Alpha Logistics', city: 'Pune' },
      from_city: 'Pune',
      to_city: 'Mumbai',
      departs_from: soon,
      departs_to: later,
      vehicle_type: 'truck',
      free_kg: 4000,
      price_per_kg_from: 2,
    });
  });

  it('leaves out pending and suspended companies', async () => {
    const res = await request(app).get(`${base}/spare-space`);
    expect(JSON.stringify(res.body)).not.toMatch(/Pending Carriers|Suspended Freight|"w2"|"w3"/);
  });

  it('filters by city (case-insensitive), vehicle type and weight', async () => {
    expect((await request(app).get(`${base}/spare-space?from=pune&to=MUMBAI`)).body.items).toHaveLength(1);
    expect((await request(app).get(`${base}/spare-space?from=Delhi`)).body.items).toHaveLength(0);
    expect((await request(app).get(`${base}/spare-space?vehicle_type=tempo`)).body.items).toHaveLength(0);
    expect((await request(app).get(`${base}/spare-space?min_kg=5000`)).body.items).toHaveLength(0);
    expect((await request(app).get(`${base}/spare-space?min_kg=3000`)).body.items).toHaveLength(1);
  });

  it('rejects a malformed date', async () => {
    expect((await request(app).get(`${base}/spare-space?date=tomorrow`)).status).toBe(400);
  });

  it('carries no plate, phone, driver, vehicle id or position', async () => {
    const res = await request(app).get(`${base}/spare-space`);
    expect(forbiddenKeys(res.body)).toEqual([]);
    expect(JSON.stringify(res.body)).not.toMatch(/MH12AB1234|Ramesh|8888888888|9999999999|27AAAAA/);
  });
});

describe('GET /public/companies', () => {
  it('lists active logistic companies with aggregate counts only', async () => {
    const res = await request(app).get(`${base}/companies`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
    expect(res.body.items).toEqual([{ id: 'o1', name: 'Alpha Logistics', city: 'Pune', vehicle_types: ['truck'], trips_completed: 2 }]);
    expect(forbiddenKeys(res.body)).toEqual([]);
    expect(JSON.stringify(res.body)).not.toMatch(/gstin|27AAAAA|a@x\.in|9999999999|Pending Carriers|Suspended Freight|A Vendor Org/);
  });

  it('filters by city and vehicle type', async () => {
    expect((await request(app).get(`${base}/companies?city=pune&vehicle_type=Truck`)).body.items).toHaveLength(1);
    expect((await request(app).get(`${base}/companies?city=Delhi`)).body.items).toHaveLength(0);
    expect((await request(app).get(`${base}/companies?vehicle_type=tempo`)).body.items).toHaveLength(0);
  });
});

describe('GET /public/cities', () => {
  it('suggests cities from active companies and their depots only', async () => {
    const res = await request(app).get(`${base}/cities`);
    expect(res.status).toBe(200);
    expect(res.body.cities).toEqual(['Mumbai', 'Pune']);
    expect((await request(app).get(`${base}/cities?q=mum`)).body.cities).toEqual(['Mumbai']);
    expect(forbiddenKeys(res.body)).toEqual([]);
  });
});

describe('retired lane-search quote endpoint', () => {
  it('is unavailable and cannot create quotes', async () => {
    const res = await request(app).post(`${base}/quote`).send({});
    expect(res.status).toBe(404);
    expect(supabaseMock.mutations).toEqual([]);
  });
});

describe('guest safety across every endpoint', () => {
  it('never returns a forbidden key', async () => {
    const bodies = [
      (await request(app).get(`${base}/spare-space`)).body,
      (await request(app).get(`${base}/companies`)).body,
      (await request(app).get(`${base}/cities`)).body,
    ];
    for (const b of bodies) expect(forbiddenKeys(b)).toEqual([]);
  });
});

// Last: these use up the per-IP allowance of the endpoints they hit
describe('rate limits', () => {
  it('limits spare space per IP', async () => {
    let last = 200;
    for (let i = 0; i < 65; i++) last = (await request(app).get(`${base}/spare-space`)).status;
    expect(last).toBe(429);
  });
});
