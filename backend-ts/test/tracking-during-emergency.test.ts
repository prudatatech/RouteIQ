import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';

const app = testApp();
const driver = { Authorization: `Bearer ${createAccessToken({ sub: 'driver-1', role: 'driver' })}` };
const VEHICLE = '33333333-3333-3333-3333-333333333333';
const ALERT = '55555555-5555-5555-5555-555555555555';

function reset(status: string) {
  supabaseMock.reset({
    // an on-route vehicle is one with an active route
    routes: status === 'on_route' ? [{ id: 'route-1', vehicle_id: VEHICLE, status: 'active' }] : [],
    cargo_manifest: [],
    users: [
      { id: 'driver-1', role: 'driver', is_active: true },
      { id: 'admin-1', role: 'admin', is_active: true },
    ],
    vehicles: [{
      id: VEHICLE, driver_id: 'driver-1', status, plate_number: 'MH12AB1234', driver_name: 'Ravi',
      capacity_kg: 1000, current_load_kg: 0, latitude: 18.5, longitude: 73.8, last_heartbeat: null,
    }],
    telemetry: [],
    gps_points: [],
    sos_alerts: [],
    notifications: [],
  });
}

const vehicle = () => supabaseMock.rows('vehicles')[0];
const ping = (lat: number, lng: number) =>
  request(app).post('/api/v1/telemetry/driver-ping').set(driver).send({ lat, lng, speed: 20 });
const sos = (body: Record<string, unknown>) =>
  request(app).post(`/api/v1/vehicles/${VEHICLE}/sos`).set(driver).send({ latitude: 18.5, longitude: 73.8, ...body });

beforeEach(() => reset('available'));

describe('position updates are always accepted for the driver\'s own vehicle', () => {
  it.each(['maintenance', 'archived'])('records a ping from a vehicle in %s and leaves its status alone', async status => {
    reset(status);
    const res = await ping(19.1, 74.2);
    expect(res.status).toBe(200);
    expect(res.body.pings_processed).toBe(1);
    expect(vehicle()).toMatchObject({ latitude: 19.1, longitude: 74.2, status });
    expect(vehicle().last_heartbeat).toBeTruthy();
    expect(supabaseMock.writes('gps_points', 'POST')).toHaveLength(1);
  });

  it('records telemetry from a vehicle in maintenance', async () => {
    reset('maintenance');
    const res = await request(app).post('/api/v1/telemetry').set(driver)
      .send({ vehicle_id: VEHICLE, latitude: 19.3, longitude: 74.4, speed_kmph: 10, heading: 90 });
    expect(res.status).toBeLessThan(300);
    expect(vehicle()).toMatchObject({ latitude: 19.3, longitude: 74.4, status: 'maintenance' });
    expect(supabaseMock.writes('telemetry', 'POST')).toHaveLength(1);
  });

  it('does not let a load report bring a vehicle out of maintenance', async () => {
    reset('maintenance');
    const res = await request(app).patch(`/api/v1/vehicles/${VEHICLE}`).set(driver)
      .send({ declared_load_percentage: 0, latitude: 19.5, longitude: 74.6 });
    expect(res.status).toBe(200);
    expect(vehicle()).toMatchObject({ status: 'maintenance', latitude: 19.5, longitude: 74.6 });
  });
});

describe('an SOS keeps the driver tracked', () => {
  it('keeps the vehicle\'s status for a panic alert and keeps accepting pings', async () => {
    reset('on_route');
    const res = await sos({ alert_type: 'panic_button' });
    expect(res.status).toBe(201);
    expect(vehicle().status).toBe('on_route');
    expect((await ping(19.1, 74.2)).status).toBe(200);
    expect(vehicle()).toMatchObject({ status: 'on_route', latitude: 19.1, longitude: 74.2 });
  });

  it('keeps the status for a breakdown that is not serious', async () => {
    reset('on_route');
    expect((await sos({ alert_type: 'breakdown', severity: 'minor' })).status).toBe(201);
    expect(vehicle().status).toBe('on_route');
  });

  it('keeps the status for a serious medical alert (not a vehicle problem)', async () => {
    reset('on_route');
    expect((await sos({ alert_type: 'medical', severity: 'serious' })).status).toBe(201);
    expect(vehicle().status).toBe('on_route');
  });

  it('puts the vehicle in maintenance for a serious accident, and it still reports its position', async () => {
    reset('on_route');
    expect((await sos({ alert_type: 'accident', severity: 'serious' })).status).toBe(201);
    expect(vehicle().status).toBe('maintenance');
    expect((await ping(19.1, 74.2)).status).toBe(200);
    expect(vehicle()).toMatchObject({ status: 'maintenance', latitude: 19.1, longitude: 74.2 });
  });

  it('does the same when severity is added afterwards to a trigger alert', async () => {
    supabaseMock.reset({
      users: [{ id: 'driver-1', role: 'driver', is_active: true }],
      vehicles: [{ id: VEHICLE, driver_id: 'driver-1', status: 'on_route', latitude: 18.5, longitude: 73.8 }],
      sos_alerts: [{ id: ALERT, vehicle_id: VEHICLE, driver_id: 'driver-1', status: 'active', alert_type: 'panic_button' }],
      telemetry: [], gps_points: [], notifications: [],
    });
    const patch = (body: object) => request(app).patch(`/api/v1/telemetry/sos/${ALERT}/details`).set(driver).send(body);
    expect((await patch({ severity: 'serious' })).status).toBe(200);
    expect(vehicle().status).toBe('on_route');
    expect((await patch({ alert_type: 'breakdown' })).status).toBe(200);
    expect(vehicle().status).toBe('maintenance');
    expect((await ping(19.1, 74.2)).status).toBe(200);
    expect(vehicle()).toMatchObject({ status: 'maintenance', latitude: 19.1 });
  });

  it('rejects a severity that is not serious or minor', async () => {
    reset('on_route');
    expect((await sos({ alert_type: 'accident', severity: 'dire' })).status).toBe(400);
    expect(supabaseMock.rows('sos_alerts')).toHaveLength(0);
  });
});
