import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';

const app = testApp();
const superadminToken = () => supabaseMock.signUserToken('super-1');
const adminToken = () => supabaseMock.signUserToken('admin-1');

function logEntry(id: string, createdAt: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    agent_name: 'dispatcher-agent',
    action: 'reassigned vehicle',
    input_data: null,
    output_data: 'ok',
    status: 'success',
    duration_ms: 120,
    vehicle_id: null,
    route_id: null,
    created_at: createdAt,
    ...overrides,
  };
}

function reset(logs: ReturnType<typeof logEntry>[]) {
  supabaseMock.reset({
    users: [
      { id: 'super-1', role: 'superadmin', is_active: true },
      { id: 'admin-1', role: 'admin', is_active: true },
    ],
    ai_agent_logs: logs,
  });
}

const get = (qs = '', token = superadminToken()) =>
  request(app).get(`/api/v1/analytics/audit-logs${qs}`).set('Authorization', `Bearer ${token}`);

describe('GET /analytics/audit-logs', () => {
  it('refuses non-superadmins', async () => {
    reset([logEntry('log-1', '2026-09-20T10:00:00.000Z')]);
    const res = await get('', adminToken());
    expect(res.status).toBe(403);
  });

  it('pages through results with limit/offset and reports hasMore', async () => {
    const logs = Array.from({ length: 5 }, (_, i) =>
      logEntry(`log-${i}`, new Date(2026, 8, 20, 10, i).toISOString()));
    reset(logs);

    const first = await get('?limit=2&offset=0');
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.hasMore).toBe(true);

    const second = await get('?limit=2&offset=4');
    expect(second.status).toBe(200);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.hasMore).toBe(false);
  });

  it('filters by an IST date range', async () => {
    reset([
      logEntry('old', '2026-09-01T10:00:00.000Z'),
      logEntry('in-range', '2026-09-15T10:00:00.000Z'),
      logEntry('new', '2026-09-25T10:00:00.000Z'),
    ]);

    const res = await get('?from=2026-09-10&to=2026-09-20');
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual(['in-range']);
  });

  it('maps ai_agent_logs fields to the audit entry shape', async () => {
    reset([logEntry('log-1', '2026-09-20T10:00:00.000Z', { agent_name: 'route-agent', status: 'failed' })]);
    const res = await get();
    expect(res.body.items[0]).toMatchObject({ id: 'log-1', agent: 'route-agent', action: 'reassigned vehicle', status: 'failed' });
  });
});
