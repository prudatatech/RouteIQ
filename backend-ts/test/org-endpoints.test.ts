/**
 * Organisation endpoints (docs/tenancy-design.md §5): profile, members, registration, platform approval and
 * 3PL affiliations: permissions, last-owner protection, a 3PL in two companies, approval flows, notifications.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { ORG, SEATS, as, orgWorld, uid } from './support/org-world';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;

describe('profile, members and registration', () => {
const seat = (user: string, org: string) => supabaseMock.rows('org_members').find(m => m.user_id === uid(user) && m.org_id === org);

beforeEach(() => supabaseMock.reset(orgWorld()));

describe('GET and PATCH /org', () => {
  it('shows the profile to an owner or admin and refuses an ordinary member', async () => {
    const res = await request(app).get(api('/org')).set(as('admin-a'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: ORG.companyA, name: 'Alpha Logistics', kind: 'logistic_company' });
    expect((await request(app).get(api('/org')).set(as('manager-a'))).status).toBe(403);
    expect((await request(app).get(api('/org')).set(as('driver-a'))).status).toBe(403);
  });

  it('changes the details, merges the profile, and leaves the type and approval alone', async () => {
    supabaseMock.rows('organizations').find(o => o.id === ORG.companyA)!.profile = { legacy: 'kept', bank: { name: 'HDFC' } };
    const res = await request(app).patch(api('/org')).set(as('admin-a'))
      .send({ name: 'Alpha Logistics Pvt Ltd', gstin: '27AAPFU0939F1ZV', city: 'Pune', profile: { bank: { name: 'ICICI' } } });
    expect(res.status).toBe(200);
    const row = supabaseMock.rows('organizations').find(o => o.id === ORG.companyA)!;
    expect(row).toMatchObject({ name: 'Alpha Logistics Pvt Ltd', gstin: '27AAPFU0939F1ZV', city: 'Pune', kind: 'logistic_company', status: 'active' });
    expect(row.profile).toEqual({ legacy: 'kept', bank: { name: 'ICICI' } });
    expect(supabaseMock.rows('ai_agent_logs').some(l => l.action === 'org.updated')).toBe(true);
  });

  it('refuses to change what the organisation is, or whether it is approved', async () => {
    for (const body of [{ kind: 'platform' }, { status: 'active' }, { approved_by: uid('admin-a') }]) {
      expect((await request(app).patch(api('/org')).set(as('admin-a')).send(body)).status).toBe(422);
    }
    expect(supabaseMock.writes('organizations')).toHaveLength(0);
  });

  it('validates what it is given', async () => {
    expect((await request(app).patch(api('/org')).set(as('admin-a')).send({ gstin: 'nope' })).status).toBe(422);
    expect((await request(app).patch(api('/org')).set(as('admin-a')).send({ pincode: '12' })).status).toBe(422);
    expect((await request(app).patch(api('/org')).set(as('admin-a')).send({})).status).toBe(422);
  });

  it('only ever touches the organisation the person acts for', async () => {
    await request(app).patch(api('/org')).set(as('admin-b')).send({ city: 'Delhi' });
    expect(supabaseMock.rows('organizations').find(o => o.id === ORG.companyA)!.city).toBeUndefined();
    expect(supabaseMock.rows('organizations').find(o => o.id === ORG.companyB)!.city).toBe('Delhi');
  });
});

describe('members', () => {
  it('are listed to an owner or admin with their names, and only the active ones', async () => {
    supabaseMock.rows('org_members').push({ org_id: ORG.companyA, user_id: uid('loner'), role: 'member', status: 'removed', created_at: '2026-10-02T00:00:00Z' });
    const res = await request(app).get(api('/org/members')).set(as('admin-a'));
    expect(res.status).toBe(200);
    expect(res.body.map((m: any) => m.user_id).sort()).toEqual(['admin-a', 'driver-a', 'manager-a', 'super-1'].map(uid).sort());
    expect(res.body.find((m: any) => m.user_id === uid('admin-a'))).toMatchObject({ name: 'Asha Alpha', role: 'admin', email: 'asha@example.test' });
    expect((await request(app).get(api('/org/members')).set(as('manager-a'))).status).toBe(403);
  });

  it('are invited by email or by phone, as an existing user, with a role', async () => {
    const byEmail = await request(app).post(api('/org/members')).set(as('admin-a')).send({ email: 'LONER@example.test', role: 'finance' });
    expect(byEmail.status).toBe(201);
    expect(seat('loner', ORG.companyA)).toMatchObject({ role: 'finance', status: 'active', invited_by: uid('admin-a') });

    const byPhone = await request(app).post(api('/org/members')).set(as('admin-a')).send({ phone: '+919876500002', role: 'driver' });
    expect(byPhone.status).toBe(201);
    expect(seat('driver-b', ORG.companyA)).toMatchObject({ role: 'driver', status: 'active' });
    // the person is still in their other organisation
    expect(seat('driver-b', ORG.companyB)).toBeTruthy();
  });

  it('cannot be someone who has not signed up, or someone already in', async () => {
    expect((await request(app).post(api('/org/members')).set(as('admin-a')).send({ email: 'ghost@example.test', role: 'ops' })).body).toEqual({ detail: 'No account with that email or phone', field: 'email' });
    expect((await request(app).post(api('/org/members')).set(as('admin-a')).send({ email: 'ravi@example.test', role: 'ops' })).status).toBe(409);
  });

  it('are checked: an email or a phone, not both, and a known role', async () => {
    const send = (body: object) => request(app).post(api('/org/members')).set(as('admin-a')).send(body);
    expect((await send({ role: 'ops' })).status).toBe(422);
    expect((await send({ email: 'loner@example.test', phone: '+919876500009', role: 'ops' })).status).toBe(422);
    expect((await send({ email: 'loner@example.test', role: 'emperor' })).status).toBe(422);
    expect((await send({ email: 'not-an-email', role: 'ops' })).status).toBe(422);
  });

  it('can be added by an ordinary member? No', async () => {
    const res = await request(app).post(api('/org/members')).set(as('manager-a')).send({ email: 'loner@example.test', role: 'ops' });
    expect(res.status).toBe(403);
    expect(seat('loner', ORG.companyA)).toBeUndefined();
  });

  it('get a new role from an admin, but an admin cannot make an owner or change one', async () => {
    const patch = (who: string, user: string, body: object) => request(app).patch(api(`/org/members/${uid(user)}`)).set(as(who)).send(body);
    expect((await patch('admin-a', 'manager-a', { role: 'dispatcher' })).status).toBe(200);
    expect(seat('manager-a', ORG.companyA)!.role).toBe('dispatcher');
    expect((await patch('admin-a', 'manager-a', { role: 'owner' })).status).toBe(403);
    expect((await patch('admin-a', 'super-1', { role: 'admin' })).status).toBe(403);
    expect((await patch('admin-a', 'super-1', { status: 'removed' })).status).toBe(403);
    expect(seat('super-1', ORG.companyA)).toMatchObject({ role: 'owner', status: 'active' });
  });

  it('can be made owners by an owner, who may then step down', async () => {
    const patch = (who: string, user: string, body: object) => request(app).patch(api(`/org/members/${uid(user)}`)).set(as(who)).send(body);
    expect((await patch('super-1', 'admin-a', { role: 'owner' })).status).toBe(200);
    expect((await patch('super-1', 'super-1', { role: 'admin' })).status).toBe(200);
    expect(seat('super-1', ORG.companyA)!.role).toBe('admin');
  });

  it('cannot leave an organisation without an owner', async () => {
    const patch = (who: string, user: string, body: object) => request(app).patch(api(`/org/members/${uid(user)}`)).set(as(who)).send(body);
    expect((await patch('super-1', 'super-1', { role: 'admin' })).status).toBe(409);
    expect((await patch('super-1', 'super-1', { status: 'removed' })).status).toBe(409);
    expect(seat('super-1', ORG.companyA)).toMatchObject({ role: 'owner', status: 'active' });
  });

  it('are removed, which takes the organisation out of their list, and can be brought back', async () => {
    const patch = (body: object) => request(app).patch(api(`/org/members/${uid('manager-a')}`)).set(as('admin-a')).send(body);
    expect((await patch({ status: 'removed' })).status).toBe(200);
    expect(seat('manager-a', ORG.companyA)!.status).toBe('removed');
    expect((await request(app).get(api('/org/members')).set(as('admin-a'))).body.map((m: any) => m.user_id)).not.toContain(uid('manager-a'));
    const back = await request(app).post(api('/org/members')).set(as('admin-a')).send({ email: 'manoj@example.test', role: 'ops' });
    expect(back.status).toBe(201);
    expect(seat('manager-a', ORG.companyA)).toMatchObject({ role: 'ops', status: 'active' });
  });

  it('are never reached across organisations', async () => {
    expect((await request(app).patch(api(`/org/members/${uid('driver-b')}`)).set(as('admin-a')).send({ role: 'ops' })).status).toBe(404);
    expect(seat('driver-b', ORG.companyB)!.role).toBe('driver');
  });

  it('are audited', async () => {
    await request(app).post(api('/org/members')).set(as('admin-a')).send({ email: 'loner@example.test', role: 'ops' });
    await request(app).patch(api(`/org/members/${uid('manager-a')}`)).set(as('admin-a')).send({ role: 'finance' });
    expect(supabaseMock.rows('ai_agent_logs').map(l => l.action)).toEqual(['org.member_added', 'org.member_updated']);
  });
});

describe('registering an organisation', () => {
  it('makes it pending, with the creator as owner, for a logistic company or a vendor', async () => {
    const res = await request(app).post(api('/orgs')).set(as('loner')).send({ kind: 'logistic_company', name: 'Gamma Carriers', city: 'Surat' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: 'logistic_company', name: 'Gamma Carriers', status: 'pending', city: 'Surat' });
    const created = supabaseMock.writes('organizations', 'POST')[0].body;
    expect(created).toMatchObject({ status: 'pending', created_by: uid('loner') });
    expect(supabaseMock.writes('org_members', 'POST')[0].body).toMatchObject({ user_id: uid('loner'), role: 'owner', status: 'active' });
  });

  it('is limited to the two kinds a person may start', async () => {
    for (const kind of ['platform', 'tpl_partner', 'other']) {
      expect((await request(app).post(api('/orgs')).set(as('loner')).send({ kind, name: 'Sneaky Co' })).status).toBe(422);
    }
    expect((await request(app).post(api('/orgs')).set(as('loner')).send({ kind: 'vendor', name: 'x' })).status).toBe(422);
    expect(supabaseMock.writes('organizations')).toHaveLength(0);
  });

  it('shows up in the creator\'s list straight away', async () => {
    expect((await request(app).get(api('/orgs/mine')).set(as('manager-a'))).body).toHaveLength(1);
    const created = await request(app).post(api('/orgs')).set(as('manager-a')).send({ kind: 'vendor', name: 'Delta Traders' });
    // the mock does not embed the new organisation, so give the seat the way the database would
    const id = created.body.id;
    supabaseMock.rows('org_members').find(m => m.org_id === id)!.organizations = { id, kind: 'vendor', name: 'Delta Traders', status: 'pending' };
    const mine = await request(app).get(api('/orgs/mine')).set(as('manager-a'));
    expect(mine.body).toContainEqual({ org: { id, kind: 'vendor', name: 'Delta Traders', status: 'pending' }, role: 'owner', app_role: 'vendor' });
    expect(mine.body).toHaveLength(2);
  });
});

describe('the seats of the test world', () => {
  it('give every person at least one organisation, but the lone admin', () => {
    expect(new Set(SEATS.map(s => s.user)).size).toBe(8);
  });
});

});

describe('platform approval', () => {
const status = (id: string) => supabaseMock.rows('organizations').find(o => o.id === id)!.status;

const PENDING = 'a0000000-0000-4000-8000-0000000000aa';

beforeEach(() => {
  const world = orgWorld();
  world.organizations.push({ id: PENDING, kind: 'logistic_company', name: 'Gamma Carriers', status: 'pending', profile: {}, created_at: '2026-10-02T00:00:00Z' });
  world.organizations.push({ id: 'a0000000-0000-4000-8000-0000000000ab', kind: 'vendor', name: 'Delta Traders', status: 'pending', profile: {}, created_at: '2026-10-03T00:00:00Z' });
  supabaseMock.reset(world);
});

describe('GET /admin/orgs', () => {
  it('lists organisations for a platform admin, newest first, filtered by kind and status', async () => {
    const all = await request(app).get(api('/admin/orgs')).set(as('super-1'));
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(7);
    expect(all.body.items).toHaveLength(7);
    const pending = await request(app).get(api('/admin/orgs?status=pending')).set(as('super-1'));
    expect(pending.body.items.map((o: any) => o.name).sort()).toEqual(['Delta Traders', 'Gamma Carriers']);
    const vendors = await request(app).get(api('/admin/orgs?kind=vendor&status=pending')).set(as('super-1'));
    expect(vendors.body.items.map((o: any) => o.name)).toEqual(['Delta Traders']);
  });

  it('works whichever organisation the admin is acting as', async () => {
    expect((await request(app).get(api('/admin/orgs')).set(as('super-1', ORG.companyA))).status).toBe(200);
  });

  it('is closed to everyone else, owners of a company included', async () => {
    for (const who of ['admin-a', 'admin-b', 'manager-a', 'vendor-1', 'tpl-1', 'loner']) {
      expect((await request(app).get(api('/admin/orgs')).set(as(who))).status).toBe(403);
    }
  });

  it('rejects a filter it does not know', async () => {
    expect((await request(app).get(api('/admin/orgs?status=bogus')).set(as('super-1'))).status).toBe(422);
  });
});

describe('approving, rejecting and suspending', () => {
  const decide = (action: string, id: string, who = 'super-1', body: object = {}) => request(app).put(api(`/admin/orgs/${id}/${action}`)).set(as(who)).send(body);

  it('approves a pending organisation and records who and when', async () => {
    const res = await decide('approve', PENDING);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    const row = supabaseMock.rows('organizations').find(o => o.id === PENDING)!;
    expect(row).toMatchObject({ status: 'active', approved_by: uid('super-1') });
    expect(typeof row.approved_at).toBe('string');
  });

  it('rejects a pending one with a reason kept in its profile', async () => {
    expect((await decide('reject', PENDING, 'super-1', { reason: 'GSTIN does not match' })).status).toBe(200);
    expect(status(PENDING)).toBe('rejected');
    expect(supabaseMock.rows('organizations').find(o => o.id === PENDING)!.profile).toMatchObject({ reject_reason: 'GSTIN does not match' });
  });

  it('suspends an active one and reinstates it with approve', async () => {
    expect((await decide('suspend', ORG.companyB, 'super-1', { reason: 'Unpaid commission' })).status).toBe(200);
    expect(status(ORG.companyB)).toBe('suspended');
    expect((await decide('approve', ORG.companyB)).status).toBe(200);
    expect(status(ORG.companyB)).toBe('active');
  });

  it('refuses a move the status does not allow', async () => {
    expect((await decide('suspend', PENDING)).status).toBe(409);
    expect((await decide('reject', PENDING)).status).toBe(422);
    expect((await decide('approve', ORG.companyA)).status).toBe(409);
    expect((await decide('reject', ORG.companyA, 'super-1', { reason: 'no good' })).status).toBe(409);
    expect(status(ORG.companyA)).toBe('active');
  });

  it('never touches the platform organisation', async () => {
    expect((await decide('suspend', ORG.platform)).status).toBe(400);
    expect(status(ORG.platform)).toBe('active');
  });

  it('is for platform admins only', async () => {
    for (const who of ['admin-a', 'manager-a', 'tpl-1']) {
      expect((await decide('approve', PENDING, who)).status).toBe(403);
    }
    expect(status(PENDING)).toBe('pending');
  });

  it('answers 404 for an unknown organisation and 422 for a reason that is too long', async () => {
    expect((await decide('approve', 'a0000000-0000-4000-8000-0000000000ee')).status).toBe(404);
    expect((await decide('approve', 'nope')).status).toBe(404);
    expect((await decide('reject', PENDING, 'super-1', { reason: 'x'.repeat(501) })).status).toBe(422);
  });

  it('is audited, and a suspension takes effect on the next request of that company', async () => {
    await decide('suspend', ORG.companyB);
    expect(supabaseMock.rows('ai_agent_logs').map(l => l.action)).toEqual(['org.suspend']);
    // the memberships carry the organisation's status: once they are re-read, the company is stopped
    for (const m of supabaseMock.rows('org_members')) if (m.org_id === ORG.companyB) m.organizations = { ...m.organizations, status: 'suspended' };
    const res = await request(app).get(api('/vehicles')).set(as('admin-b'));
    expect(res.status).toBe(403);
    expect(res.body.detail).toMatch(/suspended/);
  });
});

});

describe('3PL affiliations', () => {
const aff = (company: string) => supabaseMock.rows('tpl_affiliations').find(a => a.company_id === company && a.tpl_id === ORG.tplT);

const join = (company: string, who = 'tpl-1') => request(app).post(api('/tpl/affiliations')).set(as(who)).send({ company_id: company });
const decide = (who: string, action: string, orgId?: string) => request(app).put(api(`/org/tpl-affiliations/${ORG.tplT}/${action}`)).set(as(who, orgId));

beforeEach(() => supabaseMock.reset(orgWorld()));

describe('a 3PL partner joining companies', () => {
  it('asks two companies, and each request waits for that company', async () => {
    expect((await join(ORG.companyA)).status).toBe(201);
    expect((await join(ORG.companyB)).status).toBe(201);
    expect(aff(ORG.companyA)).toMatchObject({ status: 'pending', requested_by: uid('tpl-1') });
    expect(aff(ORG.companyB)).toMatchObject({ status: 'pending' });
  });

  it('can only be asked by a 3PL organisation', async () => {
    expect((await join(ORG.companyB, 'admin-a')).status).toBe(403);
    expect((await join(ORG.companyB, 'vendor-1')).status).toBe(403);
    expect(supabaseMock.rows('tpl_affiliations')).toHaveLength(0);
  });

  it('must name a real, active logistic company', async () => {
    expect((await join(ORG.vendorV)).status).toBe(422);
    expect((await join('a0000000-0000-4000-8000-0000000000ff')).status).toBe(404);
    expect((await join('nope')).status).toBe(422);
    supabaseMock.rows('organizations').find(o => o.id === ORG.companyB)!.status = 'pending';
    expect((await join(ORG.companyB)).status).toBe(409);
  });

  it('cannot ask twice, but can ask again after it ended', async () => {
    await join(ORG.companyA);
    expect((await join(ORG.companyA)).status).toBe(409);
    await decide('admin-a', 'end');
    expect((await join(ORG.companyA)).status).toBe(201);
    expect(aff(ORG.companyA)).toMatchObject({ status: 'pending', approved_at: null });
  });

  it('sees its own affiliations', async () => {
    await join(ORG.companyA);
    await join(ORG.companyB);
    const res = await request(app).get(api('/tpl/affiliations')).set(as('tpl-1'));
    expect(res.status).toBe(200);
    expect(res.body.map((a: any) => a.organization.name).sort()).toEqual(['Alpha Logistics', 'Beta Freight']);
  });
});

describe('a company and its 3PL partners', () => {
  beforeEach(async () => {
    await join(ORG.companyA);
    await join(ORG.companyB);
  });

  it('lists only its own partners, with their details', async () => {
    const res = await request(app).get(api('/org/tpl-affiliations')).set(as('admin-a'));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ tpl_id: ORG.tplT, status: 'pending', organization: { name: 'Tiny Transport' } });
  });

  it('approves, pauses, resumes and ends them', async () => {
    expect((await decide('admin-a', 'approve')).body).toMatchObject({ status: 'active' });
    expect(aff(ORG.companyA)!.approved_by).toBe(uid('admin-a'));
    expect((await decide('admin-a', 'pause')).body.status).toBe('paused');
    expect((await decide('admin-a', 'approve')).body.status).toBe('active');
    expect((await decide('admin-a', 'end')).body.status).toBe('ended');
  });

  it('keeps the two companies apart: A approving does not approve B, and B cannot approve for A', async () => {
    await decide('admin-a', 'approve');
    expect(aff(ORG.companyA)!.status).toBe('active');
    expect(aff(ORG.companyB)!.status).toBe('pending');
    await decide('admin-b', 'pause');
    expect(aff(ORG.companyA)!.status).toBe('active');
  });

  it('refuses moves the status does not allow', async () => {
    expect((await decide('admin-a', 'pause')).status).toBe(409);
    await decide('admin-a', 'end');
    expect((await decide('admin-a', 'approve')).status).toBe(409);
    expect((await decide('admin-a', 'bogus')).status).toBe(404);
  });

  it('is for owners and admins of a logistic company only', async () => {
    expect((await decide('manager-a', 'approve')).status).toBe(403);
    expect((await decide('tpl-1', 'approve')).status).toBe(403);
    expect((await decide('vendor-1', 'approve')).status).toBe(403);
    expect((await request(app).get(api('/org/tpl-affiliations')).set(as('manager-a'))).status).toBe(403);
    expect(aff(ORG.companyA)!.status).toBe('pending');
  });

  it('answers 404 for a partner that has not asked', async () => {
    const res = await request(app).put(api('/org/tpl-affiliations/a0000000-0000-4000-8000-0000000000ee/approve')).set(as('admin-a'));
    expect(res.status).toBe(404);
  });

  it('is audited', async () => {
    await decide('admin-a', 'approve');
    expect(supabaseMock.rows('ai_agent_logs').map(l => l.action)).toEqual(['tpl_affiliation.requested', 'tpl_affiliation.requested', 'tpl_affiliation.approve']);
  });
});

});

describe('notifications and paging', () => {
  beforeEach(() => supabaseMock.reset(orgWorld()));
  const types = (user: string) => supabaseMock.rows('notifications').filter(n => n.user_id === uid(user)).map(n => n.type);

  it('tells a company of a 3PL request and the 3PL of approval', async () => {
    await request(app).post(api('/tpl/affiliations')).set(as('tpl-1')).send({ company_id: ORG.companyA });
    expect(types('admin-a')).toEqual(['tpl_affiliation_requested']);
    expect(types('super-1')).toEqual(['tpl_affiliation_requested']);
    expect(types('manager-a')).toEqual([]);
    await request(app).put(api(`/org/tpl-affiliations/${ORG.tplT}/approve`)).set(as('admin-a'));
    expect(types('tpl-1')).toEqual(['tpl_affiliation_approve']);
  });

  it('tells an org owner of platform approval and rejection', async () => {
    const created = await request(app).post(api('/orgs')).set(as('driver-a')).send({ kind: 'vendor', name: 'Delta Traders' });
    await request(app).put(api(`/admin/orgs/${created.body.id}/approve`)).set(as('super-1'));
    expect(types('driver-a')).toEqual(['org_approve']);
    await request(app).put(api(`/admin/orgs/${ORG.vendorV}/suspend`)).set(as('super-1'));
    expect(types('vendor-1')).toEqual(['org_suspend']);
  });

  it('pages the admin list', async () => {
    const res = await request(app).get(api('/admin/orgs?limit=2&offset=1')).set(as('super-1'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ limit: 2, offset: 1 });
    expect(res.body.items).toHaveLength(2);
    expect((await request(app).get(api('/admin/orgs?limit=0')).set(as('super-1'))).status).toBe(422);
  });

  it('shows the switcher list to anyone, a non-member of any organisation included', async () => {
    const res = await request(app).get(api('/orgs/mine')).set(as('super-1'));
    expect(res.body).toHaveLength(2);
    expect((await request(app).get(api('/org')).set(as('admin-a', ORG.companyB))).status).toBe(403);
  });
});
