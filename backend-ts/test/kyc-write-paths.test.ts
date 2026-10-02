import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';

const app = testApp();
const VENDOR = 'vendor-1';
const bearer = (id: string) => ({ Authorization: `Bearer ${supabaseMock.signUserToken(id)}` });

function reset(kycStatus = 'submitted') {
  supabaseMock.reset({
    users: [
      { id: 'admin-1', role: 'admin', is_active: true },
      { id: 'super-1', role: 'superadmin', is_active: true },
      { id: 'manager-1', role: 'manager', is_active: true },
      { id: 'driver-1', role: 'driver', is_active: true },
      { id: VENDOR, role: 'vendor', is_active: true },
      { id: 'vendor-2', role: 'vendor', is_active: true },
    ],
    vendor_profiles: [
      { id: VENDOR, company_name: 'Acme Logistics', kyc_status: kycStatus, kyc_data: { data: { name: 'Acme' }, otherDocs: [] } },
      { id: 'vendor-2', company_name: 'Other Co', kyc_status: 'approved' },
    ],
    notifications: [],
    ai_agent_logs: [],
  });
}

beforeEach(() => reset());

describe('PUT /vendor/kyc/:id/approve', () => {
  const approve = (token: Record<string, string>) => request(app).put(`/api/v1/vendor/kyc/${VENDOR}/approve`).set(token);

  it('approves a submitted KYC, tells the vendor and writes an audit entry', async () => {
    const res = await approve(bearer('super-1'));
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('vendor_profiles')[0]).toMatchObject({ kyc_status: 'approved', kyc_reviewed_by: 'super-1' });

    const [note] = supabaseMock.writes('notifications', 'POST');
    expect(note.body).toMatchObject({ user_id: VENDOR, type: 'kyc_approved' });

    const [audit] = supabaseMock.writes('ai_agent_logs', 'POST');
    expect(audit.body).toMatchObject({ action: 'kyc_approved', agent_name: 'staff-console' });
    expect(audit.body.input_data).toMatchObject({ actor_id: 'super-1', vendor_id: VENDOR });
  });

  it('refuses a KYC that is not waiting for review, without notifying anyone', async () => {
    reset('approved');
    const res = await approve(bearer('super-1'));
    expect(res.status).toBe(409);
    expect(supabaseMock.writes('notifications', 'POST')).toHaveLength(0);
    expect(supabaseMock.writes('ai_agent_logs', 'POST')).toHaveLength(0);
  });

  it('reports an unknown vendor as not found', async () => {
    const res = await request(app).put('/api/v1/vendor/kyc/nobody/approve').set(bearer('super-1'));
    expect(res.status).toBe(404);
  });

  it('needs a signed-in staff account', async () => {
    expect((await request(app).put(`/api/v1/vendor/kyc/${VENDOR}/approve`)).status).toBe(401);
    expect((await approve(bearer(VENDOR))).status).toBe(403);
    expect((await approve(bearer('driver-1'))).status).toBe(403);
    expect((await approve(bearer('manager-1'))).status).toBe(403);
    expect((await approve(bearer('admin-1'))).status).toBe(403); // a company admin: KYC is the platform's
    expect(supabaseMock.rows('vendor_profiles')[0].kyc_status).toBe('submitted');
  });

  it('audits a rejection too', async () => {
    const res = await request(app).put(`/api/v1/vendor/kyc/${VENDOR}/reject`).set(bearer('super-1')).send({ reason: 'PAN scan is unreadable' });
    expect(res.status).toBe(200);
    const [audit] = supabaseMock.writes('ai_agent_logs', 'POST');
    expect(audit.body).toMatchObject({ action: 'kyc_rejected' });
    expect(supabaseMock.rows('vendor_profiles')[0].kyc_reviewed_by).toBe('super-1');
  });
});

describe('POST /vendor/kyc/upload-url', () => {
  const upload = (body: Record<string, unknown>, token = bearer(VENDOR)) =>
    request(app).post('/api/v1/vendor/kyc/upload-url').set(token).send(body);

  it('issues a signed URL inside the vendor own folder', async () => {
    const res = await upload({ key: 'panCard', content_type: 'application/pdf', size: 1000 });
    expect(res.status).toBe(200);
    expect(res.body.path).toMatch(new RegExp(`^${VENDOR}/panCard_[0-9a-f-]{36}\\.pdf$`));
  });

  it.each([
    ['a missing document name', { content_type: 'application/pdf', size: 10 }, 400],
    ['a document name with a folder', { key: '../x', content_type: 'application/pdf', size: 10 }, 400],
    ['an unsupported format', { key: 'panCard', content_type: 'text/html', size: 10 }, 415],
    ['a missing size', { key: 'panCard', content_type: 'image/png' }, 400],
    ['an oversized file', { key: 'panCard', content_type: 'image/png', size: 50 * 1024 * 1024 }, 413],
  ])('refuses %s', async (_name, body, status) => {
    expect((await upload(body as Record<string, unknown>)).status).toBe(status);
  });

  it('is for vendors only', async () => {
    const body = { key: 'panCard', content_type: 'application/pdf', size: 10 };
    expect((await request(app).post('/api/v1/vendor/kyc/upload-url').send(body)).status).toBe(401);
    expect((await upload(body, bearer('driver-1'))).status).toBe(403);
    expect((await upload(body, bearer('admin-1'))).status).toBe(403);
  });
});

