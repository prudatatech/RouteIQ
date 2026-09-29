import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';

const app = testApp();
const VEHICLE = '33333333-3333-3333-3333-333333333333';
const ALERT = '55555555-5555-5555-5555-555555555555';
const driver = createAccessToken({ sub: 'driver-1', role: 'driver' });
const other = createAccessToken({ sub: 'driver-2', role: 'driver' });
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const details = (token: string, body: object) =>
  request(app).patch(`/api/v1/telemetry/sos/${ALERT}/details`).set(bearer(token)).send(body);

beforeEach(() => {
  supabaseMock.reset({
    vehicles: [{ id: VEHICLE, driver_id: 'driver-1' }],
    sos_alerts: [{ id: ALERT, driver_id: 'driver-1', status: 'active', alert_type: 'panic_button' }],
  });
});

describe('SOS details', () => {
  it('returns the id of the alert it created', async () => {
    const res = await request(app).post('/api/v1/telemetry/sos/trigger').set(bearer(driver)).send({ lat: 1, lng: 1 });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeTruthy();
  });

  it('lets the driver add details to their own active alert', async () => {
    const res = await details(driver, { alert_type: 'accident', description: 'Rear-ended on NH48' });
    expect(res.status).toBe(200);
    expect(JSON.stringify(supabaseMock.writes('sos_alerts'))).toContain('Rear-ended on NH48');
  });

  it("refuses another driver's alert", async () => {
    expect((await details(other, { alert_type: 'accident' })).status).toBe(404);
  });

  it('refuses an alert that is no longer active', async () => {
    supabaseMock.reset({ sos_alerts: [{ id: ALERT, driver_id: 'driver-1', status: 'resolved' }] });
    expect((await details(driver, { alert_type: 'accident' })).status).toBe(404);
  });

  it('rejects an unknown type', async () => {
    expect((await details(driver, { alert_type: 'x' })).status).toBe(400);
  });
});
