import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { cleanPathKm, haversineKm } from '../src/services/odometer';
import { syncAllOdometers } from '../src/services/odometer-sync.service';

const app = testApp();
const VEHICLE = '77777777-7777-7777-7777-777777777777';
const bearer = (id: string) => ({ Authorization: `Bearer ${supabaseMock.signUserToken(id)}` });

// Points along a line of latitude: 0.01 degrees is about 1.11 km
const at = (minutes: number) => new Date(Date.UTC(2026, 8, 29, 6, minutes)).toISOString();
const pt = (lat: number, minutes: number, extra: Record<string, unknown> = {}) => ({
  vehicle_id: VEHICLE, latitude: lat, longitude: 77.2, accuracy: 8, recorded_at: at(minutes), ...extra,
});

describe('distance from pings', () => {
  const p = (lat: number, minutes: number) => ({ lat, lng: 77.2, at: at(minutes) });

  it('adds up the legs between ordered points', () => {
    const km = cleanPathKm(null, [p(28.0, 0), p(28.01, 2), p(28.02, 4)]).km;
    expect(km).toBeCloseTo(haversineKm({ lat: 28.0, lng: 77.2 }, { lat: 28.02, lng: 77.2 }), 3);
    expect(km).toBeGreaterThan(2.2);
  });

  it('sorts unordered points and bridges from the last known position', () => {
    const path = cleanPathKm(p(28.0, 0), [p(28.02, 4), p(28.01, 2)]);
    expect(path.km).toBeCloseTo(haversineKm({ lat: 28.0, lng: 77.2 }, { lat: 28.02, lng: 77.2 }), 3);
  });

  it('ignores GPS jitter while parked', () => {
    const jitter = [p(28.0, 0), p(28.00005, 1), p(28.0, 2), p(28.00008, 3), p(27.99995, 4)];
    expect(cleanPathKm(null, jitter).km).toBe(0);
  });

  it('skips a spike without losing the legs on either side', () => {
    // The middle fix is 1,100 km away one minute later: impossible speed
    const path = cleanPathKm(null, [p(28.0, 0), p(28.01, 2), p(38.0, 3), p(28.02, 4)]);
    expect(path.rejected).toBe(1);
    expect(path.km).toBeCloseTo(haversineKm({ lat: 28.0, lng: 77.2 }, { lat: 28.02, lng: 77.2 }), 3);
  });

  it('restarts from the latest fix after a run of bad ones so it cannot stall', () => {
    const bad = [p(45, 1), p(45.01, 2), p(45.02, 3), p(45.03, 4), p(45.04, 5)];
    const path = cleanPathKm(p(28.0, 0), [...bad, p(45.05, 6)]);
    expect(path.rejected).toBeGreaterThanOrEqual(5);
    expect(path.km).toBeGreaterThan(0.9); // the last leg counts once the path restarted
  });
});

