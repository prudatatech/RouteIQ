import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';

const app = testApp();

const VENDOR = 'vendor-1';

const APPROVED = {
  id: VENDOR,
  company_name: 'Acme Logistics',
  gst_number: '27ABCDE1234F1Z5',
  city: 'Pune',
  address: '1 MG Road, Pune',
  latitude: 18.5,
  longitude: 73.8,
  kyc_status: 'approved',
  kyc_reviewed_at: '2026-09-01T00:00:00Z',
  kyc_reviewed_by: 'admin-1',
};

const SAME = {
  companyName: APPROVED.company_name,
  gstNumber: APPROVED.gst_number,
  city: APPROVED.city,
  address: APPROVED.address,
  lat: APPROVED.latitude,
  lng: APPROVED.longitude,
};

const save = (body: Record<string, unknown>) =>
  request(app).post('/api/v1/vendor/profile').set('Authorization', `Bearer ${supabaseMock.signUserToken(VENDOR)}`).send(body);

beforeEach(() => {
  supabaseMock.reset({
    users: [{ id: VENDOR, role: 'vendor', is_active: true }],
    vendor_profiles: [APPROVED],
    tpl_partners: [],
  });
});

describe('POST /vendor/profile', () => {
  it.each([
    ['company name', { companyName: 'Acme Freight Pvt Ltd' }],
    ['GST number', { gstNumber: '27ZZZZZ9999Z1Z5' }],
    ['registered address', { address: '9 FC Road, Pune' }],
  ])('sends an approved vendor back to review when the %s changes', async (_field, change) => {
    const res = await save({ ...SAME, ...change });
    expect(res.status).toBe(200);
    const [write] = supabaseMock.writes('vendor_profiles', 'POST');
    expect(write.body).toMatchObject({ kyc_status: 'submitted', kyc_reviewed_at: null, kyc_reviewed_by: null });
  });

  it('keeps the approval when only the operating location changes', async () => {
    const res = await save({ ...SAME, city: 'Mumbai', lat: 19.07, lng: 72.87 });
    expect(res.status).toBe(200);
    const [write] = supabaseMock.writes('vendor_profiles', 'POST');
    expect(write.body).not.toHaveProperty('kyc_status');
    expect(supabaseMock.rows('vendor_profiles')[0].kyc_status).toBe('approved');
  });

  it('does not touch KYC for a profile that is not approved', async () => {
    supabaseMock.rows('vendor_profiles')[0].kyc_status = 'pending';
    await save({ ...SAME, companyName: 'Other' });
    const [write] = supabaseMock.writes('vendor_profiles', 'POST');
    expect(write.body).not.toHaveProperty('kyc_status');
  });

  it('creates a profile for a new vendor without KYC fields', async () => {
    supabaseMock.reset({ users: [{ id: VENDOR, role: 'vendor', is_active: true }], vendor_profiles: [], tpl_partners: [] });
    const res = await save(SAME);
    expect(res.status).toBe(200);
    const [write] = supabaseMock.writes('vendor_profiles', 'POST');
    expect(write.body).not.toHaveProperty('kyc_status');
  });
});
