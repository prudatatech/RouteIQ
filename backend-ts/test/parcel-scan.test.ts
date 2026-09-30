import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';
import { invalidateDriverVehicles } from '../src/core/ownership';
import { normalizeParcelCode } from '../src/core/parcelCode';

const app = testApp();
const bearer = (sub: string, role = 'driver') => ({ Authorization: `Bearer ${createAccessToken({ sub, role })}` });
const scan = (sub: string, body: object) => request(app).post('/api/v1/driver/scan').set(bearer(sub)).send(body);

const MANIFEST = '99999999-aaaa-bbbb-cccc-000000000001';
const NOW = new Date().toISOString();

function fixtures() {
  return {
    users: [
      { id: 'driver-1', role: 'driver', is_active: true },
      { id: 'driver-2', role: 'driver', is_active: true },
      { id: 'admin-1', role: 'admin', is_active: true },
    ],
    vehicles: [{ id: 'veh-1', driver_id: 'driver-1' }, { id: 'veh-2', driver_id: 'driver-2' }],
    routes: [
      { id: 'route-1', vehicle_id: 'veh-1', status: 'active' },
      { id: 'route-2', vehicle_id: 'veh-2', status: 'active' },
    ],
    route_stops: [
      { id: 'stop-1', route_id: 'route-1', delivery_point_id: 'dp-1', sequence: 1, status: 'pending' },
      { id: 'stop-2', route_id: 'route-1', delivery_point_id: 'dp-2', sequence: 2, status: 'pending' },
      { id: 'stop-3', route_id: 'route-2', delivery_point_id: 'dp-3', sequence: 1, status: 'pending' },
    ],
    delivery_points: [
      { id: 'dp-1', shipment_id: 's1' },
      { id: 'dp-2', shipment_id: 's2' },
      { id: 'dp-3', shipment_id: 's3' },
    ],
    shipments: [
      { id: 's1', tracking_id: 'RTX-AAAA1111', status: 'created', created_at: NOW, updated_at: NOW },
      { id: 's2', tracking_id: 'RTX-BBBB2222', status: 'picked_up', created_at: NOW, updated_at: NOW },
      { id: 's3', tracking_id: 'RTX-CCCC3333', status: 'created', created_at: NOW, updated_at: NOW },
    ],
    cargo_manifest: [{ id: MANIFEST, vehicle_id: 'veh-1', status: 'scheduled' }],
    shipment_logs: [],
    parcel_scans: [],
    invoices: [],
  };
}

beforeEach(() => {
  invalidateDriverVehicles();
  supabaseMock.reset(fixtures());
});

describe('normalizeParcelCode', () => {
  it('trims, upper-cases and strips a tracking link', () => {
    expect(normalizeParcelCode('  rtx-aaaa 1111 ')).toBe('RTX-AAAA1111');
    expect(normalizeParcelCode('https://app.example.com/track/rtx-aaaa1111')).toBe('RTX-AAAA1111');
    expect(normalizeParcelCode(42)).toBe('');
  });
});

