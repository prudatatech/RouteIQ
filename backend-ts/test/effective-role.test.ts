import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { appRoleFor, type Membership } from '../src/core/org-context';
import { ORG, ORGS, SEATS, as, memberRow, orgById, orgWorld, uid, type Seat } from './support/org-world';

const app = testApp();
const ORG_ACTIVE_NEWCO = 'a0000000-0000-4000-8000-0000000000e5';

/** A vendor-registered owner ('founder') of a company that is `status`, on top of the standard world. */
function worldWithFounder(status: string, extra: Record<string, any[]> = {}) {
  const base = orgWorld();
  return {
    ...base,
    users: [...base.users, { id: uid('founder'), role: 'vendor', full_name: 'Fay Founder', email: 'fay@example.test', is_active: true }],
    organizations: [...base.organizations, { id: ORG_ACTIVE_NEWCO, kind: 'logistic_company', name: 'Newco Logistics', status, profile: {}, created_at: '2026-10-01T00:00:00Z' }],
    org_members: [...base.org_members, {
      org_id: ORG_ACTIVE_NEWCO, user_id: uid('founder'), role: 'owner', status: 'active', created_at: '2026-10-01T00:00:00Z',
      organizations: { id: ORG_ACTIVE_NEWCO, kind: 'logistic_company', name: 'Newco Logistics', status },
    }],
    ...extra,
  };
}

const m = (org: string, role: string): Membership => ({ org: orgById(org) as any, role: role as any });

describe('appRoleFor', () => {
  it('maps the platform and company roles', () => {
    expect(appRoleFor(m(ORG.platform, 'owner'), 'vendor')).toBe('superadmin');
    expect(appRoleFor(m(ORG.platform, 'admin'), 'vendor')).toBe('superadmin');
    expect(appRoleFor(m(ORG.platform, 'ops'), 'superadmin')).toBe('admin');
    expect(appRoleFor(m(ORG.companyA, 'owner'), 'vendor')).toBe('admin');
    expect(appRoleFor(m(ORG.companyA, 'admin'), 'vendor')).toBe('admin');
    for (const r of ['ops', 'dispatcher', 'finance', 'member']) expect(appRoleFor(m(ORG.companyA, r), 'vendor')).toBe('manager');
    expect(appRoleFor(m(ORG.companyA, 'driver'), 'vendor')).toBe('driver');
    expect(appRoleFor(m(ORG.vendorV, 'owner'), 'admin')).toBe('vendor');
    expect(appRoleFor(m(ORG.tplT, 'owner'), 'superadmin')).toBe('vendor');
  });

  it('falls back to users.role without a membership', () => {
    expect(appRoleFor(null, 'admin')).toBe('admin');
  });

  it('gives no staff role in an organisation that is not active', () => {
    for (const status of ['pending', 'rejected', 'suspended']) {
      const pending = { org: { ...orgById(ORG.companyA), status }, role: 'owner' } as any;
      expect(appRoleFor(pending, 'vendor')).toBe('vendor');
      expect(appRoleFor(pending, 'admin')).toBe('vendor');
    }
  });
});

