import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';
import { settings } from '../src/core/config';
import { clearThresholdCache } from '../src/services/alert-settings.service';
import { GPS_MIN_DISTANCE_M, GPS_MIN_INTERVAL_MS, shouldRecordPoint } from '../src/services/gps-history.service';
import { loadPercent, stationarySince } from '../src/services/vehicle-activity.service';
import { hashShareToken, thin } from '../src/services/vehicle-location.service';

const app = testApp();
const driver = { Authorization: `Bearer ${createAccessToken({ sub: 'driver-1', role: 'driver' })}` };
const otherDriver = { Authorization: `Bearer ${createAccessToken({ sub: 'driver-2', role: 'driver' })}` };
const admin = { Authorization: `Bearer ${createAccessToken({ sub: 'admin-1', role: 'admin' })}` };
const VEHICLE = '33333333-3333-3333-3333-333333333333';
const OTHER = '44444444-4444-4444-4444-444444444444';

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
/** A latitude `metres` north of the base position (18.5, 73.8). */
const north = (metres: number) => 18.5 + metres / 111_195;

function reset(extra: Record<string, any[]> = {}) {
  clearThresholdCache();
  supabaseMock.reset({
    users: [
      { id: 'driver-1', role: 'driver', is_active: true },
      { id: 'driver-2', role: 'driver', is_active: true },
      { id: 'admin-1', role: 'admin', is_active: true },
    ],
    vehicles: [
      { id: VEHICLE, driver_id: 'driver-1', status: 'available', plate_number: 'MH12AB1234', capacity_kg: 1000, current_load_kg: 0, latitude: 18.5, longitude: 73.8, last_heartbeat: null, odometer_km: 0 },
      { id: OTHER, driver_id: 'driver-2', status: 'available', plate_number: 'MH12CD5678', capacity_kg: 2000, current_load_kg: 0 },
    ],
    routes: [],
    cargo_manifest: [],
    telemetry: [],
    gps_points: [],
    shipments: [],
    system_settings: [],
    vehicle_share_links: [],
    ...extra,
  });
}

const points = () => supabaseMock.rows('gps_points');
const vehicle = () => supabaseMock.rows('vehicles')[0];
const ping = (body: Record<string, unknown>) => request(app).post('/api/v1/telemetry/driver-ping').set(driver).send(body);

beforeEach(() => reset());

describe('pure rules', () => {
  const base = { latitude: 18.5, longitude: 73.8, recorded_at: '2026-09-29T10:00:00.000Z' };

  it('drops a point under 20 m and under 30 s from the last one, keeps the rest', () => {
    const at = (s: number) => new Date(Date.parse(base.recorded_at) + s * 1000).toISOString();
    expect(shouldRecordPoint(null, base)).toBe(true);
    expect(shouldRecordPoint(base, { latitude: north(5), longitude: 73.8, recorded_at: at(10) })).toBe(false);
    expect(shouldRecordPoint(base, { latitude: north(GPS_MIN_DISTANCE_M + 5), longitude: 73.8, recorded_at: at(10) })).toBe(true);
    expect(shouldRecordPoint(base, { latitude: north(5), longitude: 73.8, recorded_at: at(GPS_MIN_INTERVAL_MS / 1000) })).toBe(true);
  });

  it('finds how long a vehicle has stayed in one place', () => {
    const at = (m: number) => new Date(Date.parse(base.recorded_at) + m * 60_000).toISOString();
    const found = stationarySince([
      { lat: north(5000), lng: 73.8, at: at(0) },
      { lat: north(2000), lng: 73.8, at: at(10) },
      { lat: 18.5, lng: 73.8, at: at(20) },
      { lat: north(10), lng: 73.8, at: at(30) },
      { lat: north(20), lng: 73.8, at: at(40) },
    ]);
    expect(found).toEqual({ since: at(20), movedAt: at(10), atLeast: false });
    expect(stationarySince([{ lat: 18.5, lng: 73.8, at: at(0) }, { lat: 18.5, lng: 73.8, at: at(5) }])).toEqual({ since: at(0), movedAt: null, atLeast: true });
    expect(stationarySince([])).toBeNull();
  });

  it('works out how full a vehicle is', () => {
    expect(loadPercent({ capacityKg: 1000, currentLoadKg: 250, declaredPercent: 90, manifestKg: 400 })).toEqual({ percent_full: 25, load_kg: 250, basis: 'reported' });
    expect(loadPercent({ capacityKg: 1000, currentLoadKg: 0, declaredPercent: 60, manifestKg: 400 })).toEqual({ percent_full: 60, load_kg: 600, basis: 'declared' });
    expect(loadPercent({ capacityKg: 1000, currentLoadKg: null, declaredPercent: null, manifestKg: 400 })).toEqual({ percent_full: 40, load_kg: 400, basis: 'manifest' });
    expect(loadPercent({ capacityKg: null, currentLoadKg: null, declaredPercent: null, manifestKg: 0 })).toEqual({ percent_full: null, load_kg: null, basis: null });
  });

  it('thins a long trail but keeps its ends', () => {
    const items = Array.from({ length: 1000 }, (_, i) => i);
    const out = thin(items, 200);
    expect(out).toHaveLength(200);
    expect(out[0]).toBe(0);
    expect(out[199]).toBe(999);
    expect(thin([1, 2, 3], 200)).toEqual([1, 2, 3]);
  });
});

