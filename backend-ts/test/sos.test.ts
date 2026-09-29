import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { createApp } from '../src/app';
import { createAccessToken } from '../src/core/auth';

const app = createApp();
const VEHICLE = '33333333-3333-3333-3333-333333333333';
const driver = createAccessToken({ sub: 'driver-1', role: 'driver' });
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeEach(() => {
  supabaseMock.reset({ vehicles: [{ id: VEHICLE, driver_id: 'driver-1' }], sos_alerts: [] });
});

describe('driver SOS', () => {
  it('records the kind of emergency the driver chose', async () => {
    const res = await request(app).post('/api/v1/telemetry/sos/trigger').set(bearer(driver))
      .send({ lat: 28.6, lng: 77.2, alert_type: 'breakdown', description: 'Axle broke' });
    expect(res.status).toBe(200);
    const [write] = supabaseMock.writes('sos_alerts');
    expect(JSON.stringify(write)).toContain('"alert_type":"breakdown"');
    expect(JSON.stringify(write)).toContain('Axle broke');
  });

  it('falls back to a panic alert for unknown types', async () => {
    await request(app).post('/api/v1/telemetry/sos/trigger').set(bearer(driver)).send({ lat: 1, lng: 1, alert_type: 'drop table' });
    const [write] = supabaseMock.writes('sos_alerts');
    expect(JSON.stringify(write)).toContain('"alert_type":"panic_button"');
  });

  it('refuses when the driver has no vehicle', async () => {
    supabaseMock.reset({ vehicles: [], sos_alerts: [] });
    const res = await request(app).post('/api/v1/telemetry/sos/trigger').set(bearer(driver)).send({ lat: 1, lng: 1 });
    expect(res.status).toBe(404);
  });
});
