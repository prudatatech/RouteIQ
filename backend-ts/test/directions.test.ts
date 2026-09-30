import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { settings } from '../src/core/config';
import { externalHttp } from '../src/core/http';
import { cacheDeletePattern } from '../src/core/redis';
import {
  buildMapboxDirectionsUrl, buildTomTomDirectionsUrl, directionsCacheKey, mergeDirections, parseMapboxDirections, parseTomTomDirections,
} from '../src/services/directions.service';

const app = testApp();
const auth = (id: string) => ({ Authorization: `Bearer ${supabaseMock.signUserToken(id)}` });

const mumbai = { lat: 19.076, lng: 72.8777 };
const pune = { lat: 18.5204, lng: 73.8567 };
const nashik = { lat: 19.9975, lng: 73.7898 };
const surat = { lat: 21.1702, lng: 72.8311 };
const body = (over: Record<string, unknown> = {}) => ({ waypoints: [mumbai, pune], ...over });

const mapboxBody = (segments = 2) => ({
  routes: [{
    distance: 148_000, duration: 9_600,
    geometry: { type: 'LineString', coordinates: Array.from({ length: segments + 1 }, (_, i) => [72.8777 + i * 0.5, 19.076 - i * 0.2]) },
    legs: [{ annotation: {
      congestion: ['low', 'heavy', 'severe'].slice(0, segments), distance: [50_000, 98_000].slice(0, segments), duration: [3_000, 6_600].slice(0, segments),
    } }],
  }],
});

const tomtomBody = () => ({
  routes: [{
    summary: { lengthInMeters: 150_400, travelTimeInSeconds: 10_800 },
    legs: [
      { points: [{ latitude: 19.076, longitude: 72.8777 }, { latitude: 18.8, longitude: 73.3 }] },
      { points: [{ latitude: 18.8, longitude: 73.3 }, { latitude: 18.5204, longitude: 73.8567 }] },
    ],
  }],
});

beforeEach(async () => {
  supabaseMock.reset({
    users: [
      { id: 'admin-1', role: 'admin', is_active: true }, { id: 'vendor-1', role: 'vendor', is_active: true },
      { id: 'customer-1', role: 'customer', is_active: true }, { id: 'driver-1', role: 'driver', is_active: true },
    ],
    cargo_manifest: [], shipments: [],
  });
  await cacheDeletePattern('directions:*');
  await cacheDeletePattern('ratelimit:routing-directions*');
  await cacheDeletePattern('ratelimit:track-route*');
});
afterEach(() => {
  vi.restoreAllMocks();
  settings.TOMTOM_API_KEY = '';
  settings.MAPBOX_ACCESS_TOKEN = '';
});

const post = (over: Record<string, unknown> = {}, as = 'admin-1') => request(app).post('/api/v1/routing/directions').set(auth(as)).send(body(over));

describe('directions parsing', () => {
  it('reads the geometry, totals and per-segment congestion from Mapbox', () => {
    const parsed = parseMapboxDirections(mapboxBody(2))!;
    expect(parsed.coordinates).toHaveLength(3);
    expect(parsed).toMatchObject({ distance_meters: 148_000, duration_seconds: 9_600, congestion: ['low', 'heavy'], segment_meters: [50_000, 98_000], segment_seconds: [3_000, 6_600] });
  });

  it('pads missing annotations, leaves them out when there are none and rejects an empty answer', () => {
    const short = mapboxBody(3);
    short.routes[0].legs[0].annotation.congestion = ['low'];
    expect(parseMapboxDirections(short)!.congestion).toEqual(['low', 'unknown', 'unknown']);
    const none = mapboxBody(2);
    none.routes[0].legs = [];
    expect(parseMapboxDirections(none)!.congestion).toBeUndefined();
    expect(parseMapboxDirections({ routes: [] })).toBeNull();
    expect(parseMapboxDirections(null)).toBeNull();
  });

  it('joins TomTom legs without repeating the shared point', () => {
    const parsed = parseTomTomDirections(tomtomBody())!;
    expect(parsed.coordinates).toEqual([[72.8777, 19.076], [73.3, 18.8], [73.8567, 18.5204]]);
    expect(parsed).toMatchObject({ distance_meters: 150_400, duration_seconds: 10_800 });
    expect(parseTomTomDirections({ routes: [] })).toBeNull();
  });

  it('merges pieces of a long trip keeping the segment lists in step with the line', () => {
    const a = parseMapboxDirections(mapboxBody(2))!;
    const b = parseMapboxDirections(mapboxBody(2))!;
    const merged = mergeDirections([a, b]);
    expect(merged.coordinates).toHaveLength(5);
    expect(merged.congestion).toHaveLength(4);
    expect(merged.segment_meters).toHaveLength(4);
    expect(merged.distance_meters).toBe(296_000);
  });

  it('builds provider URLs and a cache key rounded to about 11 m', () => {
    const mb = buildMapboxDirectionsUrl([mumbai, pune], true, 'TOK');
    expect(mb).toContain('/driving-traffic/72.8777,19.076;73.8567,18.5204?');
    expect(mb).toContain('annotations=congestion,duration,distance');
    expect(buildMapboxDirectionsUrl([mumbai, pune], false, 'TOK')).toContain('/mapbox/driving/');
    const tt = buildTomTomDirectionsUrl([mumbai, pune], true, 'KEY');
    expect(tt).toContain('/calculateRoute/19.076,72.8777:18.5204,73.8567/json');
    expect(tt).toContain('traffic=true');
    expect(directionsCacheKey([{ lat: 19.07601, lng: 72.87772 }, pune], true)).toBe(directionsCacheKey([mumbai, pune], true));
    expect(directionsCacheKey([mumbai, pune], true)).not.toBe(directionsCacheKey([mumbai, pune], false));
  });
});

