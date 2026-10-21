import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { emailService } from '../src/services/email.service';

const app = testApp();
const PID = '11111111-1111-1111-1111-111111111111';
const bearer = (id: string) => ({ Authorization: `Bearer ${supabaseMock.signUserToken(id)}` });

function partner(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: PID,
    custom_id: 'acme_3pl',
    company_name: 'Acme 3PL',
    status,
    email: 'ops@acme.in',
    pan_number: 'ABCDE1234F',
    gstin: '27ABCDE1234F1Z5',
    entity_type: 'Proprietorship',
    authorized_signatory_name: 'Priya Rao',
    bank_account_no: '123456789012',
    bank_ifsc: 'HDFC0001234',
    user_id: 'partner-user',
    pending_updates: null,
    tpl_corridors: [],
    tpl_documents: [{ id: 'doc-1', file_url: `${PID}/pan_old.pdf`, doc_type: 'PAN Card' }],
    ...extra,
  };
}

function reset(status = 'active', extra: Record<string, unknown> = {}) {
  supabaseMock.reset({
    users: [
      { id: 'partner-user', role: 'vendor', is_active: true },
      { id: 'other-partner', role: 'vendor', is_active: true },
      { id: 'admin-1', role: 'admin', is_active: true },
      { id: 'super-1', role: 'superadmin', is_active: true },
      { id: 'driver-1', role: 'driver', is_active: true },
    ],
    vendor_profiles: [],
    tpl_partners: [
      partner(status, extra),
      { id: 'p2', company_name: 'Other', status: 'active', user_id: 'other-partner', tpl_corridors: [], tpl_documents: [] },
    ],
    tpl_documents: [{ id: 'doc-1', partner_id: PID, file_url: `${PID}/pan_old.pdf`, doc_type: 'PAN Card' }],
    tpl_corridors: [],
    notifications: [],
    ai_agent_logs: [],
  });
}

beforeEach(() => reset());

describe('partner document replacement', () => {
  const replace = (path: unknown, token = bearer('partner-user'), docId = 'doc-1') =>
    request(app).post(`/api/v1/tpl/${PID}/documents/${docId}/replace`).set(token).send({ path });

  it('swaps the file, sends an active partner back to review and tells superadmin', async () => {
    const res = await replace(`${PID}/pan_new.pdf`);
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('tpl_documents')[0].file_url).toBe(`${PID}/pan_new.pdf`);
    expect(supabaseMock.rows('tpl_partners')[0].status).toBe('pending');
    const recipients = supabaseMock.writes('notifications', 'POST').map(w => w.body.user_id).sort();
    // Admin can open the 3PL pages too
    expect(recipients).toEqual(['admin-1', 'super-1']);
    expect(supabaseMock.writes('ai_agent_logs', 'POST')[0].body).toMatchObject({ action: 'tpl_document_replaced', agent_name: 'partner-portal' });
  });

  it.each([
    ['a file in another folder', 'p2/pan.pdf'],
    ['a nested path', `${PID}/a/b.pdf`],
    ['a path with dots', `${PID}/../p2/x.pdf`],
    ['no path at all', undefined],
    ['a path that is not text', 42],
  ])('refuses %s', async (_name, path) => {
    const res = await replace(path);
    expect(res.status).toBe(400);
    expect(supabaseMock.rows('tpl_documents')[0].file_url).toBe(`${PID}/pan_old.pdf`);
  });

  it('refuses a document that is not this partner\'s', async () => {
    expect((await replace(`${PID}/x.pdf`, bearer('partner-user'), 'doc-9')).status).toBe(404);
  });

  it('is only for the partner that owns the record', async () => {
    expect((await request(app).post(`/api/v1/tpl/${PID}/documents/doc-1/replace`).send({ path: `${PID}/x.pdf` })).status).toBe(401);
    expect((await replace(`${PID}/x.pdf`, bearer('other-partner'))).status).toBe(403);
    expect((await replace(`${PID}/x.pdf`, bearer('driver-1'))).status).toBe(403);
    expect((await replace(`${PID}/x.pdf`, bearer('admin-1'))).status).toBe(403);
    expect(supabaseMock.rows('tpl_documents')[0].file_url).toBe(`${PID}/pan_old.pdf`);
  });

  it('will not let a paused or rejected partner get back in through a document swap', async () => {
    reset('paused');
    expect((await replace(`${PID}/x.pdf`)).status).toBe(409);
    reset('rejected');
    expect((await replace(`${PID}/x.pdf`)).status).toBe(409);
    expect(supabaseMock.rows('tpl_partners')[0].status).toBe('rejected');
  });

  it('lets staff update an active partner\'s document without sending it back to review', async () => {
    const res = await replace(`${PID}/pan_new.pdf`, bearer('super-1'));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('active');
    expect(supabaseMock.rows('tpl_documents')[0].file_url).toBe(`${PID}/pan_new.pdf`);
    expect(supabaseMock.rows('tpl_partners')[0].status).toBe('active');
    // The partner is told; staff is not told to re-review its own action
    const recipients = supabaseMock.writes('notifications', 'POST').map(w => w.body.user_id);
    expect(recipients).toEqual(['partner-user']);
  });

  it('lets staff update a paused partner\'s document too, unlike the partner itself', async () => {
    reset('paused');
    expect((await replace(`${PID}/x.pdf`)).status).toBe(409); // the partner itself still cannot
    const res = await replace(`${PID}/pan_new.pdf`, bearer('super-1'));
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('tpl_partners')[0].status).toBe('paused');
  });
});

