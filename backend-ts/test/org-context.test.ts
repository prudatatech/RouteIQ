import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Request } from 'express';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';
import {
  attachOrgContext, companyIdFor, isOrgAdmin, isPlatformAdminOf, pickActive, requireOrg, requirePlatformAdmin, type Membership,
} from '../src/core/org-context';
import { ORG, ORGS, SEATS, as, orgById, orgWorld, uid } from './support/org-world';

const app = testApp();
const fakeReq = (orgId?: string) => ({ headers: orgId ? { 'x-org-id': orgId } : {} }) as unknown as Request;

describe('picking the active organisation', () => {
  const m = (org: string, role = 'owner'): Membership => ({ org: orgById(org) as any, role: role as any });

  it('takes the only membership, else the first logistic company, else the first', () => {
    expect(pickActive([m(ORG.vendorV)])?.org.id).toBe(ORG.vendorV);
    expect(pickActive([m(ORG.platform), m(ORG.vendorV), m(ORG.companyB)])?.org.id).toBe(ORG.companyB);
    expect(pickActive([m(ORG.vendorV), m(ORG.tplT)])?.org.id).toBe(ORG.vendorV);
    expect(pickActive([])).toBeNull();
  });

  it('honours a requested organisation and refuses a foreign one', () => {
    expect(pickActive([m(ORG.platform), m(ORG.companyA)], ORG.platform)?.org.id).toBe(ORG.platform);
    expect(() => pickActive([m(ORG.companyA)], ORG.companyB)).toThrow(/not a member/);
  });

  it('knows a platform admin from an ordinary member', () => {
    expect(isPlatformAdminOf([m(ORG.platform, 'admin')])).toBe(true);
    expect(isPlatformAdminOf([m(ORG.platform, 'ops')])).toBe(false);
    expect(isPlatformAdminOf([m(ORG.companyA, 'owner')])).toBe(false);
  });
});

describe('the organisation on a request', () => {
  beforeEach(() => supabaseMock.reset(orgWorld()));

  it('is the only one the user has', async () => {
    const req = fakeReq();
    const ctx = await attachOrgContext(req, uid('admin-b'), 'admin');
    expect(ctx.configured).toBe(true);
    expect(req.org).toMatchObject({ id: ORG.companyB, kind: 'logistic_company', name: 'Beta Freight' });
    expect(req.orgRole).toBe('owner');
    expect(req.memberships).toHaveLength(1);
    expect(req.isPlatformAdmin).toBe(false);
  });

  it('defaults to the company for someone who is also in the platform, and says they are a platform admin', async () => {
    const req = fakeReq();
    await attachOrgContext(req, uid('super-1'), 'superadmin');
    expect(req.org?.id).toBe(ORG.companyA);
    expect(req.isPlatformAdmin).toBe(true);
    expect(req.memberships!.map(m => m.org.kind)).toEqual(['logistic_company', 'platform']);
  });

  it('follows X-Org-Id', async () => {
    const req = fakeReq(ORG.platform);
    await attachOrgContext(req, uid('super-1'), 'superadmin');
    expect(req.org?.kind).toBe('platform');
    expect(req.orgRole).toBe('owner');
  });

  it('answers 403 for an X-Org-Id the user is not a member of, and 400 for one that is not an id', async () => {
    const token = supabaseMock.signUserToken(uid('admin-a'));
    const foreign = await request(app).get('/api/v1/users/me').set({ Authorization: `Bearer ${token}`, 'X-Org-Id': ORG.companyB });
    expect(foreign.status).toBe(403);
    expect(foreign.body.detail).toMatch(/not a member/i);
    const malformed = await request(app).get('/api/v1/users/me').set({ Authorization: `Bearer ${token}`, 'X-Org-Id': 'not-an-id' });
    expect(malformed.status).toBe(400);
    expect((await request(app).get('/api/v1/users/me').set(as('admin-a', ORG.companyA))).status).toBe(200);
  });

  it('does not accept a removed membership', async () => {
    supabaseMock.reset(orgWorld({}, { seats: SEATS.map(s => (s.user === 'admin-a' ? { ...s, status: 'removed' } : s)) }));
    const req = fakeReq();
    await attachOrgContext(req, uid('admin-a'), 'admin');
    expect(req.org).toBeNull();
    expect(req.memberships).toEqual([]);
  });

  it('is empty before organisations are set up', async () => {
    supabaseMock.reset(orgWorld({}, { configured: false }));
    const req = fakeReq(ORG.companyB);
    const ctx = await attachOrgContext(req, uid('admin-a'), 'admin');
    expect(ctx.configured).toBe(false);
    expect(req.org).toBeNull();
    expect(companyIdFor(req)).toBeNull();
  });

  it('is empty for a staff member who belongs to no organisation, and for a customer (who is not looked up)', async () => {
    const lone = fakeReq();
    await attachOrgContext(lone, uid('loner'), 'admin');
    expect(lone.org).toBeNull();
    supabaseMock.requests.length = 0;
    const customer = fakeReq();
    await attachOrgContext(customer, 'c0000000-0000-4000-8000-000000000001', 'customer');
    expect(customer.org).toBeNull();
    expect(supabaseMock.requests.filter(u => u.pathname === '/rest/v1/org_members')).toHaveLength(0);
  });

  it('stops a suspended organisation from working, but still lets it reach /org and /orgs', async () => {
    const world = orgWorld();
    for (const o of world.organizations) if (o.id === ORG.companyA) o.status = 'suspended';
    for (const mem of world.org_members) if (mem.org_id === ORG.companyA) mem.organizations = { ...mem.organizations, status: 'suspended' };
    supabaseMock.reset(world);
    const blocked = await request(app).get('/api/v1/users/me').set(as('admin-a'));
    expect(blocked.status).toBe(403);
    expect(blocked.body.detail).toMatch(/suspended/);
    // an organisation route is let through the block (it answers 404 until the routes exist, never 403)
    expect((await request(app).get('/api/v1/org').set(as('admin-a'))).status).not.toBe(403);
  });

  it('keeps the memberships of a user for the next request', async () => {
    await attachOrgContext(fakeReq(), uid('admin-b'), 'admin');
    const first = supabaseMock.requests.filter(u => u.pathname === '/rest/v1/org_members').length;
    await attachOrgContext(fakeReq(), uid('admin-b'), 'admin');
    expect(supabaseMock.requests.filter(u => u.pathname === '/rest/v1/org_members').length).toBe(first);
  });

  it('lets customer tokens through without an organisation', async () => {
    const token = createAccessToken({ sub: 'c0000000-0000-4000-8000-000000000001', role: 'customer' });
    const res = await request(app).get('/api/v1/customer/profile').set({ Authorization: `Bearer ${token}` });
    expect(res.status).not.toBe(403);
  });
});

