import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';
import enums from './support/db-enums.json';
import { SHIPMENT_STATUSES } from '../src/routes/dashboard.routes';
import { ORG, as as orgAuth, orgWorld } from './support/org-world';

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
      out_for_delivery: 0, at_hub: 0, partially_delivered: 0, on_hold: 0, returning: 0, returned: 0, lost: 0,
    });
    expect(res.body.total).toBe(255);
    expect(supabaseMock.rpcCalls).toEqual([{ name: 'dashboard_shipment_counts', fn: 'dashboard_shipment_counts', args: { p_carrier_org_id: null } }]);
  });

  it('excludes split masters and merges vendor load statuses', async () => {
    supabaseMock.rows('shipments').push({ id: 'master', status: 'created', is_master: true });
    supabaseMock.rows('cargo_manifest').push(
      { id: 'm1', status: 'scheduled', is_master: false },
      { id: 'm2', status: 'completed', is_master: false },
      { id: 'm3', status: 'delivered', is_master: false },
      { id: 'mm', status: 'scheduled', is_master: true },
    );
    const res = await get(admin);
    expect(res.body.counts.created).toBe(251);
    expect(res.body.counts.delivered).toBe(3);
    expect(res.body.total).toBe(258);
  });

  it('returns an error when database aggregation fails', async () => {
    supabaseMock.onRpc('dashboard_shipment_counts', () => ({ __rpcError: 'aggregation failed' }));
    expect((await get(admin)).status).toBe(500);
  });

  it('passes the server-resolved company scope and keeps platform counts separate', async () => {
    supabaseMock.reset(orgWorld({
      shipments: [
        { id: 's-a', status: 'created', carrier_org_id: ORG.companyA },
        { id: 's-b', status: 'delivered', carrier_org_id: ORG.companyB },
      ],
      cargo_manifest: [{ id: 'm-b', status: 'scheduled', carrier_org_id: ORG.companyB }],
    }));
    const company = await get(orgAuth('admin-a'));
    expect(company.body.total).toBe(1);
    expect(supabaseMock.rpcCalls.at(-1)?.args).toEqual({ p_carrier_org_id: ORG.companyA });
    const platform = await get(orgAuth('super-1', ORG.platform));
    expect(platform.body.total).toBe(3);
    expect(supabaseMock.rpcCalls.at(-1)?.args).toEqual({ p_carrier_org_id: null });
    const noMembership = await get(orgAuth('loner'));
    expect(noMembership.body.total).toBe(0);
    expect(supabaseMock.rpcCalls.at(-1)?.args.p_carrier_org_id).toBe('00000000-0000-0000-0000-000000000000');
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
