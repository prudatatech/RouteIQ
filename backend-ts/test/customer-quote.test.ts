import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';
import { indianDateKey } from '../src/core/istDate';

const app = testApp();
const customer = () => ({ Authorization: `Bearer ${createAccessToken({ sub: 'cust-1', role: 'customer' })}` });
const driver = () => ({ Authorization: `Bearer ${createAccessToken({ sub: 'drv-1', role: 'driver' })}` });
const TODAY = indianDateKey(new Date());

const body = (over: Record<string, unknown> = {}) => ({
  pickup_lat: 19.3, pickup_lng: 73.06, drop_lat: 18.52, drop_lng: 73.85,
  weight_kg: 1500, load_type: 'full', date: TODAY, ...over,
});
const quote = (b: Record<string, unknown>, headers = customer()) => request(app).post('/api/v1/customer/quote').set(headers).send(b);

describe('customer quote', () => {
  beforeEach(() => supabaseMock.reset({ system_settings: [{ key: 'rate_per_km', value: { rate: 20 } }] }));

  it('needs a customer sign-in', async () => {
    expect((await request(app).post('/api/v1/customer/quote').send(body())).status).toBe(401);
    expect((await quote(body(), driver())).status).toBe(403);
  });

  it('prices through the pricing engine at the configured rate', async () => {
    const res = await quote(body());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ available: true, source: 'pricing_engine' });
    // No routing service in tests, so distance is the straight line x 1.3 estimate.
    expect(res.body.distance_km).toBeGreaterThan(130);
    expect(res.body.distance_km).toBeLessThan(170);
    expect(res.body.low).toBeLessThanOrEqual(res.body.suggested);
    expect(res.body.suggested).toBeLessThanOrEqual(res.body.high);
    expect(res.body.suggested).toBeGreaterThanOrEqual(res.body.distance_km * 20 * 0.8);
    expect(res.body.factors.some((f: { label: string }) => f.label === 'Rate card')).toBe(true);
  });

  it('says so when no rate is set, instead of inventing a price', async () => {
    supabaseMock.reset({ system_settings: [] });
    const res = await quote(body());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ available: false, suggested: null, low: null, high: null });
    expect(res.body.message).toMatch(/team will quote/);
  });

  it('rejects a bad weight, a past date and missing coordinates', async () => {
    expect((await quote(body({ weight_kg: 0 }))).status).toBe(400);
    expect((await quote(body({ date: '2020-01-01' }))).status).toBe(400);
    expect((await quote(body({ drop_lat: undefined }))).status).toBe(400);
  });
});