describe('what handlers use', () => {
  beforeEach(() => supabaseMock.reset(orgWorld()));

  it('requireOrg answers the organisation, or a 403 with none', async () => {
    const req = fakeReq();
    await attachOrgContext(req, uid('admin-a'), 'admin');
    expect(requireOrg(req).id).toBe(ORG.companyA);
    const none = fakeReq();
    await attachOrgContext(none, uid('loner'), 'admin');
    expect(() => requireOrg(none)).toThrow(/not a member/);
  });

  it('companyIdFor gives the id of a logistic company, and null for any other organisation', async () => {
    const company = fakeReq();
    await attachOrgContext(company, uid('admin-a'), 'admin');
    expect(companyIdFor(company)).toBe(ORG.companyA);
    for (const [who, org] of [['super-1', ORG.platform], ['vendor-1', ORG.vendorV], ['tpl-1', ORG.tplT]] as const) {
      const req = fakeReq(org);
      await attachOrgContext(req, uid(who), 'vendor');
      expect(companyIdFor(req)).toBeNull();
    }
  });

  it('isOrgAdmin is true for an owner or admin of the active organisation only', async () => {
    const check = async (who: string) => { const req = fakeReq(); await attachOrgContext(req, uid(who), 'admin'); return isOrgAdmin(req); };
    expect(await check('admin-a')).toBe(true);
    expect(await check('super-1')).toBe(true);
    expect(await check('manager-a')).toBe(false);
    expect(await check('driver-a')).toBe(false);
    expect(await check('loner')).toBe(false);
  });

  it('requirePlatformAdmin lets a platform admin through, whichever organisation they act as', async () => {
    const run = async (who: string, org?: string) => {
      const req = fakeReq(org);
      await attachOrgContext(req, uid(who), 'admin');
      let status = 0; let passed = false;
      requirePlatformAdmin(req, { status: (s: number) => { status = s; return { json: () => undefined }; } } as any, () => { passed = true; });
      return passed ? 200 : status;
    };
    expect(await run('super-1')).toBe(200);
    expect(await run('super-1', ORG.companyA)).toBe(200);
    expect(await run('admin-a')).toBe(403);
    expect(await run('vendor-1')).toBe(403);
  });
});

describe('the test world', () => {
  it('has every organisation kind', () => {
    expect(new Set(ORGS.map(o => o.kind))).toEqual(new Set(['platform', 'logistic_company', 'vendor', 'tpl_partner']));
  });
});
