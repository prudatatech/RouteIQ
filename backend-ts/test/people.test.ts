import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';
import { verhoeffCheckDigit } from '../src/utils/people-validators';
import { runDocumentExpiryJob } from '../src/services/people-jobs.service';
import { assertDriverDispatchable } from '../src/services/people-docs.service';

const app = testApp();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SUPER = id(1), ADMIN = id(2), MGR = id(3), DRV = id(4), DRV2 = id(5), VEH = id(10);
const as = (sub: string, role: string) => ({ Authorization: `Bearer ${createAccessToken({ sub, role })}` });
const superadmin = as(SUPER, 'superadmin');
const admin = as(ADMIN, 'admin');
const manager = as(MGR, 'manager');
const driver = as(DRV, 'driver');
const driver2 = as(DRV2, 'driver');

const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const inDays = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const aadhaar = (() => { const b = '23456789012'; return `${b}${verhoeffCheckDigit(b)}`; })();

function fixtures(extra: Record<string, any[]> = {}) {
  return {
    users: [
      { id: SUPER, role: 'superadmin', is_active: true, status: 'active', full_name: 'Sue Super' },
      { id: ADMIN, role: 'admin', is_active: true, status: 'active', full_name: 'Adam Admin', email: 'adam@x.in' },
      { id: MGR, role: 'manager', is_active: true, status: 'active', full_name: 'Mona Manager' },
      { id: DRV, role: 'driver', is_active: true, status: 'active', full_name: 'Ravi Kumar', phone: '+919876500001' },
      { id: DRV2, role: 'driver', is_active: true, status: 'active', full_name: 'Sunil Rao', phone: '+919876500002' },
      { id: id(6), role: 'vendor', is_active: true, status: 'active', full_name: 'Vee Vendor' },
    ],
    user_profiles: [
      { user_id: DRV, consent_at: '2026-09-01T00:00:00Z', consent_method: 'in_app', updated_at: '2026-09-01T00:00:00Z' },
      { user_id: DRV2, consent_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z' },
    ],
    user_documents: [], user_activity: [], user_status_history: [], user_phone_history: [], user_bank_accounts: [],
    user_emergency_contacts: [], user_notes: [], notifications: [], vehicles: [], routes: [], system_settings: [],
    driver_vehicle_assignments: [], route_stops: [], shipments: [], depots: [], tpl_partners: [],
    ...extra,
  };
}

beforeEach(() => {
  supabaseMock.reset(fixtures());
  supabaseMock.authAdmin = true;
});

const activity = (action: string) => supabaseMock.rows('user_activity').filter(a => a.action === action);

describe('creating people', () => {
  it('creates a driver on the record OTP sign-in would find, and refuses a duplicate phone', async () => {
    const res = await request(app).post('/api/v1/people').set(admin).send({ role: 'driver', full_name: 'New Driver', phone: '98765 00009' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ role: 'driver', status: 'onboarding', phone: '+919876500009', email: null });
    expect(supabaseMock.authCalls[0].body.email).toBe('driver_919876500009@driver.margixindia.local');
    const row = supabaseMock.rows('users').find(u => u.phone === '+919876500009')!;
    expect(row).toMatchObject({ role: 'driver', is_active: true, id: res.body.user.id });

    const dup = await request(app).post('/api/v1/people').set(admin).send({ role: 'driver', full_name: 'Again', phone: '9876500009' });
    expect(dup.status).toBe(409);
    expect(dup.body.existing_person.id).toBe(res.body.user.id);
  });

  it('invites staff by email without any password, and enforces role rules', async () => {
    const res = await request(app).post('/api/v1/people').set(admin).send({ role: 'manager', full_name: 'New Manager', email: 'New@X.in' });
    expect(res.status).toBe(201);
    expect(supabaseMock.authCalls.map(c => c.op)).toEqual(['invite', 'update']);
    expect(supabaseMock.authCalls[1].body).toEqual({ app_metadata: { role: 'manager' } });
    expect(JSON.stringify(supabaseMock.authCalls)).not.toMatch(/password/);
    expect(supabaseMock.rows('users').find(u => u.email === 'new@x.in')).toMatchObject({ role: 'manager', status: 'onboarding' });

    expect((await request(app).post('/api/v1/people').set(manager).send({ role: 'driver', full_name: 'X Y', phone: '9876500077' })).status).toBe(403);
    expect((await request(app).post('/api/v1/people').set(admin).send({ role: 'superadmin', full_name: 'Big Boss', email: 'b@x.in' })).status).toBe(403);
    expect((await request(app).post('/api/v1/people').set(superadmin).send({ role: 'superadmin', full_name: 'Big Boss', email: 'b@x.in' })).status).toBe(201);
    expect((await request(app).post('/api/v1/people').set(admin).send({ role: 'manager', full_name: 'Dup', email: 'adam@x.in' })).status).toBe(409);
  });
});

describe('viewing and editing', () => {
  it('lists people (not vendors), and a manager can read but not edit', async () => {
    const res = await request(app).get('/api/v1/people').set(manager);
    expect(res.status).toBe(200);
    expect(res.body.items.map((p: any) => p.id)).not.toContain(id(6));
    expect(res.body.items.find((p: any) => p.id === DRV).doc_summary.required).toBe(4);
    expect((await request(app).patch(`/api/v1/people/${DRV}`).set(manager).send({ full_name: 'X Y' })).status).toBe(403);
    expect((await request(app).get(`/api/v1/people/${id(6)}`).set(admin)).status).toBe(404);
  });

  it('updates nested profile fields, checks stale edits, and moves the phone through history', async () => {
    const res = await request(app).patch(`/api/v1/people/${DRV}`).set(admin)
      .send({ phone: '98765 00055', profile: { designation: 'Senior driver', pincode: '560001' }, updated_at: '2026-09-01T00:00:00Z' });
    expect(res.status).toBe(200);
    expect(res.body.profile).toMatchObject({ designation: 'Senior driver', pincode: '560001' });
    expect(supabaseMock.rows('users').find(u => u.id === DRV)!.phone).toBe('+919876500055');
    expect(supabaseMock.rows('user_phone_history').some(h => h.phone === '+919876500055')).toBe(true);
    expect(activity('profile_updated')).toHaveLength(1);

    const stale = await request(app).patch(`/api/v1/people/${DRV}`).set(admin).send({ full_name: 'Ravi K', updated_at: '2026-09-01T00:00:00Z' });
    expect(stale.status).toBe(409);
    expect((await request(app).patch(`/api/v1/people/${DRV}`).set(admin).send({ profile: { pincode: '12' } })).status).toBe(400);
  });

  it('refuses a phone someone else uses, and one released in the last 90 days', async () => {
    const taken = await request(app).patch(`/api/v1/people/${DRV}`).set(admin).send({ phone: '9876500002' });
    expect(taken.status).toBe(409);
    supabaseMock.reset(fixtures({ user_phone_history: [{ user_id: DRV2, phone: '+919876500077', to_at: new Date().toISOString() }] }));
    const recycled = await request(app).patch(`/api/v1/people/${DRV}`).set(admin).send({ phone: '9876500077' });
    expect(recycled.status).toBe(409);
  });

  it('only a superadmin changes roles, never between driver and staff', async () => {
    expect((await request(app).patch(`/api/v1/people/${MGR}`).set(admin).send({ role: 'admin' })).status).toBe(403);
    expect((await request(app).patch(`/api/v1/people/${MGR}`).set(superadmin).send({ role: 'driver' })).status).toBe(409);
    supabaseMock.authUsers.push({ id: MGR, email: 'm@x.in', app_metadata: {}, user_metadata: {}, confirmed: true });
    expect((await request(app).patch(`/api/v1/people/${MGR}`).set(superadmin).send({ role: 'admin' })).status).toBe(200);
    expect(supabaseMock.rows('users').find(u => u.id === MGR)!.role).toBe('admin');
  });
});

describe('status', () => {
  it('needs a reason, cannot be your own, and keeps is_active in step', async () => {
    const post = (who: object, target: string, body: object) => request(app).post(`/api/v1/people/${target}/status`).set(who).send(body);
    expect((await post(admin, ADMIN, { status: 'suspended', reason: 'test reason' })).status).toBe(403);
    expect((await post(manager, DRV, { status: 'suspended', reason: 'test reason' })).status).toBe(403);
    expect((await post(admin, DRV, { status: 'suspended' })).status).toBe(400);
    expect((await post(admin, SUPER, { status: 'suspended', reason: 'test reason' })).status).toBe(403);

    const res = await post(admin, DRV, { status: 'suspended', reason: 'Licence dispute' });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('users').find(u => u.id === DRV)).toMatchObject({ status: 'suspended', is_active: false });
    expect(supabaseMock.rows('user_status_history')[0]).toMatchObject({ to_status: 'suspended', changed_by: ADMIN });
    // The suspended driver's existing token stops working
    expect((await request(app).get('/api/v1/people/me').set(driver)).status).toBe(401);

    // Someone who left comes back through onboarding
    await post(admin, DRV, { status: 'inactive', reason: 'Left the company' });
    expect((await post(admin, DRV, { status: 'active' })).status).toBe(409);
    expect((await post(admin, DRV, { status: 'onboarding' })).status).toBe(200);
    expect(supabaseMock.rows('users').find(u => u.id === DRV)!.is_active).toBe(true);
  });

  it('refuses while the driver is on an active route, and asks before releasing a vehicle', async () => {
    supabaseMock.reset(fixtures({
      vehicles: [{ id: VEH, plate_number: 'KA01AB1234', driver_id: DRV, status: 'available' }],
      routes: [{ id: id(20), vehicle_id: VEH, status: 'active' }],
    }));
    const busy = await request(app).post(`/api/v1/people/${DRV}/status`).set(admin).send({ status: 'inactive', reason: 'Left the company' });
    expect(busy.status).toBe(409);
    expect(busy.body.detail).toContain('active trip');

    supabaseMock.rows('routes')[0].status = 'completed';
    const ask = await request(app).post(`/api/v1/people/${DRV}/status`).set(admin).send({ status: 'inactive', reason: 'Left the company' });
    expect(ask.status).toBe(409);
    expect(ask.body.requires_confirmation).toBe(true);
    const ok = await request(app).post(`/api/v1/people/${DRV}/status`).set(admin).send({ status: 'inactive', reason: 'Left the company', confirm_release: true });
    expect(ok.status).toBe(200);
    expect(supabaseMock.rows('vehicles')[0].driver_id).toBeNull();
  });
});

