import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';

const app = testApp();
const as = (sub: string, role: string) => ({ Authorization: `Bearer ${createAccessToken({ sub, role })}` });
const driver = as('driver-1', 'driver');
const admin = as('admin-1', 'admin');
const vendor = as('vendor-1', 'vendor');

const get = (auth?: object) => request(app).get('/api/v1/driver/dispatch-contact').set(auth ?? {});
const put = (auth: object, body: object) => request(app).put('/api/v1/driver/dispatch-contact').set(auth).send(body);

beforeEach(() => {
  supabaseMock.reset({
    users: [
      { id: 'driver-1', role: 'driver', is_active: true },
      { id: 'admin-1', role: 'admin', is_active: true },
      { id: 'vendor-1', role: 'vendor', is_active: true },
    ],
    system_settings: [],
  });
});

describe('dispatch contact', () => {
  it('has no number until staff set one', async () => {
    const res = await get(driver);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ phone: null });
  });

  it('lets staff save a number and drivers read it', async () => {
    const saved = await put(admin, { phone: '+91 98765-43210' });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ phone: '+919876543210' });
    expect(supabaseMock.rows('system_settings')).toEqual([expect.objectContaining({ key: 'dispatch_phone', value: { phone: '+919876543210' } })]);

    const read = await get(driver);
    expect(read.body).toEqual({ phone: '+919876543210' });
  });

  it('replaces the number instead of adding another', async () => {
    await put(admin, { phone: '9876543210' });
    await put(admin, { phone: '9123456789' });
    expect(supabaseMock.rows('system_settings')).toHaveLength(1);
    expect((await get(driver)).body.phone).toBe('9123456789');
  });

  it('reads a number stored as a bare string', async () => {
    supabaseMock.rows('system_settings').push({ key: 'dispatch_phone', value: '+911234567890' });
    expect((await get(driver)).body.phone).toBe('+911234567890');
  });

  it('clears the number with an empty value', async () => {
    await put(admin, { phone: '9876543210' });
    const cleared = await put(admin, { phone: '' });
    expect(cleared.body).toEqual({ phone: null });
    expect((await get(driver)).body.phone).toBeNull();
  });

  it('rejects something that is not a phone number', async () => {
    expect((await put(admin, { phone: 'call me' })).status).toBe(400);
    expect((await put(admin, { phone: '123' })).status).toBe(400);
    expect((await put(admin, { phone: 42 })).status).toBe(400);
    expect(supabaseMock.rows('system_settings')).toHaveLength(0);
  });

  it('does not let a driver or a vendor change it', async () => {
    expect((await put(driver, { phone: '9876543210' })).status).toBe(403);
    expect((await put(vendor, { phone: '9876543210' })).status).toBe(403);
    expect(supabaseMock.rows('system_settings')).toHaveLength(0);
  });

  it('is not readable by vendors or signed-out callers', async () => {
    expect((await get(vendor)).status).toBe(403);
    expect((await get()).status).toBe(401);
  });
});