describe('POST /routing/directions', () => {
  it('needs a signed-in user, and works for every role', async () => {
    expect((await request(app).post('/api/v1/routing/directions').send(body())).status).toBe(401);
    settings.MAPBOX_ACCESS_TOKEN = 'tok';
    vi.spyOn(externalHttp, 'getJson').mockResolvedValue(mapboxBody());
    for (const [i, id] of ['admin-1', 'vendor-1', 'customer-1', 'driver-1'].entries()) {
      // A slightly different start each time so the cache does not answer
      const res = await post({ waypoints: [{ lat: 19.076 + (i + 1) * 0.01, lng: 72.8777 }, pune] }, id);
      expect(res.status).toBe(200);
    }
  });

  it('answers from Mapbox with the congestion annotations and never leaks the token', async () => {
    settings.MAPBOX_ACCESS_TOKEN = 'secret-token';
    const http = vi.spyOn(externalHttp, 'getJson').mockResolvedValue(mapboxBody());
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ provider: 'mapbox', distance_meters: 148_000, duration_seconds: 9_600, congestion: ['low', 'heavy'] });
    expect(res.body.coordinates).toHaveLength(3);
    expect(JSON.stringify(res.body)).not.toContain('secret-token');
    expect(http).toHaveBeenCalledTimes(1);
    expect(http.mock.calls[0][0]).toContain('driving-traffic');
  });

  it('asks for the free-flow profile when traffic is off', async () => {
    settings.MAPBOX_ACCESS_TOKEN = 'tok';
    const http = vi.spyOn(externalHttp, 'getJson').mockResolvedValue(mapboxBody());
    await post({ traffic: false });
    expect(http.mock.calls[0][0]).toContain('/mapbox/driving/');
  });

  it('asks driving-traffic in pieces of three for a longer trip and joins them', async () => {
    settings.MAPBOX_ACCESS_TOKEN = 'tok';
    const http = vi.spyOn(externalHttp, 'getJson').mockResolvedValue(mapboxBody());
    const res = await post({ waypoints: [mumbai, pune, nashik, surat, mumbai] });
    expect(res.status).toBe(200);
    expect(http).toHaveBeenCalledTimes(2);
    expect(res.body.coordinates).toHaveLength(5);
    expect(res.body.distance_meters).toBe(296_000);
  });

  it('falls back to TomTom when Mapbox fails', async () => {
    settings.MAPBOX_ACCESS_TOKEN = 'tok';
    settings.TOMTOM_API_KEY = 'tt';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const http = vi.spyOn(externalHttp, 'getJson').mockImplementation(async (url: string) => {
      if (url.includes('api.mapbox.com')) throw Object.assign(new Error('Request failed with status 500'), { status: 500 });
      return tomtomBody();
    });
    const res = await post();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ provider: 'tomtom', distance_meters: 150_400, duration_seconds: 10_800 });
    expect(res.body.congestion).toBeUndefined();
    expect(http).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(res.body)).not.toContain('key=');
  });

  it('uses TomTom alone when Mapbox is not set up', async () => {
    settings.TOMTOM_API_KEY = 'tt';
    const http = vi.spyOn(externalHttp, 'getJson').mockResolvedValue(tomtomBody());
    expect((await post()).body.provider).toBe('tomtom');
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('returns 503 when neither provider is set up, and calls nothing', async () => {
    const http = vi.spyOn(externalHttp, 'getJson');
    const res = await post();
    expect(res.status).toBe(503);
    expect(res.body.detail).toMatch(/Mapbox or TomTom key/);
    expect(http).not.toHaveBeenCalled();
  });

  it('returns 502 when every provider fails and 404 when none finds a road route', async () => {
    settings.MAPBOX_ACCESS_TOKEN = 'tok';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const http = vi.spyOn(externalHttp, 'getJson').mockRejectedValue(new Error('Request failed with status 500'));
    expect((await post()).status).toBe(502);
    http.mockResolvedValue({ routes: [], code: 'NoRoute' });
    expect((await post({ waypoints: [mumbai, surat] })).status).toBe(404);
  });

  it('answers an identical request, and one within about 11 m, from the cache', async () => {
    settings.MAPBOX_ACCESS_TOKEN = 'tok';
    const http = vi.spyOn(externalHttp, 'getJson').mockResolvedValue(mapboxBody());
    await post();
    const again = await post({ waypoints: [{ lat: 19.07601, lng: 72.87772 }, pune] });
    expect(again.status).toBe(200);
    expect(http).toHaveBeenCalledTimes(1);
    await post({ traffic: false });
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('validates the waypoints', async () => {
    settings.MAPBOX_ACCESS_TOKEN = 'tok';
    const http = vi.spyOn(externalHttp, 'getJson').mockResolvedValue(mapboxBody());
    expect((await post({ waypoints: [mumbai] })).status).toBe(400);
    expect((await post({ waypoints: [mumbai, { lat: 120, lng: 73 }] })).status).toBe(400);
    expect((await post({ waypoints: [mumbai, { lat: 0, lng: 0 }] })).status).toBe(400);
    const tooMany = await post({ waypoints: Array.from({ length: 26 }, (_, i) => ({ lat: 19 + i * 0.01, lng: 73 })) });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.detail).toMatch(/Up to 25 waypoints/);
    expect(http).not.toHaveBeenCalled();
    const max = await post({ waypoints: Array.from({ length: 25 }, (_, i) => ({ lat: 19 + i * 0.01, lng: 73 })), traffic: false });
    expect(max.status).toBe(200);
  });

  it('rate limits each user', async () => {
    settings.MAPBOX_ACCESS_TOKEN = 'tok';
    vi.spyOn(externalHttp, 'getJson').mockResolvedValue(mapboxBody());
    let last = 0;
    for (let i = 0; i < 121; i++) last = (await post()).status;
    expect(last).toBe(429);
    // Another user has their own allowance
    expect((await post({}, 'vendor-1')).status).toBe(200);
  });
});

describe('GET /shipments/track/:trackingId/route (public)', () => {
  const manifest = (over: Record<string, unknown> = {}) => ({
    id: 'abcd1234-0000-4000-8000-000000000000', status: 'in_transit', capacity_kg: 900,
    pickup_location: 'Mumbai', pickup_lat: 19.076, pickup_lng: 72.8777,
    drop_location: 'Pune', drop_lat: 18.5204, drop_lng: 73.8567,
    vehicles: { id: 'v1', plate_number: 'MH01AB1234', vehicle_type: 'truck', status: 'on_route', latitude: 18.9, longitude: 73.2 },
    ...over,
  });

  it('routes from the vehicle to the drop with no sign-in and takes no coordinates from the caller', async () => {
    supabaseMock.rows('cargo_manifest').push(manifest());
    settings.MAPBOX_ACCESS_TOKEN = 'tok';
    const http = vi.spyOn(externalHttp, 'getJson').mockResolvedValue(mapboxBody());
    const res = await request(app).get('/api/v1/shipments/track/CM-ABCD1234/route?lat=1&lng=1&dLat=2&dLng=2');
    expect(res.status).toBe(200);
    expect(res.body.coordinates).toHaveLength(3);
    // The vehicle's and the drop's real positions were routed, not the ones in the query
    expect(http.mock.calls[0][0] as string).toContain('73.2,18.9;73.8567,18.5204');
  });

  it('is 404 for an unknown id, a finished shipment and one without a vehicle, and 503 without a provider', async () => {
    supabaseMock.rows('cargo_manifest').push(manifest());
    expect((await request(app).get('/api/v1/shipments/track/RTX-NOPE0000/route')).status).toBe(404);
    settings.MAPBOX_ACCESS_TOKEN = '';
    expect((await request(app).get('/api/v1/shipments/track/CM-ABCD1234/route')).status).toBe(503);
    supabaseMock.reset({ cargo_manifest: [manifest({ status: 'delivered' })], shipments: [] });
    expect((await request(app).get('/api/v1/shipments/track/CM-ABCD1234/route')).status).toBe(404);
    supabaseMock.reset({ cargo_manifest: [manifest({ vehicles: null })], shipments: [] });
    expect((await request(app).get('/api/v1/shipments/track/CM-ABCD1234/route')).status).toBe(404);
  });

  it('is rate limited per address', async () => {
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await request(app).get('/api/v1/shipments/track/RTX-NOPE0000/route')).status;
    expect(last).toBe(429);
  });
});
