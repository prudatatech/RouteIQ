/**
 * Approvals belong to the platform: vendor KYC decisions and the 3PL application queue need the effective role
 * superadmin, which a person has only while acting as the platform organisation. A company admin is refused, and
 * sees only the basic profile (name, city) of vendors whose loads it can see.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { ORG, as, orgWorld, uid } from './support/org-world';
import { clearAllMemos } from '../src/core/memo';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const V1 = uid('vendor-1');
const V2 = '77000000-0000-4000-8000-000000000002';
const P1 = '99000000-0000-4000-8000-000000000001';
const LOAD_A = '11000000-0000-4000-8000-0000000000a1';

beforeEach(() => {
  clearAllMemos();
  supabaseMock.reset({
    ...orgWorld(),
    vendor_profiles: [
      { id: V1, company_name: 'Acme Traders', city: 'Pune', gst_number: '27AAAAA0000A1Z5', kyc_status: 'submitted', latitude: 1, longitude: 2, kyc_data: { data: { panNumber: 'AAAAA0000A' } } },
      { id: V2, company_name: 'Unrelated Ltd', city: 'Delhi', kyc_status: 'submitted' },
    ],
    vendor_shipment_requests: [{ id: LOAD_A, vendor_id: V1, vendor_org_id: ORG.vendorV, carrier_org_id: ORG.companyA, status: 'approved' }],
    capacity_bids: [], capacity_windows: [], tpl_partners: [{ id: P1, status: 'pending', company_name: 'Tiny', user_id: uid('tpl-1'), custom_id: 'TPL1' }],
    tpl_documents: [], tpl_corridors: [],
  });
});

describe('vendor KYC decisions', () => {
  it('are refused to a company admin, even a superadmin account acting for a company', async () => {
    expect((await request(app).put(api(`/vendor/kyc/${V1}/approve`)).set(as('admin-a'))).status).toBe(403);
    expect((await request(app).put(api(`/vendor/kyc/${V1}/reject`)).set(as('admin-a')).send({ reason: 'not convinced' })).status).toBe(403);
    expect((await request(app).put(api(`/vendor/kyc/${V1}/approve`)).set(as('super-1'))).status).toBe(403);
    expect(supabaseMock.rows('vendor_profiles')[0].kyc_status).toBe('submitted');
  });

  it('are made by the platform acting as the platform', async () => {
    const res = await request(app).put(api(`/vendor/kyc/${V1}/approve`)).set(as('super-1', ORG.platform));
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('vendor_profiles')[0].kyc_status).toBe('approved');
  });
});

describe('3PL applications', () => {
  it('can be listed and read in full by the platform only; a company sees its own partners without private details', async () => {
    const mine = await request(app).get(api('/tpl/queue?status=all')).set(as('admin-a'));
    expect(mine.status).toBe(200);
    for (const row of mine.body) {
      expect(row).not.toHaveProperty('bank_account_no');
      expect(row).not.toHaveProperty('pan_number');
    }
    expect((await request(app).get(api('/tpl/queue')).set(as('super-1', ORG.platform))).status).toBe(200);
    expect((await request(app).get(api(`/tpl/${P1}`)).set(as('admin-a'))).body.user_id).toBeUndefined();
    expect((await request(app).get(api(`/tpl/${P1}`)).set(as('super-1', ORG.platform))).body.user_id).toBe(uid('tpl-1'));
    expect((await request(app).get(api(`/tpl/by-user/${uid('tpl-1')}`)).set(as('admin-a'))).status).toBe(403);
  });
});

describe('GET /vendor/basic', () => {
  const ids = `${V1},${V2}`;
  it('gives a company the name and city of vendors whose load it can see, and nothing else about them', async () => {
    const res = await request(app).get(api(`/vendor/basic?ids=${ids}`)).set(as('admin-a'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: V1, company_name: 'Acme Traders', city: 'Pune', has_location: true }]);
  });
  it('gives another company nothing for a vendor whose load went elsewhere', async () => {
    const res = await request(app).get(api(`/vendor/basic?ids=${V1}`)).set(as('admin-b'));
    expect(res.body).toEqual([]);
  });
  it('gives the platform every vendor', async () => {
    const res = await request(app).get(api(`/vendor/basic?ids=${ids}`)).set(as('super-1', ORG.platform));
    expect(res.body).toHaveLength(2);
  });
});