describe('every accepted position is written to gps_points', () => {
  it('driver-ping stores the point with speed, heading and accuracy, and moves the vehicle', async () => {
    const res = await ping({ lat: 19.1, lng: 74.2, speed: 10, heading: 90, accuracy: 6.4 });
    expect(res.status).toBe(200);
    expect(points()).toHaveLength(1);
    expect(points()[0]).toMatchObject({ vehicle_id: VEHICLE, latitude: 19.1, longitude: 74.2, accuracy: 6.4, speed_kmph: 36, heading: 90, source: 'driver_app' });
    expect(vehicle()).toMatchObject({ latitude: 19.1, longitude: 74.2 });
  });

  it('skips a ping under 20 m and 30 s from the last point, keeps one that moved or waited', async () => {
    const t = Date.now() - 120_000;
    const at = (s: number) => new Date(t + s * 1000).toISOString();
    await ping({ lat: 18.5, lng: 73.8, timestamp: at(0) });
    await ping({ lat: north(5), lng: 73.8, timestamp: at(10) });
    expect(points()).toHaveLength(1);
    await ping({ lat: north(60), lng: 73.8, timestamp: at(15) });
    expect(points()).toHaveLength(2);
    await ping({ lat: north(62), lng: 73.8, timestamp: at(50) });
    expect(points()).toHaveLength(3);
    // the vehicle itself always follows the ping, throttled or not
    expect(vehicle().latitude).toBe(north(62));
  });

  it('driver-ping stores every point of an offline batch in time order', async () => {
    const t = Date.now() - 600_000;
    const res = await ping({
      pings: [
        { lat: north(400), lng: 73.8, timestamp: new Date(t + 120_000).toISOString() },
        { lat: north(0), lng: 73.8, timestamp: new Date(t).toISOString() },
        { lat: north(200), lng: 73.8, timestamp: new Date(t + 60_000).toISOString() },
        { lat: 0, lng: 0, timestamp: new Date(t + 90_000).toISOString() },
      ],
    });
    expect(res.body.pings_processed).toBe(3);
    expect(points().map(p => p.latitude)).toEqual([north(0), north(200), north(400)]);
  });

  it('POST /telemetry stores the point', async () => {
    const res = await request(app).post('/api/v1/telemetry').set(admin)
      .send({ vehicle_id: VEHICLE, latitude: 19.3, longitude: 74.4, speed_kmph: 42, heading: 180 });
    expect(res.status).toBe(201);
    expect(points()).toHaveLength(1);
    expect(points()[0]).toMatchObject({ vehicle_id: VEHICLE, latitude: 19.3, longitude: 74.4, speed_kmph: 42, heading: 180, source: 'telemetry' });
  });

  it('POST /gps stores the point and moves the vehicle unless it reported something newer', async () => {
    const res = await request(app).post('/api/v1/gps').set(admin).send({ vehicle_id: VEHICLE, latitude: 19.5, longitude: 74.6, accuracy: 8 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ recorded: true, latitude: 19.5 });
    expect(points()[0]).toMatchObject({ latitude: 19.5, accuracy: 8, source: 'gps_api' });
    expect(vehicle()).toMatchObject({ latitude: 19.5, longitude: 74.6 });
    expect(vehicle().last_heartbeat).toBeTruthy();

    // an older point is history only
    const old = await request(app).post('/api/v1/gps').set(admin)
      .send({ vehicle_id: VEHICLE, latitude: 20.5, longitude: 75.6, recorded_at: minutesAgo(60) });
    expect(old.status).toBe(201);
    expect(points()).toHaveLength(2);
    expect(vehicle().latitude).toBe(19.5);
  });

  it('POST /gps refuses a position that is not real', async () => {
    const res = await request(app).post('/api/v1/gps').set(admin).send({ vehicle_id: VEHICLE, latitude: 0, longitude: 0 });
    expect(res.status).toBe(400);
    expect(points()).toHaveLength(0);
  });

  it('the SparkGPS push stores the point, telemetry and the vehicle position', async () => {
    settings.SPARK_GPS_PUSH_SECRET = 'push-secret';
    const res = await request(app).post('/api/v1/spark-gps').set({ 'X-Spark-Key': 'push-secret' })
      .send({ vehicleNo: 'MH12AB1234', lat: '19.7', lng: '74.8', speed: 33, heading: 45 });
    expect(res.status).toBe(201);
    expect(points()).toHaveLength(1);
    expect(points()[0]).toMatchObject({ vehicle_id: VEHICLE, latitude: 19.7, longitude: 74.8, speed_kmph: 33, source: 'spark_push' });
    expect(vehicle()).toMatchObject({ latitude: 19.7, longitude: 74.8 });
    expect(vehicle().last_sync).toBeTruthy();
    expect(supabaseMock.writes('telemetry', 'POST')).toHaveLength(1);
  });

  it('a driver reporting a position on the vehicle record stores it and counts as a heartbeat', async () => {
    const res = await request(app).patch(`/api/v1/vehicles/${VEHICLE}`).set(driver).send({ latitude: 19.9, longitude: 75.0 });
    expect(res.status).toBe(200);
    expect(points()).toHaveLength(1);
    expect(points()[0]).toMatchObject({ latitude: 19.9, longitude: 75.0, source: 'vehicle_update' });
    expect(vehicle().last_heartbeat).toBeTruthy();
  });

  it('a load report without a position writes no point', async () => {
    await request(app).patch(`/api/v1/vehicles/${VEHICLE}`).set(driver).send({ declared_load_percentage: 40 });
    expect(points()).toHaveLength(0);
  });
});

