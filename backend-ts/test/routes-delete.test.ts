import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';

const app = testApp();
const adminToken = () => supabaseMock.signUserToken('admin-1');

function route(status: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'route-1',
    vehicle_id: null,
    depot_id: null,
    status,
    total_distance_km: 12,
    total_duration_minutes: 30,
    estimated_fuel_liters: 2,
    waypoints: [],
    optimization_score: null,
    started_at: null,
    completed_at: null,
    created_at: '2026-09-01T10:00:00.000Z',
    updated_at: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

function reset(status: string, extra: Record<string, unknown> = {}) {
  supabaseMock.reset({
    users: [{ id: 'admin-1', role: 'admin', is_active: true }],
    routes: [route(status, extra)],
    route_stops: [],
    vehicles: [],
  });
}

const del = (id: string) => request(app).delete(`/api/v1/routes/${id}`).set('Authorization', `Bearer ${adminToken()}`);

describe('DELETE /routes/:id — safe delete', () => {
  beforeEach(() => reset('pending'));

  it('deletes a route that has not started yet (planned)', async () => {
    const res = await del('route-1');
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('routes')).toHaveLength(0);
  });

  it.each(['active', 'completed'])('refuses to delete a %s route with 409', async status => {
    reset(status);
    const res = await del('route-1');
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/can't be deleted/);
    expect(supabaseMock.rows('routes')).toHaveLength(1);
  });

  it('still allows deleting a cancelled route', async () => {
    reset('cancelled');
    const res = await del('route-1');
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('routes')).toHaveLength(0);
  });

  it('returns 404 for an unknown route', async () => {
    reset('pending');
    const res = await del('does-not-exist');
    expect(res.status).toBe(404);
  });
});
