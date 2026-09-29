import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { runAlertSweep } from '../src/services/alerts.service';
import { clearThresholdCache } from '../src/services/alert-settings.service';
import { pathKm, segmentKm } from '../src/services/odometer';

const app = testApp();
const VEHICLE = '55555555-5555-5555-5555-555555555555';
const bearer = (id: string) => ({ Authorization: `Bearer ${supabaseMock.signUserToken(id)}` });
const USERS = [
  { id: 'admin-1', role: 'admin', is_active: true },
  { id: 'super-1', role: 'superadmin', is_active: true },
];

const at = (minutesAgo: number, now = Date.now()) => new Date(now - minutesAgo * 60_000).toISOString();

function setup(vehicle: Record<string, unknown> = {}, settingsRows: Record<string, unknown>[] = []) {
  clearThresholdCache();
  supabaseMock.reset({
    users: USERS,
    vehicles: [{ id: VEHICLE, plate_number: 'MH12AB1234', status: 'on_route', fuel_capacity_liters: 200, ...vehicle }],
    system_settings: settingsRows,
    maintenance_alerts: [],
    notifications: [],
    telemetry: [],
    routes: [],
  });
}

const ping = (body: Record<string, unknown>) =>
  request(app).post('/api/v1/telemetry').set(bearer('admin-1')).send({ vehicle_id: VEHICLE, heading: 0, latitude: 19.0, longitude: 72.8, speed_kmph: 40, ...body });

describe('odometer', () => {
  it('measures distance between pings and ignores jitter and impossible jumps', () => {
    const a = { lat: 19.0, lng: 72.8, at: '2026-09-29T10:00:00Z' };
    // 0.01 degrees of latitude is about 1.11 km
    expect(segmentKm(a, { lat: 19.01, lng: 72.8, at: '2026-09-29T10:05:00Z' })).toBeCloseTo(1.11, 1);
    expect(segmentKm(a, { lat: 19.00005, lng: 72.8, at: '2026-09-29T10:05:00Z' })).toBe(0); // 5 m of jitter
    expect(segmentKm(a, { lat: 19.5, lng: 72.8, at: '2026-09-29T10:01:00Z' })).toBe(0); // 55 km in a minute
    expect(segmentKm(a, { lat: 19.01, lng: 72.8, at: '2026-09-29T09:00:00Z' })).toBe(0); // out of order
    expect(pathKm(null, [{ lat: 19, lng: 72.8 }, { lat: 19.01, lng: 72.8 }])).toBeCloseTo(1.11, 1);
  });

  it('adds real distance on every ping and never invents a starting value', async () => {
    setup({ latitude: 19.0, longitude: 72.8, last_heartbeat: at(5) });
    const first = await ping({ latitude: 19.01, longitude: 72.8, timestamp: undefined });
    expect(first.status).toBe(201);
    const km1 = supabaseMock.rows('vehicles')[0].odometer_km;
    expect(km1).toBeCloseTo(1.11, 1);

    await ping({ latitude: 19.02, longitude: 72.8 });
    // last_heartbeat is now, so the second step is measured over a very short time and is treated as a bad fix
    expect(supabaseMock.rows('vehicles')[0].odometer_km).toBeGreaterThanOrEqual(km1);
  });

  it('leaves the odometer unknown for a vehicle with no earlier position', async () => {
    setup();
    await ping({ latitude: 19.01 });
    expect(supabaseMock.rows('vehicles')[0].odometer_km).toBeUndefined();
  });

  it('lets staff correct the odometer', async () => {
    setup({ odometer_km: 10.5 });
    const res = await request(app).put(`/api/v1/fleet/vehicles/${VEHICLE}/odometer`).set(bearer('admin-1')).send({ odometer_km: 48210 });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('vehicles')[0].odometer_km).toBe(48210);
    const bad = await request(app).put(`/api/v1/fleet/vehicles/${VEHICLE}/odometer`).set(bearer('admin-1')).send({ odometer_km: -1 });
    expect(bad.status).toBe(400);
  });

  it('does not write a fuel level or tank size that no device reported', async () => {
    setup({ fuel_capacity_liters: null });
    await ping({});
    const v = supabaseMock.rows('vehicles')[0];
    expect(v.fuel_level_pct).toBeUndefined();
    expect(v.current_fuel_liters).toBeUndefined();
  });
});

