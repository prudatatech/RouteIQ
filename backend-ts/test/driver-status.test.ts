import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';
import { upcomingTrips } from '../src/services/driver-status.service';

const app = testApp();
const as = (sub: string, role: string) => ({ Authorization: `Bearer ${createAccessToken({ sub, role })}` });
const get = (auth: object) => request(app).get('/api/v1/telemetry/driver-ping/my-status').set(auth);

const route = (id: string, created_at: string, status: string, names: string[]) => ({
  id,
  status,
  created_at,
  route_stops: names.map((name, i) => ({ status: 'pending', sequence: i + 1, delivery_points: { name } })),
});

const fixtures = (overrides: Record<string, unknown[]> = {}) => ({
  users: [
    { id: 'driver-1', role: 'driver', is_active: true, status: 'active' },
    { id: 'admin-1', role: 'admin', is_active: true },
  ],
  vehicles: [{ id: 'veh-1', driver_id: 'driver-1', capacity_kg: 1000, vehicle_type: 'truck' }],
  sos_alerts: [],
  routes: [],
  user_documents: [],
  system_settings: [],
  ...overrides,
});

describe('upcomingTrips', () => {
  it('leaves out the trip my-route shows and lists the other sent trips oldest first, never an unsent one', () => {
    const list = upcomingTrips([
      route('newest', '2026-09-30T10:00:00Z', 'active', ['A']),
      route('older', '2026-09-30T09:00:00Z', 'active', ['B', 'C']),
      route('oldest', '2026-09-30T08:00:00Z', 'active', ['D']),
      route('unsent', '2026-09-30T07:00:00Z', 'pending', ['E']),
      { id: 'empty', status: 'pending', created_at: '2026-09-30T11:00:00Z', route_stops: [] },
    ]);
    expect(list.map(t => t.id)).toEqual(['oldest', 'older']);
    expect(list[1]).toEqual({ id: 'older', stops: 2, first_stop: 'B', created_at: '2026-09-30T09:00:00Z' });
  });

  it('is empty with one trip', () => {
    expect(upcomingTrips([route('only', '2026-09-30T10:00:00Z', 'active', ['A'])])).toEqual([]);
  });
});

describe('GET /telemetry/driver-ping/my-status', () => {
  beforeEach(() => supabaseMock.reset(fixtures()));

  it('is for drivers only', async () => {
    expect((await get(as('admin-1', 'admin'))).status).toBe(403);
  });

  it('reports nothing when all is well', async () => {
    const res = await get(as('driver-1', 'driver'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ open_sos: null, dispatch_blocked: [], upcoming: [] });
  });

  it('reports an open SOS', async () => {
    supabaseMock.reset(
      fixtures({ sos_alerts: [{ id: 'sos-1', driver_id: 'driver-1', status: 'active', alert_type: 'accident', created_at: '2026-09-30T10:00:00Z' }] }),
    );
    const res = await get(as('driver-1', 'driver'));
    expect(res.body.open_sos).toEqual({ id: 'sos-1', status: 'active', alert_type: 'accident', created_at: '2026-09-30T10:00:00Z' });
  });

  it('reports a missing licence only when documents block dispatch', async () => {
    expect((await get(as('driver-1', 'driver'))).body.dispatch_blocked).toEqual([]);
    supabaseMock.reset(fixtures({ system_settings: [{ key: 'driver_document_enforcement', value: { value: 'block' } }] }));
    expect((await get(as('driver-1', 'driver'))).body.dispatch_blocked).toEqual(['licence_missing']);
  });
});
