import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';
import { invalidateDriverVehicles } from '../src/core/ownership';
import { isPodPathFor } from '../src/services/pod.service';

const app = testApp();
const as = (sub: string, role: string) => ({ Authorization: `Bearer ${createAccessToken({ sub, role })}` });
const driver1 = as('driver-1', 'driver');
const driver2 = as('driver-2', 'driver');
const admin = as('admin-1', 'admin');
const vendor = as('vendor-1', 'vendor');

const MANIFEST = '99999999-aaaa-bbbb-cccc-000000000001';
const NOW = new Date().toISOString();

function fixtures() {
  return {
    users: [
      { id: 'driver-1', role: 'driver', is_active: true },
      { id: 'driver-2', role: 'driver', is_active: true },
      { id: 'admin-1', role: 'admin', is_active: true },
      { id: 'vendor-1', role: 'vendor', is_active: true },
    ],
    vehicles: [{ id: 'veh-1', driver_id: 'driver-1', capacity_kg: 1000 }, { id: 'veh-2', driver_id: 'driver-2' }],
    routes: [{ id: 'route-1', vehicle_id: 'veh-1', status: 'active' }],
    route_stops: [
      { id: 'stop-1', route_id: 'route-1', delivery_point_id: 'dp-1', sequence: 1, status: 'pending' },
      { id: 'stop-2', route_id: 'route-1', delivery_point_id: 'dp-2', sequence: 2, status: 'pending' },
    ],
    delivery_points: [{ id: 'dp-1', shipment_id: 's1' }, { id: 'dp-2', shipment_id: 's2' }],
    shipments: [
      { id: 's1', tracking_id: 'RTX-AAAA1111', status: 'in_transit', created_at: NOW, updated_at: NOW },
      { id: 's2', tracking_id: 'RTX-BBBB2222', status: 'in_transit', created_at: NOW, updated_at: NOW },
    ],
    cargo_manifest: [{ id: MANIFEST, vehicle_id: 'veh-1', status: 'in_transit', weight_kg: 0 }],
    vendor_shipment_requests: [],
    shipment_logs: [],
    invoices: [],
    parcel_scans: [],
  };
}

const uploadUrl = (auth: object, body: object) => request(app).post('/api/v1/driver/pod-upload-url').set(auth).send(body);
const complete = (auth: object, body: object) => request(app).post('/api/v1/telemetry/driver-ping/complete-stop').set(auth).send(body);

beforeEach(() => {
  invalidateDriverVehicles();
  supabaseMock.reset(fixtures());
});

describe('isPodPathFor', () => {
  it("only accepts a file directly inside the stop's own folder", () => {
    expect(isPodPathFor('pod/stop-1/photo_x.jpg', 'stop-1')).toBe(true);
    expect(isPodPathFor('pod/stop-2/photo_x.jpg', 'stop-1')).toBe(false);
    expect(isPodPathFor('pod/stop-1/../stop-2/photo_x.jpg', 'stop-1')).toBe(false);
    expect(isPodPathFor('pod/stop-1/sub/photo_x.jpg', 'stop-1')).toBe(false);
    expect(isPodPathFor('kyc/stop-1/photo_x.jpg', 'stop-1')).toBe(false);
    expect(isPodPathFor(42, 'stop-1')).toBe(false);
  });
});

describe('POST /driver/pod-upload-url', () => {
  it('issues a signed upload URL for a path the backend chooses', async () => {
    const res = await uploadUrl(driver1, { stop_id: 'stop-1', kind: 'photo', content_type: 'image/jpeg', size: 250_000 });
    expect(res.status).toBe(200);
    expect(res.body.path).toMatch(/^pod\/stop-1\/photo_[0-9a-f-]+\.jpg$/);
    expect(res.body.token).toBeTruthy();
    expect(supabaseMock.signedUploads).toHaveLength(1);
    expect(supabaseMock.signedUploads[0]).toContain('pod/stop-1/photo_');
  });

  it('issues one for a signature and for a vendor-load stop', async () => {
    const sig = await uploadUrl(driver1, { stop_id: 'stop-1', kind: 'signature', content_type: 'image/png', size: 20_000 });
    expect(sig.body.path).toMatch(/signature_.*\.png$/);
    const load = await uploadUrl(driver1, { stop_id: `${MANIFEST}_drop`, kind: 'photo', content_type: 'image/jpeg', size: 1000 });
    expect(load.status).toBe(200);
  });

  it("refuses another driver's stop, a vendor, and a signed-out caller", async () => {
    const body = { stop_id: 'stop-1', kind: 'photo', content_type: 'image/jpeg', size: 1000 };
    expect((await uploadUrl(driver2, body)).status).toBe(403);
    expect((await uploadUrl(driver2, { ...body, stop_id: `${MANIFEST}_drop` })).status).toBe(403);
    expect((await uploadUrl(vendor, body)).status).toBe(403);
    expect((await request(app).post('/api/v1/driver/pod-upload-url').send(body)).status).toBe(401);
    expect(supabaseMock.signedUploads).toHaveLength(0);
  });

  it('rejects a wrong kind, type or size', async () => {
    const base = { stop_id: 'stop-1', kind: 'photo', content_type: 'image/jpeg', size: 1000 };
    expect((await uploadUrl(driver1, { ...base, kind: 'video' })).status).toBe(400);
    expect((await uploadUrl(driver1, { ...base, content_type: 'application/pdf' })).status).toBe(415);
    expect((await uploadUrl(driver1, { ...base, size: 0 })).status).toBe(400);
    expect((await uploadUrl(driver1, { ...base, size: 50 * 1024 * 1024 })).status).toBe(413);
    expect((await uploadUrl(driver1, { kind: 'photo', content_type: 'image/jpeg', size: 1 })).status).toBe(400);
  });
});

