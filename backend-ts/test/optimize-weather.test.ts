import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { settings } from '../src/core/config';
import { externalHttp } from '../src/core/http';

const app = testApp();
const admin = () => ({ Authorization: `Bearer ${supabaseMock.signUserToken('admin-1')}` });

const VEH = '11111111-1111-4111-8111-111111111111';
const DEPOT = '22222222-2222-4222-8222-222222222222';

let sentToMl: any = null;

function reset() {
  sentToMl = null;
  supabaseMock.reset({
    users: [{ id: 'admin-1', role: 'admin', is_active: true }],
    depots: [{ id: DEPOT, name: 'Depot', latitude: 21.14, longitude: 79.08 }],
    vehicles: [{ id: VEH, plate_number: 'MH12AB1234', status: 'available', capacity_kg: 5000, fuel_efficiency_kmpl: 5, driver_id: null }],
    shipments: [{ id: '00000000-0000-4000-8000-000000000000', status: 'created', total_weight_kg: 100, delivery_points: [{ id: 'dp1', latitude: 21.2, longitude: 79.1 }] }],
    routes: [],
    route_stops: [],
    notifications: [],
  });
  // The ML service call goes through fetch; capture the factors it is sent
  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
    const url = String(input);
    if (url.includes('/optimize')) {
      sentToMl = JSON.parse(init.body);
      return new Response(JSON.stringify({ routes: [], total_distance_km: 0, total_fuel_liters: 0 }), { status: 200 });
    }
    return globalFetch(input, init);
  }));
}

const globalFetch = globalThis.fetch;

describe('optimizer weather factor', () => {
  beforeEach(reset);
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    settings.OPENWEATHER_API_KEY = '';
  });

  const post = (extra: Record<string, unknown> = {}) =>
    request(app).post('/api/v1/optimize').set(admin()).send({ depot_id: DEPOT, vehicle_ids: [VEH], shipment_ids: ['00000000-0000-4000-8000-000000000000'], ...extra });

  it('has no weather effect and says so when live weather is not configured', async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(sentToMl.weather_factor).toBe(1);
    expect(res.body.weather).toMatchObject({ source: 'unavailable' });
  });

  it('uses live severity from OpenWeather when no manual value is given', async () => {
    settings.OPENWEATHER_API_KEY = 'test-key';
    vi.spyOn(externalHttp, 'getJson').mockResolvedValue({ weather: [{ id: 211, main: 'Thunderstorm', description: 'thunderstorm' }], wind: { speed: 3 }, visibility: 9000 });
    const res = await post();
    expect(res.body.weather).toMatchObject({ source: 'live', severity: 0.9, description: 'thunderstorm' });
    expect(sentToMl.weather_factor).toBeCloseTo(1 + 0.9 * settings.WEATHER_FACTOR_MULTIPLIER);
  });

  it('keeps the manual value as an override', async () => {
    settings.OPENWEATHER_API_KEY = 'test-key';
    const http = vi.spyOn(externalHttp, 'getJson');
    const res = await post({ weather_severity: 0.5 });
    expect(http).not.toHaveBeenCalled();
    expect(res.body.weather).toMatchObject({ source: 'manual', severity: 0.5 });
    expect(sentToMl.weather_factor).toBeCloseTo(1 + 0.5 * settings.WEATHER_FACTOR_MULTIPLIER);
  });

  it('ignores weather when the option is off', async () => {
    const res = await post({ consider_weather: false, weather_severity: 0.9 });
    expect(res.body.weather.source).toBe('off');
    expect(sentToMl.weather_factor).toBe(1);
  });
});
