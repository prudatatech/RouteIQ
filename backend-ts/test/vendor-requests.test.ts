import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { createApp } from '../src/app';

const app = createApp();
const VENDOR = 'vendor-1';
const adminToken = () => supabaseMock.signUserToken('admin-1');

function vendorRequest(status: string) {
  return {
    id: 'req-1',
    vendor_id: VENDOR,
    pickup_location: 'Bhiwandi, Maharashtra',
    pickup_lat: 19.3,
    pickup_lng: 73.06,
    drop_location: 'Pune, Maharashtra',
    drop_lat: 18.52,
    drop_lng: 73.85,
    required_capacity_kg: 400,
    status,
    assigned_vehicle_id: null,
  };
}

function reset(status: string) {
  supabaseMock.reset({
    users: [{ id: 'admin-1', role: 'admin', is_active: true }],
    vendor_shipment_requests: [vendorRequest(status)],
    vehicles: [{ id: 'vehicle-1', driver_id: null, capacity_kg: 1000, current_load_kg: 0, available_capacity_kg: 1000 }],
    cargo_manifest: [],
    notifications: [],
  });
}

const put = (path: string, body?: Record<string, unknown>) =>
  request(app).put(`/api/v1/vendor/shipment-request/req-1/${path}`).set('Authorization', `Bearer ${adminToken()}`).send(body ?? {});

describe('vendor shipment request decisions', () => {
  beforeEach(() => reset('pending'));

  it('approves a new request', async () => {
    const res = await put('approve');
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('vendor_shipment_requests')[0].status).toBe('approved');
  });

  it('refuses to approve a request that was already rejected', async () => {
    reset('rejected');
    const res = await put('approve');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already rejected/);
    expect(supabaseMock.rows('vendor_shipment_requests')[0].status).toBe('rejected');
  });

  it('rejects a pending request and stores the reason', async () => {
    const res = await put('reject', { reason: 'No matching lane available' });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('vendor_shipment_requests')[0]).toMatchObject({ status: 'rejected', rejection_reason: 'No matching lane available' });
  });

  it.each([
    ['missing', {}],
    ['too short', { reason: 'no' }],
    ['too long', { reason: 'x'.repeat(501) }],
  ])('requires a reason to reject (%s)', async (_name, body) => {
    const res = await put('reject', body);
    expect(res.status).toBe(400);
    expect(supabaseMock.rows('vendor_shipment_requests')[0].status).toBe('pending');
  });

  it('refuses to reject a request that already has a vehicle', async () => {
    reset('assigned');
    const res = await put('reject', { reason: 'No matching lane available' });
    expect(res.status).toBe(409);
    expect(supabaseMock.rows('vendor_shipment_requests')[0].status).toBe('assigned');
  });

  it('assigns a vehicle once and creates one manifest entry', async () => {
    const first = await put('assign-vehicle', { vehicle_id: 'vehicle-1' });
    expect(first.status).toBe(200);
    expect(supabaseMock.rows('vendor_shipment_requests')[0]).toMatchObject({ status: 'assigned', assigned_vehicle_id: 'vehicle-1' });
    expect(supabaseMock.writes('cargo_manifest', 'POST')).toHaveLength(1);

    const second = await put('assign-vehicle', { vehicle_id: 'vehicle-1' });
    expect(second.status).toBe(409);
    expect(supabaseMock.writes('cargo_manifest', 'POST')).toHaveLength(1);
  });

  it('releases the request when the manifest cannot be created', async () => {
    reset('approved');
    supabaseMock.fail('cargo_manifest', 'insert failed');
    const res = await put('assign-vehicle', { vehicle_id: 'vehicle-1' });
    expect(res.status).toBe(500);
    expect(supabaseMock.rows('vendor_shipment_requests')[0]).toMatchObject({ status: 'approved', assigned_vehicle_id: null });
  });

  it('returns 404 for an unknown request', async () => {
    supabaseMock.rows('vendor_shipment_requests').length = 0;
    const res = await put('approve');
    expect(res.status).toBe(404);
  });
});
