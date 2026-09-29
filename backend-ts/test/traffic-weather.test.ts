import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { settings } from '../src/core/config';
import { externalHttp } from '../src/core/http';
import { cacheGet, cacheSet } from '../src/core/redis';
import { parseTomTomIncidents, describeIncident, tilesForPath } from '../src/services/traffic.service';
import { severityFromReading } from '../src/services/weather.service';

const app = testApp();
const admin = () => ({ Authorization: `Bearer ${supabaseMock.signUserToken('admin-1')}` });
const vendor = () => ({ Authorization: `Bearer ${supabaseMock.signUserToken('vendor-1')}` });

// Route from Mumbai to Pune; the vehicle is near Lonavala
const route = {
  id: 'route-1',
  vehicle_id: 'veh-1',
  status: 'active',
  vehicles: { plate_number: 'MH01AB1234', latitude: 18.75, longitude: 73.4 },
  route_stops: [
    { sequence: 0, status: 'pending', delivery_points: { latitude: 18.5204, longitude: 73.8567 } },
  ],
};

const tomtom = (incidents: any[]) => ({ incidents });
const accident = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [73.6, 18.65] }, // on the line between vehicle and stop
  properties: { id: 'inc-1', iconCategory: 1, magnitudeOfDelay: 3, delay: 1500, roadNumbers: ['NH48'], events: [{ description: 'Accident' }], startTime: '2026-09-29T08:00:00Z' },
};
const farAway = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [77.2, 28.6] },
  properties: { id: 'inc-far', iconCategory: 6, magnitudeOfDelay: 2, delay: 900 },
};

function reset() {
  supabaseMock.reset({
    users: [
      { id: 'admin-1', role: 'admin', is_active: true },
      { id: 'vendor-1', role: 'vendor', is_active: true },
    ],
    routes: [route],
    traffic_incidents: [],
    depots: [],
  });
}

describe('traffic incidents', () => {
  beforeEach(async () => {
    reset();
    await cacheSet('active_reroute_suggestions', [], 60);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    settings.TOMTOM_API_KEY = '';
  });

  it('parses TomTom incidents into plain-language causes', () => {
    const [inc] = parseTomTomIncidents(tomtom([accident]));
    expect(inc).toMatchObject({ id: 'inc-1', type: 'Accident', road: 'NH48', severity: 3, delay_seconds: 1500, lat: 18.65, lng: 73.6 });
    expect(describeIncident(inc)).toBe('Accident on NH48, +25 min');
  });

  it('splits long routes into small boxes', () => {
    const tiles = tilesForPath([{ lat: 19, lng: 72.8 }, { lat: 28.6, lng: 77.2 }]);
    expect(tiles.length).toBeGreaterThan(5);
    for (const [minLng, minLat, maxLng, maxLat] of tiles) {
      expect(maxLng - minLng).toBeLessThan(1);
      expect(maxLat - minLat).toBeLessThan(1);
    }
  });

  it('does nothing and says so when TomTom is not configured', async () => {
    const http = vi.spyOn(externalHttp, 'getJson');
    const res = await request(app).post('/api/v1/traffic/refresh').set(admin());
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(http).not.toHaveBeenCalled();
    const status = await request(app).get('/api/v1/traffic/status').set(admin());
    expect(status.body).toMatchObject({ traffic_configured: false, weather_configured: false });
  });

  it('is for staff only', async () => {
    expect((await request(app).post('/api/v1/traffic/refresh').set(vendor())).status).toBe(403);
    expect((await request(app).get('/api/v1/traffic/incidents').set(vendor())).status).toBe(403);
  });

  it('stores incidents on an active route and raises a reroute suggestion with the cause', async () => {
    settings.TOMTOM_API_KEY = 'test-key';
    const http = vi.spyOn(externalHttp, 'getJson').mockResolvedValue(tomtom([accident, farAway]));
    vi.spyOn(externalHttp, 'postJson').mockRejectedValue(new Error('ML service is down'));

    const res = await request(app).post('/api/v1/traffic/refresh').set(admin());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: true, routes_checked: 1, errors: 0, suggestions_created: 1 });
    expect(http.mock.calls[0][0]).toContain('api.tomtom.com/traffic/services/5/incidentDetails');

    const stored = supabaseMock.rows('traffic_incidents');
    expect(stored.map(r => r.id).sort()).toEqual(['inc-1', 'inc-far']);
    expect(stored.find(r => r.id === 'inc-1')).toMatchObject({ type: 'Accident', road: 'NH48', delay_seconds: 1500, affected_route_ids: ['route-1'], active: true });
    expect(stored.find(r => r.id === 'inc-far')!.affected_route_ids).toEqual([]);

    const suggestions = (await cacheGet<any[]>('active_reroute_suggestions'))!;
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ vehicle_id: 'veh-1', route_id: 'route-1', trigger: 'Accident on NH48, +25 min', saved_minutes: null, source: 'traffic' });

    const incidents = await request(app).get('/api/v1/traffic/incidents?route_id=route-1').set(admin());
    expect(incidents.body.incidents.map((i: any) => i.id)).toEqual(['inc-1']);

    // The insights list carries the cause for the Optimize page
    const insights = await request(app).get('/api/v1/analytics/insights').set(admin());
    const reroute = insights.body.find((i: any) => i.type === 'reroute_suggestion');
    expect(reroute).toMatchObject({ cause: 'Accident on NH48, +25 min', route_id: 'route-1', saved_mins: null, delay_minutes: 25 });
  });

  it('uses the ML service saving when it finds a better order', async () => {
    settings.TOMTOM_API_KEY = 'test-key';
    vi.spyOn(externalHttp, 'getJson').mockResolvedValue(tomtom([accident]));
    vi.spyOn(externalHttp, 'postJson').mockResolvedValue({ saved_minutes: 12, new_stop_sequence: ['dp-2', 'dp-1'] });
    await request(app).post('/api/v1/traffic/refresh').set(admin());
    const [s] = (await cacheGet<any[]>('active_reroute_suggestions'))!;
    expect(s).toMatchObject({ saved_minutes: 12, new_stop_sequence: ['dp-2', 'dp-1'] });
  });

  it('ignores small delays and clears incidents TomTom stops reporting', async () => {
    settings.TOMTOM_API_KEY = 'test-key';
    const minor = { ...accident, properties: { ...accident.properties, id: 'inc-minor', magnitudeOfDelay: 1, delay: 60 } };
    const http = vi.spyOn(externalHttp, 'getJson').mockResolvedValue(tomtom([minor]));
    vi.spyOn(externalHttp, 'postJson').mockRejectedValue(new Error('down'));
    const first = await request(app).post('/api/v1/traffic/refresh').set(admin());
    expect(first.body.suggestions_created).toBe(0);

    await new Promise(r => setTimeout(r, 5));
    http.mockResolvedValue(tomtom([]));
    await request(app).post('/api/v1/traffic/refresh').set(admin());
    expect(supabaseMock.rows('traffic_incidents')[0].active).toBe(false);
    const open = await request(app).get('/api/v1/traffic/incidents').set(admin());
    expect(open.body.incidents).toEqual([]);
  });

  it('keeps old incidents open when TomTom fails', async () => {
    settings.TOMTOM_API_KEY = 'test-key';
    const http = vi.spyOn(externalHttp, 'getJson').mockResolvedValue(tomtom([accident]));
    vi.spyOn(externalHttp, 'postJson').mockRejectedValue(new Error('down'));
    await request(app).post('/api/v1/traffic/refresh').set(admin());
    await new Promise(r => setTimeout(r, 5));
    http.mockRejectedValue(new Error('TomTom is down'));
    const res = await request(app).post('/api/v1/traffic/refresh').set(admin());
    expect(res.body.errors).toBeGreaterThan(0);
    expect(supabaseMock.rows('traffic_incidents')[0].active).toBe(true);
  });
});

