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
  kycData: { data: { name: 'Acme Logistics' }, otherDocs: [] },
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

    // Both active staff accounts get a notification (notifyStaff).
    const notified = supabaseMock.writes('notifications', 'POST').map(w => w.body.user_id);
    expect(notified.sort()).toEqual(['admin-1', 'super-1']);
  });

  it('resubmits a rejected profile and notifies staff again', async () => {
    supabaseMock.reset({
      users: [
        { id: VENDOR, role: 'vendor', is_active: true },
        { id: 'admin-1', role: 'admin', is_active: true },
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
});
