import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';

const app = testApp();
const SUPER = '00000000-0000-4000-8000-000000000001';
const ADMIN = '00000000-0000-4000-8000-000000000002';
const V1 = '00000000-0000-4000-8000-0000000000a1'; // submitted, org, profile
const V2 = '00000000-0000-4000-8000-0000000000a2'; // registered, never filed KYC
const PARTNER = '00000000-0000-4000-8000-0000000000a3';
const ORG1 = '00000000-0000-4000-8000-0000000000b1';
const bearer = (id: string) => ({ Authorization: `Bearer ${supabaseMock.signUserToken(id)}` });

function reset(kycStatus = 'submitted', extra: Record<string, any[]> = {}) {
  supabaseMock.reset({
    users: [
      { id: SUPER, role: 'superadmin', is_active: true, full_name: 'Platform Owner', email: 'owner@example.test' },
      { id: ADMIN, role: 'admin', is_active: true },
      { id: V1, role: 'vendor', is_active: true, full_name: 'Asha', email: 'asha@example.test', phone: '+919800000001', created_at: '2026-09-01T00:00:00Z' },
      { id: V2, role: 'vendor', is_active: true, full_name: 'Ravi', email: 'ravi@example.test', phone: '+919800000002', created_at: '2026-09-05T00:00:00Z' },
      { id: PARTNER, role: 'vendor', is_active: true, full_name: 'Carrier', email: 'c@example.test', created_at: '2026-09-06T00:00:00Z' },
    ],
    tpl_partners: [{ id: 'p1', user_id: PARTNER }],
    vendor_profiles: [{
      id: V1, company_name: 'Acme Traders', gst_number: '27AAAAA0000A1Z5', city: 'Pune', address: '1 Main Rd', kyc_status: kycStatus,
      updated_at: '2026-09-10T00:00:00Z',
      kyc_data: { data: { panNumber: 'AAAAA0000A', bankIfscCode: 'HDFC0000001', docUrls: { panScan: `${V1}/pan_1.pdf` } }, otherDocs: [{ name: 'Lease', path: `${V1}/other_1.pdf` }], bank: { ifsc_verified_at: '2026-09-09T00:00:00Z' } },
    }],
    organizations: [{
      id: ORG1, kind: 'vendor', name: 'Acme', legal_name: 'Acme Traders Pvt Ltd', gstin: '27AAAAA0000A1Z5', address: '1 Main Rd', pincode: '411001', state: 'Maharashtra', status: 'pending',
      profile: { legacy_user_id: V1, account_type: 'business_partner', business_type: 'manufacturer', monthly_loads: '10-50', contact_name: 'Asha K', state_code: '27', gstin_status: 'active' },
    }],
    org_members: [{ org_id: ORG1, user_id: V1, role: 'owner', status: 'active' }],
    vendor_shipment_requests: [{ id: 'l1', vendor_id: V1, status: 'pending', carrier_org_id: null, created_at: '2026-09-20T00:00:00Z' }],
    invoices: [],
    kyc_info_requests: [],
    notifications: [],
    ai_agent_logs: [],
    ...extra,
  });
}

beforeEach(() => reset());

