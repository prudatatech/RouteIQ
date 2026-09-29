import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { createApp } from '../src/app';

const app = createApp();
const adminToken = () => supabaseMock.signUserToken('admin-1');

function vehicle(status: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'veh-1',
    plate_number: 'MH01AB1234',
    vehicle_type: 'truck',
    capacity_kg: 5000,
    fuel_type: 'diesel',
    status,
    ...overrides,
  };
}

function reset(status: string, routes: Record<string, unknown>[] = []) {
  supabaseMock.reset({
    users: [{ id: 'admin-1', role: 'admin', is_active: true }],
    vehicles: [vehicle(status)],
    routes,
    route_stops: [],
    telemetry: [],
    maintenance_alerts: [],
    vehicle_stoppages: [],
    gps_points: [],
  });
}

const del = (id: string) => request(app).delete(`/api/v1/vehicles/${id}`).set('Authorization', `Bearer ${adminToken()}`);

describe('DELETE /vehicles/:id — refuses while on an active route', () => {
  beforeEach(() => reset('available'));

  it('deletes an available vehicle with no routes', async () => {
    const res = await del('veh-1');
    expect(res.status).toBe(204);
    expect(supabaseMock.rows('vehicles')).toHaveLength(0);
  });

  it('refuses to delete a vehicle whose status is on_route', async () => {
    reset('on_route');
    const res = await del('veh-1');
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/active route/);
    expect(supabaseMock.rows('vehicles')).toHaveLength(1);
  });

  it.each(['active', 'in_progress'])('refuses to delete a vehicle with a %s route', async routeStatus => {
    reset('available', [{ id: 'route-1', vehicle_id: 'veh-1', status: routeStatus }]);
    const res = await del('veh-1');
    expect(res.status).toBe(409);
    expect(supabaseMock.rows('vehicles')).toHaveLength(1);
  });

  it('allows deleting a vehicle whose route is completed', async () => {
    reset('available', [{ id: 'route-1', vehicle_id: 'veh-1', status: 'completed' }]);
    const res = await del('veh-1');
    expect(res.status).toBe(204);
  });

  it('returns 404 for an unknown vehicle', async () => {
    reset('available');
    const res = await del('does-not-exist');
    expect(res.status).toBe(404);
  });
});
