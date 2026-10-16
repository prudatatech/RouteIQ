import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';

const app = testApp();
const admin = () => ({ Authorization: `Bearer ${supabaseMock.signUserToken('admin-1')}` });

function seed(vendorProfiles: any[]) {
  supabaseMock.reset({
    users: [{ id: 'admin-1', role: 'admin', is_active: true }],
    vendor_profiles: vendorProfiles,
  });
}

// Mumbai-ish coordinates for "nearby", and a point far enough away (Delhi) to fall outside any sane radius.
const NEAR = { latitude: 19.08, longitude: 72.89 };
const FAR = { latitude: 28.61, longitude: 77.21 };

describe('GET /capacity/nearby-vendors', () => {
  beforeEach(() => seed([]));

  it('requires a lat and lng', async () => {
    const res = await request(app).get('/api/v1/capacity/nearby-vendors').set(admin());
    expect(res.status).toBe(400);
  });

  it('only lists approved vendors, never pending, rejected or info-requested ones', async () => {
    seed([
      { id: 'v-approved', company_name: 'Approved Traders', city: 'Mumbai', kyc_status: 'approved', ...NEAR },
      { id: 'v-pending', company_name: 'Pending Co', city: 'Mumbai', kyc_status: 'pending', ...NEAR },
      { id: 'v-submitted', company_name: 'Submitted Co', city: 'Mumbai', kyc_status: 'submitted', ...NEAR },
      { id: 'v-info', company_name: 'Info Requested Co', city: 'Mumbai', kyc_status: 'info_requested', ...NEAR },
      { id: 'v-rejected', company_name: 'Rejected Co', city: 'Mumbai', kyc_status: 'rejected', ...NEAR },
    ]);
    const res = await request(app).get('/api/v1/capacity/nearby-vendors?lat=19.07&lng=72.88&radius=50').set(admin());
    expect(res.status).toBe(200);
    expect(res.body.map((v: any) => v.id)).toEqual(['v-approved']);
  });

  it('excludes a vendor outside the radius even when approved', async () => {
    seed([
      { id: 'v-near', company_name: 'Near Co', city: 'Mumbai', kyc_status: 'approved', ...NEAR },
      { id: 'v-far', company_name: 'Far Co', city: 'Delhi', kyc_status: 'approved', ...FAR },
    ]);
    const res = await request(app).get('/api/v1/capacity/nearby-vendors?lat=19.07&lng=72.88&radius=50').set(admin());
    expect(res.body.map((v: any) => v.id)).toEqual(['v-near']);
  });

  it('excludes a vendor with no location on file', async () => {
    seed([{ id: 'v-no-loc', company_name: 'No Location Co', city: 'Mumbai', kyc_status: 'approved', latitude: null, longitude: null }]);
    const res = await request(app).get('/api/v1/capacity/nearby-vendors?lat=19.07&lng=72.88&radius=50').set(admin());
    expect(res.body).toEqual([]);
  });
});
