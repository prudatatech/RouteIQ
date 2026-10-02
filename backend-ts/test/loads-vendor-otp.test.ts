/**
 * Web sign-in for the Post a Load flow: POST /auth/vendor/send-otp and /auth/vendor/verify-otp. They share the OTP
 * machinery with the driver and customer flows; verify finds or creates the vendor and returns a Supabase session.
 */
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';

const app = testApp();

let warn: MockInstance<typeof console.warn>;
const lastCode = () => warn.mock.calls.map(a => String(a[0])).filter(m => m.includes('OTP is:')).at(-1)?.match(/OTP is: (\d+)/)?.[1] ?? '';
const wrongCode = (code: string) => (code === '000000' ? '111111' : '000000');

let clientNo = 100;
function client() {
  const ip = `10.1.0.${++clientNo}`;
  return {
    send: (phone: unknown) => request(app).post('/api/v1/auth/vendor/send-otp').set('X-Forwarded-For', ip).send({ phone }),
    verify: (phone: unknown, otp: unknown) => request(app).post('/api/v1/auth/vendor/verify-otp').set('X-Forwarded-For', ip).send({ phone, otp }),
  };
}

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  supabaseMock.reset({ users: [], vendor_profiles: [] });
  supabaseMock.authAdmin = true;
  supabaseMock.sessions = true;
});

describe('POST /auth/vendor/send-otp', () => {
  it('issues a 6-digit code with the shared limits and logs it outside production', async () => {
    const res = await client().send('9876500101');
    expect(res.status).toBe(200);
    expect(res.body.phone).toBe('+91******0101');
    expect(lastCode()).toMatch(/^\d{6}$/);
    expect(warn.mock.calls.some(c => String(c[0]).includes('Welcome Vendor'))).toBe(true);
  });

  it('rejects an invalid phone and allows only three codes per 10 minutes', async () => {
    expect((await client().send('12')).status).toBe(400);
    expect((await client().send('5876543210')).status).toBe(400);
    expect((await client().send('+14155550100')).status).toBe(400);
    const c = client();
    for (let i = 0; i < 3; i++) expect((await c.send('9876500102')).status).toBe(200);
    expect((await c.send('9876500102')).status).toBe(429);
  });
});

describe('POST /auth/vendor/verify-otp', () => {
  it('creates a vendor (auth user with role vendor in app_metadata, plus the users row) and returns a session', async () => {
    const c = client();
    await c.send('9876500103');
    const res = await c.verify('9876500103', lastCode());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'authenticated', role: 'vendor', is_new_user: true });
    expect(res.body.session).toMatchObject({ access_token: 'sb-access-token', refresh_token: 'sb-refresh-token' });

    const created = supabaseMock.authCalls.filter(a => a.op === 'create');
    expect(created).toHaveLength(1);
    expect(created[0].body.app_metadata).toEqual({ role: 'vendor' });
    expect(created[0].body.email).toBe('vendor_919876500103@vendor.margixindia.local');
    const users = supabaseMock.rows('users');
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ role: 'vendor', phone: '+919876500103', full_name: 'Vendor 0103' });
    expect(res.body.user_id).toBe(users[0].id);
  });

  it('signs an existing vendor in again without creating another account', async () => {
    const c = client();
    await c.send('9876500104');
    expect((await c.verify('9876500104', lastCode())).body.is_new_user).toBe(true);
    await c.send('9876500104');
    const again = await c.verify('9876500104', lastCode());
    expect(again.status).toBe(200);
    expect(again.body.is_new_user).toBe(false);
    expect(supabaseMock.authCalls.filter(a => a.op === 'create')).toHaveLength(1);
    expect(supabaseMock.rows('users')).toHaveLength(1);
  });

  it('refuses a wrong code and creates nobody', async () => {
    const c = client();
    await c.send('9876500105');
    const res = await c.verify('9876500105', wrongCode(lastCode()));
    expect(res.status).toBe(401);
    expect(supabaseMock.authCalls.filter(a => a.op === 'create')).toHaveLength(0);
    expect(supabaseMock.rows('users')).toHaveLength(0);
  });

  it('does not accept a code issued for the customer or driver flow', async () => {
    const ip = '10.1.9.9';
    await request(app).post('/api/v1/auth/customer/send-otp').set('X-Forwarded-For', ip).send({ phone: '9876500106' });
    const code = lastCode();
    const res = await request(app).post('/api/v1/auth/vendor/verify-otp').set('X-Forwarded-For', ip).send({ phone: '9876500106', otp: code });
    expect(res.status).toBe(401);
  });

  it('refuses a disabled vendor', async () => {
    supabaseMock.rows('users').push({ id: 'dd000000-0000-4000-8000-000000000001', phone: '+919876500107', role: 'vendor', is_active: false });
    const c = client();
    await c.send('9876500107');
    expect((await c.verify('9876500107', lastCode())).status).toBe(403);
  });

  it('answers 502 when a session cannot be made, rather than a login with nothing to use', async () => {
    supabaseMock.sessions = false;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const c = client();
    await c.send('9876500108');
    expect((await c.verify('9876500108', lastCode())).status).toBe(502);
  });
});
