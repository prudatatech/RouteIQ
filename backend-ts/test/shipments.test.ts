import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { createApp } from '../src/app';

const app = createApp();
const adminToken = () => supabaseMock.signUserToken('admin-1');

function shipment(status: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'ship-1',
    tracking_id: 'RTX-AAAA1111',
    status,
    priority: 'medium',
    origin_name: 'Bhiwandi Hub',
    origin_address: 'Bhiwandi, Maharashtra',
    origin_lat: 19.3,
    origin_lng: 73.06,
    total_items: 4,
    total_weight_kg: 120,
    received_by: null,
    signature_data: null,
    created_at: '2026-09-01T10:00:00.000Z',
    updated_at: '2026-09-01T10:00:00.000Z',
    metadata: {},
    ...overrides,
  };
}

function reset(status: string, extra: Record<string, unknown> = {}) {
  supabaseMock.reset({
    users: [{ id: 'admin-1', role: 'admin', is_active: true }],
    shipments: [shipment(status, extra)],
    delivery_points: [],
    parcels: [],
    shipment_logs: [],
    invoices: [],
    payments: [],
    capacity_windows: [],
    cargo_manifest: [],
    vendor_shipment_requests: [],
  });
}

const del = (id: string) => request(app).delete(`/api/v1/shipments/${id}`).set('Authorization', `Bearer ${adminToken()}`);
const getHistory = (id: string) => request(app).get(`/api/v1/shipments/${id}/history`).set('Authorization', `Bearer ${adminToken()}`);

describe('DELETE /shipments/:id — safe delete', () => {
  beforeEach(() => reset('created'));

  it('deletes a shipment that has not moved yet', async () => {
    const res = await del('ship-1');
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('shipments')).toHaveLength(0);
  });

  it.each(['picked_up', 'in_transit', 'delivered'])('refuses to delete a %s shipment with 409', async status => {
    reset(status);
    const res = await del('ship-1');
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/can't be deleted/);
    expect(supabaseMock.rows('shipments')).toHaveLength(1);
  });

  it('still allows deleting a cancelled shipment', async () => {
    reset('cancelled');
    const res = await del('ship-1');
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('shipments')).toHaveLength(0);
  });

  it('returns 404 for an unknown shipment', async () => {
    reset('created');
    const res = await del('does-not-exist');
    expect(res.status).toBe(404);
  });
});

describe('GET /shipments/:id/history', () => {
  it('returns the hash-chained log events in order, with actor and note', async () => {
    reset('delivered', { received_by: 'R. Sharma' });
    supabaseMock.rows('shipment_logs').push(
      {
        id: 'log-2', shipment_id: 'ship-1', status: 'delivered', location_lat: 19.1, location_lng: 72.9,
        timestamp: '2026-09-02T12:00:00.000Z', index: 1, previous_hash: 'a', log_hash: 'b',
        metadata_json: { received_by: 'R. Sharma', signature_captured: true, actor_id: 'driver-1', actor_role: 'driver' },
      },
      {
        id: 'log-1', shipment_id: 'ship-1', status: 'created', location_lat: null, location_lng: null,
        timestamp: '2026-09-01T10:00:00.000Z', index: 0, previous_hash: '0'.repeat(64), log_hash: 'a',
        metadata_json: { actor_id: 'admin-1', actor_role: 'admin' },
      },
    );
    supabaseMock.rows('users').push({ id: 'driver-1', full_name: 'Ramesh Kumar', role: 'driver' });

    const res = await getHistory('ship-1');
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(2);
    expect(res.body.events[0]).toMatchObject({ status: 'created', at: '2026-09-01T10:00:00.000Z', actor: { id: 'admin-1', role: 'admin' } });
    expect(res.body.events[1]).toMatchObject({
      status: 'delivered',
      at: '2026-09-02T12:00:00.000Z',
      actor: { id: 'driver-1', name: 'Ramesh Kumar', role: 'driver' },
      note: 'Received by R. Sharma',
      location: { lat: 19.1, lng: 72.9 },
    });
  });

  it('falls back to created_at and the current status when no logs exist, without inventing steps', async () => {
    reset('delivered', { received_by: 'Old Record' });
    const res = await getHistory('ship-1');
    expect(res.status).toBe(200);
    expect(res.body.events).toEqual([
      { status: 'created', at: '2026-09-01T10:00:00.000Z', actor: null, note: null, location: null },
      { status: 'delivered', at: '2026-09-01T10:00:00.000Z', actor: null, note: 'Received by Old Record', location: null },
    ]);
  });

  it('returns 404 for an unknown shipment', async () => {
    reset('created');
    const res = await getHistory('does-not-exist');
    expect(res.status).toBe(404);
  });
});
