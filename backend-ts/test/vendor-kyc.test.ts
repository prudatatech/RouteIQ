import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';

const app = testApp();
const VENDOR = 'vendor-1';
const adminToken = () => supabaseMock.signUserToken('admin-1');

beforeEach(() => {
  supabaseMock.reset({
    users: [{ id: 'admin-1', role: 'admin', is_active: true }],
    vendor_profiles: [{ id: VENDOR, company_name: 'Acme Logistics', kyc_status: 'submitted' }],
    notifications: [],
  });
});

const reject = (body?: Record<string, unknown>) =>
  request(app).put(`/api/v1/vendor/kyc/${VENDOR}/reject`).set('Authorization', `Bearer ${adminToken()}`).send(body ?? { reason: 'PAN scan is unreadable' });

describe('PUT /vendor/kyc/:id/reject', () => {
  it('rejects a submitted KYC and stores the reason', async () => {
    const res = await reject();
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('vendor_profiles')[0]).toMatchObject({
      kyc_status: 'rejected',
      kyc_rejection_reason: 'PAN scan is unreadable',
    });
    expect(supabaseMock.writes('notifications', 'POST')).toHaveLength(1);
  });

  it.each([
    ['missing', {}],
    ['too short', { reason: 'no' }],
    ['too long', { reason: 'x'.repeat(501) }],
    ['blank', { reason: '   ' }],
  ])('requires a reason (%s)', async (_name, body) => {
    const res = await reject(body);
    expect(res.status).toBe(400);
    expect(supabaseMock.rows('vendor_profiles')[0].kyc_status).toBe('submitted');
  });

  it('refuses to reject a KYC that is not waiting for review', async () => {
    supabaseMock.rows('vendor_profiles')[0].kyc_status = 'approved';
    const res = await reject();
    expect(res.status).toBe(409);
  });
});
