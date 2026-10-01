/**
 * UAT role findings, driver side: ROL-04 (a trip dispatch has not sent is not the driver's yet) and
 * ROL-05 (cancelling a serious SOS releases the truck and the goods that SOS held, and nothing else).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { invalidateDriverVehicles } from '../src/core/ownership';
import { ID, auth, cargoWorld, one } from './support/cargo-world';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;

describe('a trip assigned but not sent (ROL-04)', () => {
  beforeEach(() => {
    invalidateDriverVehicles();
    const world = cargoWorld();
    // The mock reads embedded rows from the row itself
    world.routes = [{ id: ID.route1, vehicle_id: ID.v1, status: 'pending', created_at: new Date().toISOString(), route_stops: [{ id: ID.stop1, sequence: 1, status: 'pending', delivery_points: { id: ID.dp1, name: 'Hinjewadi', shipment_id: ID.s1 } }] }];
    world.cargo_manifest = [];
    supabaseMock.reset(world);
  });

  it('is not in the driver trip list, my-route or the trip page, and cannot be accepted or started', async () => {
    const mine = await request(app).get(api('/telemetry/driver-ping/my-route')).set(auth.driver());
    expect(mine.body.route?.id).not.toBe(ID.route1);
    expect(mine.body.active).not.toBe(true);
    expect((await request(app).get(api('/routes')).set(auth.driver())).body.map((r: any) => r.id)).not.toContain(ID.route1);
    expect((await request(app).get(api(`/routes/${ID.route1}`)).set(auth.driver())).status).toBe(404);
    expect((await request(app).post(api('/telemetry/driver-ping/accept-route')).set(auth.driver()).send({ route_id: ID.route1 })).status).toBe(409);
    expect((await request(app).post(api('/telemetry/driver-ping/start-route')).set(auth.driver()).send({ route_id: ID.route1 })).status).toBe(409);
    expect((await request(app).patch(api(`/routes/${ID.route1}/status`)).set(auth.driver()).send({ status: 'active' })).status).toBe(409);
    expect(one('routes', ID.route1).status).toBe('pending');
  });

  it('dispatch still sees it, and once sent the driver sees and can start it', async () => {
    expect((await request(app).get(api(`/routes/${ID.route1}`)).set(auth.admin())).status).toBe(200);
    expect((await request(app).patch(api(`/routes/${ID.route1}/status`)).set(auth.admin()).send({ status: 'active' })).status).toBe(200);
    const mine = await request(app).get(api('/telemetry/driver-ping/my-route')).set(auth.driver());
    expect(mine.body.id ?? mine.body.route?.id).toBe(ID.route1);
    expect((await request(app).get(api(`/routes/${ID.route1}`)).set(auth.driver())).status).toBe(200);
    expect((await request(app).post(api('/telemetry/driver-ping/start-route')).set(auth.driver()).send({ route_id: ID.route1 })).status).toBe(200);
  });
});

describe('cancelling a serious SOS (ROL-05)', () => {
  async function raiseSerious(type = 'accident'): Promise<string> {
    const raised = await request(app).post(api('/telemetry/sos/trigger')).set(auth.driver()).send({ alert_type: type, lat: 18.6, lng: 73.8 });
    const res = await request(app).patch(api(`/telemetry/sos/${raised.body.id}/details`)).set(auth.driver()).send({ severity: 'serious' });
    expect(res.status).toBe(200);
    return raised.body.id;
  }
  const cancel = (id: string) => request(app).post(api(`/telemetry/sos/${id}/cancel`)).set(auth.driver()).send({});

  beforeEach(() => {
    invalidateDriverVehicles();
    supabaseMock.reset(cargoWorld({ ai_agent_logs: [] }));
  });

  it('puts the truck back in service, takes the goods off hold, closes the case and records it', async () => {
    const alertId = await raiseSerious();
    expect(one('vehicles', ID.v1).status).toBe('maintenance');
    expect(one('shipments', ID.s1).status).toBe('on_hold');
    expect((await cancel(alertId)).status).toBe(200);

    expect(one('vehicles', ID.v1).status).toBe('on_route');
    expect(one('shipments', ID.s1)).toMatchObject({ status: 'in_transit', on_hold_reason: null });
    expect(one('cargo_manifest', ID.m1).status).toBe('in_transit');
    const [exc] = supabaseMock.rows('cargo_exceptions');
    expect(exc).toMatchObject({ status: 'resolved', resolution: 'no_action', sos_alert_id: alertId });
    expect(supabaseMock.rows('cargo_custody_events').some(e => e.kind === 'release_hold' && e.exception_id === exc.id)).toBe(true);
    expect(supabaseMock.rows('ai_agent_logs').some(l => l.action === 'sos.cancel_released')).toBe(true);
  });

  it('leaves the truck in maintenance when a repair job is open for it, and the goods on hold', async () => {
    const alertId = await raiseSerious('breakdown');
    supabaseMock.rows('vehicle_maintenance_jobs').push({ id: 'job-1', vehicle_id: ID.v1, status: 'open' });
    expect((await cancel(alertId)).status).toBe(200);
    expect(one('vehicles', ID.v1).status).toBe('maintenance');
    expect(one('shipments', ID.s1).status).toBe('on_hold');
  });

  it('does not touch goods held by something else', async () => {
    const alertId = await raiseSerious();
    // Another case, not from this SOS, also holds a shipment on the truck
    supabaseMock.rows('cargo_exceptions').push({ id: 'other-case', code: 'EXC-OTHER1', type: 'vehicle_breakdown', status: 'open', source: 'manual', vehicle_id: ID.v1, sos_alert_id: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    expect((await cancel(alertId)).status).toBe(200);
    // The other open case keeps the truck out of service, so nothing is released
    expect(one('vehicles', ID.v1).status).toBe('maintenance');
    expect(one('shipments', ID.s1).status).toBe('on_hold');
    expect(one('cargo_exceptions', 'other-case').status).toBe('open');
  });
});