describe('partner settings request', () => {
  const GOOD = {
    sla_commitment: '4 Hours',
    tax_treatment: '5% GTA (No ITC) - Reverse Charge',
    corridors: [{ id: 1, name: 'DEL-BOM', vehicles: '32ft SXL', rate: '45000', rate_unit: 'per_trip', priority: '1' }],
  };
  const send = (body: Record<string, unknown>, token = bearer('partner-user')) =>
    request(app).post(`/api/v1/tpl/${PID}/settings`).set(token).send(body);

  it('keeps the request as pending updates without changing live settings', async () => {
    const res = await send(GOOD);
    expect(res.status).toBe(200);
    const row = supabaseMock.rows('tpl_partners')[0];
    expect(row.status).toBe('pending');
    expect(row.pending_updates).toMatchObject({ sla_commitment: '4 Hours', corridors: GOOD.corridors });
    expect(row.sla_commitment).toBeUndefined();
    expect(supabaseMock.rows('tpl_corridors')).toHaveLength(0);
    // Admin and superadmin are told
    expect(supabaseMock.writes('notifications', 'POST')).toHaveLength(2);
  });

  it.each([
    ['an unknown SLA', { sla_commitment: '1 Minute' }],
    ['an unknown tax treatment', { tax_treatment: '0% for me' }],
    ['a negative rate', { corridors: [{ name: 'DEL-BOM', rate: '-5', rate_unit: 'per_trip' }] }],
    ['a rate without a unit', { corridors: [{ name: 'DEL-BOM', rate: '45000' }] }],
    ['a rate with an unknown unit', { corridors: [{ name: 'DEL-BOM', rate: '45000', rate_unit: 'per_mile' }] }],
    ['a rate that is not a number', { corridors: [{ name: 'DEL-BOM', rate: 'cheap', rate_unit: 'per_trip' }] }],
    ['a huge rate', { corridors: [{ name: 'DEL-BOM', rate: '999999999', rate_unit: 'per_trip' }] }],
    ['a corridor without a name', { corridors: [{ name: '', rate: '10' }] }],
    ['too many corridors', { corridors: Array.from({ length: 31 }, (_, i) => ({ name: `L${i}`, rate: '10' })) }],
    ['a bad priority', { corridors: [{ name: 'DEL-BOM', rate: '10', priority: '9' }] }],
    ['corridors that are not a list', { corridors: 'all' }],
  ])('refuses %s', async (_name, change) => {
    const res = await send({ ...GOOD, ...change });
    expect(res.status).toBe(400);
    expect(supabaseMock.rows('tpl_partners')[0].status).toBe('active');
  });

  it('cannot smuggle other columns in', async () => {
    const res = await send({ ...GOOD, status: 'active', pan_number: 'ZZZZZ9999Z', user_id: 'me' });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('tpl_partners')[0]).toMatchObject({ pan_number: 'ABCDE1234F', user_id: 'partner-user' });
  });

  it('is only for the partner that owns the record, and not while paused', async () => {
    expect((await request(app).post(`/api/v1/tpl/${PID}/settings`).send(GOOD)).status).toBe(401);
    expect((await send(GOOD, bearer('other-partner'))).status).toBe(403);
    expect((await send(GOOD, bearer('admin-1'))).status).toBe(403);
    reset('paused');
    expect((await send(GOOD)).status).toBe(409);
    expect(supabaseMock.rows('tpl_partners')[0].status).toBe('paused');
  });
});

