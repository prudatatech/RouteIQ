import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';
import enums from './support/db-enums.json';
import { SHIPMENT_STATUSES } from '../src/routes/dashboard.routes';

const app = testApp();
const as = (sub: string, role: string) => ({ Authorization: `Bearer ${createAccessToken({ sub, role })}` });
const admin = as('admin-1', 'admin');
const get = (auth?: object) => request(app).get('/api/v1/dashboard/shipment-counts').set(auth ?? {});

beforeEach(() => {
  const rows = [
    ...Array.from({ length: 250 }, (_, i) => ({ id: `c${i}`, status: 'created' })),
    { id: 'p1', status: 'picked_up' },
    { id: 't1', status: 'in_transit' },
    { id: 't2', status: 'in_transit' },
    { id: 'd1', status: 'delivered' },
    { id: 'x1', status: 'cancelled' },
  ];
  supabaseMock.reset({
    users: [
      { id: 'admin-1', role: 'admin', is_active: true },
      { id: 'vendor-1', role: 'vendor', is_active: true },
      { id: 'driver-1', role: 'driver', is_active: true },
    ],
    shipments: rows,
  });
});

describe('GET /dashboard/shipment-counts', () => {
  it('counts every shipment per status, beyond a list page', async () => {
    const res = await get(admin);
    expect(res.status).toBe(200);
    expect(res.body.counts).toEqual({
      created: 250, assigned: 0, picked_up: 1, in_transit: 2, delivered: 1, cancelled: 1, exception: 0,
    });
    expect(res.body.total).toBe(255);
  });

  it('covers every status the database allows', () => {
    expect([...SHIPMENT_STATUSES].sort()).toEqual([...enums['shipments.status']].sort());
  });

  it('needs a signed-in staff member', async () => {
    expect((await get()).status).toBe(401);
    expect((await get(as('vendor-1', 'vendor'))).status).toBe(403);
    expect((await get(as('driver-1', 'driver'))).status).toBe(403);
  });
});