describe('the effective role on requests', () => {
  beforeEach(() => supabaseMock.reset(worldWithFounder('active')));

  it('lets a vendor-registered owner of an approved company use the staff endpoints, money included', async () => {
    expect((await request(app).get('/api/v1/ops/today').set(as('founder'))).status).toBe(200);
    expect((await request(app).get('/api/v1/finance/unpriced').set(as('founder'))).status).toBe(200);
  });

  it('tells the web app the effective role', async () => {
    const me = await request(app).get('/api/v1/users/me').set(as('founder'));
    expect(me.body).toMatchObject({ role: 'vendor', effective_role: 'admin', org: { id: ORG_ACTIVE_NEWCO, role: 'owner' } });
    const mine = await request(app).get('/api/v1/orgs/mine').set(as('founder'));
    expect(mine.body[0]).toMatchObject({ role: 'owner', app_role: 'admin' });
  });

  it('gives no staff access while the company is pending', async () => {
    supabaseMock.reset(worldWithFounder('pending'));
    expect((await request(app).get('/api/v1/ops/today').set(as('founder'))).status).toBe(403);
    expect((await request(app).get('/api/v1/finance/unpriced').set(as('founder'))).status).toBe(403);
    const mine = await request(app).get('/api/v1/orgs/mine').set(as('founder'));
    expect(mine.body[0].app_role).toBe('vendor');
  });

  it('gives a company ops member manager rights, and Money stays refused', async () => {
    expect((await request(app).get('/api/v1/ops/today').set(as('manager-a'))).status).toBe(200);
    expect((await request(app).get('/api/v1/finance/unpriced').set(as('manager-a'))).status).toBe(403);
    // Even when their account says admin, the membership decides
    supabaseMock.reset(orgWorld({}, { seats: SEATS.map((s: Seat) => (s.user === 'admin-a' ? { ...s, role: 'ops' } : s)) }));
    expect((await request(app).get('/api/v1/finance/unpriced').set(as('admin-a'))).status).toBe(403);
    expect((await request(app).get('/api/v1/ops/today').set(as('admin-a'))).status).toBe(200);
  });

  it('gives a superadmin acting as a company admin powers, not platform powers', async () => {
    const asCompany = await request(app).get('/api/v1/users/me').set(as('super-1', ORG.companyA));
    expect(asCompany.body.effective_role).toBe('admin');
    const asPlatform = await request(app).get('/api/v1/users/me').set(as('super-1', ORG.platform));
    expect(asPlatform.body.effective_role).toBe('superadmin');
    // Reading a person's bank account number is superadmin-only: refused as a company, allowed as the platform
    const reveal = '/api/v1/people/00000000-0000-4000-8000-000000000001/bank-accounts/00000000-0000-4000-8000-000000000002/reveal';
    expect((await request(app).post(reveal).set(as('super-1', ORG.companyA)).send({})).status).toBe(403);
    expect((await request(app).post(reveal).set(as('super-1', ORG.platform)).send({})).status).not.toBe(403);
  });

  it('falls back to users.role without a membership', () => {
    expect(appRoleFor(null, 'admin')).toBe('admin');
  });

  it('gives no staff role in an organisation that is not active', () => {
    for (const status of ['pending', 'rejected', 'suspended']) {
      const pending = { org: { ...orgById(ORG.companyA), status }, role: 'owner' } as any;
      expect(appRoleFor(pending, 'vendor')).toBe('vendor');
      expect(appRoleFor(pending, 'admin')).toBe('vendor');
    }
  });
});

describe('the effective role on requests', () => {
  beforeEach(() => supabaseMock.reset(worldWithFounder('active')));

  it('lets a vendor-registered owner of an approved company use the staff endpoints, money included', async () => {
    expect((await request(app).get('/api/v1/ops/today').set(as('founder'))).status).toBe(200);
    expect((await request(app).get('/api/v1/finance/unpriced').set(as('founder'))).status).toBe(200);
  });

  it('tells the web app the effective role', async () => {
    const me = await request(app).get('/api/v1/users/me').set(as('founder'));
    expect(me.body).toMatchObject({ role: 'vendor', effective_role: 'admin', org: { id: ORG_ACTIVE_NEWCO, role: 'owner' } });
    const mine = await request(app).get('/api/v1/orgs/mine').set(as('founder'));
    expect(mine.body[0]).toMatchObject({ role: 'owner', app_role: 'admin' });
  });

  it('gives no staff access while the company is pending', async () => {
    supabaseMock.reset(worldWithFounder('pending'));
    expect((await request(app).get('/api/v1/ops/today').set(as('founder'))).status).toBe(403);
    expect((await request(app).get('/api/v1/finance/unpriced').set(as('founder'))).status).toBe(403);
    const mine = await request(app).get('/api/v1/orgs/mine').set(as('founder'));
    expect(mine.body[0].app_role).toBe('vendor');
  });

  it('gives a company ops member manager rights, and Money stays refused', async () => {
    expect((await request(app).get('/api/v1/ops/today').set(as('manager-a'))).status).toBe(200);
    expect((await request(app).get('/api/v1/finance/unpriced').set(as('manager-a'))).status).toBe(403);
    // Even when their account says admin, the membership decides
    supabaseMock.reset(orgWorld({}, { seats: SEATS.map((s: Seat) => (s.user === 'admin-a' ? { ...s, role: 'ops' } : s)) }));
    expect((await request(app).get('/api/v1/finance/unpriced').set(as('admin-a'))).status).toBe(403);
    expect((await request(app).get('/api/v1/ops/today').set(as('admin-a'))).status).toBe(200);
  });

  it('gives a superadmin acting as a company admin powers, not platform powers', async () => {
    const asCompany = await request(app).get('/api/v1/users/me').set(as('super-1', ORG.companyA));
    expect(asCompany.body.effective_role).toBe('admin');
    const asPlatform = await request(app).get('/api/v1/users/me').set(as('super-1', ORG.platform));
    expect(asPlatform.body.effective_role).toBe('superadmin');
    // Settings and KYC-type endpoints are superadmin-only: refused as a company, open as the platform
    const path = '/api/v1/users/';
    expect((await request(app).get(path).set(as('super-1', ORG.companyA))).status).toBe(200); // admin may list
  });

  it('falls back to users.role without a membership or without organisations', async () => {
    supabaseMock.reset(orgWorld({}, { seats: SEATS.filter(s => s.user !== 'admin-a') }));
    const me = await request(app).get('/api/v1/users/me').set(as('admin-a'));
    expect(me.body.effective_role).toBe('admin');
    expect((await request(app).get('/api/v1/finance/unpriced').set(as('admin-a'))).status).toBe(200);
    supabaseMock.reset(orgWorld({}, { configured: false }));
    expect((await request(app).get('/api/v1/users/me').set(as('manager-a'))).body.effective_role).toBe('manager');
  });
});

