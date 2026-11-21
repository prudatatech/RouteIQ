/**
 * Staff enters a vendor KYC, a logistic company registration, or a 3PL application on behalf of
 * someone who phoned or WhatsApp'd their details in instead of using the sign-up form themselves.
 * Each path goes through the normal review queue unchanged - no auto-approval - and the applicant's
 * own account is found or invited so they can log in later.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { as, orgWorld, uid } from './support/org-world';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (id: string) => ({ Authorization: `Bearer ${supabaseMock.signUserToken(id)}` });

describe('POST /vendor/admin/kyc/applicants/create', () => {
  const SUPER = bearer('super-1');
  const PAYLOAD = {
    email: 'new-vendor@example.test',
    full_name: 'Phoned-in Owner',
    companyName: 'Phoned-in Traders',
    gstNumber: '27ABCDE1234F1Z0',
    city: 'Pune',
    address: '1 MG Road, Pune',
    lat: 18.5,
    lng: 73.8,
    companyLogo: null,
    kycData: { data: { name: 'Phoned-in Traders', entityType: 'Proprietorship', authorizedSignatoryName: 'Phoned-in Owner' }, otherDocs: [] },
  };

  function reset(users: Record<string, unknown>[] = [{ id: 'super-1', role: 'superadmin', is_active: true }]) {
    supabaseMock.reset({ users, vendor_profiles: [], notifications: [] });
    supabaseMock.authAdmin = true;
  }

  beforeEach(() => reset());

  it('invites a brand-new applicant and submits their KYC into the normal review queue', async () => {
    const res = await request(app).post(api('/vendor/admin/kyc/applicants/create')).set(SUPER).send(PAYLOAD);
    expect(res.status).toBe(200);
    expect(res.body.kyc_status).toBe('submitted');

    const invited = supabaseMock.authCalls.find(c => c.op === 'invite');
    expect(invited?.body.email).toBe(PAYLOAD.email);

    const profile = supabaseMock.rows('vendor_profiles')[0];
    expect(profile).toMatchObject({ company_name: 'Phoned-in Traders', kyc_status: 'submitted' });
    expect(profile.created_by).toBe('super-1');
  });

  it('reuses an existing account instead of inviting it again', async () => {
    reset([{ id: 'super-1', role: 'superadmin', is_active: true }, { id: 'existing-vendor', email: PAYLOAD.email, role: 'vendor', is_active: true }]);
    const res = await request(app).post(api('/vendor/admin/kyc/applicants/create')).set(SUPER).send(PAYLOAD);
    expect(res.status).toBe(200);
    expect(supabaseMock.authCalls.some(c => c.op === 'invite')).toBe(false);
    expect(supabaseMock.rows('vendor_profiles')[0].id).toBe('existing-vendor');
  });

  it('refuses to onboard an email that already belongs to a staff account', async () => {
    reset([{ id: 'super-1', role: 'superadmin', is_active: true }, { id: 'admin-x', email: PAYLOAD.email, role: 'admin', is_active: true }]);
    const res = await request(app).post(api('/vendor/admin/kyc/applicants/create')).set(SUPER).send(PAYLOAD);
    expect(res.status).toBe(409);
  });

  it('is superadmin only', async () => {
    const res = await request(app).post(api('/vendor/admin/kyc/applicants/create')).send(PAYLOAD);
    expect(res.status).toBe(401);
  });
});

describe('POST /admin/orgs/create-on-behalf', () => {
  const SUPER = as('super-1');
  const PAYLOAD = {
    email: 'new-company@example.test',
    full_name: 'Phoned-in Owner',
    kind: 'logistic_company',
    name: 'Phoned-in Carriers',
    legal_name: 'Phoned-in Carriers Pvt Ltd',
    entity_type: 'Proprietorship',
    authorized_signatory_name: 'Phoned-in Owner',
  };

  beforeEach(() => {
    supabaseMock.reset(orgWorld());
    supabaseMock.authAdmin = true;
  });

  it('invites the applicant as owner and leaves the company pending, not yet KYC-submitted', async () => {
    const res = await request(app).post(api('/admin/orgs/create-on-behalf')).set(SUPER).send(PAYLOAD);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'pending', name: 'Phoned-in Carriers' });
    expect(res.body.kyc_submitted_at ?? null).toBeNull();

    const invited = supabaseMock.authCalls.find(c => c.op === 'invite');
    expect(invited?.body.email).toBe(PAYLOAD.email);

    const member = supabaseMock.rows('org_members').find((m: any) => m.org_id === res.body.id);
    expect(member).toMatchObject({ role: 'owner', status: 'active' });
    expect(member!.user_id).not.toBe(uid('super-1'));
  });

  it('refuses a vendor-kind create (only a logistic company goes through this route)', async () => {
    const res = await request(app).post(api('/admin/orgs/create-on-behalf')).set(SUPER).send({ ...PAYLOAD, kind: 'vendor' });
    expect(res.status).toBe(400);
  });

  it('lets staff finish the company through the same upload-url, documents and submit routes self-service uses', async () => {
    const created = await request(app).post(api('/admin/orgs/create-on-behalf')).set(SUPER).send(PAYLOAD);
    const id = created.body.id;

    const upload = await request(app).post(api(`/admin/orgs/${id}/kyc/upload-url`)).set(SUPER).send({ key: 'panScan', content_type: 'application/pdf', size: 1000 });
    expect(upload.status).toBe(200);

    const patched = await request(app).patch(api(`/admin/orgs/${id}`)).set(SUPER).send({
      gstin: '27AAAPL1234C1ZV', pan: 'AAAPL1234C', profile: { bank_account_no: '123456789012', bank_ifsc: 'HDFC0001234' },
    });
    expect(patched.status).toBe(200);

    const docs = await request(app).put(api(`/admin/orgs/${id}/kyc/documents`)).set(SUPER).send({
      docUrls: {
        gstRegistration: `${id}/gstRegistration_1.pdf`, panScan: `${id}/panScan_1.pdf`, companyRegistration: `${id}/companyRegistration_1.pdf`,
        cancelledCheque: `${id}/cancelledCheque_1.pdf`, addressProof: `${id}/addressProof_1.pdf`,
      },
    });
    expect(docs.status).toBe(200);

    const submitted = await request(app).post(api(`/admin/orgs/${id}/kyc/submit`)).set(SUPER).send({});
    expect(submitted.status).toBe(200);
    expect(submitted.body.kyc_submitted_at).not.toBeNull();
  });

  it('is platform-admin only', async () => {
    const res = await request(app).post(api('/admin/orgs/create-on-behalf')).send(PAYLOAD);
    expect(res.status).toBe(401);
  });
});

describe('POST /tpl/admin/create', () => {
  const SUPER = bearer('super-1');
  const PAYLOAD = {
    companyName: 'Phoned-in 3PL', contactName: 'Priya Rao', email: 'phoned-in-3pl@example.test', pan: 'ABCDE1234F',
    gst: '27ABCDE1234F1Z0', entityType: 'Proprietorship', authorizedSignatoryName: 'Priya Rao',
    bankAccount: '123456789012', bankIfsc: 'HDFC0001234',
  };

  beforeEach(() => {
    supabaseMock.reset({ users: [{ id: 'super-1', role: 'superadmin', is_active: true }], tpl_partners: [] });
  });

  it('creates the application tagged with the staff member who entered it, still pending review', async () => {
    const res = await request(app).post(api('/tpl/admin/create')).set(SUPER).send(PAYLOAD);
    expect(res.status).toBe(200);
    const written = supabaseMock.writes('tpl_partners', 'POST')[0].body;
    expect(written).toMatchObject({ company_name: 'Phoned-in 3PL', status: 'pending', created_by: 'super-1', user_id: null });
  });

  it('is superadmin only', async () => {
    const res = await request(app).post(api('/tpl/admin/create')).send(PAYLOAD);
    expect(res.status).toBe(401);
  });
});