describe('PUT /vendor/kyc/documents', () => {
  const save = (body: Record<string, unknown>, token = bearer(VENDOR)) =>
    request(app).put('/api/v1/vendor/kyc/documents').set(token).send(body);

  it('saves document paths from the own folder and keeps the rest of the form', async () => {
    const res = await save({ docUrls: { panCard: `${VENDOR}/panCard_1.pdf` }, otherDocs: [{ name: 'Licence', path: `${VENDOR}/other_1.pdf` }] });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('vendor_profiles')[0].kyc_data).toMatchObject({
      data: { name: 'Acme', docUrls: { panCard: `${VENDOR}/panCard_1.pdf` } },
      otherDocs: [{ name: 'Licence', path: `${VENDOR}/other_1.pdf` }],
    });
    expect(supabaseMock.rows('vendor_profiles')[0].kyc_status).toBe('submitted');
  });

  it('sends an approved profile back to review and tells the superadmins (the KYC page is theirs)', async () => {
    reset('approved');
    const res = await save({ docUrls: { panCard: `${VENDOR}/panCard_1.pdf` } });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('vendor_profiles')[0]).toMatchObject({ kyc_status: 'submitted', kyc_reviewed_by: null });
    const recipients = supabaseMock.writes('notifications', 'POST').map(w => w.body.user_id);
    expect(recipients).toEqual(['super-1']);
  });

  it.each([
    ['another vendor folder', { docUrls: { panCard: 'vendor-2/panCard_1.pdf' } }],
    ['a path with dots', { docUrls: { panCard: `${VENDOR}/../vendor-2/x.pdf` } }],
    ['a nested path', { docUrls: { panCard: `${VENDOR}/a/b.pdf` } }],
    ['a bad document name', { docUrls: { 'a b': `${VENDOR}/x.pdf` } }],
    ['another folder in other documents', { otherDocs: [{ name: 'x', path: 'vendor-2/x.pdf' }] }],
  ])('refuses %s', async (_name, body) => {
    const res = await save(body);
    expect(res.status).toBe(400);
    expect(supabaseMock.rows('vendor_profiles')[0].kyc_data).toMatchObject({ data: { name: 'Acme' } });
  });

  it('refuses an empty request and a missing profile', async () => {
    expect((await save({})).status).toBe(400);
    supabaseMock.reset({ users: [{ id: VENDOR, role: 'vendor', is_active: true }], vendor_profiles: [] });
    expect((await save({ docUrls: {} })).status).toBe(404);
  });

  it('is for vendors only', async () => {
    expect((await request(app).put('/api/v1/vendor/kyc/documents').send({ docUrls: {} })).status).toBe(401);
    expect((await save({ docUrls: {} }, bearer('driver-1'))).status).toBe(403);
  });
});

describe('vendor form validation', () => {
  const profile = (body: Record<string, unknown>) =>
    request(app).post('/api/v1/vendor/profile').set(bearer(VENDOR)).send(body);
  const GOOD = { companyName: 'Acme Logistics', gstNumber: '27AAPFU0939F1ZV', city: 'Pune', address: '1 MG Road', lat: 18.5, lng: 73.8 };

  it.each([
    ['a missing company name', { companyName: '' }],
    ['a bad GST number', { gstNumber: 'nonsense' }],
    ['a latitude out of range', { lat: 123 }],
    ['a longitude that is text', { lng: 'far' }],
    ['a missing city', { city: '' }],
  ])('refuses %s', async (_name, change) => {
    const res = await profile({ ...GOOD, ...change });
    expect(res.status).toBe(400);
  });

  it('refuses a KYC submission that points at another vendor folder or has a bad PAN', async () => {
    const submit = (kycData: unknown, companyLogo: string | null = null) =>
      request(app).post('/api/v1/vendor/kyc/submit').set(bearer(VENDOR)).send({ ...GOOD, companyLogo, kycData });
    expect((await submit({ data: { docUrls: { panCard: 'vendor-2/x.pdf' } }, otherDocs: [] })).status).toBe(400);
    expect((await submit({ data: { panNumber: 'nope' }, otherDocs: [] })).status).toBe(400);
    expect((await submit({ data: {}, otherDocs: [] }, 'vendor-2/logo.png')).status).toBe(400);
    expect((await submit('not an object')).status).toBe(400);
    expect((await submit({ data: { panNumber: 'ABCDE1234F', docUrls: { panCard: `${VENDOR}/p.pdf` } }, otherDocs: [] })).status).toBe(200);
  });

  it('will not take a shipment request before KYC is approved, or with a nonsense body', async () => {
    const send = (body: Record<string, unknown>, token = bearer(VENDOR)) =>
      request(app).post('/api/v1/vendor/shipment-request').set(token).send(body);
    const good = {
      pickup: { address: 'Pune Yard', lat: 18.5, lng: 73.8 },
      drop: { address: 'Mumbai Dock', lat: 19, lng: 72.8 },
      capacity: 500,
    };
    expect((await send(good)).status).toBe(403); // KYC still submitted
    reset('approved');
    expect((await send({ ...good, capacity: -5 })).status).toBe(400);
    expect((await send({ ...good, pickup: undefined })).status).toBe(400);
    expect((await send({ ...good, drop: { address: 'x', lat: 999, lng: 0 } })).status).toBe(400);
    expect((await send(good)).status).toBe(200);
  });
});
