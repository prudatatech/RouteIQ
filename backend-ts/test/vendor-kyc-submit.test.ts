import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';

const app = testApp();
const VENDOR = 'vendor-1';

const PAYLOAD = {
  companyName: 'Acme Logistics',
  gstNumber: '27ABCDE1234F1Z0',
  city: 'Pune',
  address: '1 MG Road, Pune',
  lat: 18.5,
  lng: 73.8,
  companyLogo: null,
  kycData: { data: { name: 'Acme Logistics', entityType: 'Proprietorship', authorizedSignatoryName: 'Owner Name' }, otherDocs: [] },
};

const submit = (body: Record<string, unknown> = PAYLOAD) =>
  request(app).post('/api/v1/vendor/kyc/submit').set('Authorization', `Bearer ${supabaseMock.signUserToken(VENDOR)}`).send(body);

describe('POST /vendor/kyc/submit', () => {
  it('creates a profile for a first-time submission, sets it to submitted, and notifies staff', async () => {
    supabaseMock.reset({
      users: [
        { id: VENDOR, role: 'vendor', is_active: true },
        { id: 'admin-1', role: 'admin', is_active: true },
        { id: 'super-1', role: 'superadmin', is_active: true },
      ],
      vendor_profiles: [],
      notifications: [],
    });

    const res = await submit();
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('vendor_profiles')[0]).toMatchObject({
      id: VENDOR,
      company_name: 'Acme Logistics',
      kyc_status: 'submitted',
    });

    // Only the superadmin gets it: the KYC page is superadmin-only.
    const notified = supabaseMock.writes('notifications', 'POST').map(w => w.body.user_id);
    expect(notified).toEqual(['super-1']);
  });

  it('resubmits a rejected profile and notifies staff again', async () => {
    supabaseMock.reset({
      users: [
        { id: VENDOR, role: 'vendor', is_active: true },
        { id: 'super-1', role: 'superadmin', is_active: true },
      ],
      vendor_profiles: [{ id: VENDOR, company_name: 'Acme Logistics', kyc_status: 'rejected', kyc_rejection_reason: 'bad scan' }],
      notifications: [],
    });

    const res = await submit();
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('vendor_profiles')[0].kyc_status).toBe('submitted');
    expect(supabaseMock.writes('notifications', 'POST')).toHaveLength(1);
  });

  it('does not re-notify staff when the profile is already submitted', async () => {
    supabaseMock.reset({
      users: [
        { id: VENDOR, role: 'vendor', is_active: true },
        { id: 'admin-1', role: 'admin', is_active: true },
      ],
      vendor_profiles: [{ id: VENDOR, company_name: 'Acme Logistics', kyc_status: 'submitted' }],
      notifications: [],
    });

    const res = await submit();
    expect(res.status).toBe(200);
    expect(supabaseMock.writes('notifications', 'POST')).toHaveLength(0);
  });

  it('refuses a submission missing the entity type or the authorized signatory name', async () => {
    supabaseMock.reset({
      users: [{ id: VENDOR, role: 'vendor', is_active: true }],
      vendor_profiles: [],
      notifications: [],
    });
    const noEntityType = await submit({ ...PAYLOAD, kycData: { data: { name: 'Acme Logistics', authorizedSignatoryName: 'Owner Name' }, otherDocs: [] } });
    expect(noEntityType.status).toBe(400);
    const noSignatory = await submit({ ...PAYLOAD, kycData: { data: { name: 'Acme Logistics', entityType: 'Proprietorship' }, otherDocs: [] } });
    expect(noSignatory.status).toBe(400);
  });

  it('refuses a Private Limited vendor with no CIN, and accepts one with a well-formed CIN', async () => {
    supabaseMock.reset({
      users: [{ id: VENDOR, role: 'vendor', is_active: true }],
      vendor_profiles: [],
      notifications: [],
    });
    const noCin = await submit({
      ...PAYLOAD,
      kycData: { data: { name: 'Acme Logistics', entityType: 'Private Limited', authorizedSignatoryName: 'Owner Name' }, otherDocs: [] },
    });
    expect(noCin.status).toBe(400);
    const withCin = await submit({
      ...PAYLOAD,
      kycData: { data: { name: 'Acme Logistics', entityType: 'Private Limited', authorizedSignatoryName: 'Owner Name', cin: 'U74999DL2019PTC123456' }, otherDocs: [] },
    });
    expect(withCin.status).toBe(200);
  });

  it('never retroactively blocks an already-approved profile that predates this field (no backfill gate)', async () => {
    supabaseMock.reset({
      users: [{ id: VENDOR, role: 'vendor', is_active: true }],
      vendor_profiles: [{ id: VENDOR, company_name: 'Acme Logistics', kyc_status: 'approved', kyc_data: { data: { name: 'Acme Logistics' }, otherDocs: [] } }],
      notifications: [],
    });
    const res = await request(app).get('/api/v1/vendor/profile').set('Authorization', `Bearer ${supabaseMock.signUserToken(VENDOR)}`);
    expect(res.status).toBe(200);
    expect(res.body.kyc_status).toBe('approved');
  });
});
