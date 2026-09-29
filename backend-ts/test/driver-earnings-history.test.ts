import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { createApp } from '../src/app';
import { createAccessToken } from '../src/core/auth';

const app = createApp();

const DRIVER_ID = 'driver-1';
const driverToken = createAccessToken({ sub: DRIVER_ID, role: 'driver' });

const cargoTrip = (id: string, updatedAt: string, cost: number) => ({
  id,
  vehicle_id: 'veh-1',
  status: 'delivered',
  pickup_location: 'Pune',
  drop_location: 'Mumbai',
  pickup_lat: 18.5,
  pickup_lng: 73.8,
  drop_lat: 19.07,
  drop_lng: 72.87,
  total_distance_km: 150,
  cost,
  capacity_kg: 500,
  updated_at: updatedAt,
});

const get = (path: string) => request(app).get(path).set('Authorization', `Bearer ${driverToken}`);

beforeEach(() => {
  supabaseMock.reset({
    vehicles: [{ id: 'veh-1', driver_id: DRIVER_ID, latitude: 18.5, longitude: 73.8, capacity_kg: 1000 }],
    cargo_manifest: [
      cargoTrip('trip-1', '2026-09-01T00:00:00Z', 1000),
      cargoTrip('trip-2', '2026-09-05T00:00:00Z', 1500),
      cargoTrip('trip-3', '2026-09-10T00:00:00Z', 2000),
    ],
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