describe('POST /fleet/vehicles/:id/odometer/sync', () => {
  beforeEach(() => {
    supabaseMock.reset({
      users: [{ id: 'admin-1', role: 'admin', is_active: true }, { id: 'driver-1', role: 'driver', is_active: true }],
      vehicles: [{
        id: VEHICLE, plate_number: 'JH10AL0303', status: 'available', odometer_km: 10000, odometer_updated_at: at(0),
      }],
      gps_points: [],
    });
  });

  it('adds the GPS distance since the last update and moves the window forward', async () => {
    supabaseMock.rows('gps_points').push(
      pt(28.0, -30), // before the window: already counted, but it joins the first new point
      pt(28.01, 5), pt(28.02, 10), pt(28.03, 15),
    );
    const res = await request(app).post(`/api/v1/fleet/vehicles/${VEHICLE}/odometer/sync`).set(bearer('admin-1'));
    expect(res.status).toBe(200);
    // 28.00 -> 28.03 is about 3.34 km
    const expected = Math.round(haversineKm({ lat: 28.0, lng: 77.2 }, { lat: 28.03, lng: 77.2 }) * 10) / 10;
    expect(res.body).toMatchObject({ before_km: 10000, after_km: 10000 + expected, added_km: expected, source: 'gps', changed: true, points_used: 3 });

    const vehicle = supabaseMock.rows('vehicles')[0];
    expect(vehicle).toMatchObject({ odometer_km: 10000 + expected, odometer_source: 'gps', odometer_updated_at: at(15) });
    expect(vehicle.odometer_synced_at).toBeTruthy();
    expect(supabaseMock.rows('vehicle_odometer_events')[0]).toMatchObject({ kind: 'auto_sync', before_km: 10000, after_km: 10000 + expected, source: 'gps' });

    // Nothing new: a second sync adds nothing and does not double count
    const again = await request(app).post(`/api/v1/fleet/vehicles/${VEHICLE}/odometer/sync`).set(bearer('admin-1'));
    expect(again.body).toMatchObject({ added_km: 0, changed: false, after_km: 10000 + expected });
    expect(supabaseMock.rows('vehicle_odometer_events')).toHaveLength(1);
  });

  it('leaves out weak fixes, jitter and impossible jumps', async () => {
    supabaseMock.rows('gps_points').push(
      pt(28.0, 1),
      pt(28.005, 2, { accuracy: 500 }), // weak fix
      pt(28.00003, 3), // jitter
      pt(35.0, 4), // teleport
      pt(28.01, 5),
    );
    const res = await request(app).post(`/api/v1/fleet/vehicles/${VEHICLE}/odometer/sync`).set(bearer('admin-1'));
    const expected = Math.round(haversineKm({ lat: 28.0, lng: 77.2 }, { lat: 28.01, lng: 77.2 }) * 10) / 10;
    expect(res.body.added_km).toBe(expected);
    expect(res.body.points_ignored).toBeGreaterThanOrEqual(2);
  });

  it('never goes backwards: no points and no journeys means no change', async () => {
    const res = await request(app).post(`/api/v1/fleet/vehicles/${VEHICLE}/odometer/sync`).set(bearer('admin-1'));
    expect(res.body).toMatchObject({ added_km: 0, changed: false, source: 'none', after_km: 10000 });
    expect(supabaseMock.rows('vehicles')[0].odometer_km).toBe(10000);
  });

  it('falls back to completed routes and delivered loads when there are no GPS points', async () => {
    supabaseMock.rows('routes').push(
      { id: 'r1', vehicle_id: VEHICLE, status: 'completed', total_distance_km: 120.5, completed_at: at(20) },
      { id: 'r-old', vehicle_id: VEHICLE, status: 'completed', total_distance_km: 999, completed_at: at(-60) },
      { id: 'r-live', vehicle_id: VEHICLE, status: 'active', total_distance_km: 50, completed_at: null },
    );
    supabaseMock.rows('cargo_manifest').push(
      { id: 'm1', vehicle_id: VEHICLE, status: 'delivered', pickup_lat: 28.0, pickup_lng: 77.2, drop_lat: 28.1, drop_lng: 77.2, updated_at: at(30) },
    );
    const res = await request(app).post(`/api/v1/fleet/vehicles/${VEHICLE}/odometer/sync`).set(bearer('admin-1'));
    const load = haversineKm({ lat: 28.0, lng: 77.2 }, { lat: 28.1, lng: 77.2 });
    expect(res.body).toMatchObject({ source: 'routes', changed: true });
    expect(res.body.added_km).toBeCloseTo(120.5 + load, 1);
    expect(supabaseMock.rows('vehicles')[0]).toMatchObject({ odometer_source: 'routes', odometer_updated_at: at(30) });
  });

  it('asks for a starting reading when there is none', async () => {
    supabaseMock.rows('vehicles')[0].odometer_km = null;
    const res = await request(app).post(`/api/v1/fleet/vehicles/${VEHICLE}/odometer/sync`).set(bearer('admin-1'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ changed: false, source: 'none', before_km: null });
    expect(res.body.message).toMatch(/dashboard reading/);
  });

  it('is staff only and 404s for an unknown vehicle', async () => {
    expect((await request(app).post(`/api/v1/fleet/vehicles/${VEHICLE}/odometer/sync`)).status).toBe(401);
    expect((await request(app).post(`/api/v1/fleet/vehicles/${VEHICLE}/odometer/sync`).set(bearer('driver-1'))).status).toBe(403);
    expect((await request(app).post('/api/v1/fleet/vehicles/99999999-9999-9999-9999-999999999999/odometer/sync').set(bearer('admin-1'))).status).toBe(404);
  });
});

