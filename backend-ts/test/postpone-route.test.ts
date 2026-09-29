import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';
import { invalidateDriverVehicles } from '../src/core/ownership';

const app = testApp();
const driver = createAccessToken({ sub: 'driver-1', role: 'driver' });
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const postpone = (token: string, body: object = { route_id: 'route-1' }) =>
  request(app).post('/api/v1/capacity/driver/postpone-route').set(bearer(token)).send(body);

beforeEach(() => {
  invalidateDriverVehicles();
  supabaseMock.reset({
    users: [
      { id: 'driver-1', role: 'driver', is_active: true, full_name: 'Ravi Kumar' },
      { id: 'admin-1', role: 'admin', is_active: true },
      { id: 'super-1', role: 'superadmin', is_active: true },
      { id: 'ex-admin', role: 'admin', is_active: false },
    ],
    vehicles: [{ id: 'veh-1', driver_id: 'driver-1' }],
    routes: [{ id: 'route-1', vehicle_id: 'veh-1', status: 'pending' }],
    notifications: [],
  });
});

describe('POST /capacity/driver/postpone-route', () => {
  it('tells every active staff member the driver postponed the route', async () => {
    const res = await postpone(driver);
    expect(res.status).toBe(200);
    const sent = supabaseMock.writes('notifications', 'POST');
    expect(sent.map((w) => w.body.user_id).sort()).toEqual(['admin-1', 'super-1']);
    expect(sent[0].body.type).toBe('route_postponed');
    expect(sent[0].body.body).toContain('Ravi Kumar');
  });

  it('refuses a route that belongs to another vehicle', async () => {
    supabaseMock.reset({
      users: [{ id: 'admin-1', role: 'admin', is_active: true }],
      vehicles: [{ id: 'veh-1', driver_id: 'someone-else' }],
      routes: [{ id: 'route-1', vehicle_id: 'veh-1', status: 'pending' }],
      notifications: [],
    });
    expect((await postpone(driver)).status).toBe(403);
    expect(supabaseMock.writes('notifications', 'POST')).toEqual([]);
  });

  it('needs a route id', async () => {
    expect((await postpone(driver, {})).status).toBe(400);
  });

  it('is for drivers only', async () => {
    const admin = createAccessToken({ sub: 'admin-1', role: 'admin' });
    expect((await postpone(admin)).status).toBe(403);
  });
});
