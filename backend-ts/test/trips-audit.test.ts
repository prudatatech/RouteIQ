/**
 * Trips and the driver audit (docs/uat/findings/TRIPS.md): messages stay in their company, a trip with no driver is
 * not sent, a trip made by assigning carries a distance and time, a delivery keeps the vehicle's load right, and
 * goods held on a vehicle keep it loaded.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock, type Row } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { ORG, as, orgWorld, uid } from './support/org-world';
import { clearAllMemos } from '../src/core/memo';
import { ShipmentService, estimateLegs } from '../src/services/shipment.service';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const NOW = new Date().toISOString();
const ID = {
  vA: 'a1000000-0000-4000-8000-000000000001', vB: 'b1000000-0000-4000-8000-000000000001', vNoDriver: 'a1000000-0000-4000-8000-000000000009',
  rA: 'b0000000-0000-4000-8000-0000000000a1', rB: 'b0000000-0000-4000-8000-0000000000b1', rNoDriver: 'b0000000-0000-4000-8000-0000000000a9',
  sHeld: '51000000-0000-4000-8000-0000000000a1',
};

function seed(extra: Record<string, Row[]> = {}) {
  clearAllMemos();
  supabaseMock.reset({
    ...orgWorld(),
    vehicles: [
      { id: ID.vA, plate_number: 'MH01AA0001', status: 'on_route', capacity_kg: 5000, available_capacity_kg: 5000, current_load_kg: 0, driver_id: uid('driver-a'), carrier_org_id: ORG.companyA, created_at: NOW },
      { id: ID.vB, plate_number: 'MH01BB0001', status: 'available', capacity_kg: 5000, available_capacity_kg: 5000, current_load_kg: 0, driver_id: uid('driver-b'), carrier_org_id: ORG.companyB, created_at: NOW },
      { id: ID.vNoDriver, plate_number: 'MH01AA0009', status: 'available', capacity_kg: 5000, available_capacity_kg: 5000, current_load_kg: 0, driver_id: null, carrier_org_id: ORG.companyA, created_at: NOW },
    ],
    routes: [
      { id: ID.rA, vehicle_id: ID.vA, status: 'active', created_at: NOW, carrier_org_id: ORG.companyA },
      { id: ID.rB, vehicle_id: ID.vB, status: 'active', created_at: NOW, carrier_org_id: ORG.companyB },
      { id: ID.rNoDriver, vehicle_id: ID.vNoDriver, status: 'pending', created_at: NOW, carrier_org_id: ORG.companyA },
    ],
    route_stops: [],
    delivery_points: [],
    shipments: [],
    cargo_manifest: [],
    messages: [
      { id: 'm-a', route_id: ID.rA, shipment_id: null, sender_id: uid('driver-a'), sender_role: 'driver', sender_name: 'Ravi', body: 'On my way', created_at: NOW, read_at: null },
      { id: 'm-b', route_id: ID.rB, shipment_id: null, sender_id: uid('driver-b'), sender_role: 'driver', sender_name: 'Sunil', body: 'Other company', created_at: NOW, read_at: null },
    ],
    ...extra,
  });
}

beforeEach(() => seed());

describe('driver messages are per company', () => {
  it("staff unread counts only their own company's drivers", async () => {
    const a = await request(app).get(api('/messages/unread')).set(as('admin-a'));
    expect(a.status).toBe(200);
    expect(a.body.total).toBe(1);
    expect(a.body.threads.map((t: any) => t.route_id)).toEqual([ID.rA]);
    const b = await request(app).get(api('/messages/unread')).set(as('admin-b'));
    expect(b.body.threads.map((t: any) => t.route_id)).toEqual([ID.rB]);
  });
});

describe('sending a trip', () => {
  it('is refused while its vehicle has no driver, and the trip stays pending', async () => {
    const res = await request(app).patch(api(`/routes/${ID.rNoDriver}/status`)).set(as('admin-a')).send({ status: 'active' });
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/no driver/i);
    expect(supabaseMock.rows('routes').find(r => r.id === ID.rNoDriver)?.status).toBe('pending');
  });
});

describe('estimating a trip made by assigning', () => {
  it('adds up straight-line legs and stop time', () => {
    const e = estimateLegs({ lat: 19.0745, lng: 72.9978 }, [{ lat: 19.2183, lng: 72.9781 }, { lat: 19.9975, lng: 73.7898 }]);
    expect(e.distance_km).toBeGreaterThan(100);
    expect(e.duration_minutes).toBeGreaterThan(Math.round((e.distance_km / 40) * 60));
    expect(estimateLegs(null, [])).toEqual({ distance_km: 0, duration_minutes: 0 });
  });
});

describe('vehicle load', () => {
  it('counts goods held on the vehicle even when their trip is cancelled', async () => {
    seed({
      shipments: [{ id: ID.sHeld, tracking_id: 'RTX-HELD0001', status: 'on_hold', current_holder: 'vehicle', current_vehicle_id: ID.vA, total_weight_kg: 700, is_master: false, carrier_org_id: ORG.companyA }],
    });
    await ShipmentService.recalculateVehicleCapacity(ID.vA);
    const v = supabaseMock.rows('vehicles').find(r => r.id === ID.vA)!;
    expect(v.current_load_kg).toBe(700);
    expect(v.available_capacity_kg).toBe(4300);
    expect(v.status).toBe('on_route');
  });
});
