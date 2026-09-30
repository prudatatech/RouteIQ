import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { resetMlHealth } from '../src/services/optimizer/ml-client';
import { invalidateDriverVehicles } from '../src/core/ownership';

const app = testApp();
const admin = () => ({ Authorization: `Bearer ${supabaseMock.signUserToken('admin-1')}` });

const VEH = '11111111-1111-4111-8111-111111111111';
const DEPOT = '22222222-2222-4222-8222-222222222222';
const SHIP = '33333333-3333-4333-8333-333333333333';
const globalFetch = globalThis.fetch;

function reset() {
  invalidateDriverVehicles();
  supabaseMock.reset({
    users: [{ id: 'admin-1', role: 'admin', is_active: true }, { id: 'driver-1', role: 'driver', is_active: true }],
    depots: [{ id: DEPOT, name: 'Depot', latitude: 21.14, longitude: 79.08 }],
    vehicles: [{ id: VEH, plate_number: 'MH12AB1234', status: 'available', capacity_kg: 5000, fuel_efficiency_kmpl: 5, driver_id: 'driver-1' }],
    shipments: [{ id: SHIP, status: 'created', total_weight_kg: 100, delivery_points: [{ id: 'dp1', latitude: 21.2, longitude: 79.1 }] }],
    delivery_points: [],
    routes: [],
    route_stops: [],
    notifications: [],
  });
  resetMlHealth();
  // The ML service plans the one shipment onto the vehicle
  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
    const url = String(input);
    if (url.endsWith('/health')) return new Response('{"status":"healthy"}', { status: 200 });
    if (url.includes('/optimize')) {
      return new Response(JSON.stringify({
        routes: [{ vehicle_id: VEH, stop_ids: [SHIP], total_distance_km: 12, total_duration_minutes: 30, estimated_fuel_liters: 2, efficiency_score: 0.9 }],
        total_distance_km: 12, total_fuel_liters: 2,
      }), { status: 200 });
    }
    return globalFetch(input, init);
  }));
}

const driverNotes = () => supabaseMock.writes('notifications', 'POST').filter(w => w.body.user_id === 'driver-1');

describe('trips are sent to the driver only when dispatched', () => {
  beforeEach(reset);
  afterEach(() => { vi.unstubAllGlobals(); });

  it('the optimizer leaves the trip pending and tells the driver nothing', async () => {
    const res = await request(app).post('/api/v1/optimize').set(admin()).send({ depot_id: DEPOT, vehicle_ids: [VEH], shipment_ids: [SHIP] });
    expect(res.status).toBe(200);
    expect(res.body.routes).toHaveLength(1);
    expect(supabaseMock.rows('routes')[0].status).toBe('pending');
    expect(driverNotes()).toHaveLength(0);
  });

  it('sending the optimized trip notifies the driver once, with the trip link', async () => {
    const plan = await request(app).post('/api/v1/optimize').set(admin()).send({ depot_id: DEPOT, vehicle_ids: [VEH], shipment_ids: [SHIP] });
    const routeId = plan.body.routes[0].id;
    expect(driverNotes()).toHaveLength(0);

    const sent = await request(app).patch(`/api/v1/routes/${routeId}/status`).set(admin()).send({ status: 'active' });
    expect(sent.status).toBe(200);
    const notes = driverNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toMatchObject({ title: 'New trip', type: 'route_activated', data: { route_id: routeId, link: `/routes/${routeId}` } });
    expect(notes[0].body.body).toMatch(/1 stop/);
  });

  it('a trip made in the route planner tells the driver nothing until it is sent', async () => {
    const created = await request(app).post('/api/v1/routing/create-route').set(admin()).send({
      vehicle_id: VEH,
      origin: { lat: 19.076, lng: 72.8777, name: 'Mumbai' },
      stops: [{ name: 'Pune', lat: 18.5204, lng: 73.8567 }],
      distance_km: 150, duration_minutes: 180, traffic_delay_minutes: 0, estimated_fuel_liters: 30,
      provider: 'tomtom', truck_aware: true, avoid: { tolls: false, highways: false, ferries: false, unpaved: false },
    });
    expect(created.status).toBe(201);
    expect(driverNotes()).toHaveLength(0);

    const sent = await request(app).patch(`/api/v1/routes/${created.body.id}/status`).set(admin()).send({ status: 'active' });
    expect(sent.status).toBe(200);
    expect(driverNotes().map(n => n.body.type)).toEqual(['route_activated']);
  });
});