describe('staff decisions on partners', () => {
  const act = (verb: string, token = bearer('super-1'), body?: Record<string, unknown>) =>
    request(app).post(`/api/v1/tpl/${verb}`).set(token).send(body ?? {});

  it.each([
    ['PAN', { pan_number: null }, 'PAN'],
    ['bank account', { bank_account_no: null }, 'bank details'],
    ['IFSC', { bank_ifsc: null }, 'bank details'],
    ['entity type', { entity_type: null }, 'entity type'],
    ['authorized signatory name', { authorized_signatory_name: null }, 'authorized signatory name'],
  ])('refuses to approve a quick-onboarded application missing its %s', async (_name, extra, expectedWord) => {
    reset('pending', extra);
    const res = await act(`approve/${PID}`);
    expect(res.status).toBe(409);
    expect(res.body.detail ?? res.body.error).toContain(expectedWord);
    expect(supabaseMock.rows('tpl_partners')[0].status).toBe('pending');
  });

  it('refuses to approve a quick-onboarded application whose entity type needs a CIN but has none', async () => {
    reset('pending', { entity_type: 'Private Limited', cin: null });
    const res = await act(`approve/${PID}`);
    expect(res.status).toBe(409);
    expect(res.body.detail ?? res.body.error).toContain('CIN');
    expect(supabaseMock.rows('tpl_partners')[0].status).toBe('pending');
  });

  it('approves a partner whose entity type needs a CIN once one is on file', async () => {
    reset('pending', { entity_type: 'Private Limited', cin: 'U74999DL2019PTC123456' });
    expect((await act(`approve/${PID}`)).status).toBe(200);
    expect(supabaseMock.rows('tpl_partners')[0].status).toBe('active');
  });

  it('approves a partner who has no GSTIN on file (GSTIN is optional)', async () => {
    reset('pending', { gstin: null });
    expect((await act(`approve/${PID}`)).status).toBe(200);
    expect(supabaseMock.rows('tpl_partners')[0].status).toBe('active');
  });

  it('never retroactively blocks an already-active partner that predates this field (no backfill gate)', async () => {
    reset('active', { entity_type: null, authorized_signatory_name: null, cin: null });
    expect((await act(`${PID}/pause`)).status).toBe(200);
    expect(supabaseMock.rows('tpl_partners')[0].status).toBe('paused');
  });

  it('refuses to approve a quick-onboarded application with no documents', async () => {
    reset('pending');
    supabaseMock.rows('tpl_documents').length = 0;
    const res = await act(`approve/${PID}`);
    expect(res.status).toBe(409);
    expect(res.body.detail ?? res.body.error).toContain('documents');
    expect(supabaseMock.rows('tpl_partners')[0].status).toBe('pending');
  });

  it('approves a quick-onboarded application (fleet_size set) so staff can connect and complete details', async () => {
    reset('pending', { fleet_size: 'single', pan_number: null, gstin: null, bank_account_no: null, bank_ifsc: null, entity_type: null, authorized_signatory_name: null });
    const res = await act(`approve/${PID}`);
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('tpl_partners')[0].status).toBe('active');
  });

  it('still approves a profile-update request even if PAN/GST/bank are missing', async () => {
    // The compliance gate only applies to a first-time approval; a profile-update request (settings
    // changes, which move status back to 'pending' while open) was already activated once and is not
    // re-vetted here.
    reset('pending', { pan_number: null, gstin: null, bank_account_no: null, bank_ifsc: null, pending_updates: { sla_commitment: '6 Hours' } });
    const res = await act(`approve/${PID}`);
    expect(res.status).toBe(200);
  });

  it('refuses to approve an application with an unresolved flagged document', async () => {
    reset('pending', { document_issues: { 'PAN Card': 'Blurry scan' } });
    const res = await act(`approve/${PID}`);
    expect(res.status).toBe(409);
    expect(supabaseMock.rows('tpl_partners')[0].status).toBe('pending');
  });

  it('clears document_issues on approval, even if somehow left over', async () => {
    reset('pending', { document_issues: null });
    expect((await act(`approve/${PID}`)).status).toBe(200);
    expect(supabaseMock.rows('tpl_partners')[0].document_issues).toBeNull();
  });

  it('approves only a pending partner, tells them and audits it', async () => {
    reset('pending');
    const res = await act(`approve/${PID}`);
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('tpl_partners')[0].status).toBe('active');
    expect(supabaseMock.writes('notifications', 'POST')[0].body).toMatchObject({ user_id: 'partner-user', type: 'tpl_approved' });
    expect(supabaseMock.writes('ai_agent_logs', 'POST')[0].body).toMatchObject({ action: 'tpl_approved' });
  });

  describe('approval email', () => {
    let send: MockInstance;
    beforeEach(() => { send = vi.spyOn(emailService, 'send').mockResolvedValue(true); });

    it('emails a newly approved partner a link to set up their account', async () => {
      reset('pending', { user_id: null });
      expect((await act(`approve/${PID}`)).status).toBe(200);
      expect(send).toHaveBeenCalledTimes(1);
      const [to, subject, html] = send.mock.calls[0];
      expect(to).toBe('ops@acme.in');
      expect(subject).toMatch(/approved/);
      expect(html).toContain('/3pl/onboard/setup?email=ops%40acme.in');
      expect(html).toContain('Acme 3PL');
    });

    it('tells a partner with a linked (Google) account to sign in, rather than a setup link', async () => {
      reset('pending');  // default fixture has user_id: 'partner-user'
      expect((await act(`approve/${PID}`)).status).toBe(200);
      expect(send).toHaveBeenCalledTimes(1);
      const [to, subject, html] = send.mock.calls[0];
      expect(to).toBe('ops@acme.in');
      expect(subject).toMatch(/approved/);
      expect(html).toContain('/login');
      expect(html).not.toContain('/3pl/onboard/setup');
    });

    it('sends nothing for approved profile changes, or when the partner cannot be approved', async () => {
      reset('pending', { pending_updates: { sla_commitment: '6 Hours' } });
      expect((await act(`approve/${PID}`)).status).toBe(200);
      reset('active');
      expect((await act(`approve/${PID}`)).status).toBe(409);
      expect(send).not.toHaveBeenCalled();
    });

    it('still approves when the email does not go out', async () => {
      send.mockResolvedValueOnce(false);
      reset('pending', { user_id: null });
      expect((await act(`approve/${PID}`)).status).toBe(200);
      expect(supabaseMock.rows('tpl_partners')[0].status).toBe('active');
    });
  });

  it('applies requested corridors on approval and keeps live ones until then', async () => {
    reset('pending', { pending_updates: { sla_commitment: '6 Hours', corridors: [{ name: 'DEL-BOM', vehicles: '20ft', rate: '100', rate_unit: 'per_km', priority: '1' }, { name: 'BLR-MAA', rate: '', legacy_rate: 'Base + 12%' }] } });
    expect((await act(`approve/${PID}`)).status).toBe(200);
    expect(supabaseMock.rows('tpl_partners')[0]).toMatchObject({ status: 'active', sla_commitment: '6 Hours', pending_updates: null });
    expect(supabaseMock.rows('tpl_corridors')).toHaveLength(2);
    // A number and a unit are stored as such; older free text is kept as written, without a numeric rate
    expect(supabaseMock.rows('tpl_corridors')[0]).toMatchObject({ corridor_name: 'DEL-BOM', rate_amount: 100, rate_unit: 'per_km', proposed_rate: '₹100 per km' });
    expect(supabaseMock.rows('tpl_corridors')[1]).toMatchObject({ corridor_name: 'BLR-MAA', rate_amount: null, rate_unit: null, proposed_rate: 'Base + 12%' });
  });

  it.each(['active', 'paused', 'rejected'])('will not approve a partner that is %s', async status => {
    reset(status);
    const res = await act(`approve/${PID}`);
    expect(res.status).toBe(409);
    expect(supabaseMock.rows('tpl_partners')[0].status).toBe(status);
    expect(supabaseMock.writes('notifications', 'POST')).toHaveLength(0);
  });

  it('rejects only a pending partner, with a reason', async () => {
    reset('pending');
    expect((await act(`reject/${PID}`, bearer('super-1'), {})).status).toBe(400);
    expect((await act(`reject/${PID}`, bearer('super-1'), { reason: 'PAN does not match' })).status).toBe(200);
    expect(supabaseMock.rows('tpl_partners')[0]).toMatchObject({ status: 'rejected', rejection_reason: 'PAN does not match' });
    reset('active');
    expect((await act(`reject/${PID}`, bearer('super-1'), { reason: 'PAN does not match' })).status).toBe(409);
  });

  it('pauses only an active partner and resumes only a paused one', async () => {
    reset('active');
    expect((await act(`${PID}/pause`)).status).toBe(200);
    expect(supabaseMock.rows('tpl_partners')[0].status).toBe('paused');
    expect((await act(`${PID}/pause`)).status).toBe(409);
    expect((await act(`${PID}/resume`)).status).toBe(200);
    expect(supabaseMock.rows('tpl_partners')[0].status).toBe('active');
    expect((await act(`${PID}/resume`)).status).toBe(409);
    reset('rejected');
    expect((await act(`${PID}/resume`)).status).toBe(409);
    expect(supabaseMock.rows('tpl_partners')[0].status).toBe('rejected');
    reset('pending');
    expect((await act(`${PID}/resume`)).status).toBe(409);
  });

  it('is superadmin only', async () => {
    reset('pending');
    for (const verb of [`approve/${PID}`, `reject/${PID}`, `${PID}/pause`, `${PID}/resume`]) {
      expect((await request(app).post(`/api/v1/tpl/${verb}`).send({ reason: 'nope nope' })).status).toBe(401);
      expect((await act(verb, bearer('admin-1'), { reason: 'nope nope' })).status).toBe(403);
      expect((await act(verb, bearer('partner-user'), { reason: 'nope nope' })).status).toBe(403);
    }
    expect(supabaseMock.rows('tpl_partners')[0].status).toBe('pending');
  });
});