describe('documents', () => {
  const upload = (who: object, target: string, body: object) => request(app).post(`/api/v1/people/${target}/documents/upload-url`).set(who).send(body);
  const add = (who: object, target: string, body: object) => request(app).post(`/api/v1/people/${target}/documents`).set(who).send(body);

  it('issues signed upload paths inside the person’s folder, for staff or the person only', async () => {
    const res = await upload(driver, DRV, { doc_type: 'aadhaar', file_name: 'a.jpg', content_type: 'image/jpeg' });
    expect(res.status).toBe(200);
    expect(supabaseMock.signedUploads[0]).toMatch(new RegExp(`^kyc_documents/people/${DRV}/aadhaar/[0-9a-f-]+\\.jpg$`));
    expect((await upload(driver2, DRV, { doc_type: 'aadhaar', file_name: 'a.jpg', content_type: 'image/jpeg' })).status).toBe(403);
    expect((await upload(manager, DRV, { doc_type: 'aadhaar', file_name: 'a.exe', content_type: 'application/x-msdownload' })).status).toBe(415);
    expect((await upload(admin, DRV, { doc_type: 'aadhaar', file_name: 'a.pdf', content_type: 'application/pdf', size: 20_000_000 })).status).toBe(413);
  });

  it('needs consent first, and keeps files confined to the person’s folder', async () => {
    supabaseMock.reset(fixtures({ user_profiles: [] }));
    expect((await add(admin, DRV, { doc_type: 'pan', doc_number: 'ABCDE1234F', file_path: `people/${DRV}/pan/x.jpg` })).body.code).toBe('consent_required');
    supabaseMock.reset(fixtures());
    const body = { doc_type: 'pan', doc_number: 'abcde1234f' };
    expect((await add(admin, DRV, { ...body, file_path: `people/${DRV2}/pan/x.jpg` })).status).toBe(400);
    expect((await add(admin, DRV, { ...body, file_path: `people/${DRV}/pan/../../${DRV2}/x.jpg` })).status).toBe(400);
    expect((await add(admin, DRV, { ...body, file_path: `people/${DRV}/aadhaar/x.jpg` })).status).toBe(400);
    const ok = await add(admin, DRV, { ...body, file_path: `people/${DRV}/pan/x.jpg` });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ doc_number: 'ABCDE1234F', status: 'pending' });
  });

  it('never stores a full Aadhaar number, and refuses the same number on another person', async () => {
    const res = await add(driver, DRV, { doc_type: 'aadhaar', doc_number: aadhaar, file_path: `people/${DRV}/aadhaar/x.jpg` });
    expect(res.status).toBe(201);
    expect(res.body.doc_number).toBe(`XXXX XXXX ${aadhaar.slice(-4)}`);
    expect(JSON.stringify(res.body)).not.toContain(aadhaar);
    const stored = supabaseMock.rows('user_documents')[0];
    expect(JSON.stringify(stored)).not.toContain(aadhaar);
    expect(stored).toMatchObject({ number_last4: aadhaar.slice(-4), doc_number: null });
    expect(stored.number_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify((await request(app).get(`/api/v1/people/${DRV}`).set(admin)).body)).not.toContain(aadhaar);

    const dup = await add(admin, DRV2, { doc_type: 'aadhaar', doc_number: aadhaar, file_path: `people/${DRV2}/aadhaar/y.jpg` });
    expect(dup.status).toBe(409);
    expect(dup.body.existing_person.id).toBe(DRV);
    expect((await add(admin, DRV2, { doc_type: 'aadhaar', doc_number: '234567890123', file_path: `people/${DRV2}/aadhaar/y.jpg` })).status).toBe(400);
  });

  it('replaces the live document, verifies, rejects with a notification, and hides the file from others', async () => {
    const first = await add(admin, DRV, { doc_type: 'driving_licence', doc_number: 'KA0120200001234', expires_on: inDays(200), file_path: `people/${DRV}/driving_licence/a.jpg`, metadata: { licence_classes: ['LMV'] } });
    const second = await add(admin, DRV, { doc_type: 'driving_licence', doc_number: 'KA0120200001235', expires_on: inDays(300), file_path: `people/${DRV}/driving_licence/b.jpg` });
    expect(second.status).toBe(201);
    expect(supabaseMock.rows('user_documents').find(d => d.id === first.body.id)!.archived_at).toBeTruthy();

    const patch = (who: object, body: object) => request(app).patch(`/api/v1/people/${DRV}/documents/${second.body.id}`).set(who).send(body);
    expect((await patch(driver, { status: 'verified' })).status).toBe(403);
    expect((await patch(manager, { status: 'rejected' })).status).toBe(400);
    const rejected = await patch(manager, { status: 'rejected', rejection_reason: 'Blurry photo' });
    expect(rejected.body.status).toBe('rejected');
    expect(supabaseMock.rows('notifications').some(n => n.user_id === DRV && n.type === 'document_rejected')).toBe(true);
    const again = await add(driver, DRV, { doc_type: 'driving_licence', doc_number: 'KA0120200001235', expires_on: inDays(300), file_path: `people/${DRV}/driving_licence/c.jpg` });
    expect(again.body.resubmission_count).toBe(1);
    const verified = await request(app).patch(`/api/v1/people/${DRV}/documents/${again.body.id}`).set(manager).send({ status: 'verified' });
    expect(verified.body).toMatchObject({ status: 'verified' });

    const file = await request(app).get(`/api/v1/people/${DRV}/documents/${again.body.id}/file`).set(driver);
    expect(file.body.url).toContain('token=');
    expect((await request(app).get(`/api/v1/people/${DRV}/documents/${again.body.id}/file`).set(driver2)).status).toBe(403);
    expect((await request(app).get(`/api/v1/people/${DRV}/documents/${again.body.id}/file?index=0`).set(admin)).status).toBe(404);
    expect((await request(app).delete(`/api/v1/people/${DRV}/documents/${again.body.id}`).set(manager)).status).toBe(403);
    expect((await request(app).delete(`/api/v1/people/${DRV}/documents/${again.body.id}`).set(admin)).status).toBe(204);
  });

  it('serves /people/me and replays a repeated Idempotency-Key once', async () => {
    const me = await request(app).get('/api/v1/people/me').set(driver);
    expect(me.body.user.id).toBe(DRV);
    expect(me.body.notes).toEqual([]);
    expect(me.body.bank_accounts).toBeNull();
    const send = () => request(app).post('/api/v1/people/me/documents').set(driver).set('Idempotency-Key', 'key-12345678')
      .send({ doc_type: 'pan', doc_number: 'ABCDE1234F', file_path: `people/${DRV}/pan/x.jpg` });
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(201);
    expect(supabaseMock.rows('user_documents')).toHaveLength(1);
  });
});