describe('POST /driver/scan pickup', () => {
  it('marks a shipment on the driver route as picked up and logs who did it', async () => {
    const res = await scan('driver-1', { code: 'rtx-aaaa1111', purpose: 'pickup', method: 'manual' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, kind: 'shipment', shipment_id: 's1', already: false, status: 'picked_up' });
    expect(supabaseMock.rows('shipments').find(s => s.id === 's1')!.status).toBe('picked_up');
    expect(supabaseMock.rows('shipment_logs')[0]).toMatchObject({ shipment_id: 's1', status: 'picked_up' });
    expect(supabaseMock.rows('parcel_scans')[0]).toMatchObject({ shipment_id: 's1', purpose: 'pickup', method: 'manual', driver_id: 'driver-1' });
  });

  it('does nothing the second time', async () => {
    await scan('driver-1', { code: 'RTX-AAAA1111', purpose: 'pickup' });
    const again = await scan('driver-1', { code: 'RTX-AAAA1111', purpose: 'pickup' });
    expect(again.status).toBe(200);
    expect(again.body.already).toBe(true);
    expect(supabaseMock.rows('shipment_logs')).toHaveLength(1);
  });

  it("refuses another driver's parcel, and does not reveal that it exists", async () => {
    const res = await scan('driver-1', { code: 'RTX-CCCC3333', purpose: 'pickup' });
    expect(res.status).toBe(404);
    expect(supabaseMock.rows('shipments').find(s => s.id === 's3')!.status).toBe('created');
  });

  it('refuses a stop that is not the parcel stop', async () => {
    const res = await scan('driver-1', { code: 'RTX-AAAA1111', purpose: 'pickup', stop_id: 'stop-2' });
    expect(res.status).toBe(409);
  });

  it('verifies a vendor load against its pickup stop without changing its status', async () => {
    const res = await scan('driver-1', { code: `CM-${MANIFEST.slice(0, 8)}`, purpose: 'pickup', stop_id: `${MANIFEST}_pickup` });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: 'manifest', manifest_id: MANIFEST, stop_id: `${MANIFEST}_pickup` });
    expect(supabaseMock.rows('cargo_manifest')[0].status).toBe('scheduled');
    expect(supabaseMock.rows('parcel_scans')).toHaveLength(1);
  });
});

describe('POST /driver/scan delivery', () => {
  it('accepts the parcel for the stop and records it', async () => {
    const res = await scan('driver-1', { code: 'RTX-BBBB2222', purpose: 'delivery', stop_id: 'stop-2' });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('parcel_scans')[0]).toMatchObject({ shipment_id: 's2', stop_id: 'stop-2', purpose: 'delivery' });
    expect(supabaseMock.rows('shipments').find(s => s.id === 's2')!.status).toBe('picked_up');
  });

  it('refuses a parcel that belongs to a different stop', async () => {
    const res = await scan('driver-1', { code: 'RTX-AAAA1111', purpose: 'delivery', stop_id: 'stop-2' });
    expect(res.status).toBe(409);
    expect(supabaseMock.rows('parcel_scans')).toHaveLength(0);
  });

  it('needs a stop', async () => {
    expect((await scan('driver-1', { code: 'RTX-BBBB2222', purpose: 'delivery' })).status).toBe(400);
  });

  it('verifies the vendor load at its drop stop only', async () => {
    const code = `CM-${MANIFEST.slice(0, 8)}`;
    expect((await scan('driver-1', { code, purpose: 'delivery', stop_id: `${MANIFEST}_pickup` })).status).toBe(409);
    expect((await scan('driver-1', { code, purpose: 'delivery', stop_id: `${MANIFEST}_drop` })).status).toBe(200);
  });
});

describe('POST /driver/scan access and input', () => {
  it('is for drivers only', async () => {
    const res = await request(app).post('/api/v1/driver/scan').set(bearer('admin-1', 'admin')).send({ code: 'RTX-AAAA1111', purpose: 'pickup' });
    expect(res.status).toBe(403);
  });

  it('needs a sign-in', async () => {
    expect((await request(app).post('/api/v1/driver/scan').send({ code: 'x', purpose: 'pickup' })).status).toBe(401);
  });

  it('rejects a missing code and an unknown purpose', async () => {
    expect((await scan('driver-1', { purpose: 'pickup' })).status).toBe(400);
    expect((await scan('driver-1', { code: 'RTX-AAAA1111', purpose: 'return' })).status).toBe(400);
  });

  it('does not accept a parcel from a route that is finished', async () => {
    supabaseMock.rows('routes')[0].status = 'completed';
    expect((await scan('driver-1', { code: 'RTX-AAAA1111', purpose: 'pickup' })).status).toBe(404);
  });
});

