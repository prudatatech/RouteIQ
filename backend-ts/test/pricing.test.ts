import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { settings } from '../src/core/config';
import { externalHttp } from '../src/core/http';
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

  it('says the price is unavailable when there is no rate card and no history', async () => {
    reset({ system_settings: [] });
    const res = await request(app).post('/api/v1/pricing/quote').set('Authorization', token('admin-1')).send(body);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('unavailable');
    expect(res.body.reason).toMatch(/rate/);
    expect(supabaseMock.rows('price_quotes')).toHaveLength(0);
  });

  it('applies per-vehicle-type rates, weight surcharge and the minimum charge', async () => {
    reset({
      system_settings: [
        { key: 'rate_per_km', value: '20' },
        { key: 'rate_per_km_tempo', value: '10' },
        { key: 'per_kg_surcharge', value: '2' },
        { key: 'min_charge', value: '100000' },
      ],
    });
    const res = await request(app).post('/api/v1/pricing/quote').set('Authorization', token('admin-1')).send({ ...body, vehicle_type: 'Tempo' });
    expect(res.body.status).toBe('ok');
    const byKey = Object.fromEntries(res.body.factors.map((f: any) => [f.key, f]));
    expect(byKey.rate_card.amount_inr).toBe(Math.round(res.body.distance_km * 10));
    expect(byKey.weight.amount_inr).toBe(2000);
    expect(byKey.min_charge).toBeDefined();
    expect(res.body.suggested).toBe(100000);
  });

  it('raises the price when loads outnumber free vehicles near pickup, using real counts', async () => {
    reset({
      vendor_shipment_requests: [
        { id: 'r1', status: 'pending', pickup_lat: 19.1, pickup_lng: 72.9 },
        { id: 'r2', status: 'approved', pickup_lat: 19.0, pickup_lng: 72.8 },
        { id: 'r3', status: 'pending', pickup_lat: 28.6, pickup_lng: 77.2 }, // Delhi: too far
        { id: 'r4', status: 'assigned', pickup_lat: 19.1, pickup_lng: 72.9 }, // not open
      ],
      vehicles: [{ id: 'v1', status: 'idle', latitude: 19.2, longitude: 72.9, vehicle_type: 'truck' }],
    });
    const res = await request(app).post('/api/v1/pricing/quote').set('Authorization', token('admin-1')).send(body);
    expect(res.body.demand).toMatchObject({ open_loads: 2, available_vehicles: 1 });
    const demand = res.body.factors.find((f: any) => f.key === 'demand');
    expect(demand.amount_inr).toBeGreaterThan(0);
    expect(res.body.suggested).toBeGreaterThan(Math.round(res.body.distance_km * 20));
  });

  it('learns from accepted prices on similar distances', async () => {
    const priced = (id: string, perKm: number) => ({
      id, cost_per_km: perKm, pickup_lat: 19.076, pickup_lng: 72.8777, drop_lat: 18.5204, drop_lng: 73.8567,
    });
    reset({ vendor_shipment_requests: [priced('a', 30), priced('b', 32), priced('c', 34)] });
    const res = await request(app).post('/api/v1/pricing/quote').set('Authorization', token('admin-1')).send(body);
    expect(res.body.history.samples).toBe(3);
    expect(res.body.history.median_per_km).toBe(32);
    const h = res.body.factors.find((f: any) => f.key === 'history');
    expect(h.amount_inr).toBeGreaterThan(0);
    // halfway between the rate card (20) and history (32) per km, plus a small demand effect of zero
    expect(res.body.per_km_suggested).toBeCloseTo(26, 0);
  });

  it('does not use history from a different distance band', async () => {
    reset({
      vendor_shipment_requests: ['a', 'b', 'c'].map(id => ({ id, cost_per_km: 90, pickup_lat: 19.076, pickup_lng: 72.8777, drop_lat: 28.6, drop_lng: 77.2 })),
    });
    const res = await request(app).post('/api/v1/pricing/quote').set('Authorization', token('admin-1')).send(body);
    expect(res.body.history.samples).toBe(0);
    expect(res.body.factors.find((f: any) => f.key === 'history')).toBeUndefined();
  });

  it('adds a weather surcharge only when OpenWeather reports severe weather', async () => {
    settings.OPENWEATHER_API_KEY = 'test-key';
    const weather = vi.spyOn(externalHttp, 'getJson').mockResolvedValue({
      weather: [{ id: 211, main: 'Thunderstorm', description: 'thunderstorm' }],
      main: { temp: 27 }, wind: { speed: 5 }, visibility: 8000,
    });
    const severe = await request(app).post('/api/v1/pricing/quote').set('Authorization', token('admin-1')).send(body);
    expect(weather).toHaveBeenCalledTimes(1);
    expect(severe.body.weather).toMatchObject({ checked: true, severe: true });
    expect(severe.body.factors.find((f: any) => f.key === 'weather').amount_inr).toBeGreaterThan(0);

    weather.mockResolvedValue({ weather: [{ id: 800, main: 'Clear', description: 'clear sky' }], main: { temp: 30 }, wind: { speed: 2 }, visibility: 10000 });
    // A different pickup avoids the 15 minute weather cache
    const calm = await request(app).post('/api/v1/pricing/quote').set('Authorization', token('admin-1'))
      .send({ ...body, pickup: { lat: 13.0827, lng: 80.2707 }, drop: { lat: 12.9716, lng: 77.5946 } });
    expect(calm.body.weather).toMatchObject({ checked: true, severe: false });
    expect(calm.body.factors.find((f: any) => f.key === 'weather')).toBeUndefined();
  });

  it('skips weather with a note when OpenWeather is not configured', async () => {
    const weather = vi.spyOn(externalHttp, 'getJson');
    const res = await request(app).post('/api/v1/pricing/quote').set('Authorization', token('admin-1')).send(body);
    expect(weather).not.toHaveBeenCalled();
    expect(res.body.weather.checked).toBe(false);
    expect(res.body.notes.join(' ')).toMatch(/OpenWeather is not set up/);
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

  it('keeps the low end of the range at or above the fuel cost when fuel settings exist', async () => {
    reset({
      system_settings: [{ key: 'rate_per_km', value: '1' }, { key: 'fuel_price_per_litre', value: '100' }],
      vehicles: [{ id: 'v1', status: 'on_route', latitude: 0, longitude: 0, vehicle_type: 'truck', fuel_efficiency_kmpl: 4 }],
    });
    const res = await request(app).post('/api/v1/pricing/quote').set('Authorization', token('admin-1')).send({ ...body, vehicle_type: 'truck' });
    const fuel = (res.body.distance_km / 4) * 100;
    expect(res.body.low).toBeGreaterThanOrEqual(Math.round(fuel));
    expect(res.body.suggested).toBeGreaterThanOrEqual(res.body.low);
    expect(res.body.factors.find((f: any) => f.key === 'fuel')).toBeDefined();
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