describe('weather on a route', () => {
  beforeEach(() => reset());
  afterEach(() => {
    vi.restoreAllMocks();
    settings.OPENWEATHER_API_KEY = '';
  });

  it('shows a not-configured state without a key', async () => {
    const http = vi.spyOn(externalHttp, 'getJson');
    const res = await request(app).get('/api/v1/weather/route/route-1').set(admin());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: false, available: false });
    expect(http).not.toHaveBeenCalled();
  });

  it('returns current conditions at the middle of the route, cached for later calls', async () => {
    settings.OPENWEATHER_API_KEY = 'test-key';
    const http = vi.spyOn(externalHttp, 'getJson').mockResolvedValue({
      weather: [{ id: 502, main: 'Rain', description: 'heavy intensity rain' }],
      main: { temp: 24.2 }, wind: { speed: 6 }, visibility: 4000, rain: { '1h': 9.5 },
    });
    const res = await request(app).get('/api/v1/weather/route/route-1').set(admin());
    expect(res.body).toMatchObject({ available: true, description: 'heavy intensity rain', severe: true, rain_mm_per_hour: 9.5, wind_kmph: 22 });
    await request(app).get('/api/v1/weather/route/route-1').set(admin());
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('reports when the weather service does not answer', async () => {
    settings.OPENWEATHER_API_KEY = 'test-key';
    // A different place from the earlier tests, so nothing is cached for it
    supabaseMock.reset({
      users: [{ id: 'admin-1', role: 'admin', is_active: true }],
      routes: [{ ...route, vehicles: { latitude: 13.08, longitude: 80.27 }, route_stops: [] }],
    });
    vi.spyOn(externalHttp, 'getJson').mockRejectedValue(new Error('timeout'));
    const res = await request(app).get('/api/v1/weather/route/route-1').set(admin());
    expect(res.body).toMatchObject({ configured: true, available: false });
  });

  it('404s for an unknown route', async () => {
    settings.OPENWEATHER_API_KEY = 'test-key';
    supabaseMock.reset({ users: [{ id: 'admin-1', role: 'admin', is_active: true }], routes: [] });
    expect((await request(app).get('/api/v1/weather/route/nope').set(admin())).status).toBe(404);
  });

  it('scores conditions from the code, wind and visibility', () => {
    expect(severityFromReading(800, 10, 10000)).toBe(0);
    expect(severityFromReading(211, 10, 10000)).toBeGreaterThanOrEqual(0.6);
    expect(severityFromReading(800, 70, 10000)).toBeGreaterThanOrEqual(0.6);
    expect(severityFromReading(800, 5, 100)).toBeGreaterThanOrEqual(0.6);
  });
});
