import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { externalHttp } from '../src/core/http';
import { checkIfscForSave, lookupIfsc } from '../src/services/ifsc.service';
import { createAccessToken } from '../src/core/auth';
import { cacheDelete } from '../src/core/redis';

const app = testApp();

const HDFC = {
  BANK: 'HDFC Bank', BANKCODE: 'HDFC', BRANCH: 'Andheri East', ADDRESS: '1 Link Road', CITY: 'Mumbai', DISTRICT: 'Mumbai',
  STATE: 'Maharashtra', CENTRE: 'Mumbai', CONTACT: '+912212345678', MICR: '400240002', IFSC: 'HDFC0001234',
  NEFT: true, RTGS: true, IMPS: true, UPI: true, SWIFT: null,
};
const notFound = () => Object.assign(new Error('Request failed with status 404'), { status: 404 });
const get = (code: string) => request(app).get(`/api/v1/bank/ifsc/${code}`);

beforeEach(async () => {
  supabaseMock.reset({ users: [] });
  for (const c of ['HDFC0001234', 'SBIN0000001', 'ICIC0000001', 'UTIB0000001', 'KKBK0000001']) await cacheDelete(`ifsc:${c}`);
});
afterEach(() => vi.restoreAllMocks());

describe('lookupIfsc', () => {
  it('normalises a found branch and calls the API once for repeats (cached)', async () => {
    const http = vi.spyOn(externalHttp, 'getJson').mockResolvedValue(HDFC);
    const first = await lookupIfsc(' hdfc0001234 ');
    expect(first).toMatchObject({ found: true, ifsc: 'HDFC0001234', bank: 'HDFC Bank', bank_code: 'HDFC', branch: 'Andheri East', city: 'Mumbai', state: 'Maharashtra', micr: '400240002', neft: true, upi: true, swift: null });
    await lookupIfsc('HDFC0001234');
    expect(http).toHaveBeenCalledTimes(1);
    expect(http.mock.calls[0][0]).toBe('http://127.0.0.1:9/HDFC0001234');
    expect(http.mock.calls[0][1]).toBe(5000);
  });

  it('reports an unknown IFSC and remembers it', async () => {
    const http = vi.spyOn(externalHttp, 'getJson').mockRejectedValue(notFound());
    expect(await lookupIfsc('SBIN0000001')).toEqual({ found: false });
    expect(await lookupIfsc('SBIN0000001')).toEqual({ found: false });
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('throws service unavailable on a timeout or server error, and does not cache it', async () => {
    const http = vi.spyOn(externalHttp, 'getJson').mockRejectedValue(new Error('The operation was aborted due to timeout'));
    await expect(lookupIfsc('ICIC0000001')).rejects.toMatchObject({ status: 503, message: 'Bank lookup is unavailable, check the IFSC yourself' });
    await expect(lookupIfsc('ICIC0000001')).rejects.toMatchObject({ status: 503 });
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('refuses a badly formed code without calling out', async () => {
    const http = vi.spyOn(externalHttp, 'getJson');
    for (const bad of ['HDFC1001234', 'HDF0001234', 'HDFC000123', '', undefined]) await expect(lookupIfsc(bad)).rejects.toMatchObject({ status: 400 });
    expect(http).not.toHaveBeenCalled();
  });
});

describe('checkIfscForSave', () => {
  it('warns when a branch has neither NEFT nor IMPS', async () => {
    vi.spyOn(externalHttp, 'getJson').mockResolvedValue({ ...HDFC, NEFT: false, IMPS: false, RTGS: true });
    const check = await checkIfscForSave('UTIB0000001');
    expect(check.warnings).toEqual(['ifsc_no_neft_imps']);
    expect(check.verifiedAt).not.toBeNull();
  });
});

describe('GET /bank/ifsc/:code', () => {
  it('is open without sign-in and returns the branch', async () => {
    vi.spyOn(externalHttp, 'getJson').mockResolvedValue(HDFC);
    const res = await get('hdfc0001234');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ifsc: 'HDFC0001234', bank: 'HDFC Bank', branch: 'Andheri East', neft: true });
    expect(res.body.found).toBeUndefined();
  });

  it('answers 404, 400 and 503 with a detail message', async () => {
    vi.spyOn(externalHttp, 'getJson').mockRejectedValue(notFound());
    expect(await get('SBIN0000001')).toMatchObject({ status: 404, body: { detail: 'No bank branch has this IFSC' } });
    expect((await get('BAD')).status).toBe(400);
    vi.spyOn(externalHttp, 'getJson').mockRejectedValue(new Error('boom'));
    expect(await get('ICIC0000001')).toMatchObject({ status: 503, body: { detail: 'Bank lookup is unavailable, check the IFSC yourself' } });
  });

  it('is rate limited per IP', async () => {
    vi.spyOn(externalHttp, 'getJson').mockResolvedValue(HDFC);
    let last = 200;
    for (let i = 0; i < 65; i++) last = (await get('HDFC0001234')).status;
    expect(last).toBe(429);
  });
});

// One save path per area: people bank accounts, vendor KYC, 3PL onboarding.
describe('saving an IFSC', () => {
  const SUPER = '00000000-0000-4000-8000-000000000001';
  const DRV = '00000000-0000-4000-8000-000000000004';
  const superadmin = { Authorization: `Bearer ${createAccessToken({ sub: SUPER, role: 'superadmin' })}` };

  function peopleFixtures() {
    supabaseMock.reset({
      users: [
        { id: SUPER, role: 'superadmin', is_active: true, status: 'active', full_name: 'Sue Super' },
        { id: DRV, role: 'driver', is_active: true, status: 'active', full_name: 'Ravi Kumar' },
      ],
      user_profiles: [], user_bank_accounts: [], user_activity: [], notifications: [], system_settings: [],
    });
  }
  const addBank = () => request(app).post(`/api/v1/people/${DRV}/bank-accounts`).set(superadmin)
    .send({ account_holder: 'Ravi Kumar', account_number: '123456789012', ifsc: 'HDFC0001234' });

  it('people bank: refuses an IFSC no branch has', async () => {
    peopleFixtures();
    vi.spyOn(externalHttp, 'getJson').mockRejectedValue(notFound());
    const res = await addBank();
    expect(res.status).toBe(400);
    expect(res.body.detail).toBe('No bank branch has this IFSC');
    expect(supabaseMock.rows('user_bank_accounts')).toHaveLength(0);
  });

  it('people bank: stores the branch when found and warns without verifying when the service is down', async () => {
    peopleFixtures();
    vi.spyOn(externalHttp, 'getJson').mockResolvedValue(HDFC);
    const ok = await addBank();
    expect(ok.status).toBe(201);
    expect(ok.body.warnings).toEqual([]);
    expect(supabaseMock.rows('user_bank_accounts')[0]).toMatchObject({ bank_name: 'HDFC Bank', branch_name: 'Andheri East', bank_city: 'Mumbai', micr: '400240002' });
    expect(supabaseMock.rows('user_bank_accounts')[0].ifsc_verified_at).toBeTruthy();

    peopleFixtures();
    await cacheDelete('ifsc:HDFC0001234');
    vi.spyOn(externalHttp, 'getJson').mockRejectedValue(new Error('down'));
    const down = await addBank();
    expect(down.status).toBe(201);
    expect(down.body.warnings).toContain('ifsc_unverified');
    expect(supabaseMock.rows('user_bank_accounts')[0].ifsc_verified_at).toBeNull();
  });

  it('vendor KYC: refuses an unknown IFSC, and keeps the branch inside kyc_data when found', async () => {
    const VENDOR = 'vendor-1';
    const submit = () => request(app).post('/api/v1/vendor/kyc/submit').set('Authorization', `Bearer ${supabaseMock.signUserToken(VENDOR)}`)
      .send({ companyName: 'Acme', gstNumber: '', city: 'Pune', address: '1 MG Road', lat: 18.5, lng: 73.8, companyLogo: null, kycData: { data: { bankIfscCode: 'hdfc0001234' }, otherDocs: [] } });
    const reset = () => supabaseMock.reset({ users: [{ id: VENDOR, role: 'vendor', is_active: true }], vendor_profiles: [], notifications: [] });

    reset();
    vi.spyOn(externalHttp, 'getJson').mockRejectedValue(notFound());
    expect((await submit()).status).toBe(400);
    expect(supabaseMock.rows('vendor_profiles')).toHaveLength(0);

    reset();
    await cacheDelete('ifsc:HDFC0001234');
    vi.spyOn(externalHttp, 'getJson').mockResolvedValue(HDFC);
    expect((await submit()).status).toBe(200);
    const stored = supabaseMock.rows('vendor_profiles')[0].kyc_data;
    expect(stored.bank.ifsc_details).toMatchObject({ bank: 'HDFC Bank', branch: 'Andheri East' });
    expect(stored.data).toMatchObject({ bankName: 'HDFC Bank', bankBranchName: 'Andheri East', bankIfscCode: 'HDFC0001234' });

    reset();
    await cacheDelete('ifsc:HDFC0001234');
    vi.spyOn(externalHttp, 'getJson').mockRejectedValue(new Error('down'));
    const down = await submit();
    expect(down.status).toBe(200);
    expect(down.body.warnings).toContain('ifsc_unverified');
    expect(supabaseMock.rows('vendor_profiles')[0].kyc_data.bank.ifsc_verified_at).toBeNull();
  });

  it('3PL onboarding: refuses an unknown IFSC, warns when the service is down', async () => {
    const onboard = () => request(app).post('/api/v1/tpl/onboard').send({ companyName: 'Northline', email: 'ops@northline.example', pan: 'ABCDE1234F', gst: '27ABCDE1234F1Z0', bankIfsc: 'HDFC0001234' });
    const reset = () => supabaseMock.reset({ users: [], tpl_partners: [], tpl_corridors: [], tpl_documents: [], notifications: [] });

    reset();
    vi.spyOn(externalHttp, 'getJson').mockRejectedValue(notFound());
    const res = await onboard();
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('No bank branch has this IFSC');
    expect(supabaseMock.writes('tpl_partners', 'POST')).toHaveLength(0);

    reset();
    await cacheDelete('ifsc:HDFC0001234');
    vi.spyOn(externalHttp, 'getJson').mockRejectedValue(new Error('down'));
    const down = await onboard();
    expect(down.status).toBe(200);
    expect(down.body.warnings).toEqual(['ifsc_unverified']);
    expect(supabaseMock.rows('tpl_partners')[0]).toMatchObject({ bank_ifsc: 'HDFC0001234', bank_ifsc_verified_at: null });

    reset();
    await cacheDelete('ifsc:HDFC0001234');
    vi.spyOn(externalHttp, 'getJson').mockResolvedValue(HDFC);
    expect((await onboard()).status).toBe(200);
    expect(supabaseMock.rows('tpl_partners')[0]).toMatchObject({ bank_name: 'HDFC Bank', bank_branch: 'Andheri East' });
  });
});
