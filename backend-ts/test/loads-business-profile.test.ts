/**
 * GET/PUT /vendor/business-profile: stored on the vendor organisation plus profile jsonb, mirrored to vendor_profiles,
 * GSTIN required (and verified) for a business partner, `complete` in the answer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { ORG, as, orgWorld, uid } from './support/org-world';
import { gstinCheckChar } from '../src/utils/gstin';
import { gstinService } from '../src/services/gstin.service';
import { goodsTables } from './support/goods-world';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;

/** A GSTIN with a correct check character: Maharashtra (27), PAN AAAPL1234C. */
const gstin = (() => { const first14 = '27AAAPL1234C1Z'.slice(0, 14); return first14 + gstinCheckChar(first14); })();

const body = (over: Record<string, unknown> = {}) => ({
  full_name: 'Vik Vendor', business_name: 'Acme Traders Pvt Ltd', account_type: 'business_partner', gstin,
  address: 'Plot 4, MIDC Andheri', pincode: '400093', email: 'Vik@Example.test', business_type: 'manufacturer', monthly_loads: '6-20', ...over,
});

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  supabaseMock.reset(orgWorld({ vendor_profiles: [{ id: uid('vendor-1'), company_name: 'Vik Vendor', gst_number: '', city: 'Mumbai', address: null, kyc_status: 'pending' }], ...goodsTables() }));
});

const put = (b: unknown, who = as('vendor-1')) => request(app).put(api('/vendor/business-profile')).set(who).send(b as object);
const get = (who = as('vendor-1')) => request(app).get(api('/vendor/business-profile')).set(who);

describe('GET /vendor/business-profile', () => {
  it('is incomplete for a new vendor and says so', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.complete).toBe(false);
    expect(res.body.full_name).toBe('Vik Vendor');
  });

  it('is for vendors only', async () => {
    expect((await get(as('driver-a'))).status).toBe(403);
    expect((await request(app).get(api('/vendor/business-profile'))).status).toBe(401);
  });
});

describe('PUT /vendor/business-profile', () => {
  it('saves a business partner on the organisation and the profile jsonb, and mirrors vendor_profiles', async () => {
    const res = await put(body());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ complete: true, account_type: 'business_partner', gstin, business_name: 'Acme Traders Pvt Ltd', email: 'vik@example.test', pincode: '400093', state_code: '27', state: 'Maharashtra', business_type: 'manufacturer', monthly_loads: '6-20', full_name: 'Vik Vendor' });

    const org = supabaseMock.rows('organizations').find(o => o.id === ORG.vendorV)!;
    expect(org).toMatchObject({ legal_name: 'Acme Traders Pvt Ltd', gstin, address: 'Plot 4, MIDC Andheri', pincode: '400093', state: 'Maharashtra', email: 'vik@example.test' });
    expect(org.profile).toMatchObject({ account_type: 'business_partner', business_type: 'manufacturer', monthly_loads: '6-20', contact_name: 'Vik Vendor' });

    const vp = supabaseMock.rows('vendor_profiles').find(v => v.id === uid('vendor-1'))!;
    expect(vp).toMatchObject({ company_name: 'Acme Traders Pvt Ltd', gst_number: gstin, address: 'Plot 4, MIDC Andheri' });
  });

  it('requires a GSTIN for a business partner', async () => {
    const res = await put(body({ gstin: '' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/GSTIN is required/);
    expect(supabaseMock.writes('organizations')).toHaveLength(0);
  });

  it('checks the GSTIN with gstinService.verify and refuses a wrong one', async () => {
    const verify = vi.spyOn(gstinService, 'verify');
    const bad = await put(body({ gstin: '27AAAPL1234C1ZX' }));
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/GSTIN|check/i);
    expect(verify).toHaveBeenCalledWith('27AAAPL1234C1ZX');
    expect(supabaseMock.writes('organizations')).toHaveLength(0);
  });

  it('refuses a GSTIN the GST portal says is not active', async () => {
    vi.spyOn(gstinService, 'verify').mockResolvedValue({ gstin, valid: true, online: { status: 'inactive', gst_status: 'Cancelled' }, summary: 'Found on the GST portal but not active (Cancelled)' } as any);
    const res = await put(body());
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not active/);
  });

  it('lets a customer account save without a GSTIN, and verifies one when given', async () => {
    const verify = vi.spyOn(gstinService, 'verify');
    const res = await put(body({ account_type: 'customer', gstin: null }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ complete: true, account_type: 'customer', gstin: null });
    expect(verify).not.toHaveBeenCalled();
    await put(body({ account_type: 'customer' }));
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('requires the business name for everyone, and leaves email optional', async () => {
    expect((await put(body({ account_type: 'customer', gstin: null, business_name: null }))).status).toBe(400);
    expect((await put(body({ account_type: 'customer', gstin: null, business_name: '  ' }))).status).toBe(400);
    const res = await put(body({ account_type: 'customer', gstin: null, email: null }));
    expect(res.status).toBe(200);
    expect(res.body.complete).toBe(true);
    expect(supabaseMock.rows('organizations').find((o: any) => o.id === ORG.vendorV)?.email).toBeNull();
    expect((await put(body({ account_type: 'customer', gstin: null, email: '' }))).status).toBe(200);
  });

  it('validates the rest of the form', async () => {
    expect((await put(body({ pincode: '40' }))).status).toBe(400);
    expect((await put(body({ email: 'not-an-email' }))).status).toBe(400);
    expect((await put(body({ account_type: 'other' }))).status).toBe(400);
    expect((await put(body({ monthly_loads: '1000' }))).status).toBe(400);
    expect((await put(body({ full_name: '' }))).status).toBe(400);
  });

  it('sends an approved vendor back to KYC review when its legal identity changes, as the old profile save does', async () => {
    supabaseMock.rows('vendor_profiles')[0].kyc_status = 'approved';
    await put(body());
    expect(supabaseMock.rows('vendor_profiles')[0].kyc_status).toBe('submitted');
  });

  it('updates an existing vendor profile instead of upserting it (an upsert has no city and the column is NOT NULL)', async () => {
    await put(body());
    expect(supabaseMock.writes('vendor_profiles', 'POST')).toHaveLength(0);
    expect(supabaseMock.writes('vendor_profiles', 'PATCH')).toHaveLength(1);
    expect(supabaseMock.rows('vendor_profiles')[0].city).toBe('Mumbai');
  });

  it('creates the profile (with an empty city) when the vendor has none yet', async () => {
    supabaseMock.rows('vendor_profiles').length = 0;
    expect((await put(body())).status).toBe(200);
    expect(supabaseMock.rows('vendor_profiles')[0]).toMatchObject({ id: uid('vendor-1'), city: '', company_name: 'Acme Traders Pvt Ltd' });
  });

  it('tells the platform owner when a business-profile change sends an approved vendor back to review', async () => {
    supabaseMock.rows('users').push({ id: uid('owner-1'), role: 'superadmin', email: 'owner@example.test', is_active: true });
    supabaseMock.rows('vendor_profiles')[0].kyc_status = 'approved';
    await put(body());
    expect(supabaseMock.rows('notifications').filter(n => n.user_id === uid('owner-1') && n.type === 'kyc_submitted')).toHaveLength(1);
  });

  it('takes the state from the pin code when there is no GSTIN', async () => {
    const res = await put(body({ account_type: 'customer', gstin: null, pincode: '411001' }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ state_code: '27', state: 'Maharashtra' });
  });

  it('then reads back as complete', async () => {
    await put(body());
    expect((await get()).body).toMatchObject({ complete: true, gstin });
  });
});
