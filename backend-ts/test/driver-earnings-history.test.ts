import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';

const app = testApp();

const DRIVER_ID = 'driver-1';
const driverToken = createAccessToken({ sub: DRIVER_ID, role: 'driver' });

const cargoTrip = (id: string, updatedAt: string) => ({
  id,
  vehicle_id: 'veh-1',
  status: 'delivered',
  pickup_location: 'Pune',
  drop_location: 'Mumbai',
  pickup_lat: 18.5,
  pickup_lng: 73.8,
  drop_lat: 19.07,
  drop_lng: 72.87,
  capacity_kg: 500,
  updated_at: updatedAt,
});
const invoiceFor = (manifestId: string, amount: number, status = 'issued') => ({
  id: `inv-${manifestId}`, manifest_id: manifestId, shipment_id: null, amount, status, voided_at: null,
});

const get = (path: string) => request(app).get(path).set('Authorization', `Bearer ${driverToken}`);

beforeEach(() => {
  supabaseMock.reset({
    vehicles: [{ id: 'veh-1', driver_id: DRIVER_ID, latitude: 18.5, longitude: 73.8, capacity_kg: 1000 }],
    cargo_manifest: [
      cargoTrip('trip-1', '2026-09-01T00:00:00Z'),
      cargoTrip('trip-2', '2026-09-05T00:00:00Z'),
      cargoTrip('trip-3', '2026-09-10T00:00:00Z'),
    ],
    invoices: [invoiceFor('trip-1', 1000), invoiceFor('trip-2', 1500, 'paid'), invoiceFor('trip-3', 2000)],
    vendor_shipment_requests: [],
    routes: [],
  });
});

describe('GET /auth/driver/earnings/history', () => {
  it('requires a driver token', async () => {
    const res = await request(app).get('/api/v1/auth/driver/earnings/history');
    expect(res.status).toBe(401);
  });

  it('paginates the full trip history', async () => {
    const res = await get('/api/v1/auth/driver/earnings/history?limit=2&offset=0');
    expect(res.status).toBe(200);
    expect(res.body.invoices).toHaveLength(2);
    expect(res.body.total).toBe(3);
    expect(res.body.has_more).toBe(true);
  });

  it('returns the remaining page and has_more=false at the end', async () => {
    const res = await get('/api/v1/auth/driver/earnings/history?limit=2&offset=2');
    expect(res.status).toBe(200);
    expect(res.body.invoices).toHaveLength(1);
    expect(res.body.has_more).toBe(false);
  });

  it('reports the driver total earnings and clamps an oversized limit', async () => {
    const res = await get('/api/v1/auth/driver/earnings/history?limit=99999');
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(100);
    expect(res.body.total_earnings).toBe(4500);
  });
});

describe('driver earnings come from invoices', () => {
  it('marks a trip paid only when its invoice is paid', async () => {
    const res = await get('/api/v1/auth/driver/earnings/history');
    const byPayout = Object.fromEntries(res.body.invoices.map((i: any) => [i.total_payout, i.status]));
    expect(byPayout).toEqual({ 1000: 'pending', 1500: 'paid', 2000: 'pending' });
  });

  it('ignores voided invoices', async () => {
    const rows = supabaseMock.rows('invoices');
    rows[0].voided_at = '2026-09-02T00:00:00Z';
    const res = await get('/api/v1/auth/driver/earnings');
    expect(res.body.total_earnings).toBe(3500);
  });

  it('falls back to the vendor request cost before an invoice exists', async () => {
    supabaseMock.reset({
      vehicles: [{ id: 'veh-1', driver_id: DRIVER_ID, capacity_kg: 1000 }],
      cargo_manifest: [{ ...cargoTrip('trip-9', '2026-09-11T00:00:00Z'), vendor_request_id: 'req-1' }],
      invoices: [],
      vendor_shipment_requests: [{ id: 'req-1', cost: 2750 }],
      routes: [],
    });
    const res = await get('/api/v1/auth/driver/earnings');
    expect(res.body.total_earnings).toBe(2750);
    expect(res.body.recent_invoices[0].status).toBe('pending');
  });

  it('sums the invoices of the shipments delivered on a route', async () => {
    supabaseMock.reset({
      vehicles: [{ id: 'veh-1', driver_id: DRIVER_ID, capacity_kg: 1000 }],
      cargo_manifest: [],
      routes: [{
        id: 'route-1', vehicle_id: 'veh-1', status: 'completed', updated_at: '2026-09-12T00:00:00Z',
        route_stops: [
          { sequence: 1, delivery_points: { name: 'A', shipment_id: 'ship-1', demand_kg: 100 } },
          { sequence: 2, delivery_points: { name: 'B', shipment_id: 'ship-2', demand_kg: 100 } },
        ],
      }],
      invoices: [
        { id: 'i1', shipment_id: 'ship-1', manifest_id: null, amount: 800, status: 'paid', voided_at: null },
        { id: 'i2', shipment_id: 'ship-2', manifest_id: null, amount: 700, status: 'paid', voided_at: null },
        { id: 'i3', shipment_id: 'ship-3', manifest_id: null, amount: 999, status: 'paid', voided_at: null },
      ],
      vendor_shipment_requests: [],
    });
    const res = await get('/api/v1/auth/driver/earnings');
    expect(res.body.total_earnings).toBe(1500);
    expect(res.body.recent_invoices[0].status).toBe('paid');
  });
});
