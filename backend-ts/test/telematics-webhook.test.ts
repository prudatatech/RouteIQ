import crypto from 'crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { settings } from '../src/core/config';

const app = testApp();
const SECRET = 'webhook-secret-for-tests';
const VEHICLE = '44444444-4444-4444-4444-444444444444';
const bearer = (id: string) => ({ Authorization: `Bearer ${supabaseMock.signUserToken(id)}` });

const USERS = [
  { id: 'admin-1', role: 'admin', is_active: true },
  { id: 'super-1', role: 'superadmin', is_active: true },
];

function freshData() {
  supabaseMock.reset({
    users: USERS,
    vehicles: [{ id: VEHICLE, plate_number: 'MH12AB1234', spark_id: 'DEV-1', status: 'on_route' }],
    maintenance_alerts: [],
    notifications: [],
  });
}

describe('POST /telematics/webhook', () => {
  beforeEach(() => {
    settings.FLEET_TELEMATICS_WEBHOOK_SECRET = SECRET;
    freshData();
  });

  it('answers 503 when no secret is configured', async () => {
    settings.FLEET_TELEMATICS_WEBHOOK_SECRET = '';
    const res = await request(app).post('/api/v1/telematics/webhook').send({ event: 'tamper', device_id: 'DEV-1' });
    expect(res.status).toBe(503);
  });

  it('rejects a missing or wrong secret', async () => {
    const none = await request(app).post('/api/v1/telematics/webhook').send({ event: 'tamper', device_id: 'DEV-1' });
    expect(none.status).toBe(401);
    const wrong = await request(app).post('/api/v1/telematics/webhook').set('Authorization', 'Bearer nope').send({ event: 'tamper', device_id: 'DEV-1' });
    expect(wrong.status).toBe(401);
    expect(supabaseMock.rows('maintenance_alerts')).toHaveLength(0);
  });

  it('accepts a Bearer secret, records the alarm and notifies staff', async () => {
    const res = await request(app)
      .post('/api/v1/telematics/webhook')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({ event: 'tamper', device_id: 'DEV-1', timestamp: '2026-09-29T10:00:00Z', latitude: 19.07, longitude: 72.87 });
    expect(res.status).toBe(201);
    expect(res.body.results[0]).toMatchObject({ status: 'created' });

    const [alert] = supabaseMock.rows('maintenance_alerts');
    expect(alert).toMatchObject({
      vehicle_id: VEHICLE, alert_type: 'tamper', severity: 'critical', is_resolved: false, status: 'open',
      source: 'webhook', is_test: false, occurrences: 1,
    });
    expect(alert.details).toMatchObject({ latitude: 19.07, longitude: 72.87 });
    const notified = supabaseMock.writes('notifications', 'POST').map(w => w.body.user_id).sort();
    expect(notified).toEqual(['admin-1', 'super-1']);
  });

  it('accepts an HMAC signature of the raw body', async () => {
    const body = JSON.stringify({ event: 'harsh_braking', plate_number: 'MH12AB1234', speed_kmph: 61 });
    const signature = 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');
    const ok = await request(app).post('/api/v1/telematics/webhook').set('Content-Type', 'application/json').set('X-Signature', signature).send(body);
    expect(ok.status).toBe(201);
    expect(supabaseMock.rows('maintenance_alerts')[0]).toMatchObject({ alert_type: 'harsh_braking', severity: 'medium' });

    const bad = await request(app).post('/api/v1/telematics/webhook').set('Content-Type', 'application/json').set('X-Signature', 'sha256=' + '0'.repeat(64)).send(body);
    expect(bad.status).toBe(401);
  });

  it('keeps one open alarm per vehicle and type, and counts repeats without notifying again', async () => {
    const send = () => request(app).post('/api/v1/telematics/webhook').set('Authorization', `Bearer ${SECRET}`).send({ event: 'overspeed', device_id: 'DEV-1', speed_kmph: 95 });
    const first = await send();
    const second = await send();
    expect(first.body.results[0].status).toBe('created');
    expect(second.body.results[0].status).toBe('repeat');
    const rows = supabaseMock.rows('maintenance_alerts');
    expect(rows).toHaveLength(1);
    expect(rows[0].occurrences).toBe(2);
    expect(supabaseMock.writes('notifications', 'POST')).toHaveLength(2); // two staff, once
  });

  it('handles a batch, reporting unknown vehicles and invalid events per event', async () => {
    const res = await request(app)
      .post('/api/v1/telematics/webhook')
      .set('Authorization', `Bearer ${SECRET}`)
      .send({ events: [
        { event: 'low_fuel', device_id: 'DEV-1', fuel_level_pct: 7 },
        { event: 'geofence', device_id: 'NO-SUCH', direction: 'exit', geofence: 'Depot' },
        { event: 'exploded', device_id: 'DEV-1' },
        { event: 'ignition', state: 'on' },
      ] });
    expect(res.status).toBe(201);
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual(['created', 'unknown_vehicle', 'invalid', 'invalid']);
    expect(supabaseMock.rows('maintenance_alerts')).toHaveLength(1);
    // A fuel level a real device reported is kept on the vehicle
    expect(supabaseMock.rows('vehicles')[0]).toMatchObject({ fuel_level_pct: 7 });
  });

  it('returns 400 when every event is invalid', async () => {
    const res = await request(app).post('/api/v1/telematics/webhook').set('Authorization', `Bearer ${SECRET}`).send({ event: 'nonsense', device_id: 'DEV-1' });
    expect(res.status).toBe(400);
  });
});