describe('only the platform grants superadmin', () => {
  beforeEach(() => {
    supabaseMock.reset(orgWorld({
      user_profiles: [], user_documents: [], user_activity: [], user_status_history: [], user_phone_history: [], user_bank_accounts: [],
      user_emergency_contacts: [], user_notes: [], vehicles: [], routes: [], driver_vehicle_assignments: [], route_stops: [], shipments: [], depots: [], tpl_partners: [],
    }));
    supabaseMock.authAdmin = true;
  });
  const newSuper = { role: 'superadmin', full_name: 'Big Boss', email: 'boss@example.test' };

  it('a company admin cannot create, or promote someone to, superadmin', async () => {
    expect((await request(app).post('/api/v1/people').set(as('admin-a', ORG.companyA)).send(newSuper)).status).toBe(403);
    expect((await request(app).patch(`/api/v1/people/${uid('manager-a')}`).set(as('admin-a', ORG.companyA)).send({ role: 'superadmin' })).status).toBe(403);
    expect((await request(app).patch(`/api/v1/users/${uid('manager-a')}`).set(as('admin-a', ORG.companyA)).send({ role: 'superadmin' })).status).toBe(403);
    expect(supabaseMock.rows('users').find(u => u.id === uid('manager-a'))!.role).toBe('manager');
  });

  it('a superadmin acting as a company cannot either', async () => {
    expect((await request(app).post('/api/v1/people').set(as('super-1', ORG.companyA)).send(newSuper)).status).toBe(403);
    expect((await request(app).patch(`/api/v1/people/${uid('manager-a')}`).set(as('super-1', ORG.companyA)).send({ role: 'superadmin' })).status).toBe(403);
  });

  it('the platform owner can', async () => {
    supabaseMock.authUsers.push({ id: uid('manager-a'), email: 'm@x.in', app_metadata: {}, user_metadata: {}, confirmed: true });
    expect((await request(app).post('/api/v1/people').set(as('super-1', ORG.platform)).send(newSuper)).status).toBe(201);
    expect((await request(app).patch(`/api/v1/people/${uid('manager-a')}`).set(as('super-1', ORG.platform)).send({ role: 'superadmin' })).status).toBe(200);
    expect(supabaseMock.rows('users').find(u => u.id === uid('manager-a'))!.role).toBe('superadmin');
  });

  it('a platform member below admin has no platform powers', () => {
    expect(appRoleFor({ org: orgById(ORG.platform) as any, role: 'ops' }, 'superadmin')).toBe('admin');
  });
});

describe('the membership trigger (supabase/migrations/20261002040000_superadmin_guard.sql)', () => {
  const sql = readFileSync(join(__dirname, '../../supabase/migrations/20261002040000_superadmin_guard.sql'), 'utf8')
    .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

  it('replaces app.sync_user_membership and no longer touches the platform organisation', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION app\.sync_user_membership/);
    expect(sql).not.toMatch(/platform/i);
    expect(sql).not.toMatch(/DELETE|UPDATE public\.org_members/i);
  });

  it('still keeps the company membership in step with the app role', () => {
    expect(sql).toMatch(/INSERT INTO public\.org_members \(org_id, user_id, role, status\) VALUES \(company/);
  });
});
