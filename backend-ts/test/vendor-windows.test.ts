import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';

const app = testApp();

const VENDOR = 'vendor-1';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

// The mock returns fixture rows as written, so these carry every sensitive
// vehicle column a careless select could leak.
const FULL_VEHICLE = {
  id: 'vehicle-1',
  plate_number: 'MH12AB1234',
  vehicle_type: 'truck',
  capacity_kg: 30000,
  body_type: 'container',
  available_capacity_kg: 800,
  current_location_name: 'Baner, Pune',
  driver_id: 'driver-1',
  driver_name: 'Ravi',
  driver_phone: '+919800000000',
  latitude: 18.52,
  longitude: 73.85,
};

beforeEach(() => {
  supabaseMock.reset({
    users: [
      { id: VENDOR, role: 'vendor', is_active: true },
      { id: 'admin-1', role: 'admin', is_active: true },
    ],
    vendor_profiles: [{ id: VENDOR, kyc_status: 'approved', city: 'Pune', latitude: 18.55, longitude: 73.86 }],
    tpl_partners: [],
    capacity_windows: [{
      id: 'w1',
      vehicle_id: 'vehicle-1',
      trigger_type: 'return_trip',
      opens_at: '2026-09-29T10:00:00Z',
      closes_at: '2099-01-01T00:00:00Z',
      floor_price: 1000,
      status: 'open',
      winning_bid_id: null,
      fallback_shipment_id: 'shipment-9',
      vehicles: FULL_VEHICLE,
    }],
    capacity_bids: [
      { id: 'b1', vendor_id: VENDOR, window_id: 'w1', status: 'pending', bid_amount: 1200, capacity_windows: { trigger_type: 'return_trip', vehicles: FULL_VEHICLE } },
      { id: 'b2', vendor_id: VENDOR, window_id: 'w2', status: 'won', bid_amount: 1500, capacity_windows: { trigger_type: 'mid_route', vehicles: FULL_VEHICLE } },
    ],
  });
});

describe('GET /capacity/windows/open', () => {
  it('gives vendors what they need to bid and nothing about the vehicle or driver', async () => {
    const res = await request(app).get('/api/v1/capacity/windows/open').set(bearer(supabaseMock.signUserToken(VENDOR)));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{
      id: 'w1',
      trigger_type: 'return_trip',
      opens_at: '2026-09-29T10:00:00Z',
      closes_at: '2099-01-01T00:00:00Z',
      floor_price: 1000,
      vehicles: { vehicle_type: 'truck', capacity_kg: 30000, body_type: 'container', available_capacity_kg: 800 },
    }]);
  });

  it('asks the database only for the limited columns', async () => {
    await request(app).get('/api/v1/capacity/windows/open').set(bearer(supabaseMock.signUserToken(VENDOR)));
    const query = supabaseMock.requests.find(u => u.pathname === '/rest/v1/capacity_windows');
    const select = query?.searchParams.get('select') ?? '';
    // Position is read to apply the geofence, but never sent on
    expect(select).toContain('vehicles(vehicle_type,capacity_kg,body_type,available_capacity_kg,latitude,longitude,current_location_name)');
    expect(select).not.toMatch(/plate|driver|\*/);
  });

  it('shows a vendor only trucks near them, or in their own city', async () => {
    const windows = () => request(app).get('/api/v1/capacity/windows/open').set(bearer(supabaseMock.signUserToken(VENDOR)));
    const vehicle = supabaseMock.rows('capacity_windows')[0].vehicles;

    // 200 km away: hidden
    vehicle.latitude = 20.3; vehicle.longitude = 73.85; vehicle.current_location_name = 'Nashik';
    expect((await windows()).body).toEqual([]);

    // Far by coordinates but reporting the vendor's city: shown
    vehicle.current_location_name = 'Kothrud, Pune';
    expect((await windows()).body).toHaveLength(1);
  });

  it('shows a vendor with no pickup location nothing, and staff everything', async () => {
    supabaseMock.rows('vendor_profiles')[0].latitude = null;
    const asVendor = await request(app).get('/api/v1/capacity/windows/open').set(bearer(supabaseMock.signUserToken(VENDOR)));
    expect(asVendor.body).toEqual([]);
    const asStaff = await request(app).get('/api/v1/capacity/windows/open').set(bearer(supabaseMock.signUserToken('admin-1')));
    expect(asStaff.body).toHaveLength(1);
  });

  it('hides windows that have not opened yet or are no longer open', async () => {
    const row = supabaseMock.rows('capacity_windows')[0];
    const get = async () => (await request(app).get('/api/v1/capacity/windows/open').set(bearer(supabaseMock.signUserToken(VENDOR)))).body;
    row.opens_at = new Date(Date.now() + 3600_000).toISOString();
    expect(await get()).toEqual([]);
    row.opens_at = '2026-09-29T10:00:00Z';
    row.status = 'closed';
    expect(await get()).toEqual([]);
  });

  it('is not available to drivers or anonymous callers', async () => {
    expect((await request(app).get('/api/v1/capacity/windows/open')).status).toBe(401);
    const driver = createAccessToken({ sub: 'driver-1', role: 'driver' });
    expect((await request(app).get('/api/v1/capacity/windows/open').set(bearer(driver))).status).toBe(403);
  });

  it('is available to staff', async () => {
    const res = await request(app).get('/api/v1/capacity/windows/open').set(bearer(supabaseMock.signUserToken('admin-1')));
    expect(res.status).toBe(200);
  });
});

describe('GET /capacity/bids/mine', () => {
  it('returns the vendor\'s bids with the plate only on a won bid', async () => {
    const res = await request(app).get('/api/v1/capacity/bids/mine').set(bearer(supabaseMock.signUserToken(VENDOR)));
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.map((b: any) => [b.id, b]));
    expect(byId.b1.capacity_windows).toEqual({ trigger_type: 'return_trip', vehicles: { vehicle_type: 'truck' } });
    expect(byId.b2.capacity_windows).toEqual({ trigger_type: 'mid_route', vehicles: { vehicle_type: 'truck', plate_number: 'MH12AB1234' } });
    expect(JSON.stringify(res.body)).not.toMatch(/driver_phone|latitude|longitude/);
  });

  it('only returns the caller\'s own bids', async () => {
    supabaseMock.rows('capacity_bids').push({ id: 'b3', vendor_id: 'vendor-2', window_id: 'w1', status: 'pending' });
    const res = await request(app).get('/api/v1/capacity/bids/mine').set(bearer(supabaseMock.signUserToken(VENDOR)));
    expect(res.body.map((b: any) => b.id).sort()).toEqual(['b1', 'b2']);
  });
});
