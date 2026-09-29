import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';

const app = testApp();
const driver = createAccessToken({ sub: 'driver-1', role: 'driver' });
const bearer = { Authorization: `Bearer ${driver}` };
const complete = (body: object) =>
  request(app).post('/api/v1/telemetry/driver-ping/complete-stop').set(bearer).send({ stop_id: 'stop-1', ...body });

beforeEach(() => {
  supabaseMock.reset({
    vehicles: [{ id: 'veh-1', driver_id: 'driver-1' }],
    routes: [{ id: 'route-1', vehicle_id: 'veh-1', status: 'active' }],
    route_stops: [{ id: 'stop-1', route_id: 'route-1', delivery_point_id: 'dp-1', status: 'pending' }],
    delivery_points: [{ id: 'dp-1', shipment_id: 'ship-1' }],
    shipments: [{ id: 'ship-1', status: 'in_transit', total_weight_kg: 10 }],
    shipment_logs: [],
    parcels: [],
  });
});

describe('failed stop reason', () => {
  it('keeps the driver\'s reason and note in the shipment log', async () => {
    const res = await complete({ status: 'failed', reason: 'customer_unavailable', note: 'Phone off' });
    expect(res.status).toBe(200);
    const [log] = supabaseMock.writes('shipment_logs');
    expect(JSON.stringify(log)).toContain('"failure_reason":"customer_unavailable"');
    expect(JSON.stringify(log)).toContain('Phone off');
  });

  it('still works without a reason', async () => {
    expect((await complete({ status: 'failed' })).status).toBe(200);
  });

  it('rejects a reason it does not know', async () => {
    const res = await complete({ status: 'failed', reason: 'bored' });
    expect(res.status).toBe(400);
    expect(supabaseMock.writes('route_stops')).toEqual([]);
  });

  it('does not record a failure reason on a completed stop', async () => {
    await complete({ status: 'completed', reason: 'other' });
    expect(JSON.stringify(supabaseMock.writes('shipment_logs'))).not.toContain('failure_reason');
  });
});