describe('GET /gps/vehicle/:id/track', () => {
  const rows = () => [
    { id: 'p1', vehicle_id: VEHICLE, latitude: north(0), longitude: 73.8, recorded_at: minutesAgo(50), speed_kmph: 20, heading: 10, accuracy: 5 },
    { id: 'p2', vehicle_id: VEHICLE, latitude: north(1000), longitude: 73.8, recorded_at: minutesAgo(40), speed_kmph: 30, heading: 10, accuracy: null },
    { id: 'p3', vehicle_id: VEHICLE, latitude: north(2000), longitude: 73.8, recorded_at: minutesAgo(30), speed_kmph: 25, heading: 10, accuracy: 4 },
    { id: 'old', vehicle_id: VEHICLE, latitude: north(9000), longitude: 73.8, recorded_at: minutesAgo(60 * 30), speed_kmph: 0, heading: 0, accuracy: null },
  ];
  const track = (query = '', headers: Record<string, string> = admin) =>
    request(app).get(`/api/v1/gps/vehicle/${VEHICLE}/track${query}`).set(headers);

  it('returns the last 24 hours oldest first with the distance driven', async () => {
    reset({ gps_points: rows() });
    const res = await track();
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
    expect(res.body.points.map((p: any) => Math.round((p.lat - 18.5) * 111_195))).toEqual([0, 1000, 2000]);
    expect(res.body.points[0]).toMatchObject({ speed_kmph: 20, heading: 10, accuracy: 5 });
    expect(res.body.points[1].accuracy).toBeNull();
    expect(res.body.distance_km).toBeCloseTo(2, 0);
    expect(res.body.truncated).toBe(false);
  });

  it('honours from and to', async () => {
    reset({ gps_points: rows() });
    const res = await track(`?from=${encodeURIComponent(minutesAgo(45))}&to=${encodeURIComponent(minutesAgo(35))}`);
    expect(res.body.count).toBe(1);
    expect(res.body.points[0].lat).toBeCloseTo(north(1000), 6);
  });

  it('keeps the newest points when there are more than the limit', async () => {
    reset({ gps_points: rows() });
    const res = await track('?limit=2');
    expect(res.body.count).toBe(2);
    expect(res.body.truncated).toBe(true);
    expect(res.body.points[1].lat).toBeCloseTo(north(2000), 6);
  });

  it('refuses a bad window and a vehicle the caller does not drive', async () => {
    reset({ gps_points: rows() });
    expect((await track('?from=nonsense')).status).toBe(400);
    expect((await track(`?from=${encodeURIComponent(minutesAgo(10))}&to=${encodeURIComponent(minutesAgo(20))}`)).status).toBe(400);
    expect((await track(`?from=${encodeURIComponent(minutesAgo(60 * 24 * 30))}`)).status).toBe(400);
    expect((await track('', otherDriver)).status).toBe(403);
    expect((await track('', driver)).status).toBe(200);
    expect((await request(app).get(`/api/v1/gps/vehicle/${VEHICLE}/track`)).status).toBe(401);
  });
});