describe('PUT /tpl/:id/flag-documents', () => {
  const flag = (issues: Record<string, string>, token = bearer('super-1')) =>
    request(app).put(`/api/v1/tpl/${PID}/flag-documents`).set(token).send({ issues });

  it('flags a document, notifies the applicant and audits it', async () => {
    reset('pending');
    const res = await flag({ 'PAN Card': 'Blurry scan' });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('tpl_partners')[0].document_issues).toEqual({ 'PAN Card': 'Blurry scan' });
    expect(supabaseMock.writes('notifications', 'POST')[0].body).toMatchObject({ user_id: 'partner-user', type: 'tpl_document_flagged' });
    expect(supabaseMock.writes('ai_agent_logs', 'POST')[0].body).toMatchObject({ action: 'tpl_document_flagged' });
  });

  it('is additive across calls', async () => {
    reset('pending', { document_issues: { 'PAN Card': 'Blurry scan' } });
    expect((await flag({ 'GST Certificate': 'Expired' })).status).toBe(200);
    expect(supabaseMock.rows('tpl_partners')[0].document_issues).toEqual({ 'PAN Card': 'Blurry scan', 'GST Certificate': 'Expired' });
  });

  it('refuses an application that is not pending', async () => {
    reset('active');
    expect((await flag({ 'PAN Card': 'Blurry scan' })).status).toBe(409);
  });

  it('refuses an unknown document type or a reason that is too short', async () => {
    reset('pending');
    expect((await flag({ 'Not A Real Doc': 'bad document' })).status).toBe(400);
    expect((await flag({ 'PAN Card': 'x' })).status).toBe(400);
  });

  it('is superadmin only', async () => {
    reset('pending');
    expect((await request(app).put(`/api/v1/tpl/${PID}/flag-documents`).send({ issues: { 'PAN Card': 'Blurry scan' } })).status).toBe(401);
    expect((await flag({ 'PAN Card': 'Blurry scan' }, bearer('admin-1'))).status).toBe(403);
  });
});