describe('rules on incoming telemetry', () => {
  it('raises overspeed above the limit in system_settings, and not below it', async () => {
    setup({}, [{ key: 'alert_overspeed_kmph', value: { value: 60 } }]);
    await ping({ speed_kmph: 55 });
    expect(supabaseMock.rows('maintenance_alerts')).toHaveLength(0);
    await ping({ speed_kmph: 72 });
    const [alert] = supabaseMock.rows('maintenance_alerts');
    expect(alert).toMatchObject({ alert_type: 'overspeed', source: 'rule', is_test: false });
    expect(alert.description).toContain('72 km/h');
    expect(alert.description).toContain('60 km/h');
    expect(supabaseMock.writes('notifications', 'POST').length).toBe(2);
    await ping({ speed_kmph: 90 });
    expect(supabaseMock.rows('maintenance_alerts')).toHaveLength(1);
    expect(supabaseMock.rows('maintenance_alerts')[0].occurrences).toBe(2);
  });

  it('raises low fuel only from a fuel level the device sent, and clears it when refuelled', async () => {
    setup({}, [{ key: 'alert_low_fuel_pct', value: { value: 20 } }]);
    await ping({});
    expect(supabaseMock.rows('maintenance_alerts')).toHaveLength(0);
    await ping({ fuel_level_pct: 12 });
    expect(supabaseMock.rows('maintenance_alerts')[0]).toMatchObject({ alert_type: 'low_fuel', is_resolved: false });
    expect(supabaseMock.rows('vehicles')[0]).toMatchObject({ fuel_level_pct: 12, current_fuel_liters: 24 });
    await ping({ fuel_level_pct: 80 });
    expect(supabaseMock.rows('maintenance_alerts')[0]).toMatchObject({ is_resolved: true, status: 'resolved' });
  });
});

describe('sweep of active routes', () => {
  const now = Date.now();
  const activeRoute = (vehicle: Record<string, unknown>) => ({
    id: 'route-1', vehicle_id: VEHICLE, status: 'active', started_at: at(120, now),
    vehicles: { id: VEHICLE, plate_number: 'MH12AB1234', status: 'on_route', ...vehicle },
  });

  it('raises GPS lost when an active route has had no ping for longer than the limit', async () => {
    setup({}, [{ key: 'alert_gps_lost_minutes', value: { value: 10 } }]);
    supabaseMock.rows('routes').push(activeRoute({ last_heartbeat: at(25, now) }));
    const result = await runAlertSweep(now);
    expect(result.gpsLost).toBe(1);
    expect(supabaseMock.rows('maintenance_alerts')[0]).toMatchObject({ alert_type: 'gps_lost', source: 'rule' });
    await runAlertSweep(now);
    expect(supabaseMock.rows('maintenance_alerts')).toHaveLength(1);
  });

  it('does not raise GPS lost for a vehicle that pinged recently, and closes an earlier one on the next ping', async () => {
    setup({}, [{ key: 'alert_gps_lost_minutes', value: { value: 10 } }]);
    supabaseMock.rows('routes').push(activeRoute({ last_heartbeat: at(2, now) }));
    expect((await runAlertSweep(now)).gpsLost).toBe(0);
    supabaseMock.rows('maintenance_alerts').push({ id: 'old', vehicle_id: VEHICLE, alert_type: 'gps_lost', is_resolved: false, is_test: false, source: 'rule', status: 'open' });
    await ping({});
    expect(supabaseMock.rows('maintenance_alerts')[0]).toMatchObject({ is_resolved: true });
  });

  it('raises long idle when a vehicle on an active route has not moved for the whole window', async () => {
    setup({}, [{ key: 'alert_idle_minutes', value: { value: 30 } }]);
    supabaseMock.rows('routes').push(activeRoute({ last_heartbeat: at(1, now) }));
    for (const m of [32, 25, 15, 5, 1]) {
      supabaseMock.rows('telemetry').push({ vehicle_id: VEHICLE, latitude: 19.0, longitude: 72.8, speed_kmph: 0, timestamp: at(m, now) });
    }
    const result = await runAlertSweep(now);
    expect(result.idle).toBe(1);
    expect(supabaseMock.rows('maintenance_alerts')[0]).toMatchObject({ alert_type: 'long_idle' });
  });

  it('does not raise long idle when the vehicle moved, when history is too short, or on a break', async () => {
    setup({}, [{ key: 'alert_idle_minutes', value: { value: 30 } }]);
    supabaseMock.rows('routes').push(activeRoute({ last_heartbeat: at(1, now) }));
    // moved 1 km within the window
    supabaseMock.rows('telemetry').push(
      { vehicle_id: VEHICLE, latitude: 19.0, longitude: 72.8, speed_kmph: 0, timestamp: at(30, now) },
      { vehicle_id: VEHICLE, latitude: 19.01, longitude: 72.8, speed_kmph: 0, timestamp: at(1, now) },
    );
    expect((await runAlertSweep(now)).idle).toBe(0);

    setup({}, [{ key: 'alert_idle_minutes', value: { value: 30 } }]);
    supabaseMock.rows('routes').push(activeRoute({ last_heartbeat: at(1, now) }));
    supabaseMock.rows('telemetry').push(
      { vehicle_id: VEHICLE, latitude: 19.0, longitude: 72.8, speed_kmph: 0, timestamp: at(8, now) },
      { vehicle_id: VEHICLE, latitude: 19.0, longitude: 72.8, speed_kmph: 0, timestamp: at(1, now) },
    );
    expect((await runAlertSweep(now)).idle).toBe(0);

    setup({}, [{ key: 'alert_idle_minutes', value: { value: 30 } }]);
    supabaseMock.rows('routes').push(activeRoute({ last_heartbeat: at(1, now), status: 'idle' }));
    for (const m of [32, 15, 1]) {
      supabaseMock.rows('telemetry').push({ vehicle_id: VEHICLE, latitude: 19.0, longitude: 72.8, speed_kmph: 0, timestamp: at(m, now) });
    }
    expect((await runAlertSweep(now)).idle).toBe(0);
  });
});

