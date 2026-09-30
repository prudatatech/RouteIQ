import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { settings } from '../src/core/config';
import { externalHttp } from '../src/core/http';
import { cacheDeletePattern } from '../src/core/redis';
import {
  averagePrice, buildMapboxUrl, buildTomTomUrl, buildTruckProfile, estimateFuel, parseMapboxRoutes, parseTomTomRoutes,
  pickupDropViolation, resolveDeparture, simplifyLine, toIstOffsetIso, type PlanStop,
} from '../src/services/routing.service';

const app = testApp();
const admin = () => ({ Authorization: `Bearer ${supabaseMock.signUserToken('admin-1')}` });
const vendor = () => ({ Authorization: `Bearer ${supabaseMock.signUserToken('vendor-1')}` });

const VEHICLE = '11111111-1111-4111-8111-111111111111';
const NO_AVOID = { tolls: false, highways: false, ferries: false, unpaved: false };
const mumbai = { lat: 19.076, lng: 72.8777, name: 'Mumbai' };
const pune = { lat: 18.5204, lng: 73.8567, name: 'Pune' };
const nashik = { lat: 19.9975, lng: 73.7898, name: 'Nashik' };
const lonavala = { lat: 18.7546, lng: 73.4062, name: 'Lonavala' };

/** A TomTom route: two legs (Mumbai-Lonavala, Lonavala-Pune) with one jam and one toll section. */
const tomtomRoute = (over: Record<string, unknown> = {}) => ({
  summary: {
    lengthInMeters: 150_400, travelTimeInSeconds: 10_800, trafficDelayInSeconds: 900, noTrafficTravelTimeInSeconds: 9_900,
    departureTime: '2026-10-01T09:00:00+05:30', arrivalTime: '2026-10-01T12:00:00+05:30',
  },
  legs: [
    { summary: { lengthInMeters: 90_000, travelTimeInSeconds: 6_000 }, points: [
      { latitude: 19.076, longitude: 72.8777 }, { latitude: 18.95, longitude: 73.1 }, { latitude: 18.8, longitude: 73.3 }, { latitude: 18.7546, longitude: 73.4062 },
    ] },
    { summary: { lengthInMeters: 60_400, travelTimeInSeconds: 4_800 }, points: [
      { latitude: 18.7546, longitude: 73.4062 }, { latitude: 18.65, longitude: 73.65 }, { latitude: 18.5204, longitude: 73.8567 },
    ] },
  ],
  sections: [
    { startPointIndex: 1, endPointIndex: 2, sectionType: 'TRAFFIC', simpleCategory: 'JAM', effectiveSpeedInKmh: 12, delayInSeconds: 600, magnitudeOfDelay: 3 },
    { startPointIndex: 2, endPointIndex: 3, sectionType: 'TRAFFIC', simpleCategory: 'ROAD_WORK', delayInSeconds: 10, magnitudeOfDelay: 1 },
    { startPointIndex: 0, endPointIndex: 3, sectionType: 'TOLL', tollType: 'regular' },
  ],
  ...over,
});
const tomtomBody = (routes: unknown[] = [tomtomRoute()], extra: Record<string, unknown> = {}) => ({ routes, ...extra });

const mapboxBody = {
  routes: [
    { distance: 148_000, duration: 9_600, duration_typical: 8_400, geometry: { type: 'LineString', coordinates: [[72.8777, 19.076], [73.4, 18.75], [73.8567, 18.5204]] }, legs: [{ distance: 148_000, duration: 9_600 }] },
    { distance: 160_000, duration: 10_200, duration_typical: 9_600, geometry: { type: 'LineString', coordinates: [[72.8777, 19.076], [73.6, 18.9], [73.8567, 18.5204]] }, legs: [{ distance: 160_000, duration: 10_200 }] },
  ],
};

function reset(extra: Record<string, any[]> = {}) {
  supabaseMock.reset({
    users: [{ id: 'admin-1', role: 'admin', is_active: true }, { id: 'vendor-1', role: 'vendor', is_active: true }],
    vehicles: [
      { id: VEHICLE, plate_number: 'MH01AB1234', status: 'available', capacity_kg: 9000, current_load_kg: 2000, container_length_ft: 20, container_width_ft: 8, container_height_ft: 8.5, fuel_type: 'diesel', fuel_efficiency_kmpl: 5, driver_id: null },
    ],
    vehicle_fuel_logs: [],
    ...extra,
  });
}

const body = (over: Record<string, unknown> = {}) => ({ origin: mumbai, destination: pune, stops: [], vehicle_id: VEHICLE, kerb_weight_kg: 7000, avoid: NO_AVOID, ...over });

