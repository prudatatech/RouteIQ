import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { createApp } from '../src/app';
import { indianDateKey, startOfIndianDay } from '../src/core/istDate';

const app = createApp();
const admin = () => ({ Authorization: `Bearer ${supabaseMock.signUserToken('admin-1')}` });

/** A timestamp safely inside the IST calendar day `daysAgo` days before today. */
function midDayIST(daysAgo: number): string {
  return new Date(startOfIndianDay(daysAgo).getTime() + 12 * 60 * 60 * 1000).toISOString();
}

/** YYYY-MM-DD (IST) of the calendar day `daysAgo` days before today. */
function dateKeyDaysAgo(daysAgo: number): string {
  return indianDateKey(startOfIndianDay(daysAgo));
}

function route(id: string, status: string, createdAt: string) {
  return { id, vehicle_id: null, depot_id: null, status, total_distance_km: 10, created_at: createdAt, updated_at: createdAt };
}

function shipment(id: string, updatedAt: string) {
  return {
    id, tracking_id: id, status: 'delivered', priority: 'medium',
    origin_name: 'Hub', origin_address: 'Pune', origin_lat: 18.5, origin_lng: 73.8,
    total_weight_kg: 100, created_at: updatedAt, updated_at: updatedAt,
  };
}

beforeEach(() => {
  supabaseMock.reset({
    users: [{ id: 'admin-1', role: 'admin', is_active: true }],
    vehicles: [],
    routes: [
      route('route-old', 'completed', midDayIST(10)),
      route('route-recent', 'completed', midDayIST(2)),
    ],
    shipments: [
      shipment('ship-old', midDayIST(10)),
      shipment('ship-recent', midDayIST(2)),
    ],
    vendor_shipment_requests: [],
  });
});

describe('GET /analytics/fleet-overview with from/to', () => {
  it('counts only routes/deliveries inside the given range', async () => {
    const res = await request(app).get('/api/v1/analytics/fleet-overview')
      .query({ from: dateKeyDaysAgo(3), to: dateKeyDaysAgo(0) })
      .set(admin());
    expect(res.status).toBe(200);
    expect(res.body.trips_today).toBe(1);
    expect(res.body.deliveries_today).toBe(1);
  });

  it('counts both when the range spans everything', async () => {
    const res = await request(app).get('/api/v1/analytics/fleet-overview')
      .query({ from: dateKeyDaysAgo(11), to: dateKeyDaysAgo(0) })
      .set(admin());
    expect(res.status).toBe(200);
    expect(res.body.trips_today).toBe(2);
    expect(res.body.deliveries_today).toBe(2);
  });
});

describe('GET /analytics/daily-activity with from/to', () => {
  it('buckets only the requested range', async () => {
    const res = await request(app).get('/api/v1/analytics/daily-activity')
      .query({ from: dateKeyDaysAgo(4), to: dateKeyDaysAgo(0) })
      .set(admin());
    expect(res.status).toBe(200);
    const total = res.body.reduce((s: number, d: { trips: number }) => s + d.trips, 0);
    expect(total).toBe(1);
    expect(res.body.length).toBeGreaterThan(0);
  });
});
