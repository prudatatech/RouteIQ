import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { createApp } from '../src/app';
import { settings } from '../src/core/config';

const app = createApp();

const PARTNER = {
  id: '11111111-1111-1111-1111-111111111111',
  custom_id: 'acme_3pl',
  company_name: 'Acme',
  status: 'pending',
  email: 'ops@acme.in',
  pan_number: 'ABCDE1234F',
  user_id: 'partner-user',
  tpl_corridors: [],
  tpl_documents: [{ id: 'doc-1', file_url: 'acme_3pl/pan_card_old.pdf', doc_type: 'PAN Card' }],
};

const NEW_FILE = { custom_id: 'fresh_3pl', doc_type: 'GST Certificate', content_type: 'application/pdf', size: 150_000 };

const uploadUrl = (body: Record<string, unknown>, token?: string) => {
  const req = request(app).post('/api/v1/tpl/applications/upload-url');
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req.send(body);
};

beforeEach(() => {
  supabaseMock.reset({
    users: [
      { id: 'partner-user', role: 'vendor', is_active: true },
      { id: 'admin-1', role: 'admin', is_active: true },
      { id: 'other-user', role: 'vendor', is_active: true },
    ],
    vendor_profiles: [],
    tpl_partners: [PARTNER],
    tpl_documents: [],
    tpl_corridors: [],
  });
});

describe('POST /tpl/applications/upload-url', () => {
  it('issues a signed URL for a server-chosen path in the new application\'s folder', async () => {
    const res = await uploadUrl(NEW_FILE);
    expect(res.status).toBe(200);
    expect(res.body.token).toBe('test-upload-token');
    expect(res.body.path).toMatch(/^tpl-applications\/fresh_3pl\/gst_certificate_[0-9a-f-]{36}\.pdf$/);
    expect(supabaseMock.signedUploads).toEqual([`kyc_documents/${res.body.path}`]);
  });

  it('ignores any client-supplied file name or path', async () => {
    const res = await uploadUrl({ ...NEW_FILE, path: 'other/../evil.exe', file_name: 'evil.exe' });
    expect(res.status).toBe(200);
    expect(res.body.path.startsWith('tpl-applications/fresh_3pl/')).toBe(true);
    expect(res.body.path.endsWith('.pdf')).toBe(true);
  });

  it.each([
    ['an unknown document type', { doc_type: 'Anything' }, 400],
    ['a disallowed content type', { content_type: 'application/x-msdownload' }, 415],
    ['an HTML file', { content_type: 'text/html' }, 415],
    ['a missing size', { size: undefined }, 400],
    ['a file over the size limit', { size: settings.TPL_UPLOAD_MAX_BYTES + 1 }, 413],
    ['an invalid 3PL ID', { custom_id: '../x' }, 400],
    ['a 3PL ID that already belongs to a partner', { custom_id: PARTNER.custom_id }, 409],
  ])('rejects %s', async (_case, change, status) => {
    const res = await uploadUrl({ ...NEW_FILE, ...change });
    expect(res.status).toBe(status);
    expect(supabaseMock.signedUploads).toEqual([]);
  });

  it('accepts JPG and PNG images', async () => {
    expect((await uploadUrl({ ...NEW_FILE, content_type: 'image/jpeg' })).body.path).toMatch(/\.jpg$/);
    expect((await uploadUrl({ ...NEW_FILE, content_type: 'image/png' })).body.path).toMatch(/\.png$/);
  });

  describe('for an existing application', () => {
    const existing = { application_id: PARTNER.id, doc_type: 'PAN Card', content_type: 'image/png', size: 1000 };

    it('lets the partner upload into its own folder', async () => {
      const res = await uploadUrl(existing, supabaseMock.signUserToken('partner-user'));
      expect(res.status).toBe(200);
      expect(res.body.path.startsWith(`${PARTNER.id}/pan_card_`)).toBe(true);
    });

    it('lets the applicant upload with the application\'s PAN', async () => {
      const res = await uploadUrl({ ...existing, verify_pan: 'abcde1234f' });
      expect(res.status).toBe(200);
      expect(res.body.path.startsWith(`${PARTNER.id}/`)).toBe(true);
    });

    it('refuses anyone else', async () => {
      expect((await uploadUrl(existing)).status).toBe(403);
      expect((await uploadUrl({ ...existing, verify_pan: 'XXXXX0000X' })).status).toBe(403);
      expect((await uploadUrl(existing, supabaseMock.signUserToken('other-user'))).status).toBe(403);
      expect(supabaseMock.signedUploads).toEqual([]);
    });

    it('refuses PAN-only uploads once the application is no longer pending', async () => {
      supabaseMock.rows('tpl_partners')[0].status = 'approved';
      expect((await uploadUrl({ ...existing, verify_pan: 'ABCDE1234F' })).status).toBe(409);
    });
  });
});

describe('attaching uploaded documents', () => {
  const onboard = (documents: unknown) => request(app).post('/api/v1/tpl/onboard').send({
    custom_id: 'fresh_3pl', companyName: 'Fresh', email: 'hi@fresh.in', pan: 'FGHIJ5678K', documents,
  });

  it('accepts documents from the application\'s own upload folder', async () => {
    const res = await onboard([{ type: 'PAN Card', url: 'tpl-applications/fresh_3pl/pan_card_x.pdf' }]);
    expect(res.status).toBe(200);
    expect(supabaseMock.writes('tpl_documents', 'POST')).toHaveLength(1);
  });

  it.each([
    ['another folder', 'tpl-applications/acme_3pl/pan_card_x.pdf'],
    ['another user\'s KYC', 'vendor-1/pan.pdf'],
    ['a nested path', 'tpl-applications/fresh_3pl/../acme_3pl/x.pdf'],
  ])('rejects a document from %s', async (_case, url) => {
    const res = await onboard([{ type: 'PAN Card', url }]);
    expect(res.status).toBe(400);
    expect(supabaseMock.writes('tpl_partners', 'POST')).toEqual([]);
  });

  it('lets an applicant edit keep existing documents and add new uploads', async () => {
    const res = await request(app).patch(`/api/v1/tpl/${PARTNER.id}`).send({
      verify_pan: 'ABCDE1234F',
      companyName: 'Acme',
      documents: [
        { type: 'PAN Card', url: 'acme_3pl/pan_card_old.pdf' },
        { type: 'GST Certificate', url: `${PARTNER.id}/gst_certificate_new.pdf` },
      ],
    });
    expect(res.status).toBe(200);
  });

  it('rejects an edit that references a file outside the application', async () => {
    const res = await request(app).patch(`/api/v1/tpl/${PARTNER.id}`).send({
      verify_pan: 'ABCDE1234F',
      documents: [{ type: 'PAN Card', url: 'someone-else/pan.pdf' }],
    });
    expect(res.status).toBe(400);
    expect(supabaseMock.writes('tpl_partners', 'PATCH')).toEqual([]);
  });
});

// Last in the file: it uses up this client's hourly allowance
describe('upload URL rate limit', () => {
  it('limits upload URLs per client IP', async () => {
    let status = 0;
    for (let i = 0; i <= settings.TPL_UPLOAD_URLS_PER_HOUR && status !== 429; i++) {
      status = (await uploadUrl(NEW_FILE)).status;
    }
    expect(status).toBe(429);
  });
});