describe('GET /fleet/vehicles/:id/activity', () => {
  const activity = () => request(app).get(`/api/v1/fleet/vehicles/${VEHICLE}/activity`).set(admin);
  const live = () => ({ last_heartbeat: new Date().toISOString() });

  it('is carrying on an active route: which route, from where to where, how full, and the shipments', async () => {
    reset({
      routes: [{
        id: 'route-1', vehicle_id: VEHICLE, status: 'active', started_at: minutesAgo(90),
        depots: { name: 'Pune Hub' },
        route_stops: [
          { id: 's1', sequence: 1, status: 'completed', delivery_points: { name: 'Nashik Store', address: null, shipment_id: 'sh-1' } },
          { id: 's2', sequence: 2, status: 'pending', delivery_points: { name: 'Surat Store', address: null, shipment_id: 'sh-2' } },
        ],
      }],
      shipments: [{ id: 'sh-1', tracking_id: 'RTX-1' }, { id: 'sh-2', tracking_id: 'RTX-2' }],
    });
    Object.assign(vehicle(), live(), { current_load_kg: 600 });
    const res = await activity();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ state: 'carrying', live: true, load: { percent_full: 60, load_kg: 600, capacity_kg: 1000, basis: 'reported' } });
    expect(res.body.jobs).toHaveLength(1);
    expect(res.body.jobs[0]).toMatchObject({
      kind: 'route', id: 'route-1', from: 'Pune Hub', to: 'Surat Store', next_stop: 'Surat Store', stops_total: 2, stops_done: 1,
    });
    expect(res.body.jobs[0].tracking_ids.sort()).toEqual(['RTX-1', 'RTX-2']);
    expect(res.body.since).toBe(res.body.jobs[0].started_at);
  });

  it('is carrying a manifest in transit, with the pickup and drop places', async () => {
    reset({ cargo_manifest: [{ id: 'm-1', vehicle_id: VEHICLE, status: 'in_transit', pickup_location: 'Andheri', drop_location: 'Thane', capacity_kg: 250, updated_at: minutesAgo(30) }] });
    Object.assign(vehicle(), live());
    const res = await activity();
    expect(res.body.state).toBe('carrying');
    expect(res.body.jobs[0]).toMatchObject({ kind: 'manifest', from: 'Andheri', to: 'Thane', weight_kg: 250 });
    expect(res.body.load).toMatchObject({ percent_full: 25, basis: 'manifest' });
  });

  it('only counts manifests that are in transit, not the ones still scheduled', async () => {
    Object.assign(vehicle(), live());
    await activity();
    const query = supabaseMock.requests.find(u => u.pathname.endsWith('/cargo_manifest'));
    expect(query?.searchParams.get('status')).toBe('eq.in_transit');
  });

  it('is idle when reporting with nothing on board, and says since when it has stayed there', async () => {
    reset({
      gps_points: [
        { id: 'a', vehicle_id: VEHICLE, latitude: north(3000), longitude: 73.8, recorded_at: minutesAgo(200), speed_kmph: 30 },
        { id: 'b', vehicle_id: VEHICLE, latitude: 18.5, longitude: 73.8, recorded_at: minutesAgo(120), speed_kmph: 0 },
        { id: 'c', vehicle_id: VEHICLE, latitude: north(10), longitude: 73.8, recorded_at: minutesAgo(60), speed_kmph: 0 },
        { id: 'd', vehicle_id: VEHICLE, latitude: north(15), longitude: 73.8, recorded_at: minutesAgo(1), speed_kmph: 0 },
      ],
    });
    Object.assign(vehicle(), live(), { current_location_name: 'Pune Hub' });
    const res = await activity();
    expect(res.body).toMatchObject({ state: 'idle', jobs: [], place_name: 'Pune Hub' });
    expect(res.body.stationary.at_least).toBe(false);
    expect(res.body.stationary.minutes).toBeGreaterThanOrEqual(119);
    expect(res.body.stationary.minutes).toBeLessThanOrEqual(121);
    expect(res.body.since).toBe(res.body.stationary.since);
    expect(res.body.last_moved_at).toBeTruthy();
  });

  it('is offline when it has not reported within the GPS-lost limit, and still lists what it holds', async () => {
    reset({ cargo_manifest: [{ id: 'm-1', vehicle_id: VEHICLE, status: 'in_transit', pickup_location: 'A', drop_location: 'B', capacity_kg: 100 }] });
    Object.assign(vehicle(), { last_heartbeat: minutesAgo(45) });
    const res = await activity();
    expect(res.body).toMatchObject({ state: 'offline', live: false });
    expect(res.body.jobs).toHaveLength(1);
    expect(Date.parse(res.body.since)).toBe(Date.parse(res.body.last_seen_at));
  });

  it('is offline for a vehicle that never reported', async () => {
    Object.assign(vehicle(), { last_heartbeat: null, last_sync: null });
    const res = await activity();
    expect(res.body).toMatchObject({ state: 'offline', last_seen_at: null, since: null });
  });

  it('is for staff, and 404s an unknown vehicle', async () => {
    expect((await request(app).get(`/api/v1/fleet/vehicles/${VEHICLE}/activity`).set(driver)).status).toBe(403);
    expect((await request(app).get('/api/v1/fleet/vehicles/99999999-9999-9999-9999-999999999999/activity').set(admin)).status).toBe(404);
  });
});