describe('bank details', () => {
  const bankBody = { account_holder: 'Ravi Kumar', account_number: '123456789012', ifsc: 'hdfc0001234' };

  it('is for admins, masked, and revealed only by a superadmin with a log entry', async () => {
    expect((await request(app).post(`/api/v1/people/${DRV}/bank-accounts`).set(manager).send(bankBody)).status).toBe(403);
    expect((await request(app).post(`/api/v1/people/${DRV}/bank-accounts`).set(admin).send({ ...bankBody, ifsc: 'BAD' })).status).toBe(400);
    const created = await request(app).post(`/api/v1/people/${DRV}/bank-accounts`).set(admin).send(bankBody);
    expect(created.status).toBe(201);
    expect(created.body.account_number).toBe('XXXXXXXX9012');
    expect(JSON.stringify(created.body)).not.toContain('123456789012');
    const detail = await request(app).get(`/api/v1/people/${DRV}`).set(admin);
    expect(detail.body.bank_accounts[0].account_number).toBe('XXXXXXXX9012');
    expect((await request(app).get(`/api/v1/people/${DRV}`).set(manager)).body.bank_accounts).toBeNull();

    const reveal = (who: object) => request(app).post(`/api/v1/people/${DRV}/bank-accounts/${created.body.id}/reveal`).set(who);
    expect((await reveal(admin)).status).toBe(403);
    const shown = await reveal(superadmin);
    expect(shown.body.account_number).toBe('123456789012');
    expect(activity('bank_reveal')).toHaveLength(1);
    expect(activity('bank_reveal')[0]).toMatchObject({ actor_id: SUPER, user_id: DRV });
  });
});

