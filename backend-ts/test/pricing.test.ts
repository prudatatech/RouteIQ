import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { settings } from '../src/core/config';
import { externalHttp } from '../src/core/http';
import { goodsTables } from './support/goods-world';
import { MapplsService } from '../src/services/mappls.service';

const app = testApp();
const token = (id: string) => `Bearer ${supabaseMock.signUserToken(id)}`;

// Mumbai to Pune: about 120 km in a straight line
const body = {
  pickup: { lat: 19.076, lng: 72.8777, label: 'Mumbai' },
  drop: { lat: 18.5204, lng: 73.8567, label: 'Pune' },
  weight_kg: 1000,
};

function reset(extra: Record<string, unknown[]> = {}) {
  supabaseMock.reset({
    users: [
      { id: 'admin-1', role: 'admin', is_active: true },
      { id: 'vendor-1', role: 'vendor', is_active: true },
      { id: 'driver-1', role: 'driver', is_active: true },
    ],
    system_settings: [{ key: 'rate_per_km', value: '20' }],
    vendor_shipment_requests: [],
    vehicles: [],
    capacity_bids: [],
    shipments: [],
    delivery_points: [],
    price_quotes: [],
    ...goodsTables(),
    ...extra,
  });
}

describe('POST /pricing/quote', () => {
  beforeEach(() => reset());
  afterEach(() => {
    vi.restoreAllMocks();
    settings.GOOGLE_MAPS_API_KEY = '';
    settings.OPENWEATHER_API_KEY = '';
    settings.MAPPLS_CLIENT_ID = '';
    settings.MAPPLS_CLIENT_SECRET = '';
  });

  it('needs sign-in and a permitted role', async () => {
    expect((await request(app).post('/api/v1/pricing/quote').send(body)).status).toBe(401);
    const res = await request(app).post('/api/v1/pricing/quote').set('Authorization', token('driver-1')).send(body);
    expect(res.status).toBe(403);
  });

  it('rejects bad input', async () => {
    const res = await request(app).post('/api/v1/pricing/quote').set('Authorization', token('vendor-1')).send({ ...body, weight_kg: 0 });
    expect(res.status).toBe(400);
  });

  it('prices from the rate card with an estimated distance and stores the quote', async () => {
    const res = await request(app).post('/api/v1/pricing/quote').set('Authorization', token('vendor-1')).send({ ...body, source: 'vendor_request' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.distance_source).toBe('estimate');
    expect(res.body.distance_is_estimate).toBe(true);
    const km = res.body.distance_km;
    expect(km).toBeGreaterThan(130);
    expect(res.body.suggested).toBe(Math.round(km * 20));
    expect(res.body.low).toBeLessThan(res.body.suggested);
    expect(res.body.high).toBeGreaterThan(res.body.suggested);
    expect(res.body.factors.map((f: any) => f.key)).toContain('rate_card');
    expect(res.body.notes.join(' ')).toMatch(/estimate/);
    const stored = supabaseMock.rows('price_quotes');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ user_id: 'vendor-1', role: 'vendor', source: 'vendor_request', suggested_inr: res.body.suggested });
    expect(res.body.quote_id).toBe(stored[0].id);
  });

  it('says the price is unavailable when there is no truck reference capacity', async () => {
    reset({ vehicle_classes: [] });
    const res = await request(app).post('/api/v1/pricing/quote').set('Authorization', token('admin-1')).send(body);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('unavailable');
    expect(res.body.reason).toMatch(/rate/);
    expect(supabaseMock.rows('price_quotes')).toHaveLength(0);
  });

  it('uses the same owner band for company and vendor accounts, despite old adjustments', async () => {
    reset({ system_settings: [{ key: 'rate_per_km', value: 500 }, { key: 'min_charge', value: 100000 }, { key: 'per_kg_surcharge', value: 20 }] });
    for (const id of ['admin-1', 'vendor-1']) {
      const res = await request(app).post('/api/v1/pricing/quote').set('Authorization', token(id)).send({ ...body, vehicle_type: 'flatbed' });
      expect(res.body.status).toBe('ok');
      expect(res.body.low).toBe(Math.round(res.body.distance_km * 25));
      expect(res.body.high).toBe(Math.round(res.body.distance_km * 40));
      expect(res.body.suggested).toBe(Math.round(res.body.distance_km * 32.5));
      expect(res.body.basis.rate_key).toBe('ten_wheeler');
      expect(res.body.factors.map((f: any) => f.code)).toEqual(['rate_card']);
    }
  });

  it('prices a selected container separately from a standard truck and rejects unsupported types', async () => {
    const res = await request(app).post('/api/v1/pricing/quote').set('Authorization', token('admin-1')).send({ ...body, vehicle_type: 'container_20ft' });
    expect(res.body.low).toBe(Math.round(res.body.distance_km * 50));
    expect(res.body.high).toBe(Math.round(res.body.distance_km * 80));
    for (const vehicle_type of ['reefer', 'tanker', 'bike', 'car', 'unknown']) {
      const unavailable = await request(app).post('/api/v1/pricing/quote').set('Authorization', token('admin-1')).send({ ...body, vehicle_type });
      expect(unavailable.body.status).toBe('unavailable');
    }
  });

  it('uses recorded fleet capacity instead of the cargo weight for a generic truck', async () => {
    const res = await request(app).post('/api/v1/pricing/quote').set('Authorization', token('admin-1')).send({ ...body, vehicle_type: 'truck', vehicle_capacity_t: 30 });
    expect(res.body.basis.rate_key).toBe('multi_axle');
    expect(res.body.low).toBe(Math.round(res.body.distance_km * 35));
  });

  it('uses the routed distance from Google when configured', async () => {
    settings.GOOGLE_MAPS_API_KEY = 'test-key';
    vi.spyOn(externalHttp, 'getJson').mockResolvedValue({ status: 'OK', routes: [{ legs: [{ distance: { value: 148_400 } }] }] });
    const res = await request(app).post('/api/v1/pricing/quote').set('Authorization', token('admin-1')).send(body);
    expect(res.body).toMatchObject({ distance_km: 148.4, distance_source: 'google', distance_is_estimate: false });
    expect(res.body.suggested).toBe(Math.round(148.4 * 20));
  });

  it('prefers Mappls, then falls back to an estimate when it fails', async () => {
    settings.MAPPLS_CLIENT_ID = 'id';
    settings.MAPPLS_CLIENT_SECRET = 'secret';
    const routing = vi.spyOn(MapplsService, 'getRouting').mockResolvedValueOnce({ routes: [{ distance: 150_000 }] });
    const ok = await request(app).post('/api/v1/pricing/quote').set('Authorization', token('admin-1')).send(body);
    expect(ok.body).toMatchObject({ distance_km: 150, distance_source: 'mappls' });

    routing.mockRejectedValueOnce(new Error('down'));
    const failed = await request(app).post('/api/v1/pricing/quote').set('Authorization', token('admin-1')).send(body);
    expect(failed.body.distance_source).toBe('estimate');
  });


});

