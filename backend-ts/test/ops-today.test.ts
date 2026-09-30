import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';

const app = testApp();
const as = (id: string) => ({ Authorization: `Bearer ${supabaseMock.signUserToken(id)}` });
const today = (id?: string) => request(app).get('/api/v1/ops/today').set(id ? as(id) : {});

const NOW = new Date().toISOString();

beforeEach(() => {
  supabaseMock.reset({
    users: [
      { id: 'admin-1', role: 'admin', is_active: true },
      { id: 'manager-1', role: 'manager', is_active: true },
      { id: 'driver-1', role: 'driver', is_active: true },
      { id: 'vendor-1', role: 'vendor', is_active: true },
    ],
    sos_alerts: [
      { id: 's1', status: 'active' }, { id: 's2', status: 'acknowledged' }, { id: 's3', status: 'resolved' },
    ],
    cargo_exceptions: [
      { id: 'e1', status: 'open' }, { id: 'e2', status: 'investigating' }, { id: 'e3', status: 'resolved' },
    ],
    customer_bookings: [
      { id: 'b1', status: 'requested' }, { id: 'b2', status: 'requested' }, { id: 'b3', status: 'confirmed' },
    ],
    vendor_shipment_requests: [
      { id: 'v1', status: 'pending' }, { id: 'v2', status: 'approved' }, { id: 'v3', status: 'escalated' }, { id: 'v4', status: 'completed' },
    ],
    shipments: [
      { id: 'sh1', status: 'created', is_master: false },
      { id: 'sh2', status: 'created', is_master: true },
      { id: 'sh3', status: 'assigned', is_master: false },
      { id: 'sh4', status: 'delivered', is_master: false, tracking_id: 'RTX-1', updated_at: NOW, freight_charge: null },
      { id: 'sh5', status: 'delivered', is_master: false, tracking_id: 'RTX-2', updated_at: NOW, freight_charge: 5000 },
    ],
    invoices: [],
    routes: [
      { id: 'r1', status: 'pending', created_at: NOW }, { id: 'r2', status: 'active', created_at: NOW },
      { id: 'r3', status: 'completed', created_at: NOW }, { id: 'r4', status: 'completed', created_at: NOW },
    ],
    vehicles: [
      { id: 'veh1', status: 'pending_approval', plate_number: 'MH12AB1234' },
      { id: 'veh2', status: 'on_route', plate_number: 'MH12AB1235' },
      { id: 'veh3', status: 'available', plate_number: 'MH12AB1236' },
    ],
    user_documents: [
      { id: 'd1', status: 'pending', archived_at: null }, { id: 'd2', status: 'verified', archived_at: null },
      { id: 'd3', status: 'pending', archived_at: null },
    ],
    notifications: [
      { id: 'n1', user_id: 'admin-1', type: 'driver_action_rejected', is_read: false },
      { id: 'n2', user_id: 'admin-1', type: 'stop_flagged', is_read: false },
      { id: 'n3', user_id: 'admin-1', type: 'stop_flagged', is_read: true },
      { id: 'n4', user_id: 'manager-1', type: 'driver_action_rejected', is_read: false },
      { id: 'n5', user_id: 'admin-1', type: 'sos', is_read: false },
    ],
    vendor_profiles: [{ id: 'vp1', kyc_status: 'submitted' }, { id: 'vp2', kyc_status: 'approved' }],
    capacity_bids: [{ id: 'bid1', window_id: 'w1', status: 'pending' }, { id: 'bid2', window_id: 'w1', status: 'lost' }],
    capacity_windows: [{ id: 'w1', winning_bid_id: null, status: 'open', closes_at: '2020-01-01T00:00:00Z' }],
  });
});

describe('GET /ops/today', () => {
  it('counts every queue for an admin', async () => {
    const res = await today('admin-1');
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe('all');
    const q = res.body.queues;
    expect(q.sos).toEqual({ count: 2 });
    expect(q.problems.count).toBe(2);
    expect(q.requests).toEqual({ count: 3, bookings: 2, vendor_loads: 1 });
    // one created shipment (the master is counted by its lots) and two vendor loads waiting for a vehicle
    expect(q.needs_vehicle).toEqual({ count: 3, shipments: 1, vendor_loads: 2 });
    expect(q.trips_to_send).toEqual({ count: 1 });
    expect(q.vehicle_requests).toEqual({ count: 1 });
    expect(q.documents).toEqual({ count: 2 });
    // only the caller's own unread notifications of the two driver-action types
    expect(q.driver_actions).toEqual({ count: 2 });
    expect(q.kyc).toEqual({ count: 1 });
    expect(q.bids).toEqual({ count: 1 });
    // both delivered shipments have no invoice; only RTX-2 has a price to invoice from
    expect(q.unpriced).toEqual({ count: 2, no_price: 1 });
  });

  it('adds the live strip', async () => {
    const res = await today('admin-1');
    expect(res.body.live).toEqual({ active_trips: 1, vehicles_on_road: 1, on_time_rate_pct: 50 });
  });

  it('has no on-time rate when no trip was created today', async () => {
    supabaseMock.reset({ users: [{ id: 'admin-1', role: 'admin', is_active: true }] });
    const res = await today('admin-1');
    expect(res.status).toBe(200);
    expect(res.body.live.on_time_rate_pct).toBeNull();
    expect(res.body.queues.sos).toEqual({ count: 0 });
  });

  it('gives a manager the operations queues only', async () => {
    const res = await today('manager-1');
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe('operations');
    expect(Object.keys(res.body.queues).sort()).toEqual([
      'documents', 'driver_actions', 'needs_vehicle', 'problems', 'requests', 'sos', 'trips_to_send', 'vehicle_requests',
    ]);
    expect(res.body.queues.driver_actions).toEqual({ count: 1 });
  });

  it('needs a signed-in staff member', async () => {
    expect((await today()).status).toBe(401);
    expect((await today('driver-1')).status).toBe(403);
    expect((await today('vendor-1')).status).toBe(403);
  });
});
