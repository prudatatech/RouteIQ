import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';
import { invalidateDriverVehicles } from '../src/core/ownership';

const app = testApp();
const as = (sub: string, role = 'driver') => ({ Authorization: `Bearer ${createAccessToken({ sub, role })}` });
const driver1 = as('driver-1');
const driver2 = as('driver-2');
const NOW = new Date().toISOString();
const KEY = 'a1b2c3d4-0000-4000-8000-000000000001';

function fixtures() {
  return {
    users: [
      { id: 'driver-1', role: 'driver', is_active: true },
      { id: 'driver-2', role: 'driver', is_active: true },
    ],
    vehicles: [{ id: 'veh-1', driver_id: 'driver-1', capacity_kg: 1000 }, { id: 'veh-2', driver_id: 'driver-2', capacity_kg: 1000 }],
    routes: [{ id: 'route-1', vehicle_id: 'veh-1', status: 'active' }],
    route_stops: [
      { id: 'stop-1', route_id: 'route-1', delivery_point_id: 'dp-1', sequence: 1, status: 'pending' },
      { id: 'stop-2', route_id: 'route-1', delivery_point_id: 'dp-2', sequence: 2, status: 'pending' },
    ],
    delivery_points: [{ id: 'dp-1', shipment_id: 's1' }, { id: 'dp-2', shipment_id: 's2' }],
    shipments: [
      { id: 's1', tracking_id: 'RTX-AAAA1111', status: 'in_transit', freight_charge: 500, created_at: NOW, updated_at: NOW },
      { id: 's2', tracking_id: 'RTX-BBBB2222', status: 'in_transit', created_at: NOW, updated_at: NOW },
    ],
    cargo_manifest: [],
    vendor_shipment_requests: [],
    shipment_logs: [],
    invoices: [],
    sos_alerts: [],
    idempotency_keys: [],
  };
}

const complete = (auth: object, body: object, key?: string) => {
  const req = request(app).post('/api/v1/telemetry/driver-ping/complete-stop').set(auth);
  if (key) req.set('Idempotency-Key', key);
  return req.send(body);
};

beforeEach(() => {
  invalidateDriverVehicles();
  supabaseMock.reset(fixtures());
});