describe('contacts, notes and settings', () => {
  it('keeps one primary contact and lets staff add notes', async () => {
    const a = await request(app).post(`/api/v1/people/${DRV}/emergency-contacts`).set(manager).send({ name: 'Asha Kumar', relation: 'Wife', phone: '9876543210' });
    const b = await request(app).post(`/api/v1/people/${DRV}/emergency-contacts`).set(manager).send({ name: 'Bala Kumar', phone: '9876543211', is_primary: true });
    expect(a.body.is_primary).toBe(true);
    expect(b.status).toBe(201);
    expect(supabaseMock.rows('user_emergency_contacts').filter(c => c.is_primary)).toHaveLength(1);
    expect((await request(app).get(`/api/v1/people/${DRV}/emergency-contacts`).set(driver)).body).toHaveLength(2);
    expect((await request(app).post(`/api/v1/people/${DRV}/emergency-contacts`).set(driver).send({ name: 'Zed', phone: '9876543212' })).status).toBe(403);
    const note = await request(app).post(`/api/v1/people/${DRV}/notes`).set(manager).send({ body: 'Called about renewal' });
    expect(note.body.author_name).toBe('Mona Manager');
    expect((await request(app).get(`/api/v1/people/${DRV}/notes`).set(driver)).status).toBe(403);
  });

  it('reads and saves settings', async () => {
    expect((await request(app).get('/api/v1/people/settings').set(manager)).body.driver_document_enforcement).toBe('warn');
    expect((await request(app).put('/api/v1/people/settings').set(manager).send({ licence_grace_days: 7 })).status).toBe(403);
    expect((await request(app).put('/api/v1/people/settings').set(admin).send({ driver_document_enforcement: 'strict' })).status).toBe(400);
    const saved = await request(app).put('/api/v1/people/settings').set(admin).send({ licence_grace_days: 7, driver_document_enforcement: 'block' });
    expect(saved.body).toMatchObject({ licence_grace_days: 7, driver_document_enforcement: 'block' });
  });
});