describe('PUT /tpl/:id/flag-details', () => {
  const flagDetails = (issues: Record<string, string>, token = bearer('super-1')) =>
    request(app).put(`/api/v1/tpl/${PID}/flag-details`).set(token).send({ issues });

  it('flags application details, notifies the applicant and audits it', async () => {
    reset('pending');
    const res = await flagDetails({ pan_number: 'PAN name mismatch with MCA', bank_ifsc: 'Invalid IFSC for branch' });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('tpl_partners')[0].field_issues).toEqual({
      pan_number: 'PAN name mismatch with MCA',
      bank_ifsc: 'Invalid IFSC for branch',
    });
    expect(supabaseMock.writes('notifications', 'POST')[0].body).toMatchObject({ user_id: 'partner-user', type: 'tpl_details_flagged' });
    expect(supabaseMock.writes('ai_agent_logs', 'POST')[0].body).toMatchObject({ action: 'tpl_details_flagged' });
  });

  it('normalizes camelCase field keys and is additive across calls', async () => {
    reset('pending', { field_issues: { pan_number: 'PAN mismatch' } });
    const res = await flagDetails({ bankAccount: 'Account number too short' });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('tpl_partners')[0].field_issues).toEqual({
      pan_number: 'PAN mismatch',
      bank_account_no: 'Account number too short',
    });
  });

  it('refuses an application that is not pending', async () => {
    reset('active');
    expect((await flagDetails({ pan_number: 'Mismatch' })).status).toBe(409);
  });

  it('refuses an unknown field or a reason that is too short', async () => {
    reset('pending');
    expect((await flagDetails({ favorite_color: 'Must be blue' })).status).toBe(400);
    expect((await flagDetails({ pan_number: 'x' })).status).toBe(400);
  });

  it('refuses to approve an application with flagged details until fixed', async () => {
    reset('pending', { field_issues: { pan_number: 'Fix name' } });
    const res = await request(app).post(`/api/v1/tpl/approve/${PID}`).set(bearer('super-1')).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('flagged details');
  });

  it('clears matching field_issues when application fields are updated', async () => {
    reset('pending', { field_issues: { pan_number: 'Fix name', bank_account_no: 'Wrong account' } });
    const res = await request(app).patch(`/api/v1/tpl/${PID}`).send({
      verify_pan: 'ABCDE1234F',
      pan: 'ABCDE1234F',
    });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('tpl_partners')[0].field_issues).toEqual({
      bank_account_no: 'Wrong account',
    });
  });
});

