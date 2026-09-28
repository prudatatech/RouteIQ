import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { createApp } from '../src/app';
import { authenticateToken } from '../src/core/auth';

const app = createApp();

// Outside production without Twilio, the SMS body is logged with console.warn
let warn: MockInstance<typeof console.warn>;
function lastCode(): string {
  const messages = warn.mock.calls.map(args => String(args[0])).filter(m => m.includes('OTP is:'));
  return messages.at(-1)?.match(/OTP is: (\d+)/)?.[1] ?? '';
}
const DRIVER_ID = 'd0000000-0000-4000-8000-000000000001';
const CUSTOMER_ID = 'c0000000-0000-4000-8000-000000000001';
const wrongCode = (code: string) => (code === '000000' ? '111111' : '000000');

// OTP state lives in the in-memory cache for the whole file, so every test
// uses its own phone number and client IP (the per-IP limits also apply).
let clientNo = 0;
function otpClient(kind: 'driver' | 'customer' = 'driver') {
  const ip = `10.0.0.${++clientNo}`;
  return {
    send: (phone: unknown) =>
      request(app).post(`/api/v1/auth/${kind}/send-otp`).set('X-Forwarded-For', ip).send({ phone }),
    verify: (phone: unknown, otp: unknown) =>
      request(app).post(`/api/v1/auth/${kind}/verify-otp`).set('X-Forwarded-For', ip).send({ phone, otp }),
  };
}

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  supabaseMock.reset({
    users: [{ id: DRIVER_ID, phone: '+919876500003', role: 'driver', is_active: true }],
    customers: [{ id: CUSTOMER_ID, phone: '+919123456789', full_name: 'Test Customer' }],
  });
});

describe('sending an OTP', () => {
  it('rejects an invalid phone number', async () => {
    expect((await otpClient().send('12')).status).toBe(400);
  });

  it('issues a 6-digit code', async () => {
    const res = await otpClient().send('9876500001');
    expect(res.status).toBe(200);
    expect(res.body.phone).toBe('+91******0001');
    expect(lastCode()).toMatch(/^\d{6}$/);
  });

  it('allows three codes per 10 minutes, and a refused send keeps the current code', async () => {
    const client = otpClient();
    for (let i = 0; i < 3; i++) expect((await client.send('9876500003')).status).toBe(200);
    const current = lastCode();
    warn.mockClear();

    expect((await client.send('9876500003')).status).toBe(429);
    expect(lastCode()).toBe('');

    const res = await client.verify('9876500003', current);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: 'driver', user_id: DRIVER_ID });
  });

  it('is refused in production when Twilio is not configured', async () => {
    vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', 'production');
    const res = await otpClient().send('9876500009');
    expect(res.status).toBe(503);
    expect(lastCode()).toBe('');
  });
});

describe('verifying an OTP', () => {
  it('rejects a non-string code', async () => {
    const client = otpClient();
    await client.send('9876500002');
    expect((await client.verify('9876500002', 12345)).status).toBe(400);
  });

  it('allows five wrong guesses per code', async () => {
    const client = otpClient();
    await client.send('9876500004');
    const code = lastCode();

    for (let i = 1; i <= 5; i++) {
      const res = await client.verify('9876500004', wrongCode(code));
      expect(res.status).toBe(401);
      expect(res.body.remaining_attempts).toBe(5 - i);
    }
    expect((await client.verify('9876500004', code)).status).toBe(429);
  });

  it('locks the phone after ten failures across resends, even with the correct code', async () => {
    const client = otpClient();
    for (let round = 0; round < 2; round++) {
      await client.send('9876500005');
      const code = lastCode();
      for (let i = 0; i < 5; i++) await client.verify('9876500005', wrongCode(code));
    }
    await client.send('9876500005');

    const res = await client.verify('9876500005', lastCode());
    expect(res.status).toBe(429);
    expect(res.body.detail).toMatch(/in an hour/);
  });

  it('signs in a customer with the correct code', async () => {
    const client = otpClient('customer');
    await client.send('9123456789');

    const res = await client.verify('9123456789', lastCode());
    expect(res.status).toBe(200);
    expect(res.body.user_id).toBe(CUSTOMER_ID);
    expect(await authenticateToken(res.body.access_token)).toMatchObject({ user_id: CUSTOMER_ID, role: 'customer' });
  });
});