describe('GET /vendor/registry', () => {
  it('lists every vendor, including one with no KYC profile, and leaves out 3PL partners', async () => {
    const res = await request(app).get('/api/v1/vendor/registry').set(bearer(SUPER));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    const ids = res.body.items.map((i: any) => i.id);
    expect(ids).toContain(V2);
    expect(ids).not.toContain(PARTNER);
    const noProfile = res.body.items.find((i: any) => i.id === V2);
    expect(noProfile).toMatchObject({ kyc_status: 'pending', name: 'Ravi', email: 'ravi@example.test', org_status: null });
    const v1 = res.body.items.find((i: any) => i.id === V1);
    expect(v1).toMatchObject({ name: 'Acme Traders', kyc_status: 'submitted', org_status: 'pending', city: 'Pune', gstin: '27AAAAA0000A1Z5' });
  });

  it('filters by status and searches by name', async () => {
    const pending = await request(app).get('/api/v1/vendor/registry?status=pending').set(bearer(SUPER));
    expect(pending.body.items.map((i: any) => i.id)).toEqual([V2]);
    const found = await request(app).get('/api/v1/vendor/registry?q=acme').set(bearer(SUPER));
    expect(found.body.items.map((i: any) => i.id)).toEqual([V1]);
    const page = await request(app).get('/api/v1/vendor/registry?limit=1&offset=1').set(bearer(SUPER));
    expect(page.body.items).toHaveLength(1);
    expect(page.body.total).toBe(2);
  });

  it('is for the platform only', async () => {
    expect((await request(app).get('/api/v1/vendor/registry').set(bearer(ADMIN))).status).toBe(403);
    expect((await request(app).get('/api/v1/vendor/registry').set(bearer(V1))).status).toBe(403);
  });
});

describe('GET /vendor/registry/:id', () => {
  it('merges the account, the business and the KYC profile', async () => {
    const res = await request(app).get(`/api/v1/vendor/registry/${V1}`).set(bearer(SUPER));
    expect(res.status).toBe(200);
    expect(res.body.account).toMatchObject({ id: V1, email: 'asha@example.test', full_name: 'Asha' });
    expect(res.body.business).toMatchObject({
      org_id: ORG1, org_status: 'pending', business_name: 'Acme Traders Pvt Ltd', contact_name: 'Asha K', account_type: 'business_partner',
      gstin: '27AAAAA0000A1Z5', pincode: '411001', state_code: '27', gstin_status: 'active',
    });
    expect(res.body.kyc.status).toBe('submitted');
    expect(res.body.kyc.form.panNumber).toBe('AAAAA0000A');
    expect(res.body.kyc.documents).toEqual([
      { key: 'panScan', label: 'PAN card', path: `${V1}/pan_1.pdf` },
      { key: 'other_1', label: 'Lease', path: `${V1}/other_1.pdf` },
    ]);
    expect(res.body.kyc.ifsc_verified_at).toBe('2026-09-09T00:00:00Z');
    expect(res.body.activity).toMatchObject({ loads_total: 1, loads_open: 1, loads_awarded: 0, invoices: 0 });
  });

  it('shows a vendor without a KYC profile as pending, and 404s for others', async () => {
    const none = await request(app).get(`/api/v1/vendor/registry/${V2}`).set(bearer(SUPER));
    expect(none.status).toBe(200);
    expect(none.body.kyc).toMatchObject({ status: 'pending', form: {}, documents: [] });
    expect((await request(app).get(`/api/v1/vendor/registry/${PARTNER}`).set(bearer(SUPER))).status).toBe(404);
    expect((await request(app).get(`/api/v1/vendor/registry/${ADMIN}`).set(bearer(SUPER))).status).toBe(404);
    expect((await request(app).get('/api/v1/vendor/registry/00000000-0000-4000-8000-0000000000ff').set(bearer(SUPER))).status).toBe(404);
  });
});