describe('pricing settings', () => {
  beforeEach(() => reset());

  it('lets staff read and edit the rate card, and refuses others', async () => {
    expect((await request(app).get('/api/v1/pricing/settings').set('Authorization', token('vendor-1'))).status).toBe(403);
    const read = await request(app).get('/api/v1/pricing/settings').set('Authorization', token('admin-1'));
    expect(read.body.settings).toEqual({ rate_per_km: 20 });

    const put = await request(app).put('/api/v1/pricing/settings').set('Authorization', token('admin-1'))
      .send({ settings: { rate_per_km: 25, min_charge: 3000, fuel_price_per_litre: 96.5, rate_per_km_tempo: 12 } });
    expect(put.status).toBe(200);
    expect(put.body.settings).toEqual({ rate_per_km: 25, min_charge: 3000, fuel_price_per_litre: 96.5, rate_per_km_tempo: 12 });

    const removed = await request(app).put('/api/v1/pricing/settings').set('Authorization', token('admin-1')).send({ settings: { min_charge: null } });
    expect(removed.body.settings.min_charge).toBeUndefined();
  });

  it('refuses keys that are not pricing settings', async () => {
    const res = await request(app).put('/api/v1/pricing/settings').set('Authorization', token('admin-1')).send({ settings: { secret_thing: 1 } });
    expect(res.status).toBe(400);
    const neg = await request(app).put('/api/v1/pricing/settings').set('Authorization', token('admin-1')).send({ settings: { rate_per_km: -5 } });
    expect(neg.status).toBe(400);
  });
});