describe('complete-stop with proof files', () => {
  it('stores the photo and signature paths on the shipment and the stop, and logs them', async () => {
    const res = await complete(driver1, {
      stop_id: 'stop-1',
      received_by: 'R. Sharma',
      photo_url: 'pod/stop-1/photo_a.jpg',
      signature_url: 'pod/stop-1/signature_a.png',
    });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('shipments').find(s => s.id === 's1')).toMatchObject({
      status: 'delivered', received_by: 'R. Sharma', photo_url: 'pod/stop-1/photo_a.jpg', signature_url: 'pod/stop-1/signature_a.png',
    });
    expect(supabaseMock.rows('route_stops').find(s => s.id === 'stop-1')).toMatchObject({
      status: 'completed', photo_url: 'pod/stop-1/photo_a.jpg', signature_url: 'pod/stop-1/signature_a.png',
    });
    const log = supabaseMock.rows('shipment_logs').find(l => l.status === 'delivered')!;
    expect(log.metadata_json).toMatchObject({ photo_captured: true, signature_captured: true });
  });

  it('still completes with only the receiver name', async () => {
    const res = await complete(driver1, { stop_id: 'stop-1', received_by: 'R. Sharma' });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('shipments').find(s => s.id === 's1')!.photo_url).toBeUndefined();
    expect(supabaseMock.rows('shipment_logs').find(l => l.status === 'delivered')!.metadata_json).toMatchObject({ photo_captured: false });
  });

  it("refuses a path that is not in the stop's upload folder, and completes nothing", async () => {
    const res = await complete(driver1, { stop_id: 'stop-1', received_by: 'A', photo_url: 'pod/stop-2/photo_a.jpg' });
    expect(res.status).toBe(400);
    expect(supabaseMock.rows('route_stops').find(s => s.id === 'stop-1')!.status).toBe('pending');
    const other = await complete(driver1, { stop_id: 'stop-1', received_by: 'A', signature_url: 'https://evil.example/x.png' });
    expect(other.status).toBe(400);
  });

  it('stores the proof on a vendor load', async () => {
    const res = await complete(driver1, {
      stop_id: `${MANIFEST}_drop`, received_by: 'Warehouse desk', photo_url: `pod/${MANIFEST}_drop/photo_a.jpg`,
    });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('cargo_manifest')[0]).toMatchObject({
      status: 'delivered', received_by: 'Warehouse desk', photo_url: `pod/${MANIFEST}_drop/photo_a.jpg`,
    });
  });

  it('does not store proof files on a failed stop', async () => {
    const res = await complete(driver1, { stop_id: 'stop-1', status: 'failed', reason: 'customer_unavailable', photo_url: 'pod/stop-1/photo_a.jpg' });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('route_stops').find(s => s.id === 'stop-1')!.photo_url).toBeUndefined();
  });
});

describe('GET /shipments/:id/proof', () => {
  beforeEach(() => {
    supabaseMock.rows('shipments')[0].received_by = 'R. Sharma';
    supabaseMock.rows('shipments')[0].photo_url = 'pod/stop-1/photo_a.jpg';
    supabaseMock.rows('shipments')[0].signature_url = 'pod/stop-1/signature_a.png';
  });

  it('gives staff signed links to the photo and signature', async () => {
    const res = await request(app).get('/api/v1/shipments/s1/proof').set(admin);
    expect(res.status).toBe(200);
    expect(res.body.received_by).toBe('R. Sharma');
    expect(res.body.photo_url).toContain('/object/sign/');
    expect(res.body.photo_url).toContain('token=');
    expect(res.body.signature_url).toContain('signature_a.png');
    expect(supabaseMock.signedReads).toHaveLength(2);
  });

  it('gives nulls when nothing was captured', async () => {
    const res = await request(app).get('/api/v1/shipments/s2/proof').set(admin);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ photo_url: null, signature_url: null });
  });

  it('is for staff only', async () => {
    expect((await request(app).get('/api/v1/shipments/s1/proof').set(driver1)).status).toBe(403);
    expect((await request(app).get('/api/v1/shipments/s1/proof').set(vendor)).status).toBe(403);
    expect((await request(app).get('/api/v1/shipments/s1/proof')).status).toBe(401);
  });

  it('is 404 for an unknown shipment', async () => {
    expect((await request(app).get('/api/v1/shipments/nope/proof').set(admin)).status).toBe(404);
  });
});