describe('POST /vendor/kyc/:id/request-info', () => {
  const send = (body: unknown, id = V1, token = bearer(SUPER)) => request(app).post(`/api/v1/vendor/kyc/${id}/request-info`).set(token).send(body as object);
  const body = { message: 'Please clarify', items: [{ label: 'Latest GST return', kind: 'document' }, { label: 'Years in business', kind: 'text', hint: 'a number' }] };

  it('records the request, moves the KYC to info_requested, tells the vendor and audits', async () => {
    const res = await send(body);
    expect(res.status).toBe(201);
    expect(supabaseMock.rows('vendor_profiles')[0].kyc_status).toBe('info_requested');
    const [saved] = supabaseMock.rows('kyc_info_requests');
    expect(saved).toMatchObject({ vendor_id: V1, status: 'open', requested_by: SUPER });
    expect(saved.items.map((i: any) => i.key)).toEqual(['latest_gst_return_1', 'years_in_business_2']);
    expect(supabaseMock.writes('notifications', 'POST')[0].body).toMatchObject({ user_id: V1, type: 'kyc_info_requested' });
    expect(supabaseMock.writes('ai_agent_logs', 'POST')[0].body).toMatchObject({ action: 'kyc_info_requested' });
  });

  it('is a 409 when the KYC is not waiting for review', async () => {
    reset('approved');
    const res = await send(body);
    expect(res.status).toBe(409);
    expect(supabaseMock.rows('kyc_info_requests')).toHaveLength(0);
    reset('pending');
    expect((await send(body)).status).toBe(409);
  });

  it('rejects an empty or oversized ask and non-platform callers', async () => {
    expect((await send({ items: [] })).status).toBe(400);
    expect((await send({ items: [{ label: 'x', kind: 'file' }] })).status).toBe(400);
    expect((await send(body, V1, bearer(ADMIN))).status).toBe(403);
    expect((await send(body, V1, bearer(V1))).status).toBe(403);
  });

  it('cannot be approved while information is requested', async () => {
    await send(body);
    const res = await request(app).put(`/api/v1/vendor/kyc/${V1}/approve`).set(bearer(SUPER));
    expect(res.status).toBe(409);
  });
});

describe('vendor answers', () => {
  const REQ = '00000000-0000-4000-8000-0000000000c1';
  const items = [
    { key: 'latest_gst_return_1', label: 'Latest GST return', kind: 'document', hint: null },
    { key: 'years_in_business_2', label: 'Years in business', kind: 'text', hint: null },
  ];
  beforeEach(() => reset('info_requested', { kyc_info_requests: [{ id: REQ, vendor_id: V1, status: 'open', items, requested_at: '2026-09-11T00:00:00Z', answers: {} }] }));
  const respond = (answers: unknown[], token = bearer(V1)) => request(app).post('/api/v1/vendor/kyc/respond').set(token).send({ request_id: REQ, answers });

  it('lists the vendor\'s open requests', async () => {
    const res = await request(app).get('/api/v1/vendor/kyc/requests').set(bearer(V1));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect((await request(app).get('/api/v1/vendor/kyc/requests').set(bearer(ADMIN))).status).toBe(403);
  });

  it('needs every item answered and files from the vendor\'s own folder', async () => {
    expect((await respond([{ key: 'years_in_business_2', text: '5' }])).status).toBe(400);
    expect((await respond([{ key: 'latest_gst_return_1', document_path: `${V2}/x.pdf` }, { key: 'years_in_business_2', text: '5' }])).status).toBe(400);
    expect((await respond([{ key: 'latest_gst_return_1', document_path: `${V1}/gst.pdf` }, { key: 'years_in_business_2', text: '  ' }])).status).toBe(400);
    expect(supabaseMock.rows('kyc_info_requests')[0].status).toBe('open');
  });

  it('stores the answers, adds them to the KYC and sends it back to review', async () => {
    const res = await respond([{ key: 'latest_gst_return_1', document_path: `${V1}/gst.pdf` }, { key: 'years_in_business_2', text: '5' }]);
    expect(res.status).toBe(200);
    const [req] = supabaseMock.rows('kyc_info_requests');
    expect(req.status).toBe('answered');
    expect(req.answered_at).toBeTruthy();
    const [profile] = supabaseMock.rows('vendor_profiles');
    expect(profile.kyc_status).toBe('submitted');
    expect(profile.kyc_data.otherDocs).toContainEqual({ name: 'Latest GST return', path: `${V1}/gst.pdf` });
    expect(profile.kyc_data.extra).toEqual({ 'Years in business': '5' });
    expect(supabaseMock.writes('ai_agent_logs', 'POST')[0].body).toMatchObject({ action: 'kyc_info_answered' });
    expect((await respond([])).status).toBe(409);
  });
});
