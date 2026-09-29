import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';

const app = testApp();
const admin = () => ({ Authorization: `Bearer ${supabaseMock.signUserToken('admin-1')}` });

describe('GET /analytics/insights', () => {
  beforeEach(() => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
    supabaseMock.reset({
      users: [{ id: 'admin-1', role: 'admin', is_active: true }],
      routes: [],
      route_stops: [],
      telemetry: [],
      vehicles: [{ id: 'veh-1', plate_number: 'MH01AB1234', status: 'idle', updated_at: twoDaysAgo }],
    });
  });

  it('reports real conditions only, with no invented score or trend', async () => {
    const res = await request(app).get('/api/v1/analytics/insights').set(admin());
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ type: 'idle_vehicle', vehicle_id: 'veh-1' });
    for (const insight of res.body) {
      expect(insight).not.toHaveProperty('score');
      expect(insight).not.toHaveProperty('trend');
      expect(['fuel_efficiency', 'maintenance_due']).not.toContain(insight.type);
    }
  });
});