describe('idempotency keys', () => {
  it('applies a stop completion once, and answers the repeat with the first response', async () => {
    const first = await complete(driver1, { stop_id: 'stop-1', received_by: 'R. Sharma' }, KEY);
    expect(first.status).toBe(200);
    const writes = supabaseMock.writes('route_stops', 'PATCH').length;
    const logs = supabaseMock.rows('shipment_logs').length;

    const again = await complete(driver1, { stop_id: 'stop-1', received_by: 'R. Sharma' }, KEY);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(supabaseMock.writes('route_stops', 'PATCH')).toHaveLength(writes);
    expect(supabaseMock.rows('shipment_logs')).toHaveLength(logs);
    expect(supabaseMock.rows('idempotency_keys')).toHaveLength(1);
    expect(supabaseMock.rows('idempotency_keys')[0]).toMatchObject({ user_id: 'driver-1', key: KEY, action: 'complete-stop', status_code: 200 });
  });

  it('accepts the key in the body as idempotency_key', async () => {
    await complete(driver1, { stop_id: 'stop-1', received_by: 'R. Sharma', idempotency_key: KEY });
    const again = await complete(driver1, { stop_id: 'stop-1', received_by: 'R. Sharma', idempotency_key: KEY });
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(supabaseMock.rows('shipment_logs').filter(l => l.status === 'delivered')).toHaveLength(1);
  });

  it('runs every request that has no key, but a stop is still decided only once', async () => {
    await complete(driver1, { stop_id: 'stop-1', received_by: 'R. Sharma' });
    const again = await complete(driver1, { stop_id: 'stop-1', received_by: 'R. Sharma' });
    expect(again.status).toBe(200);
    expect(again.headers['idempotent-replay']).toBeUndefined();
    expect(supabaseMock.rows('shipment_logs').filter(l => l.status === 'delivered')).toHaveLength(1);
    expect(supabaseMock.rows('idempotency_keys')).toHaveLength(0);
  });

  it('bills, logs and stamps the arrival once even when a repeat comes with a fresh key', async () => {
    await complete(driver1, { stop_id: 'stop-1', received_by: 'R. Sharma' }, KEY);
    const stampedAt = supabaseMock.rows('route_stops').find(s => s.id === 'stop-1')?.actual_arrival_at;
    expect(stampedAt).toBeTruthy();
    const again = await complete(driver1, { stop_id: 'stop-1', received_by: 'R. Sharma' }, 'a1b2c3d4-0000-4000-8000-000000000002');
    expect(again.status).toBe(200);
    expect(again.headers['idempotent-replay']).toBeUndefined();
    expect(supabaseMock.rows('shipment_logs').filter(l => l.status === 'delivered')).toHaveLength(1);
    expect(supabaseMock.rows('invoices')).toHaveLength(1);
    expect(supabaseMock.rows('route_stops').find(s => s.id === 'stop-1')?.actual_arrival_at).toBe(stampedAt);
  });

  it('keeps keys apart per driver', async () => {
    await complete(driver1, { stop_id: 'stop-1', received_by: 'R. Sharma' }, KEY);
    const other = await complete(driver2, { stop_id: 'stop-2', received_by: 'A' }, KEY);
    expect(other.status).toBe(403);
    expect(other.headers['idempotent-replay']).toBeUndefined();
  });

  it('does not store a failure, so the action can be retried', async () => {
    const denied = await complete(driver2, { stop_id: 'stop-1', received_by: 'A' }, KEY);
    expect(denied.status).toBe(403);
    expect(supabaseMock.rows('idempotency_keys')).toHaveLength(0);
    const ok = await complete(driver1, { stop_id: 'stop-1', received_by: 'A' }, KEY);
    expect(ok.status).toBe(200);
  });

  it('rejects a malformed key', async () => {
    const res = await complete(driver1, { stop_id: 'stop-1', received_by: 'A' }, 'short');
    expect(res.status).toBe(400);
    expect(supabaseMock.rows('route_stops').find(s => s.id === 'stop-1')!.status).toBe('pending');
  });

  it('refuses a key that was used for a different action', async () => {
    await complete(driver1, { stop_id: 'stop-1', received_by: 'A' }, KEY);
    const res = await request(app).post('/api/v1/telemetry/sos/trigger').set(driver1).set('Idempotency-Key', KEY).send({ lat: 1, lng: 1 });
    expect(res.status).toBe(409);
    expect(supabaseMock.rows('sos_alerts')).toHaveLength(0);
  });

  it('raises one SOS when the trigger is sent twice', async () => {
    const key = 'a1b2c3d4-0000-4000-8000-000000000002';
    const a = await request(app).post('/api/v1/telemetry/sos/trigger').set(driver1).set('Idempotency-Key', key).send({ lat: 1, lng: 1 });
    const b = await request(app).post('/api/v1/telemetry/sos/trigger').set(driver1).set('Idempotency-Key', key).send({ lat: 1, lng: 1 });
    expect(a.body.id).toBeTruthy();
    expect(b.body.id).toBe(a.body.id);
    expect(supabaseMock.rows('sos_alerts')).toHaveLength(1);
  });

  it('applies a declared load once', async () => {
    const key = 'a1b2c3d4-0000-4000-8000-000000000003';
    const patch = () => request(app).patch('/api/v1/vehicles/veh-1').set(driver1).set('Idempotency-Key', key).send({ declared_load_percentage: 50 });
    expect((await patch()).status).toBe(200);
    const writes = supabaseMock.writes('vehicles', 'PATCH').length;
    expect((await patch()).status).toBe(200);
    expect(supabaseMock.writes('vehicles', 'PATCH')).toHaveLength(writes);
  });

  it('handles two sends of the same key at the same time as one', async () => {
    const [a, b] = await Promise.all([
      complete(driver1, { stop_id: 'stop-1', received_by: 'R. Sharma' }, KEY),
      complete(driver1, { stop_id: 'stop-1', received_by: 'R. Sharma' }, KEY),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(supabaseMock.rows('shipment_logs').filter(l => l.status === 'delivered')).toHaveLength(1);
  });
});
