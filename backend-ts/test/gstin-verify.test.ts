import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import axios from 'axios';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { settings } from '../src/core/config';

const app = testApp();
const VALID = '27AAPFU0939F1ZV';
const verify = (body: Record<string, unknown>) => request(app).post('/api/v1/gstin/verify').send(body);

function configureGsp(on: boolean) {
  Object.assign(settings, {
    EWAYBILL_GSP_USERNAME: on ? 'gsp-user' : '',
    EWAYBILL_GSP_PASSWORD: on ? 'gsp-pass' : '',
    EWAYBILL_GSP_CLIENT_ID: on ? 'gsp-client' : '',
    EWAYBILL_GSP_BASE_URL: on ? 'https://gsp.example' : '',
  });
}

beforeEach(() => configureGsp(false));
afterEach(() => {
  configureGsp(false);
  vi.restoreAllMocks();
});

describe('POST /gstin/verify', () => {
  it('says the online check is not configured when there are no GSP credentials', async () => {
    const res = await verify({ gstin: VALID });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      valid: true, stateCode: '27', pan: 'AAPFU0939F',
      online: { status: 'not_configured' },
      summary: 'Checksum valid; online check not configured',
    });
  });

  it('rejects a wrong check character without calling the GSP', async () => {
    configureGsp(true);
    const get = vi.spyOn(axios, 'get');
    const res = await verify({ gstin: '27AAPFU0939F1Z5' });
    expect(res.body).toMatchObject({ valid: false, problem: 'checksum' });
    expect(get).not.toHaveBeenCalled();
  });

  it('flags a GSTIN that belongs to another PAN', async () => {
    const res = await verify({ gstin: VALID, pan: 'ABCDE1234F' });
    expect(res.body.summary).toMatch(/different PAN/);
  });

  it('needs a gstin', async () => {
    expect((await verify({})).status).toBe(400);
  });

  it('reads an active GSTIN from the GSP', async () => {
    configureGsp(true);
    const get = vi.spyOn(axios, 'get').mockResolvedValue({ status: 200, data: { LegalName: 'Acme Freight Pvt Ltd', TradeName: 'Acme', Status: 'ACT' } });
    const res = await verify({ gstin: VALID });
    expect(res.body.online).toEqual({ status: 'active', legal_name: 'Acme Freight Pvt Ltd', trade_name: 'Acme', gst_status: 'ACT' });
    expect(res.body.summary).toBe('Active on the GST portal as Acme Freight Pvt Ltd');
    expect(get).toHaveBeenCalledWith(expect.stringContaining('https://gsp.example/'), expect.objectContaining({ params: { GSTIN: VALID } }));
  });

  it('reports a cancelled GSTIN, an unknown one and an unreachable GSP', async () => {
    configureGsp(true);
    const get = vi.spyOn(axios, 'get');
    get.mockResolvedValueOnce({ status: 200, data: { lgnm: 'Old Co', sts: 'Cancelled' } });
    expect((await verify({ gstin: VALID })).body.online.status).toBe('inactive');
    get.mockResolvedValueOnce({ status: 404, data: {} });
    expect((await verify({ gstin: VALID })).body.online.status).toBe('not_found');
    get.mockRejectedValueOnce(new Error('timeout'));
    const down = await verify({ gstin: VALID });
    expect(down.body.online.status).toBe('unavailable');
    expect(down.body.valid).toBe(true);
  });
});

describe('GSTIN is checked where it is saved', () => {
  it('3PL onboarding refuses a GSTIN with a wrong check character', async () => {
    supabaseMock.reset({ users: [], tpl_partners: [], tpl_corridors: [], tpl_documents: [], notifications: [] });
    const res = await request(app).post('/api/v1/tpl/onboard').send({
      companyName: 'Acme', email: 'a@acme.in', pan: 'AAPFU0939F', gst: '27AAPFU0939F1Z5',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not match/);
    expect(supabaseMock.writes('tpl_partners', 'POST')).toEqual([]);
  });

  it('3PL onboarding refuses a GSTIN that belongs to another PAN, and needs one', async () => {
    supabaseMock.reset({ users: [], tpl_partners: [], tpl_corridors: [], tpl_documents: [], notifications: [] });
    const send = (gst?: string) => request(app).post('/api/v1/tpl/onboard').send({ companyName: 'Acme', email: 'a@acme.in', pan: 'ABCDE1234F', gst });
    expect((await send(VALID)).body.error).toMatch(/different PAN/);
    expect((await send()).status).toBe(400);
  });

  it('vendor KYC refuses a bad GSTIN but accepts a blank one', async () => {
    supabaseMock.reset({ users: [{ id: 'vendor-1', role: 'vendor', is_active: true }, { id: 'admin-1', role: 'admin', is_active: true }], vendor_profiles: [], notifications: [] });
    const submit = (gstNumber: string) => request(app).post('/api/v1/vendor/kyc/submit')
      .set('Authorization', `Bearer ${supabaseMock.signUserToken('vendor-1')}`)
      .send({ companyName: 'Acme', gstNumber, city: 'Pune', address: '1 MG Road', lat: 18.5, lng: 73.8, kycData: {} });
    const bad = await submit('27AAPFU0939F1Z5');
    expect(bad.status).toBe(400);
    expect(supabaseMock.rows('vendor_profiles')).toEqual([]);
    expect((await submit(VALID.toLowerCase())).status).toBe(200);
    expect(supabaseMock.rows('vendor_profiles')[0].gst_number).toBe(VALID);
    expect((await submit('')).status).toBe(200);
  });
});
