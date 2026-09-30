import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';

const app = testApp();

const PARTNER = {
  id: '11111111-1111-1111-1111-111111111111',
  custom_id: 'TPL-1',
  company_name: 'Acme',
  status: 'pending',
  email: 'ops@acme.in',
  pan_number: 'ABCDE1234F',
  bank_account_no: '999',
  user_id: null,
  tpl_corridors: [],
  tpl_documents: [],
};
const FOREIGN_VEHICLE = '22222222-2222-2222-2222-222222222222';

const driver = createAccessToken({ sub: 'driver-1', role: 'driver' });
const admin = () => supabaseMock.signUserToken('admin-1');
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeEach(() => {
  supabaseMock.reset({
    users: [{ id: 'admin-1', role: 'admin', is_active: true }, { id: 'driver-1', role: 'driver', is_active: true }],
    tpl_partners: [PARTNER],
    vehicles: [{ id: FOREIGN_VEHICLE, driver_id: 'someone-else' }],
  });
});

describe('3PL partner records', () => {
  it('the queue is for staff who can view partners, and approve and delete need a superadmin', async () => {
    expect((await request(app).get('/api/v1/tpl/queue')).status).toBe(401);
    expect((await request(app).get('/api/v1/tpl/queue').set(bearer(admin()))).status).toBe(200);
    expect((await request(app).get('/api/v1/tpl/queue').set(bearer(supabaseMock.signUserToken('driver-1')))).status).toBe(403);
    expect((await request(app).post(`/api/v1/tpl/approve/${PARTNER.id}`)).status).toBe(401);
    expect((await request(app).post(`/api/v1/tpl/approve/${PARTNER.id}`).set(bearer(admin()))).status).toBe(403);
    expect((await request(app).delete(`/api/v1/tpl/${PARTNER.id}`)).status).toBe(401);
    expect((await request(app).delete(`/api/v1/tpl/${PARTNER.id}`).set(bearer(admin()))).status).toBe(403);
  });

  it('shows anonymous callers a public view without PAN or bank details', async () => {
    const res = await request(app).get(`/api/v1/tpl/${PARTNER.id}`);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('pan_number');
    expect(res.body).not.toHaveProperty('bank_account_no');
    expect(res.body.email_masked).toBe('op***@acme.in');
  });

  it('returns the full record with the matching PAN', async () => {
    const res = await request(app).get(`/api/v1/tpl/${PARTNER.id}?pan=abcde1234f`);
    expect(res.status).toBe(200);
    expect(res.body.pan_number).toBe('ABCDE1234F');
  });

  it('refuses an edit with the wrong PAN', async () => {
    const res = await request(app).patch(`/api/v1/tpl/${PARTNER.id}`).send({ verify_pan: 'XXXXX0000X' });
    expect(res.status).toBe(403);
    expect(supabaseMock.writes('tpl_partners')).toEqual([]);
  });
});

describe('staff-only actions', () => {
  it('invite-vendor needs a superadmin', async () => {
    const body = { email: 'x@y.in', password: 'p' };
    expect((await request(app).post('/api/v1/auth/invite-vendor').send(body)).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/invite-vendor').set(bearer(admin())).send(body)).status).toBe(403);
  });

  it('route optimisation needs staff', async () => {
    expect((await request(app).post('/api/v1/optimize').send({})).status).toBe(401);
    expect((await request(app).post('/api/v1/optimize').set(bearer(driver)).send({})).status).toBe(403);
  });

  it('shipment verification and bid counts need a signed-in user', async () => {
    expect((await request(app).get('/api/v1/shipments/abc/verify')).status).toBe(401);
    expect((await request(app).get('/api/v1/capacity/windows/abc/bid-count')).status).toBe(401);
  });

  it('drivers cannot create mobile GPS sessions', async () => {
    const res = await request(app).post('/api/v1/telemetry/mobile-session').set(bearer(driver)).send({ vehicle_id: 'v' });
    expect(res.status).toBe(403);
  });

  it('proof-of-delivery verification is staff-only and needs a recipient', async () => {
    const body = { tracking_id: 't', otp: '2026' };
    expect((await request(app).post('/api/v1/cargo/verify-pod').set(bearer(driver)).send(body)).status).toBe(403);
    expect((await request(app).post('/api/v1/cargo/verify-pod').set(bearer(admin())).send(body)).status).toBe(400);
  });

  it('admins can list shipments', async () => {
    const res = await request(app).get('/api/v1/shipments/').set(bearer(admin()));
    expect(res.status).toBe(200);
  });
});

describe('drivers are limited to their own resources', () => {
  it('cannot list shipments', async () => {
    expect((await request(app).get('/api/v1/shipments/').set(bearer(driver))).status).toBe(403);
  });

  it('cannot mark a foreign shipment delivered', async () => {
    expect((await request(app).patch('/api/v1/shipments/s1?status=delivered').set(bearer(driver))).status).toBe(403);
  });

  it('cannot read the fleet summary', async () => {
    expect((await request(app).get('/api/v1/vehicles/summary').set(bearer(driver))).status).toBe(403);
  });

  it('cannot push telemetry for a vehicle they do not drive', async () => {
    const res = await request(app).post('/api/v1/telemetry/').set(bearer(driver)).send({
      vehicle_id: FOREIGN_VEHICLE, latitude: 1, longitude: 1, speed_kmph: 0, heading: 0, fuel_level_pct: 50,
    });
    expect(res.status).toBe(403);
    expect(supabaseMock.writes('telemetry')).toEqual([]);
  });

  it('cannot complete a stop on a foreign route', async () => {
    const res = await request(app).post('/api/v1/telemetry/driver-ping/complete-stop').set(bearer(driver))
      .send({ stop_id: 'abc', status: 'completed' });
    expect(res.status).toBe(403);
  });

  it('cannot read analytics insights', async () => {
    expect((await request(app).get('/api/v1/analytics/insights').set(bearer(driver))).status).toBe(403);
  });

  it('cannot resolve an SOS', async () => {
    expect((await request(app).put('/api/v1/telemetry/sos/x/resolve').set(bearer(driver))).status).toBe(403);
  });
});

describe('removed and unconfigured endpoints', () => {
  it('the earnings test endpoint is gone', async () => {
    expect((await request(app).get('/api/v1/auth/driver/earnings-test')).status).toBe(404);
  });

  it('GPS push is refused in production when no push secret is set', async () => {
    vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', 'production');
    const res = await request(app).post('/api/v1/spark-gps').send({ vehicleNo: 'X', lat: 1, lng: 1 });
    expect(res.status).toBe(503);
  });
});

describe('error responses', () => {
  it('unknown routes return a JSON 404', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ detail: 'Not found' });
  });

  it('internal errors return a generic 500 with the request id, not the database message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    supabaseMock.fail('capacity_bids', 'relation "internal_bid_ledger" does not exist');

    const res = await request(app).get('/api/v1/capacity/bids/pending').set(bearer(admin()));

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error', request_id: res.headers['x-request-id'] });
    expect(res.text).not.toContain('internal_bid_ledger');
  });
});
