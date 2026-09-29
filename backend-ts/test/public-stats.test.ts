import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { cacheDelete } from '../src/core/redis';
import { PUBLIC_STATS_CACHE_KEY } from '../src/routes/public.routes';

const app = testApp();
const get = () => request(app).get('/api/v1/public/stats');

function seed() {
  supabaseMock.reset({
    vehicles: [{ id: 'v1', plate_number: 'MH01AA0001', status: 'available' }, { id: 'v2', plate_number: 'MH01AA0002', status: 'on_route' }, { id: 'v3', plate_number: 'OLD', status: 'archived' }],
    shipments: [
      { id: 's1', status: 'delivered', updated_at: '2026-09-01T00:00:00Z' },
      { id: 's2', status: 'delivered', updated_at: '2026-09-02T00:00:00Z' },
      { id: 's3', status: 'in_transit', updated_at: '2026-09-03T00:00:00Z' },
    ],
    cargo_manifest: [{ id: 'm1', status: 'delivered' }, { id: 'm2', status: 'scheduled' }],
    tpl_partners: [{ id: 'p1', status: 'active', company_name: 'Secret Logistics' }, { id: 'p2', status: 'pending' }],
    delivery_points: [
      { id: 'd1', shipment_id: 's1', address: 'Andheri, Mumbai, Maharashtra 400093' },
      { id: 'd2', shipment_id: 's2', address: 'Kothrud, Pune, Maharashtra 411038' },
      { id: 'd3', shipment_id: 's3', address: 'Somewhere, Delhi, Delhi 110001' },
    ],
  });
}

beforeEach(async () => {
  await cacheDelete(PUBLIC_STATS_CACHE_KEY);
  seed();
});

describe('GET /public/stats', () => {
  it('returns aggregate counts without signing in', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ vehicles: 2, deliveries_completed: 3, active_partners: 1, cities_served: 2 });
  });

  it('carries nothing that identifies a person or company', async () => {
    const res = await get();
    expect(Object.keys(res.body).sort()).toEqual(['active_partners', 'cities_served', 'deliveries_completed', 'vehicles']);
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/MH01|Secret|Mumbai|Pune/);
  });

  it('reports zeros, not made-up figures, on an empty platform', async () => {
    supabaseMock.reset({ vehicles: [], shipments: [], cargo_manifest: [], tpl_partners: [], delivery_points: [] });
    expect((await get()).body).toEqual({ vehicles: 0, deliveries_completed: 0, active_partners: 0, cities_served: 0 });
  });

  it('is cached for 10 minutes', async () => {
    const first = await get();
    supabaseMock.rows('vehicles').push({ id: 'v9', status: 'available' });
    const second = await get();
    expect(second.body).toEqual(first.body);
    expect(second.headers['cache-control']).toContain('max-age=600');
    await cacheDelete(PUBLIC_STATS_CACHE_KEY);
    expect((await get()).body.vehicles).toBe(3);
  });

  it('is rate limited per client', async () => {
    let last = 200;
    for (let i = 0; i < 70; i++) last = (await get()).status;
    expect(last).toBe(429);
  });
});