describe('auto-generation of 3PL custom_id', () => {
  it('automatically generates a valid unique 3PL custom_id when omitted', async () => {
    const res = await request(app).post('/api/v1/tpl/onboard').send({
      companyName: 'Acme Logistics India',
      contactName: 'Priya Rao',
      email: 'unique_auto_id@northline.example',
      pan: 'ABCDE1234F',
      entityType: 'Proprietorship',
      authorizedSignatoryName: 'Priya Rao',
    });
    expect(res.status).toBe(200);
    const partner = res.body.data;
    expect(partner.custom_id).toBeDefined();
    expect(partner.custom_id).toMatch(/^[a-z0-9_]{5,20}$/);
    expect(partner.custom_id.length).toBeGreaterThanOrEqual(5);
    expect(partner.custom_id.length).toBeLessThanOrEqual(20);
  });
});

describe('application field checks', () => {
  const onboard = (change: Record<string, unknown>) =>
    request(app).post('/api/v1/tpl/onboard').send({
      companyName: 'Northline', contactName: 'Priya Rao', email: 'ops@northline.example', pan: 'ABCDE1234F',
      entityType: 'Proprietorship', authorizedSignatoryName: 'Priya Rao', ...change,
    });

  it.each([
    ['a bad PAN', { pan: 'nope' }],
    ['a bad GSTIN', { gst: '123' }],
    ['a bad IFSC', { bankIfsc: 'XYZ' }],
    ['a bad account number', { bankAccount: '12ab' }],
    ['a negative corridor rate', { corridors: [{ name: 'DEL-BOM', rate: '-1' }] }],
    ['no contact person', { contactName: undefined }],
    ['no company name', { companyName: undefined }],
    ['no entity type', { entityType: undefined }],
    ['an unknown entity type', { entityType: 'Sole Trader' }],
    ['no authorized signatory name', { authorizedSignatoryName: undefined }],
    ['a Private Limited entity with no CIN', { entityType: 'Private Limited' }],
    ['a bad CIN', { entityType: 'Private Limited', cin: 'not-a-cin' }],
  ])('refuses %s', async (_name, change) => {
    reset('pending');
    const res = await onboard(change);
    expect(res.status).toBe(400);
    expect(supabaseMock.writes('tpl_partners', 'POST')).toHaveLength(0);
  });

  it('accepts a full (non-quick) application with entity type, CIN and the authorized signatory', async () => {
    reset('pending');
    const res = await onboard({ email: 'full@northline.example', gst: '27ABCDE1234F1Z0', entityType: 'Private Limited', cin: 'U74999DL2019PTC123456' });
    expect(res.status).toBe(200);
    const written = supabaseMock.writes('tpl_partners', 'POST')[0].body;
    expect(written).toMatchObject({ entity_type: 'Private Limited', cin: 'U74999DL2019PTC123456', authorized_signatory_name: 'Priya Rao' });
  });

  it('stores the company name and the contact person under their own columns', async () => {
    reset('pending');
    const res = await request(app).post('/api/v1/tpl/onboard').send({
      companyName: 'Acme Logistics Pvt Ltd', contactName: 'Priya Rao', email: 'new@northline.example', fleetSize: 'single', truckType: '32ft_sxl', user_id: 'new-user',
    });
    expect(res.status).toBe(200);
    const written = supabaseMock.writes('tpl_partners', 'POST')[0].body;
    expect(written).toMatchObject({ company_name: 'Acme Logistics Pvt Ltd', contact_name: 'Priya Rao' });
  });

  it('does not require entity type, CIN or the authorized signatory for a quick (fleet-size) application', async () => {
    reset('pending');
    const res = await request(app).post('/api/v1/tpl/onboard').send({
      companyName: 'Acme Logistics Pvt Ltd', contactName: 'Priya Rao', email: 'quick2@northline.example', fleetSize: 'single', truckType: '32ft_sxl',
    });
    expect(res.status).toBe(200);
    const written = supabaseMock.writes('tpl_partners', 'POST')[0].body;
    expect(written).toMatchObject({ entity_type: null, cin: null, authorized_signatory_name: null });
  });

  it('refuses a quick application missing the contact person even with no PAN yet', async () => {
    reset('pending');
    const res = await request(app).post('/api/v1/tpl/onboard').send({
      companyName: 'Acme Logistics Pvt Ltd', email: 'new2@northline.example', fleetSize: 'single', truckType: '32ft_sxl',
    });
    expect(res.status).toBe(400);
    expect(supabaseMock.writes('tpl_partners', 'POST')).toHaveLength(0);
  });

  it('updateApplication accepts and stores entity type, CIN and the authorized signatory', async () => {
    reset('pending');
    const res = await request(app).patch(`/api/v1/tpl/${PID}`).send({
      verify_pan: 'ABCDE1234F', entityType: 'LLP', cin: 'U74999DL2019PTC654321', authorizedSignatoryName: 'New Signatory',
    });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('tpl_partners')[0]).toMatchObject({
      entity_type: 'LLP', cin: 'U74999DL2019PTC654321', authorized_signatory_name: 'New Signatory',
    });
  });

  it('updateApplication accepts empty string gst: "" without failing or demanding GSTIN', async () => {
    reset('pending');
    const res = await request(app).patch(`/api/v1/tpl/${PID}`).send({
      verify_pan: 'ABCDE1234F', gst: '',
    });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('tpl_partners')[0].gstin).toBeNull();
  });
});