describe('invites and anonymising', () => {
  it('resends a staff invite at most every 10 minutes', async () => {
    supabaseMock.authUsers.push({ id: MGR, email: 'm@x.in', app_metadata: {}, user_metadata: {}, confirmed: false });
    supabaseMock.rows('users').find(u => u.id === MGR)!.email = 'm@x.in';
    expect((await request(app).post(`/api/v1/people/${MGR}/invite`).set(admin)).status).toBe(200);
    expect((await request(app).post(`/api/v1/people/${MGR}/invite`).set(admin)).status).toBe(429);
  });

  it('anonymises only inactive people, only by a superadmin', async () => {
    expect((await request(app).post(`/api/v1/people/${DRV}/anonymise`).set(admin)).status).toBe(403);
    expect((await request(app).post(`/api/v1/people/${DRV}/anonymise`).set(superadmin)).status).toBe(409);
    supabaseMock.rows('users').find(u => u.id === DRV)!.status = 'inactive';
    expect((await request(app).post(`/api/v1/people/${DRV}/anonymise`).set(superadmin)).status).toBe(200);
    expect(supabaseMock.rows('users').find(u => u.id === DRV)).toMatchObject({ full_name: 'Anonymised person', phone: null });
  });
});

describe('dispatch warnings and dashboard', () => {
  const doc = (owner: string, expires: string, extra = {}) => ({
    id: `d-${owner}`, user_id: owner, doc_type: 'driving_licence', status: 'verified', expires_on: expires, archived_at: null, metadata: {}, ...extra,
  });

  it('shows driver_licence_status on vehicles and in the dashboard list', async () => {
    supabaseMock.reset(fixtures({
      vehicles: [
        { id: VEH, plate_number: 'A1', driver_id: DRV, status: 'available', capacity_kg: 1000 },
        { id: id(11), plate_number: 'A2', driver_id: DRV2, status: 'available', capacity_kg: 1000 },
        { id: id(12), plate_number: 'A3', driver_id: null, status: 'available', capacity_kg: 1000 },
      ],
      user_documents: [doc(DRV, inDays(-3))],
    }));
    const res = await request(app).get('/api/v1/vehicles').set(manager);
    const byPlate = Object.fromEntries(res.body.map((v: any) => [v.plate_number, v.driver_licence_status]));
    expect(byPlate).toEqual({ A1: 'expired', A2: 'missing', A3: null });

    supabaseMock.rows('user_documents')[0].expires_on = inDays(400);
    expect((await request(app).get('/api/v1/vehicles').set(manager).query({ status: 'available' })).body.find((v: any) => v.plate_number === 'A1').driver_licence_status).toBe('valid');

    supabaseMock.rows('user_documents')[0].expires_on = inDays(-3);
    const attention = await request(app).get('/api/v1/dashboard/people-attention').set(manager);
    expect(attention.status).toBe(200);
    expect(attention.body.expired_licences[0]).toMatchObject({ user_id: DRV, full_name: 'Ravi Kumar' });
    expect(attention.body.missing_required.find((m: any) => m.user_id === DRV2).missing).toContain('driving_licence');
  });

  it('blocks dispatch of an unfit driver only when the setting says block', async () => {
    supabaseMock.reset(fixtures({
      vehicles: [{ id: VEH, plate_number: 'A1', driver_id: DRV, status: 'available', capacity_kg: 1000 }],
      user_documents: [doc(DRV, inDays(-3))],
      system_settings: [{ key: 'driver_document_enforcement', value: { value: 'warn' } }],
    }));
    await expect(assertDriverDispatchable(VEH)).resolves.toBeUndefined();
    supabaseMock.rows('system_settings')[0].value = { value: 'block' };
    await expect(assertDriverDispatchable(VEH)).rejects.toMatchObject({ status: 409 });
    supabaseMock.rows('system_settings').push({ key: 'licence_grace_days', value: { value: 7 } });
    await expect(assertDriverDispatchable(VEH)).resolves.toBeUndefined();
  });
});