describe('GET /fleet/vehicles/:id/location', () => {
  it('returns the position with speed, heading, accuracy and last seen', async () => {
    reset({
      telemetry: [{ id: 't1', vehicle_id: VEHICLE, latitude: 18.5, longitude: 73.8, speed_kmph: 55, heading: 270, timestamp: minutesAgo(1) }],
      gps_points: [{ id: 'g1', vehicle_id: VEHICLE, latitude: 18.5, longitude: 73.8, accuracy: 7, recorded_at: minutesAgo(1) }],
    });
    Object.assign(vehicle(), { last_heartbeat: minutesAgo(1) });
    const res = await request(app).get(`/api/v1/fleet/vehicles/${VEHICLE}/location`).set(admin);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ latitude: 18.5, longitude: 73.8, speed_kmph: 55, heading: 270, accuracy_m: 7, live: true });
  });

  it('gives no speed when the last telemetry is older than the GPS-lost limit', async () => {
    reset({ telemetry: [{ id: 't1', vehicle_id: VEHICLE, latitude: 18.5, longitude: 73.8, speed_kmph: 55, heading: 270, timestamp: minutesAgo(120) }] });
    const res = await request(app).get(`/api/v1/fleet/vehicles/${VEHICLE}/location`).set(admin);
    expect(res.body).toMatchObject({ speed_kmph: null, heading: null, live: false });
  });
});