describe('TomTom request', () => {
  it('asks for a commercial truck route with traffic, alternatives and the vehicle size in metres', () => {
    const { profile } = buildTruckProfile({ capacity_kg: 9000, current_load_kg: 2000, container_length_ft: 20, container_width_ft: 8, container_height_ft: 8.5 }, { kerb_weight_kg: 7000 });
    expect(profile).toEqual({ weight_kg: 9000, length_m: 6.1, width_m: 2.44, height_m: 2.59 });

    const url = buildTomTomUrl({ points: [mumbai, lonavala, pune], profile, avoid: { tolls: true, highways: false, ferries: true, unpaved: true }, departAtMs: null, alternatives: 2, bestOrder: false }, 'KEY');
    expect(url).toContain('/calculateRoute/19.076000,72.877700:18.754600,73.406200:18.520400,73.856700/json?');
    for (const part of [
      'key=KEY', 'travelMode=truck', 'vehicleCommercial=true', 'traffic=true', 'departAt=now', 'maxAlternatives=2', 'computeTravelTimeFor=all',
      'sectionType=traffic', 'sectionType=toll', 'vehicleWeight=9000', 'vehicleLength=6.1', 'vehicleWidth=2.44', 'vehicleHeight=2.59',
      'avoid=tollRoads', 'avoid=ferries', 'avoid=unpavedRoads',
    ]) expect(url).toContain(part);
    expect(url).not.toContain('avoid=motorways');
    expect(url).not.toContain('computeBestOrder');
  });

  it('sends a future departure with the India offset and asks for the best order without alternatives', () => {
    const t = Date.parse('2026-10-01T03:30:00Z');
    expect(toIstOffsetIso(t)).toBe('2026-10-01T09:00:00+05:30');
    const url = buildTomTomUrl({ points: [mumbai, pune], profile: { weight_kg: null, length_m: null, width_m: null, height_m: null }, avoid: { ...NO_AVOID, highways: true }, departAtMs: t, alternatives: 2, bestOrder: true }, 'KEY');
    expect(url).toContain('departAt=2026-10-01T09%3A00%3A00%2B05%3A30');
    expect(url).toContain('computeBestOrder=true');
    expect(url).not.toContain('maxAlternatives');
    expect(url).toContain('avoid=motorways');
    expect(url).not.toContain('vehicleWeight');
  });

  it('leaves the weight out, and says so, when the kerb weight is not known', () => {
    const { profile, notes } = buildTruckProfile({ capacity_kg: 9000, current_load_kg: 2000, container_length_ft: null, container_width_ft: null, container_height_ft: null });
    expect(profile.weight_kg).toBeNull();
    expect(notes.join(' ')).toMatch(/Kerb weight is not set/);
    expect(notes.join(' ')).toMatch(/no container size/);
  });

  it('warns when the load is above the capacity', () => {
    const { notes } = buildTruckProfile({ capacity_kg: 1000, current_load_kg: null, container_length_ft: 10, container_width_ft: 6, container_height_ft: 6 }, { kerb_weight_kg: 3000, load_kg: 1500 });
    expect(notes.join(' ')).toMatch(/above the vehicle's capacity/);
  });

  it('uses now for a past or missing departure', () => {
    const now = Date.parse('2026-10-01T00:00:00Z');
    expect(resolveDeparture(undefined, now)).toEqual({ ms: now, isNow: true });
    expect(resolveDeparture('2026-09-30T00:00:00Z', now).isNow).toBe(true);
    expect(resolveDeparture('2026-10-02T00:00:00Z', now)).toEqual({ ms: Date.parse('2026-10-02T00:00:00Z'), isNow: false });
  });
});

describe('TomTom response', () => {
  it('reads distance, times, delay, toll distance, legs and traffic sections', () => {
    const { routes, order } = parseTomTomRoutes(tomtomBody(), Date.parse('2026-10-01T03:30:00Z'));
    expect(order).toBeNull();
    expect(routes).toHaveLength(1);
    const r = routes[0];
    expect(r).toMatchObject({ id: 'r0', distance_km: 150.4, travel_minutes: 180, no_traffic_minutes: 165, traffic_delay_minutes: 15 });
    expect(r.arrival_at).toBe('2026-10-01T06:30:00.000Z');
    expect(r.legs).toEqual([{ distance_km: 90, travel_minutes: 100 }, { distance_km: 60.4, travel_minutes: 80 }]);
    // The joint point of the two legs is not repeated
    expect(r.geometry).toHaveLength(6);
    expect(r.geometry[0]).toEqual([72.8777, 19.076]);
    // The toll section covers points 0 to 3
    expect(r.toll_km).toBeGreaterThan(50);
    expect(r.toll_km).toBeLessThan(90);
    // The 10 second road works are not worth listing; the jam is
    expect(r.traffic_sections).toHaveLength(1);
    expect(r.traffic_sections[0]).toMatchObject({ category: 'JAM', label: 'Traffic jam', delay_seconds: 600, magnitude: 3, effective_speed_kmh: 12 });
    expect(r.traffic_sections[0].coordinates).toHaveLength(2);
  });

  it('reports no toll when the route has no toll sections, and skips broken routes', () => {
    const noToll = tomtomRoute({ sections: [] });
    const { routes } = parseTomTomRoutes(tomtomBody([noToll, { summary: {} }, tomtomRoute()]), 0);
    expect(routes).toHaveLength(2);
    expect(routes[0].toll_km).toBe(0);
    expect(routes.map(r => r.id)).toEqual(['r0', 'r2']);
  });

  it('turns optimizedWaypoints into an order, and rejects one that is not a permutation', () => {
    const good = parseTomTomRoutes(tomtomBody([tomtomRoute()], { optimizedWaypoints: [{ providedIndex: 0, optimizedIndex: 1 }, { providedIndex: 1, optimizedIndex: 0 }, { providedIndex: 2, optimizedIndex: 2 }] }), 0);
    expect(good.order).toEqual([1, 0, 2]);
    const bad = parseTomTomRoutes(tomtomBody([tomtomRoute()], { optimizedWaypoints: [{ providedIndex: 0, optimizedIndex: 0 }, { providedIndex: 0, optimizedIndex: 1 }] }), 0);
    expect(bad.order).toBeNull();
  });

  it('thins long lines and keeps their ends', () => {
    const line: [number, number][] = Array.from({ length: 5000 }, (_, i) => [72 + i * 0.001, 19 + Math.sin(i / 40) * 0.05]);
    const out = simplifyLine(line, 800);
    expect(out.length).toBeLessThanOrEqual(800);
    expect(out[0]).toEqual(line[0]);
    expect(out[out.length - 1]).toEqual(line[line.length - 1]);
  });
});

describe('Mapbox response', () => {
  it('uses the traffic profile with alternatives for a simple trip, and excludes what is avoided', () => {
    const url = buildMapboxUrl([mumbai, pune], { tolls: true, highways: false, ferries: true, unpaved: false }, null, 'TOKEN');
    expect(url).toContain('/mapbox/driving-traffic/72.877700,19.076000;73.856700,18.520400?');
    expect(url).toContain('alternatives=true');
    expect(url).toContain('exclude=toll%2Cferry');
    expect(url).not.toContain('depart_at');
  });

  it('uses the plain driving profile when there are more than three places', () => {
    const url = buildMapboxUrl([mumbai, nashik, lonavala, pune], NO_AVOID, Date.parse('2026-10-01T03:30:00Z'), 'TOKEN');
    expect(url).toContain('/mapbox/driving/');
    expect(url).toContain('alternatives=false');
    expect(url).not.toContain('depart_at');
    expect(buildMapboxUrl([mumbai, lonavala, pune], NO_AVOID, Date.parse('2026-10-01T03:30:00Z'), 'T')).toContain('depart_at=2026-10-01T03%3A30%3A00Z');
  });

  it('reads routes, delay against typical traffic, and no toll figure', () => {
    const routes = parseMapboxRoutes(mapboxBody, Date.parse('2026-10-01T03:30:00Z'));
    expect(routes).toHaveLength(2);
    expect(routes[0]).toMatchObject({ distance_km: 148, travel_minutes: 160, no_traffic_minutes: null, traffic_delay_minutes: 20, toll_km: null, traffic_sections: [] });
    expect(routes[0].arrival_at).toBe('2026-10-01T06:10:00.000Z');
  });
});

describe('fuel', () => {
  it('works out litres from km per litre and cost from the price', () => {
    expect(estimateFuel(150.4, 5, { price_per_litre: 92.5, source: 'vehicle_log' })).toEqual({
      litres: 30.1, cost: 2784.25, price_per_litre: 92.5, price_source: 'vehicle_log', note: null,
    });
  });

  it('shows litres only, and says why, when no price has been logged', () => {
    const f = estimateFuel(100, 4, null);
    expect(f).toMatchObject({ litres: 25, cost: null, price_per_litre: null, price_source: null });
    expect(f.note).toMatch(/No fuel price has been logged/);
  });

  it('cannot estimate without the vehicle efficiency', () => {
    expect(estimateFuel(100, null, { price_per_litre: 90, source: 'fleet_average' })).toMatchObject({ litres: null, cost: null });
    expect(estimateFuel(100, 0, null).note).toMatch(/no fuel efficiency/);
  });

  it('averages fleet fills by litres', () => {
    expect(averagePrice([{ price_per_litre: 90, litres: 100 }, { price_per_litre: 100, litres: 300 }, { price_per_litre: 'x', litres: 5 }])).toEqual({ price_per_litre: 97.5, source: 'fleet_average' });
    expect(averagePrice([])).toBeNull();
  });
});

describe('pickup before drop', () => {
  const stops: PlanStop[] = [
    { lat: 1, lng: 1, name: 'Pickup A', kind: 'pickup', shipment_id: 'A' },
    { lat: 2, lng: 2, name: 'Drop A', kind: 'drop', shipment_id: 'A' },
    { lat: 3, lng: 3, name: 'Pickup B', kind: 'pickup', shipment_id: 'B' },
    { lat: 4, lng: 4, name: 'Plain stop', kind: 'stop' },
  ];
  it('accepts an order with every pickup first', () => {
    expect(pickupDropViolation(stops, [0, 1, 2, 3])).toBeNull();
    expect(pickupDropViolation(stops, [3, 2, 0, 1])).toBeNull();
  });
  it('names the drop that would come first', () => {
    expect(pickupDropViolation(stops, [1, 0, 2, 3])).toBe('Drop A would come before its pickup (Pickup A).');
  });
  it('ignores stops of different shipments and plain stops', () => {
    expect(pickupDropViolation(stops, [2, 3, 0, 1])).toBeNull();
  });
});

describe('POST /routing/plan', () => {
  beforeEach(async () => {
    reset();
    await cacheDeletePattern('routing:*');
    await cacheDeletePattern('ratelimit:routing*');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    settings.TOMTOM_API_KEY = '';
    settings.MAPBOX_ACCESS_TOKEN = '';
  });

  it('is for staff only', async () => {
    expect((await request(app).post('/api/v1/routing/plan').send(body())).status).toBe(401);
    expect((await request(app).post('/api/v1/routing/plan').set(vendor()).send(body())).status).toBe(403);
  });

  it('returns 503 with a clear message when neither service is set up', async () => {
    const http = vi.spyOn(externalHttp, 'getJson');
    const res = await request(app).post('/api/v1/routing/plan').set(admin()).send(body());
    expect(res.status).toBe(503);
    expect(res.body.detail).toMatch(/TomTom or Mapbox key/);
    expect(http).not.toHaveBeenCalled();
    const status = await request(app).get('/api/v1/routing/status').set(admin());
    expect(status.body).toMatchObject({ tomtom: false, mapbox: false, available: false });
  });

  it('validates the request', async () => {
    settings.TOMTOM_API_KEY = 'k';
    const http = vi.spyOn(externalHttp, 'getJson').mockResolvedValue(tomtomBody());
    const post = (b: unknown) => request(app).post('/api/v1/routing/plan').set(admin()).send(b as object);
    expect((await post({ ...body(), origin: undefined })).status).toBe(400);
    expect((await post(body({ destination: { lat: 120, lng: 73 } }))).status).toBe(400);
    expect((await post(body({ destination: { lat: 0, lng: 0 } }))).status).toBe(400);
    expect((await post(body({ vehicle_id: 'not-a-uuid' }))).status).toBe(400);
    expect((await post(body({ departure_at: 'tomorrow morning' }))).status).toBe(400);
    const tooMany = await post(body({ stops: Array.from({ length: 21 }, (_, i) => ({ lat: 19 + i * 0.01, lng: 73 })) }));
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.detail).toMatch(/Up to 20 stops/);
    expect(http).not.toHaveBeenCalled();
  });

  it('accepts 20 stops', async () => {
    settings.TOMTOM_API_KEY = 'k';
    vi.spyOn(externalHttp, 'getJson').mockResolvedValue(tomtomBody());
    const res = await request(app).post('/api/v1/routing/plan').set(admin()).send(body({ stops: Array.from({ length: 20 }, (_, i) => ({ lat: 19 + i * 0.01, lng: 73 })) }));
    expect(res.status).toBe(200);
  });

  it('plans a truck route with TomTom, with fuel from the vehicle\'s latest logged price', async () => {
    settings.TOMTOM_API_KEY = 'k';
    supabaseMock.rows('vehicle_fuel_logs').push({ id: 'f1', vehicle_id: VEHICLE, filled_at: '2026-09-29T10:00:00Z', litres: 100, price_per_litre: 92, total_amount: 9200 });
    const http = vi.spyOn(externalHttp, 'getJson').mockResolvedValue(tomtomBody([tomtomRoute(), tomtomRoute({ summary: { ...tomtomRoute().summary, lengthInMeters: 162_000, travelTimeInSeconds: 11_400 } })]));

    const res = await request(app).post('/api/v1/routing/plan').set(admin()).send(body({ stops: [lonavala], avoid: { ...NO_AVOID, tolls: true } }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ provider: 'tomtom', truck_aware: true, cached: false });
    expect(res.body.routes).toHaveLength(2);
    expect(res.body.routes[0]).toMatchObject({ distance_km: 150.4, travel_minutes: 180, traffic_delay_minutes: 15, fuel: { litres: 30.1, price_per_litre: 92, price_source: 'vehicle_log', cost: 2769.2 } });
    expect(res.body.truck_profile).toEqual({ weight_kg: 9000, length_m: 6.1, width_m: 2.44, height_m: 2.59 });
    expect(res.body.vehicle).toMatchObject({ id: VEHICLE, plate_number: 'MH01AB1234' });

    const url = http.mock.calls[0][0] as string;
    expect(url).toContain('api.tomtom.com/routing/1/calculateRoute/');
    expect(url).toContain('travelMode=truck');
    expect(url).toContain('avoid=tollRoads');
    expect(url).toContain('vehicleWeight=9000');
    // The key is never in the reply
    expect(JSON.stringify(res.body)).not.toContain('key=');
  });

  it('answers an identical request from the cache', async () => {
    settings.TOMTOM_API_KEY = 'k';
    const http = vi.spyOn(externalHttp, 'getJson').mockResolvedValue(tomtomBody());
    const first = await request(app).post('/api/v1/routing/plan').set(admin()).send(body());
    const second = await request(app).post('/api/v1/routing/plan').set(admin()).send(body());
    expect(first.body.cached).toBe(false);
    expect(second.body.cached).toBe(true);
    expect(http).toHaveBeenCalledTimes(1);
    // A different avoid option is a different plan
    await request(app).post('/api/v1/routing/plan').set(admin()).send(body({ avoid: { ...NO_AVOID, ferries: true } }));
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('falls back to the fleet average price, then to litres only', async () => {
    settings.TOMTOM_API_KEY = 'k';
    vi.spyOn(externalHttp, 'getJson').mockResolvedValue(tomtomBody());
    supabaseMock.rows('vehicles').push({ id: '22222222-2222-4222-8222-222222222222', plate_number: 'MH02', status: 'available', fuel_type: 'diesel' });
    supabaseMock.rows('vehicle_fuel_logs').push(
      { id: 'f1', vehicle_id: '22222222-2222-4222-8222-222222222222', filled_at: new Date().toISOString(), litres: 100, price_per_litre: 90 },
      { id: 'f2', vehicle_id: '22222222-2222-4222-8222-222222222222', filled_at: new Date().toISOString(), litres: 100, price_per_litre: 94 },
    );
    const avg = await request(app).post('/api/v1/routing/plan').set(admin()).send(body());
    expect(avg.body.routes[0].fuel).toMatchObject({ litres: 30.1, price_per_litre: 92, price_source: 'fleet_average', cost: 2769.2 });

    supabaseMock.rows('vehicle_fuel_logs').length = 0;
    const none = await request(app).post('/api/v1/routing/plan').set(admin()).send(body());
    expect(none.body.routes[0].fuel).toMatchObject({ litres: 30.1, cost: null, price_per_litre: null, price_source: null });
    expect(none.body.routes[0].fuel.note).toMatch(/No fuel price has been logged/);
  });

  it('falls back to Mapbox when TomTom is not set up, and says truck restrictions are not considered', async () => {
    settings.MAPBOX_ACCESS_TOKEN = 'pk.test';
    const http = vi.spyOn(externalHttp, 'getJson').mockResolvedValue(mapboxBody);
    const res = await request(app).post('/api/v1/routing/plan').set(admin()).send(body());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ provider: 'mapbox', truck_aware: false });
    expect(res.body.notes.join(' ')).toMatch(/do not consider truck restrictions/);
    expect(res.body.routes).toHaveLength(2);
    expect(res.body.routes[0]).toMatchObject({ toll_km: null, no_traffic_minutes: null, traffic_delay_minutes: 20 });
    expect(http.mock.calls[0][0]).toContain('api.mapbox.com/directions/v5/mapbox/driving-traffic/');
  });

  it('falls back to Mapbox when TomTom fails', async () => {
    settings.TOMTOM_API_KEY = 'k';
    settings.MAPBOX_ACCESS_TOKEN = 'pk.test';
    const http = vi.spyOn(externalHttp, 'getJson').mockImplementation(async (url: string) => {
      if (url.includes('tomtom')) throw Object.assign(new Error('Request failed with status 503'), { status: 503 });
      return mapboxBody;
    });
    const res = await request(app).post('/api/v1/routing/plan').set(admin()).send(body());
    expect(res.status).toBe(200);
    expect(res.body.provider).toBe('mapbox');
    expect(res.body.notes.join(' ')).toMatch(/TomTom could not be reached.*do not consider truck restrictions/);
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('retries TomTom without alternatives when it refuses them', async () => {
    settings.TOMTOM_API_KEY = 'k';
    const http = vi.spyOn(externalHttp, 'getJson').mockImplementation(async (url: string) => {
      if (url.includes('maxAlternatives')) throw Object.assign(new Error('Request failed with status 400'), { status: 400 });
      return tomtomBody();
    });
    const res = await request(app).post('/api/v1/routing/plan').set(admin()).send(body({ stops: [lonavala] }));
    expect(res.status).toBe(200);
    expect(res.body.provider).toBe('tomtom');
    expect(res.body.notes.join(' ')).toMatch(/no alternative routes/);
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('says so when TomTom cannot route the truck and there is no fallback', async () => {
    settings.TOMTOM_API_KEY = 'k';
    vi.spyOn(externalHttp, 'getJson').mockRejectedValue(Object.assign(new Error('Request failed with status 400'), { status: 400 }));
    const res = await request(app).post('/api/v1/routing/plan').set(admin()).send(body());
    expect(res.status).toBe(422);
    expect(res.body.detail).toMatch(/could not find a truck route/);

    vi.spyOn(externalHttp, 'getJson').mockRejectedValue(Object.assign(new Error('Request failed with status 500'), { status: 500 }));
    const down = await request(app).post('/api/v1/routing/plan').set(admin()).send(body({ avoid: { ...NO_AVOID, unpaved: true } }));
    expect(down.status).toBe(502);
  });

  it('404s an unknown vehicle', async () => {
    settings.TOMTOM_API_KEY = 'k';
    vi.spyOn(externalHttp, 'getJson').mockResolvedValue(tomtomBody());
    const res = await request(app).post('/api/v1/routing/plan').set(admin()).send(body({ vehicle_id: '33333333-3333-4333-8333-333333333333' }));
    expect(res.status).toBe(404);
  });

  it('limits each user\'s requests', async () => {
    settings.TOMTOM_API_KEY = 'k';
    vi.spyOn(externalHttp, 'getJson').mockResolvedValue(tomtomBody());
    let last = 200;
    for (let i = 0; i < 31; i++) last = (await request(app).post('/api/v1/routing/plan').set(admin()).send(body())).status;
    expect(last).toBe(429);
  });
});

describe('POST /routing/optimize-order', () => {
  const A = { ...nashik, kind: 'pickup', shipment_id: 'S1', id: 'a' };
  const B = { ...lonavala, kind: 'drop', shipment_id: 'S1', id: 'b' };
  const C = { lat: 18.9, lng: 73.2, name: 'Panvel', kind: 'stop', id: 'c' };
  // Entered order is A, B, C; the fastest visits C, A, B
  const bestOrder = (order: number[]) => ({ optimizedWaypoints: order.map((providedIndex, optimizedIndex) => ({ providedIndex, optimizedIndex })) });
  const shorter = tomtomRoute({ summary: { ...tomtomRoute().summary, lengthInMeters: 120_000, travelTimeInSeconds: 8_400 } });

  beforeEach(async () => {
    reset();
    await cacheDeletePattern('ratelimit:routing*');
    settings.TOMTOM_API_KEY = 'k';
  });
  afterEach(() => {
    vi.restoreAllMocks();
    settings.TOMTOM_API_KEY = '';
  });

  const mockTomTom = (best: Record<string, unknown>) => vi.spyOn(externalHttp, 'getJson').mockImplementation(async (url: string) =>
    url.includes('computeBestOrder') ? best : tomtomBody());

  it('needs TomTom and at least two stops', async () => {
    settings.TOMTOM_API_KEY = '';
    expect((await request(app).post('/api/v1/routing/optimize-order').set(admin()).send(body({ stops: [A, B] }))).status).toBe(503);
    settings.TOMTOM_API_KEY = 'k';
    const one = await request(app).post('/api/v1/routing/optimize-order').set(admin()).send(body({ stops: [A] }));
    expect(one.status).toBe(400);
  });

  it('reports the new order with the km and minutes saved against the entered order', async () => {
    const stops = [C, A, B].map(s => ({ ...s }));
    // Entered: C, A, B. The fastest is A, C, B, which still picks up (A) before it drops (B)
    const http = mockTomTom({ routes: [shorter], ...bestOrder([1, 0, 2]) }); // A, C, B
    const res = await request(app).post('/api/v1/routing/optimize-order').set(admin()).send(body({ stops }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      applicable: true, changed: true, order: [1, 0, 2],
      entered: { distance_km: 150.4, travel_minutes: 180 }, optimized: { distance_km: 120, travel_minutes: 140 },
      saved_km: 30.4, saved_minutes: 40,
    });
    expect(res.body.route.distance_km).toBe(120);
    const urls = http.mock.calls.map(c => c[0] as string);
    expect(urls.filter(u => u.includes('computeBestOrder=true'))).toHaveLength(1);
    // Start and end stay fixed: they are the first and last points in both requests
    for (const u of urls) {
      expect(u).toContain('/calculateRoute/19.076000,72.877700:');
      expect(u).toContain(':18.520400,73.856700/json');
    }
  });

  it('keeps the entered order and says why when the fastest order puts a drop before its pickup', async () => {
    mockTomTom({ routes: [shorter], ...bestOrder([1, 0, 2]) }); // B first: Lonavala drop before Nashik pickup
    const res = await request(app).post('/api/v1/routing/optimize-order').set(admin()).send(body({ stops: [A, B, C] }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ applicable: false, changed: false, order: [0, 1, 2], saved_km: 0, saved_minutes: 0 });
    expect(res.body.reason).toMatch(/lonavala would come before its pickup \(Nashik\)/i);
  });

  it('says the order is already the fastest when nothing changes', async () => {
    mockTomTom({ routes: [tomtomRoute()], ...bestOrder([0, 1, 2]) });
    const res = await request(app).post('/api/v1/routing/optimize-order').set(admin()).send(body({ stops: [A, B, C] }));
    expect(res.body).toMatchObject({ applicable: true, changed: false, order: [0, 1, 2], saved_km: 0, saved_minutes: 0 });
  });

  it('fails clearly when TomTom does not return an order', async () => {
    mockTomTom({ routes: [shorter] });
    const res = await request(app).post('/api/v1/routing/optimize-order').set(admin()).send(body({ stops: [A, B, C] }));
    expect(res.status).toBe(502);
  });
});

describe('open loads and route creation', () => {
  beforeEach(async () => {
    reset({
      shipments: [
        {
          id: 's1', tracking_id: 'MRX-1', status: 'created', origin_name: 'Bhiwandi warehouse', origin_address: 'Bhiwandi', origin_lat: 19.3, origin_lng: 73.06, total_weight_kg: 800, created_at: '2026-09-29T10:00:00Z',
          delivery_points: [
            { id: 'dp-1', name: 'Pune hub', address: 'Hinjewadi, Pune', latitude: 18.59, longitude: 73.73, created_at: '2026-09-29T10:00:01Z' },
            { id: 'dp-2', name: 'Nashik depot', address: 'Nashik', latitude: 19.99, longitude: 73.78, created_at: '2026-09-29T10:00:02Z' },
          ],
        },
        { id: 's2', tracking_id: 'MRX-2', status: 'delivered', origin_lat: 19, origin_lng: 73, delivery_points: [] },
        { id: 's3', tracking_id: 'MRX-3', status: 'created', origin_lat: null, origin_lng: null, delivery_points: [] },
      ],
      cargo_manifest: [
        { id: 'abcdef12-0000-4000-8000-000000000000', status: 'scheduled', pickup_location: 'Vashi', pickup_lat: 19.07, pickup_lng: 72.99, drop_location: 'Surat', drop_lat: 21.17, drop_lng: 72.83, capacity_kg: 5000 },
        { id: 'x2', status: 'delivered', pickup_lat: 19, pickup_lng: 72, drop_lat: 20, drop_lng: 73 },
      ],
      delivery_points: [{ id: '44444444-4444-4444-8444-444444444444', name: 'Pune hub', latitude: 18.59, longitude: 73.73, status: 'pending' }],
      routes: [],
      route_stops: [],
    });
    await cacheDeletePattern('ratelimit:routing*');
  });

  it('lists open shipments and loads with their real points, in drop order', async () => {
    const res = await request(app).get('/api/v1/routing/open-loads').set(admin());
    expect(res.status).toBe(200);
    const s1 = res.body.loads.find((l: any) => l.id === 's1');
    expect(s1).toMatchObject({ kind: 'shipment', reference: 'MRX-1', weight_kg: 800 });
    expect(s1.pickup).toMatchObject({ name: 'Bhiwandi warehouse', lat: 19.3, lng: 73.06 });
    expect(s1.drops.map((d: any) => d.name)).toEqual(['Pune hub', 'Nashik depot']);
    expect(s1.drops[0].delivery_point_id).toBe('dp-1');
    const load = res.body.loads.find((l: any) => l.kind === 'load');
    expect(load).toMatchObject({ reference: 'Load ABCDEF12', weight_kg: 5000, pickup: { name: 'Vashi' }, drops: [{ name: 'Surat' }] });
    // Delivered work and shipments with no usable place are not offered
    expect(res.body.loads.map((l: any) => l.id)).toEqual(['s1', 'abcdef12-0000-4000-8000-000000000000']);
    expect((await request(app).get('/api/v1/routing/open-loads').set(vendor())).status).toBe(403);
  });

  const create = (over: Record<string, unknown> = {}) => ({
    vehicle_id: VEHICLE,
    origin: mumbai,
    stops: [
      { name: 'Lonavala', address: 'Lonavala, Maharashtra', lat: 18.7546, lng: 73.4062 },
      { name: 'Pune hub', lat: 18.59, lng: 73.73, delivery_point_id: '44444444-4444-4444-8444-444444444444' },
      { name: 'Pune', lat: 18.5204, lng: 73.8567 },
    ],
    distance_km: 150.4, duration_minutes: 180, traffic_delay_minutes: 15, estimated_fuel_liters: 30.1,
    departure_at: '2026-10-01T03:30:00.000Z', provider: 'tomtom', truck_aware: true, toll_km: 62.5, avoid: NO_AVOID,
    ...over,
  });

  it('creates a pending route for the vehicle with the stops in the chosen order', async () => {
    const res = await request(app).post('/api/v1/routing/create-route').set(admin()).send(create());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ vehicle_id: VEHICLE, status: 'pending' });

    const [route] = supabaseMock.rows('routes');
    expect(route).toMatchObject({ vehicle_id: VEHICLE, status: 'pending', total_distance_km: 150.4, total_duration_minutes: 180, traffic_delay_minutes: 15, estimated_fuel_liters: 30.1 });
    expect(route.plan).toMatchObject({ source: 'route_planner', provider: 'tomtom', truck_aware: true, toll_km: 62.5, created_by: 'admin-1', origin: { name: 'Mumbai' } });

    const stops = supabaseMock.rows('route_stops').sort((a, b) => a.sequence - b.sequence);
    expect(stops.map(s => s.sequence)).toEqual([1, 2, 3]);
    expect(stops[1].delivery_point_id).toBe('44444444-4444-4444-8444-444444444444');
    const points = supabaseMock.rows('delivery_points');
    // The shipment's own point is reused; the two other places get new ones
    expect(points).toHaveLength(3);
    expect(points.find(p => p.id === stops[0].delivery_point_id)).toMatchObject({ name: 'Lonavala', latitude: 18.7546, status: 'pending' });
    expect(points.find(p => p.id === stops[2].delivery_point_id)).toMatchObject({ name: 'Pune' });
  });

  it('validates the plan and the vehicle', async () => {
    const post = (b: object) => request(app).post('/api/v1/routing/create-route').set(admin()).send(b);
    expect((await post(create({ stops: [] }))).status).toBe(400);
    expect((await post(create({ vehicle_id: 'nope' }))).status).toBe(400);
    expect((await post(create({ distance_km: -1 }))).status).toBe(400);
    expect((await post(create({ provider: 'google' }))).status).toBe(400);
    expect((await post(create({ vehicle_id: '33333333-3333-4333-8333-333333333333' }))).status).toBe(404);
    expect((await post(create({ stops: [{ name: 'Gone', lat: 19, lng: 73, delivery_point_id: '55555555-5555-4555-8555-555555555555' }] }))).status).toBe(400);
    supabaseMock.rows('vehicles')[0].status = 'maintenance';
    expect((await post(create())).status).toBe(409);
    expect(supabaseMock.rows('routes')).toHaveLength(0);
    expect((await request(app).post('/api/v1/routing/create-route').set(vendor()).send(create())).status).toBe(403);
  });
});