describe('daily expiry job', () => {
  it('expires documents, sends each reminder once, and one digest to staff', async () => {
    supabaseMock.reset(fixtures({
      user_documents: [
        { id: 'd1', user_id: DRV, doc_type: 'driving_licence', status: 'verified', expires_on: inDays(7), archived_at: null, metadata: {} },
        { id: 'd2', user_id: DRV2, doc_type: 'driving_licence', status: 'verified', expires_on: inDays(-1), archived_at: null, metadata: {} },
        { id: 'd3', user_id: DRV, doc_type: 'pan', status: 'verified', expires_on: inDays(90), archived_at: null, metadata: {} },
      ],
    }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const first = await runDocumentExpiryJob();
    expect(first).toMatchObject({ expired: 1, reminders: 2, digest_sent: true });
    const docs = supabaseMock.rows('user_documents');
    expect(docs.find(d => d.id === 'd2')!.status).toBe('expired');
    expect(docs.find(d => d.id === 'd1')!.metadata.reminders_sent).toMatchObject({ d7: expect.any(String), d30: expect.any(String) });

    const staffNotes = supabaseMock.rows('notifications').filter(n => n.type === 'document_expiring' && [ADMIN, SUPER, MGR].includes(n.user_id));
    expect(staffNotes).toHaveLength(3); // one digest each for admin, superadmin and manager
    expect(supabaseMock.rows('notifications').filter(n => n.user_id === DRV)).toHaveLength(1);
    expect(supabaseMock.rows('notifications').filter(n => n.user_id === DRV2)).toHaveLength(1);

    const second = await runDocumentExpiryJob();
    expect(second).toMatchObject({ expired: 0, reminders: 0, digest_sent: false });
    expect(supabaseMock.rows('notifications')).toHaveLength(5);
  });
});
