import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';

const app = testApp();
const admin = () => ({ Authorization: `Bearer ${supabaseMock.signUserToken('admin-1')}` });
const SHIP = '11111111-1111-4111-8111-111111111111';
const NOW = new Date().toISOString();

const DP = { id: 'dp-1', name: 'Pune', address: 'Pune', latitude: 18.5, longitude: 73.8, shipment_id: SHIP, status: 'pending', created_at: NOW };
const LOG = { id: 'log-1', shipment_id: SHIP, status: 'assigned', metadata_json: { vehicle_id: 'veh-1', route_id: 'route-1' }, created_at: NOW };

function reset(shipment: Record<string, unknown>) {
  supabaseMock.reset({
    users: [{ id: 'admin-1', role: 'admin', is_active: true }, { id: 'driver-1', role: 'driver', is_active: true }],
    shipments: [{
      id: SHIP, tracking_id: 'RTX-AAAA1111', status: 'assigned', current_holder: 'consignor', current_vehicle_id: 'veh-1', priority: 'medium',
      origin_name: 'Bhiwandi', origin_lat: 19.3, origin_lng: 73.06, total_items: 1, total_weight_kg: 500, metadata: {}, created_at: NOW, updated_at: NOW,
      delivery_points: [DP], shipment_logs: [LOG],
      ...shipment,
    }],
    shipment_logs: [LOG],
    delivery_points: [DP],
    // The trip also carries another shipment's stop, so it stays open when this one leaves
    routes: [{ id: 'route-1', vehicle_id: 'veh-1', status: 'pending', created_at: NOW }],
    route_stops: [
      { id: 'st-1', route_id: 'route-1', delivery_point_id: 'dp-1', sequence: 1, status: 'pending' },
      { id: 'st-2', route_id: 'route-1', delivery_point_id: 'dp-other', sequence: 2, status: 'pending' },
    ],
    vehicles: [{ id: 'veh-1', plate_number: 'MH04AB1234', vehicle_type: 'truck', capacity_kg: 5000, available_capacity_kg: 4500, status: 'available', driver_id: 'driver-1', driver_name: 'Ravi' }],
    notifications: [], parcels: [], invoices: [], customer_bookings: [], capacity_bids: [], capacity_windows: [], cargo_manifest: [], vendor_shipment_requests: [],
  });
}

const take = () => request(app).patch(`/api/v1/shipments/${SHIP}`).set(admin()).send({ status: 'created' });

describe('taking a shipment off its vehicle', () => {
  beforeEach(() => reset({}));

  it('cancels its stop, clears the vehicle and gives the load back', async () => {
    const res = await take();
    expect(res.status).toBe(200);
    const row = supabaseMock.rows('shipments')[0];
    expect(row).toMatchObject({ status: 'created', current_vehicle_id: null });
    expect(supabaseMock.rows('route_stops').find(s => s.id === 'st-1')!.status).toBe('cancelled');
    expect(supabaseMock.rows('route_stops').find(s => s.id === 'st-2')!.status).toBe('pending');
    expect(supabaseMock.rows('vehicles')[0].available_capacity_kg).toBe(5000);
  });

  it('shows no vehicle, driver or trip on the shipment page or in the list afterwards', async () => {
    await take();
    const overview = await request(app).get(`/api/v1/shipments/${SHIP}/overview`).set(admin());
    expect(overview.status).toBe(200);
    expect(overview.body.trip).toBeNull();
    expect(overview.body.vehicle).toBeNull();
    expect(overview.body.driver).toBeNull();
    const list = await request(app).get('/api/v1/shipments').set(admin());
    const row = (Array.isArray(list.body) ? list.body : list.body.items ?? list.body.shipments).find((r: any) => r.id === SHIP);
    expect(row.vehicle_id ?? null).toBeNull();
  });

  it('refuses goods that were already picked up, and says a transfer is the way', async () => {
    reset({ status: 'picked_up', current_holder: 'vehicle' });
    const res = await take();
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/already picked up/);
    expect(res.body.detail).toMatch(/transfer/i);
    expect(supabaseMock.rows('shipments')[0]).toMatchObject({ status: 'picked_up', current_vehicle_id: 'veh-1' });
    expect(supabaseMock.rows('route_stops').every(s => s.status === 'pending')).toBe(true);
  });
});

describe('the history of a new shipment', () => {
  it('leaves out an old matcher entry that offered the load to nobody', async () => {
    reset({});
    supabaseMock.rows('shipment_logs').push(
      { id: 'log-0', shipment_id: SHIP, status: 'created', index: 0, metadata_json: {}, timestamp: NOW },
      { id: 'log-e', shipment_id: SHIP, status: 'escalated', index: 1, metadata_json: { engine: 'CascadeMatcher', tier: 'Tier 0', broadcast_count: 0 }, timestamp: NOW },
    );
    supabaseMock.rows('shipment_logs').find(l => l.id === 'log-1')!.index = 2;
    const res = await request(app).get(`/api/v1/shipments/${SHIP}/history`).set(admin());
    expect(res.status).toBe(200);
    expect(res.body.events.map((e: any) => e.status)).toEqual(['created', 'assigned']);
  });
});