describe('GET /tpl/:id/history', () => {
  const history = (id = PID, token = bearer('super-1')) => request(app).get(`/api/v1/tpl/${id}/history`).set(token);

  it('lists this partner\'s audited decisions, newest first, with the actor\'s name', async () => {
    // Name resolution looks the actor up by a real (uuid-shaped) id, unlike this file's other
    // shorthand bearer ids - add one just for this test.
    const SUE = '22222222-2222-2222-2222-222222222222';
    supabaseMock.rows('users').push({ id: SUE, role: 'superadmin', is_active: true, full_name: 'Sue Super' });
    supabaseMock.rows('ai_agent_logs').push(
      { created_at: '2026-10-01T05:00:00Z', action: 'tpl_approved', input_data: { actor_id: SUE, partner_id: PID } },
      { created_at: '2026-10-05T05:00:00Z', action: 'tpl_paused', input_data: { actor_id: SUE, partner_id: PID } },
      // Belongs to a different partner - must not show up here
      { created_at: '2026-10-06T05:00:00Z', action: 'tpl_approved', input_data: { actor_id: SUE, partner_id: 'p2' } },
    );
    const res = await history();
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { at: '2026-10-05T05:00:00Z', actor: 'Sue Super', action: 'tpl_paused', detail: null },
      { at: '2026-10-01T05:00:00Z', actor: 'Sue Super', action: 'tpl_approved', detail: null },
    ]);
  });

  it('is empty for a partner with no audited history yet', async () => {
    expect((await history()).body).toEqual([]);
  });

  it('is for superadmins only', async () => {
    expect((await request(app).get(`/api/v1/tpl/${PID}/history`)).status).toBe(401);
    expect((await history(PID, bearer('admin-1'))).status).toBe(403);
    expect((await history(PID, bearer('partner-user'))).status).toBe(403);
  });
});