describe('complete-stop and my-route use the scan', () => {
  it('reports the parcel code per stop', async () => {
    supabaseMock.rows('routes')[0].route_stops = [
      { id: 'stop-1', sequence: 1, status: 'pending', delivery_points: { id: 'dp-1', shipment_id: 's1' } },
      { id: 'stop-2', sequence: 2, status: 'pending', delivery_points: { id: 'dp-2', shipment_id: 's2' } },
    ];
    const res = await request(app).get('/api/v1/telemetry/driver-ping/my-route').set(bearer('driver-1'));
    expect(res.status).toBe(200);
    const stops = res.body.route.stops as any[];
    expect(stops.find(s => s.id === 'stop-1').parcel).toMatchObject({ kind: 'shipment', code: 'RTX-AAAA1111', status: 'created' });
  });

  it('logs whether the parcel was verified at delivery', async () => {
    await scan('driver-1', { code: 'RTX-BBBB2222', purpose: 'delivery', stop_id: 'stop-2' });
    const res = await request(app)
      .post('/api/v1/telemetry/driver-ping/complete-stop')
      .set(bearer('driver-1'))
      .send({ stop_id: 'stop-2', received_by: 'R. Sharma' });
    expect(res.status).toBe(200);
    const log = supabaseMock.rows('shipment_logs').find(l => l.status === 'delivered')!;
    expect(log.metadata_json.parcel_verified).toBe(true);

    const other = await request(app)
      .post('/api/v1/telemetry/driver-ping/complete-stop')
      .set(bearer('driver-1'))
      .send({ stop_id: 'stop-1', received_by: 'A. Gupta' });
    expect(other.status).toBe(200);
    expect(supabaseMock.rows('shipment_logs').find(l => l.shipment_id === 's1' && l.status === 'delivered')!.metadata_json.parcel_verified).toBe(false);
  });
});

describe('lots on the driver route (docs/cargo-plan.md, Lots)', () => {
  const MASTER_LOAD = '88888888-aaaa-bbbb-cccc-000000000001';
  const LOAD_LOT = '77777777-aaaa-bbbb-cccc-000000000001';

  it("gives a lot's drop its pieces, consignee and lot in my-route", async () => {
    supabaseMock.rows('routes')[0].route_stops = [
      {
        id: 'stop-1', sequence: 1, status: 'pending',
        delivery_points: { id: 'dp-1', shipment_id: 's1', name: 'Gate 2', pieces: 25, consignee_name: 'Sharma Traders', consignee_phone: '9876543210', lot_shipment_id: 's1' },
      },
      { id: 'stop-2', sequence: 2, status: 'pending', delivery_points: { id: 'dp-2', shipment_id: 's2', name: 'Plain drop' } },
    ];
    const res = await request(app).get('/api/v1/telemetry/driver-ping/my-route').set(bearer('driver-1'));
    expect(res.status).toBe(200);
    const stops = res.body.route.stops as any[];
    expect(stops.find(s => s.id === 'stop-1').delivery_point).toMatchObject({
      pieces: 25, consignee_name: 'Sharma Traders', consignee_phone: '9876543210', lot_shipment_id: 's1',
    });
    expect(stops.find(s => s.id === 'stop-2').delivery_point).toMatchObject({ pieces: null, consignee_name: null, consignee_phone: null, lot_shipment_id: null });
  });

  it('names a load lot by its lot code in my-route and accepts that code at the scan', async () => {
    supabaseMock.reset({
      ...fixtures(),
      routes: [],
      route_stops: [],
      cargo_manifest: [{ id: LOAD_LOT, vehicle_id: 'veh-1', status: 'scheduled', parent_manifest_id: MASTER_LOAD, lot_label: 'A2', created_at: NOW }],
    });
    const lotCode = `CM-${MASTER_LOAD.slice(0, 8).toUpperCase()}-A2`;
    const res = await request(app).get('/api/v1/telemetry/driver-ping/my-route').set(bearer('driver-1'));
    expect(res.status).toBe(200);
    expect((res.body.route.stops as any[]).map(s => s.parcel.code)).toEqual([lotCode, lotCode]);

    const scanned = await scan('driver-1', { code: lotCode.toLowerCase(), purpose: 'pickup', stop_id: `${LOAD_LOT}_pickup` });
    expect(scanned.status).toBe(200);
    expect(scanned.body).toMatchObject({ kind: 'manifest', manifest_id: LOAD_LOT, tracking_id: lotCode });
  });
});
