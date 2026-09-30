import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';

const app = testApp();
const admin = () => ({ Authorization: `Bearer ${supabaseMock.signUserToken('admin-1')}` });

describe('GET /routes/:id names the shipment of each stop', () => {
  beforeEach(() => {
    supabaseMock.reset({
      users: [{ id: 'admin-1', role: 'admin', is_active: true }],
      vehicles: [{ id: 'veh-1', plate_number: 'HR55AB1234', driver_id: 'driver-1', driver_name: 'Ravi', status: 'available' }],
      shipments: [
        { id: 'ship-1', tracking_id: 'RTX-AAAA1111', status: 'assigned' },
        { id: 'ship-2', tracking_id: 'RTX-BBBB2222', status: 'assigned' },
        { id: 'lot-2b', tracking_id: 'RTX-BBBB2222-B', status: 'assigned' },
      ],
      cargo_manifest: [],
      routes: [{ id: 'route-1', vehicle_id: 'veh-1', status: 'pending', vehicles: { id: 'veh-1', plate_number: 'HR55AB1234', driver_id: 'driver-1' },
        route_stops: [
        { id: 'rs-1', route_id: 'route-1', sequence: 1, status: 'pending', delivery_point_id: 'dp-1', delivery_points: { id: 'dp-1', name: 'Pune', shipment_id: 'ship-1' } },
        // A drop that belongs to a lot links to the lot, not to its master
        { id: 'rs-2', route_id: 'route-1', sequence: 2, status: 'pending', delivery_point_id: 'dp-2', delivery_points: { id: 'dp-2', name: 'Nashik', shipment_id: 'ship-2', lot_shipment_id: 'lot-2b' } },
        // A stop that is only a place on the map (route planner) has no shipment
        { id: 'rs-3', route_id: 'route-1', sequence: 3, status: 'pending', delivery_point_id: 'dp-3', delivery_points: { id: 'dp-3', name: 'Depot' } },
      ] }],
      route_stops: [],
    });
  });

  it('adds the shipment (or lot) each stop delivers, and null for a plain place', async () => {
    const res = await request(app).get('/api/v1/routes/route-1').set(admin());
    expect(res.status).toBe(200);
    const stops = [...res.body.route_stops].sort((a: any, b: any) => a.sequence - b.sequence);
    expect(stops.map((s: any) => s.shipment)).toEqual([
      { id: 'ship-1', tracking_id: 'RTX-AAAA1111' },
      { id: 'lot-2b', tracking_id: 'RTX-BBBB2222-B' },
      null,
    ]);
    expect(res.body.vehicles).toMatchObject({ id: 'veh-1', driver_id: 'driver-1' });
  });
});