describe('alarms list, acknowledge and resolve', () => {
  const row = (over: Record<string, unknown>) => ({
    id: 'a1', vehicle_id: VEHICLE, alert_type: 'overspeed', severity: 'high', description: 'Fast', is_resolved: false,
    status: 'open', is_test: false, occurrences: 1, created_at: new Date().toISOString(), vehicles: { plate_number: 'MH12AB1234' }, ...over,
  });

  beforeEach(() => setup());

  it('lists active alarms with plate numbers and rejects non-staff', async () => {
    supabaseMock.rows('maintenance_alerts').push(row({}), row({ id: 'a2', is_resolved: true, status: 'resolved' }));
    supabaseMock.rows('users').push({ id: 'drv', role: 'driver', is_active: true });
    const res = await request(app).get('/api/v1/fleet/alerts').set(bearer('admin-1'));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: 'a1', plate_number: 'MH12AB1234', type: 'overspeed', status: 'open' });
    expect((await request(app).get('/api/v1/fleet/alerts').set(bearer('drv'))).status).toBe(403);
    const resolved = await request(app).get('/api/v1/fleet/alerts?status=resolved').set(bearer('admin-1'));
    expect(resolved.body.map((a: { id: string }) => a.id)).toEqual(['a2']);
  });

  it('acknowledges, then resolves; a resolved alarm cannot be acknowledged', async () => {
    supabaseMock.rows('maintenance_alerts').push(row({}));
    const ack = await request(app).post('/api/v1/fleet/alerts/a1/acknowledge').set(bearer('admin-1'));
    expect(ack.status).toBe(200);
    expect(supabaseMock.rows('maintenance_alerts')[0]).toMatchObject({ status: 'acknowledged', acknowledged_by: 'admin-1' });

    const resolve = await request(app).post('/api/v1/fleet/alerts/a1/resolve').set(bearer('admin-1'));
    expect(resolve.status).toBe(200);
    expect(supabaseMock.rows('maintenance_alerts')[0]).toMatchObject({ is_resolved: true, status: 'resolved', resolved_by: 'admin-1' });

    expect((await request(app).post('/api/v1/fleet/alerts/a1/acknowledge').set(bearer('admin-1'))).status).toBe(409);
    expect((await request(app).post('/api/v1/fleet/alerts/nope/resolve').set(bearer('admin-1'))).status).toBe(404);
  });

  it('keeps the older cargo resolve endpoint working', async () => {
    supabaseMock.rows('maintenance_alerts').push(row({}));
    const res = await request(app).post('/api/v1/cargo/resolve-alert/a1').set(bearer('admin-1'));
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('maintenance_alerts')[0]).toMatchObject({ is_resolved: true, status: 'resolved' });
  });
});

describe('alarm rule settings', () => {
  beforeEach(() => setup({}, [{ key: 'alert_overspeed_kmph', value: { value: 70 } }]));

  it('reads thresholds with their limits, and only a superadmin can change them', async () => {
    const get = await request(app).get('/api/v1/fleet/alert-settings').set(bearer('admin-1'));
    expect(get.body.values).toMatchObject({ overspeed_kmph: 70, idle_minutes: 30 });
    expect(get.body.limits.overspeed_kmph).toEqual({ min: 20, max: 200 });

    expect((await request(app).put('/api/v1/fleet/alert-settings').set(bearer('admin-1')).send({ overspeed_kmph: 90 })).status).toBe(403);
    expect((await request(app).put('/api/v1/fleet/alert-settings').set(bearer('super-1')).send({ overspeed_kmph: 5 })).status).toBe(400);

    const put = await request(app).put('/api/v1/fleet/alert-settings').set(bearer('super-1')).send({ overspeed_kmph: 90, idle_minutes: 45 });
    expect(put.status).toBe(200);
    expect(put.body.values).toMatchObject({ overspeed_kmph: 90, idle_minutes: 45 });
    expect(supabaseMock.rows('system_settings').find(r => r.key === 'alert_overspeed_kmph')?.value).toEqual({ value: 90 });
  });
});