describe('POST /telematics/test-alarm', () => {
  beforeEach(() => {
    settings.FLEET_TELEMATICS_WEBHOOK_SECRET = SECRET;
    freshData();
  });

  it('is superadmin only', async () => {
    const res = await request(app).post('/api/v1/telematics/test-alarm').set(bearer('admin-1')).send({ vehicle_id: VEHICLE });
    expect(res.status).toBe(403);
  });

  it('records a marked test alarm through the same path and keeps it out of stats and health', async () => {
    const res = await request(app).post('/api/v1/telematics/test-alarm').set(bearer('super-1')).send({ vehicle_id: VEHICLE, event: 'tamper' });
    expect(res.status).toBe(201);
    const [alert] = supabaseMock.rows('maintenance_alerts');
    expect(alert).toMatchObject({ alert_type: 'tamper', is_test: true, source: 'webhook' });
    expect(supabaseMock.writes('notifications', 'POST').length).toBeGreaterThan(0);
    expect(supabaseMock.writes('notifications', 'POST')[0].body.title).toMatch(/^Test alarm/);

    const summary = await request(app).get('/api/v1/fleet/alerts/summary').set(bearer('admin-1'));
    expect(summary.body).toMatchObject({ open: 0, acknowledged: 0, last_30_days_by_type: {} });

    // Still listed for the staff who sent it, marked as a test
    const list = await request(app).get('/api/v1/fleet/alerts').set(bearer('admin-1'));
    expect(list.body[0]).toMatchObject({ type: 'tamper', is_test: true });

    // A real alarm of the same type is separate from the test one
    const real = await request(app).post('/api/v1/telematics/webhook').set('Authorization', `Bearer ${SECRET}`).send({ event: 'tamper', device_id: 'DEV-1' });
    expect(real.body.results[0].status).toBe('created');
    expect(supabaseMock.rows('maintenance_alerts')).toHaveLength(2);
  });

  it('404s for an unknown vehicle', async () => {
    const res = await request(app).post('/api/v1/telematics/test-alarm').set(bearer('super-1')).send({ vehicle_id: '99999999-9999-9999-9999-999999999999' });
    expect(res.status).toBe(404);
  });
});