describe('sharing live location', () => {
  const create = (body: Record<string, unknown> = {}) => request(app).post(`/api/v1/fleet/vehicles/${VEHICLE}/share-links`).set(admin).send(body);

  it('creates an expiring link, stores only the token hash, and serves a read-only public view', async () => {
    Object.assign(vehicle(), { last_heartbeat: new Date().toISOString() });
    const made = await create({ hours: 2 });
    expect(made.status).toBe(201);
    const { token, path } = made.body;
    expect(path).toBe(`/share/${token}`);
    const stored = supabaseMock.rows('vehicle_share_links')[0];
    expect(stored.token_hash).toBe(hashShareToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(Date.parse(stored.expires_at) - Date.now()).toBeGreaterThan(115 * 60_000);

    const view = await request(app).get(`/api/v1/public/vehicle-share/${token}`);
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ plate_number: 'MH12AB1234', latitude: 18.5, longitude: 73.8, live: true, state: 'idle' });
    // nothing about the load, the driver or customers
    expect(Object.keys(view.body).sort()).toEqual([
      'expires_at', 'heading', 'last_seen_at', 'latitude', 'live', 'longitude', 'plate_number', 'speed_kmph', 'state', 'trail',
    ]);
    expect(supabaseMock.rows('vehicle_share_links')[0].view_count).toBe(1);
  });

  it('does not open for an unknown, expired or revoked token', async () => {
    expect((await request(app).get('/api/v1/public/vehicle-share/not-a-real-token')).status).toBe(404);

    const { token, id } = (await create()).body;
    supabaseMock.rows('vehicle_share_links')[0].expires_at = minutesAgo(1);
    expect((await request(app).get(`/api/v1/public/vehicle-share/${token}`)).status).toBe(404);

    supabaseMock.rows('vehicle_share_links')[0].expires_at = new Date(Date.now() + 3_600_000).toISOString();
    expect((await request(app).get(`/api/v1/public/vehicle-share/${token}`)).status).toBe(200);
    expect((await request(app).delete(`/api/v1/fleet/share-links/${id}`).set(admin)).status).toBe(200);
    expect((await request(app).get(`/api/v1/public/vehicle-share/${token}`)).status).toBe(404);
    expect((await request(app).delete(`/api/v1/fleet/share-links/${id}`).set(admin)).status).toBe(404);
  });

  it('lists only the links that still work, and is for staff', async () => {
    await create();
    await create();
    supabaseMock.rows('vehicle_share_links')[0].expires_at = minutesAgo(5);
    const list = await request(app).get(`/api/v1/fleet/vehicles/${VEHICLE}/share-links`).set(admin);
    expect(list.body).toHaveLength(1);
    // the mock returns whole rows; the real query never selects the hash
    const listQuery = supabaseMock.requests.find(u => u.pathname.endsWith('/vehicle_share_links') && u.searchParams.get('select')?.includes('view_count'));
    expect(listQuery?.searchParams.get('select')).not.toContain('token_hash');
    expect((await request(app).post(`/api/v1/fleet/vehicles/${VEHICLE}/share-links`).set(driver).send({})).status).toBe(403);
    expect((await create({ hours: 0 })).status).toBe(400);
    expect((await create({ hours: 24 * 30 })).status).toBe(400);
  });
});
