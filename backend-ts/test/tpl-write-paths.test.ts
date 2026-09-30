import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('approves only a pending partner, tells them and audits it', async () => {
    reset('pending');
    const res = await act(`approve/${PID}`);
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('tpl_partners')[0].status).toBe('active');
    expect(supabaseMock.writes('notifications', 'POST')[0].body).toMatchObject({ user_id: 'partner-user', type: 'tpl_approved' });
    expect(supabaseMock.writes('ai_agent_logs', 'POST')[0].body).toMatchObject({ action: 'tpl_approved' });
  });

  describe('approval email', () => {
    let send: ReturnType<typeof vi.spyOn<typeof emailService, 'send'>>;
    beforeEach(() => { send = vi.spyOn(emailService, 'send').mockResolvedValue(true); });

    it('emails a newly approved partner a link to set up their account', async () => {
      reset('pending');
      expect((await act(`approve/${PID}`)).status).toBe(200);
      expect(send).toHaveBeenCalledTimes(1);
      const [to, subject, html] = send.mock.calls[0];
      expect(to).toBe('ops@acme.in');
      expect(subject).toMatch(/approved/);
      expect(html).toContain('/3pl/onboard/setup?email=ops%40acme.in');
      expect(html).toContain('Acme 3PL');
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
      reset('pending');
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

describe('application field checks', () => {
  const onboard = (change: Record<string, unknown>) =>
    request(app).post('/api/v1/tpl/onboard').send({ companyName: 'Northline', email: 'ops@northline.example', pan: 'ABCDE1234F', ...change });

  it.each([
    ['a bad PAN', { pan: 'nope' }],
    ['a bad GSTIN', { gst: '123' }],
    ['a bad IFSC', { bankIfsc: 'XYZ' }],
    ['a bad account number', { bankAccount: '12ab' }],
    ['a negative corridor rate', { corridors: [{ name: 'DEL-BOM', rate: '-1' }] }],
  ])('refuses %s', async (_name, change) => {
    reset('pending');
    const res = await onboard(change);
    expect(res.status).toBe(400);
    expect(supabaseMock.writes('tpl_partners', 'POST')).toHaveLength(0);
  });
});
