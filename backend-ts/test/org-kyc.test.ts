/**
 * A logistic company's KYC documents: upload, save (with per-document flag clearing), submit for
 * review, and the platform flagging specific documents instead of rejecting the whole application.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { ORG, as, orgWorld, uid } from './support/org-world';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;

const PCO = 'a0000000-0000-4000-8000-0000000000e5';

const REQUIRED_DOCS: Record<string, string> = {
  gstRegistration: `${PCO}/gstRegistration_1.pdf`,
  panScan: `${PCO}/panScan_1.pdf`,
  companyRegistration: `${PCO}/companyRegistration_1.pdf`,
  cancelledCheque: `${PCO}/cancelledCheque_1.pdf`,
  addressProof: `${PCO}/addressProof_1.pdf`,
};

function reset(over: {
  status?: string; gstin?: string | null; pan?: string | null; profile?: Record<string, unknown>; kyc_documents?: unknown; kyc_document_issues?: unknown;
  kyc_submitted_at?: string | null; entity_type?: string | null; cin?: string | null; authorized_signatory_name?: string | null;
} = {}) {
  const world = orgWorld();
  world.organizations.push({
    id: PCO,
    kind: 'logistic_company',
    name: 'Pending Carriers Co',
    status: over.status ?? 'pending',
    gstin: 'gstin' in over ? over.gstin : '27AAAPL1234C1ZV',
    pan: 'pan' in over ? over.pan : 'AAAPL1234C',
    profile: over.profile ?? { bank_account_no: '123456789012', bank_ifsc: 'HDFC0001234' },
    kyc_documents: over.kyc_documents ?? null,
    kyc_document_issues: over.kyc_document_issues ?? null,
    kyc_submitted_at: 'kyc_submitted_at' in over ? over.kyc_submitted_at : null,
    entity_type: 'entity_type' in over ? over.entity_type : 'Proprietorship',
    cin: 'cin' in over ? over.cin : null,
    authorized_signatory_name: 'authorized_signatory_name' in over ? over.authorized_signatory_name : 'Priya Owner',
    created_at: '2026-10-02T00:00:00Z',
  });
  world.org_members.push({ org_id: PCO, user_id: uid('pco-owner'), role: 'owner', status: 'active', created_at: '2026-10-02T00:00:00Z', organizations: world.organizations.find(o => o.id === PCO) });
  world.users.push({ id: uid('pco-owner'), role: 'admin', full_name: 'Priya Owner', email: 'priya@pco.test', is_active: true });
  supabaseMock.reset(world);
}

beforeEach(() => reset());

const owner = () => as('pco-owner', PCO);

describe('POST /org/kyc/documents/upload-url', () => {
  it('issues a signed URL inside the company own folder', async () => {
    const res = await request(app).post(api('/org/kyc/documents/upload-url')).set(owner()).send({ key: 'panScan', content_type: 'application/pdf', size: 1000 });
    expect(res.status).toBe(200);
    expect(res.body.path).toMatch(new RegExp(`^${PCO}/panScan_[0-9a-f-]{36}\\.pdf$`));
  });

  it('needs a signed-in owner or admin acting for a logistic company', async () => {
    const body = { key: 'panScan', content_type: 'application/pdf', size: 10 };
    expect((await request(app).post(api('/org/kyc/documents/upload-url')).send(body)).status).toBe(401);
    expect((await request(app).post(api('/org/kyc/documents/upload-url')).set(as('driver-a', ORG.companyA)).send(body)).status).toBe(403);
  });
});

describe('PUT /org/kyc/documents', () => {
  it('saves document paths and keeps the rest', async () => {
    const res = await request(app).put(api('/org/kyc/documents')).set(owner()).send({ docUrls: { panScan: REQUIRED_DOCS.panScan } });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('organizations').find(o => o.id === PCO)!.kyc_documents).toMatchObject({ docUrls: { panScan: REQUIRED_DOCS.panScan } });
  });

  it('refuses a path outside the company own folder', async () => {
    const res = await request(app).put(api('/org/kyc/documents')).set(owner()).send({ docUrls: { panScan: `${ORG.companyA}/x.pdf` } });
    expect(res.status).toBe(400);
  });

  it('clears a flagged document the moment it is re-uploaded, without touching other flags', async () => {
    reset({ kyc_documents: { docUrls: { panScan: `${PCO}/panScan_old.pdf`, gstRegistration: `${PCO}/gst_old.pdf` } }, kyc_document_issues: { panScan: 'Blurry scan', gstRegistration: 'Expired' } });
    const res = await request(app).put(api('/org/kyc/documents')).set(owner()).send({ docUrls: { panScan: `${PCO}/panScan_new.pdf`, gstRegistration: `${PCO}/gst_old.pdf` } });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('organizations').find(o => o.id === PCO)!.kyc_document_issues).toEqual({ gstRegistration: 'Expired' });
  });
});

describe('POST /org/kyc/submit', () => {
  it('submits once every required document, GSTIN, PAN and bank detail is present', async () => {
    reset({ kyc_documents: { docUrls: REQUIRED_DOCS } });
    const res = await request(app).post(api('/org/kyc/submit')).set(owner());
    expect(res.status).toBe(200);
    const row = supabaseMock.rows('organizations').find(o => o.id === PCO)!;
    expect(typeof row.kyc_submitted_at).toBe('string');
    expect(row.status).toBe('pending');
    const [note] = supabaseMock.writes('notifications', 'POST');
    expect(note.body).toMatchObject({ type: 'org_kyc_submitted' });
  });

  it('refuses when a required document is missing', async () => {
    reset({ kyc_documents: { docUrls: { panScan: REQUIRED_DOCS.panScan } } });
    const res = await request(app).post(api('/org/kyc/submit')).set(owner());
    expect(res.status).toBe(400);
  });

  it('refuses when GSTIN or bank details are missing', async () => {
    reset({ kyc_documents: { docUrls: REQUIRED_DOCS }, gstin: null });
    expect((await request(app).post(api('/org/kyc/submit')).set(owner())).status).toBe(400);
    reset({ kyc_documents: { docUrls: REQUIRED_DOCS }, profile: {} });
    expect((await request(app).post(api('/org/kyc/submit')).set(owner())).status).toBe(400);
  });

  it('refuses when the entity type or the authorized signatory name is missing', async () => {
    reset({ kyc_documents: { docUrls: REQUIRED_DOCS }, entity_type: null });
    expect((await request(app).post(api('/org/kyc/submit')).set(owner())).status).toBe(400);
    reset({ kyc_documents: { docUrls: REQUIRED_DOCS }, authorized_signatory_name: null });
    expect((await request(app).post(api('/org/kyc/submit')).set(owner())).status).toBe(400);
  });

  it('refuses a Private Limited company with no CIN, and accepts one with a well-formed CIN', async () => {
    reset({ kyc_documents: { docUrls: REQUIRED_DOCS }, entity_type: 'Private Limited', cin: null });
    expect((await request(app).post(api('/org/kyc/submit')).set(owner())).status).toBe(400);
    reset({ kyc_documents: { docUrls: REQUIRED_DOCS }, entity_type: 'Private Limited', cin: 'U74999DL2019PTC123456' });
    expect((await request(app).post(api('/org/kyc/submit')).set(owner())).status).toBe(200);
  });

  it('resubmitting after a rejection goes back to pending and clears the rejection reason', async () => {
    reset({ status: 'rejected', profile: { bank_account_no: '123456789012', bank_ifsc: 'HDFC0001234', reject_reason: 'GSTIN mismatch' }, kyc_documents: { docUrls: REQUIRED_DOCS } });
    const res = await request(app).post(api('/org/kyc/submit')).set(owner());
    expect(res.status).toBe(200);
    const row = supabaseMock.rows('organizations').find(o => o.id === PCO)!;
    expect(row.status).toBe('pending');
    expect(row.profile.reject_reason).toBeNull();
  });

  it('never retroactively blocks an already-active company that predates this field (no backfill gate)', async () => {
    reset({ status: 'active', entity_type: null, authorized_signatory_name: null });
    const res = await request(app).get(api('/org')).set(owner());
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
  });
});

describe('PUT /admin/orgs/:id/flag-documents', () => {
  const flag = (issues: Record<string, string>, who = 'super-1') =>
    request(app).put(api(`/admin/orgs/${PCO}/flag-documents`)).set(as(who)).send({ issues });

  it('flags specific documents, notifies the company and unlocks it to fix just those', async () => {
    reset({ kyc_documents: { docUrls: REQUIRED_DOCS }, kyc_submitted_at: '2026-10-05T00:00:00Z' });
    const res = await flag({ panScan: 'Blurry scan' });
    expect(res.status).toBe(200);
    const row = supabaseMock.rows('organizations').find(o => o.id === PCO)!;
    expect(row.kyc_document_issues).toEqual({ panScan: 'Blurry scan' });
    expect(row.kyc_submitted_at).toBeNull();
    expect(row.status).toBe('pending');
    const [note] = supabaseMock.writes('notifications', 'POST');
    expect(note.body).toMatchObject({ type: 'org_kyc_document_flagged' });
  });

  it('refuses an unknown document key', async () => {
    reset({ kyc_documents: { docUrls: REQUIRED_DOCS }, kyc_submitted_at: '2026-10-05T00:00:00Z' });
    expect((await flag({ notARealDoc: 'bad document' })).status).toBe(400);
  });

  it('refuses while the company has not submitted (nothing to flag yet)', async () => {
    const res = await flag({ panScan: 'Blurry scan' });
    expect(res.status).toBe(409);
  });

  it('is for platform admins only', async () => {
    reset({ kyc_documents: { docUrls: REQUIRED_DOCS }, kyc_submitted_at: '2026-10-05T00:00:00Z' });
    expect((await flag({ panScan: 'x' }, 'admin-a')).status).toBe(403);
  });
});