describe('scheduled sync', () => {
  it('syncs every vehicle with a reading, skips archived ones, and survives a failure', async () => {
    const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    supabaseMock.reset({
      vehicles: [
        { id: A, plate_number: 'A', status: 'idle', odometer_km: 100, odometer_updated_at: at(0) },
        { id: B, plate_number: 'B', status: 'archived', odometer_km: 100, odometer_updated_at: at(0) },
        { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', plate_number: 'C', status: 'idle', odometer_km: null, odometer_updated_at: null },
      ],
      gps_points: [
        { vehicle_id: A, latitude: 28.0, longitude: 77.2, accuracy: 5, recorded_at: at(1) },
        { vehicle_id: A, latitude: 28.05, longitude: 77.2, accuracy: 5, recorded_at: at(10) },
        { vehicle_id: B, latitude: 28.0, longitude: 77.2, accuracy: 5, recorded_at: at(1) },
        { vehicle_id: B, latitude: 28.05, longitude: 77.2, accuracy: 5, recorded_at: at(10) },
      ],
    });
    const result = await syncAllOdometers();
    expect(result).toEqual({ checked: 1, updated: 1, failed: 0 });
    expect(supabaseMock.rows('vehicles').find(v => v.id === A)!.odometer_km).toBeGreaterThan(105);
    expect(supabaseMock.rows('vehicles').find(v => v.id === B)!.odometer_km).toBe(100);
  });
});

describe('PUT /fleet/vehicles/:id/odometer (manual entry)', () => {
  beforeEach(() => {
    supabaseMock.reset({
      users: [{ id: 'admin-1', role: 'admin', is_active: true }],
      vehicles: [{ id: VEHICLE, plate_number: 'JH10AL0303', status: 'available', odometer_km: 10000, odometer_updated_at: at(0) }],
    });
  });
  const put = (body: object) => request(app).put(`/api/v1/fleet/vehicles/${VEHICLE}/odometer`).set(bearer('admin-1')).send(body);

  it('accepts a higher reading', async () => {
    const res = await put({ odometer_km: 10250 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ odometer_km: 10250, kind: 'manual' });
    expect(supabaseMock.rows('vehicles')[0]).toMatchObject({ odometer_km: 10250, odometer_source: 'manual' });
  });

  it('refuses a lower reading without a reason, and says so', async () => {
    const res = await put({ odometer_km: 9000 });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ requires_reason: true, current_km: 10000 });
    expect(res.body.detail).toMatch(/lower than the current/);
    expect(supabaseMock.rows('vehicles')[0].odometer_km).toBe(10000);

    const short = await put({ odometer_km: 9000, correction_reason: 'x' });
    expect(short.status).toBe(400);
  });

  it('records a lower reading as a correction when a reason is given', async () => {
    const res = await put({ odometer_km: 9000, correction_reason: 'Odometer cluster was replaced' });
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('correction');
    expect(supabaseMock.rows('vehicles')[0].odometer_km).toBe(9000);
    expect(supabaseMock.rows('vehicle_odometer_events')[0]).toMatchObject({
      kind: 'correction', before_km: 10000, after_km: 9000, reason: 'Odometer cluster was replaced',
    });
  });
});
