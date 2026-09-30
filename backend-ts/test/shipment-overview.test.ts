import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';

const app = testApp();
const staff = (id = 'admin-1') => ({ Authorization: `Bearer ${supabaseMock.signUserToken(id)}` });

const SHIP = '11111111-1111-4111-8111-111111111111';
const MANIFEST = 'abcdef12-0000-4000-8000-000000000000';

function reset(over: Record<string, unknown[]> = {}) {
  supabaseMock.reset({
    users: [
      { id: 'admin-1', role: 'admin', is_active: true },
      { id: 'driver-1', role: 'driver', is_active: true },
      { id: 'vendor-1', role: 'vendor', is_active: true },
    ],
    shipments: [{
      id: SHIP, tracking_id: 'RTX-AAAA1111', status: 'in_transit', current_holder: 'vehicle', current_vehicle_id: 'veh-1', freight_charge: 4200,
      origin_name: 'Bhiwandi', total_items: 4, total_weight_kg: 120, created_at: '2026-09-01T10:00:00Z', metadata: {},
      delivery_points: [{ id: 'dp-2', name: 'Pune', latitude: 18.5, longitude: 73.8, shipment_id: SHIP }],
      shipment_logs: [],
    }],
    delivery_points: [],
    routes: [
      { id: 'route-old', vehicle_id: 'veh-1', status: 'cancelled', created_at: '2026-08-01T10:00:00Z' },
      { id: 'route-1', vehicle_id: 'veh-1', status: 'active', depot_id: 'depot-1', total_distance_km: 180, created_at: '2026-09-02T10:00:00Z' },
    ],
    route_stops: [
      { id: 'rs-1', route_id: 'route-1', delivery_point_id: 'dp-1', sequence: 1, status: 'completed' },
      { id: 'rs-2', route_id: 'route-1', delivery_point_id: 'dp-2', sequence: 2, status: 'pending' },
      { id: 'rs-3', route_id: 'route-1', delivery_point_id: 'dp-3', sequence: 3, status: 'pending' },
      { id: 'rs-old', route_id: 'route-old', delivery_point_id: 'dp-2', sequence: 1, status: 'pending' },
    ],
    vehicles: [{ id: 'veh-1', plate_number: 'HR55AB1234', driver_id: 'driver-1', driver_name: 'Ravi', status: 'on_route' }],
    customer_bookings: [{ id: 'book-1', customer_id: 'cust-1', shipment_id: SHIP, status: 'in_transit' }],
    customers: [{ id: 'cust-1', full_name: 'Asha Rao', company_name: 'Rao Traders' }],
    cargo_exception_items: [{ id: 'ei-1', exception_id: 'exc-1', shipment_id: SHIP }, { id: 'ei-2', exception_id: 'exc-2', shipment_id: SHIP }],
    cargo_exceptions: [
      { id: 'exc-1', code: 'EXC-1', type: 'damage', status: 'resolved', created_at: '2026-09-03T10:00:00Z' },
      { id: 'exc-2', code: 'EXC-2', type: 'delay', status: 'open', created_at: '2026-09-04T10:00:00Z' },
    ],
    cargo_transfer_items: [{ id: 'ti-1', transfer_id: 'trf-1', shipment_id: SHIP }],
    cargo_transfers: [{ id: 'trf-1', code: 'TRF-1', status: 'planned', created_at: '2026-09-04T10:00:00Z' }],
    cargo_claims: [{ id: 'clm-1', code: 'CLM-1', status: 'open', claim_type: 'damage', shipment_id: SHIP, created_at: '2026-09-05T10:00:00Z' }],
    invoices: [
      { id: 'inv-old', shipment_id: SHIP, invoice_number: 'INV-0', status: 'void', total: 1, created_at: '2026-09-05T10:00:00Z' },
      { id: 'inv-1', shipment_id: SHIP, invoice_number: 'INV-1', status: 'issued', total: 4956, created_at: '2026-09-06T10:00:00Z' },
    ],
    capacity_windows: [],
    capacity_bids: [],
    cargo_manifest: [],
    vendor_shipment_requests: [],
    vendor_profiles: [{ id: 'vendor-1', company_name: 'Sharma Steel' }],
    ...over,
  });
}

const get = (ref: string, auth = staff()) => request(app).get(`/api/v1/shipments/${encodeURIComponent(ref)}/overview`).set(auth);

describe('GET /shipments/:ref/overview', () => {
  beforeEach(() => reset());

  it('finds a shipment by id or by tracking id, and links everything it touches', async () => {
    for (const ref of [SHIP, 'RTX-AAAA1111', 'rtx-aaaa1111']) {
      const res = await get(ref);
      expect(res.status).toBe(200);
      expect(res.body.shipment).toMatchObject({ id: SHIP, tracking_id: 'RTX-AAAA1111', vehicle_id: 'veh-1' });
    }
    const { body } = await get(SHIP);
    expect(body.kind).toBe('shipment');
    expect(body.requester).toEqual({ kind: 'customer_booking', id: 'book-1', name: 'Rao Traders', status: 'in_transit' });
    // The live trip, not the cancelled one; this shipment's drop is stop 2 of 3 and one stop is done
    expect(body.trip).toMatchObject({ id: 'route-1', status: 'active', source: 'optimizer', distance_km: 180, stop_count: 3, stops_done: 1, this_stop: { position: 2, status: 'pending' } });
    expect(body.vehicle).toEqual({ id: 'veh-1', plate_number: 'HR55AB1234' });
    expect(body.driver).toEqual({ id: 'driver-1', name: 'Ravi' });
    expect(body.problems.map((p: any) => [p.code, p.open])).toEqual([['EXC-2', true], ['EXC-1', false]]);
    expect(body.transfers).toEqual([{ id: 'trf-1', code: 'TRF-1', status: 'planned' }]);
    expect(body.claims).toEqual([{ id: 'clm-1', code: 'CLM-1', status: 'open', claim_type: 'damage' }]);
    // A voided invoice is not the invoice
    expect(body.invoice).toEqual({ id: 'inv-1', invoice_number: 'INV-1', status: 'issued', total: 4956 });
    expect(body.price).toBe(4200);
  });

  it('has no trip, vehicle or price for a shipment that was only created', async () => {
    reset({
      shipments: [{ id: SHIP, tracking_id: 'RTX-AAAA1111', status: 'created', total_items: 1, total_weight_kg: 10, created_at: '2026-09-01T10:00:00Z', delivery_points: [], shipment_logs: [] }],
      route_stops: [], routes: [], customer_bookings: [], cargo_exception_items: [], cargo_transfer_items: [], cargo_claims: [], invoices: [],
    });
    const { body } = await get(SHIP);
    expect(body).toMatchObject({ trip: null, vehicle: null, driver: null, invoice: null, price: null, problems: [], requester: { kind: 'staff', id: null } });
  });

  it('shows a vendor load by its CM- code, with its vendor and the price the vendor request carries', async () => {
    reset({
      cargo_manifest: [{
        id: MANIFEST, vehicle_id: 'veh-1', vendor_request_id: 'req-1', status: 'in_transit', capacity_kg: 900,
        pickup_location: 'Vashi', drop_location: 'Surat', created_at: '2026-09-01T10:00:00Z',
      }],
      vendor_shipment_requests: [{ id: 'req-1', vendor_id: 'vendor-1', status: 'assigned', cost: 15000 }],
      shipments: [], customer_bookings: [], cargo_exception_items: [], cargo_transfer_items: [], cargo_claims: [], invoices: [],
    });
    const res = await get('CM-ABCDEF12');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      kind: 'manifest',
      code: 'CM-ABCDEF12',
      requester: { kind: 'vendor_load', id: 'req-1', name: 'Sharma Steel' },
      // The load is its own trip: pickup done, drop pending
      trip: { id: MANIFEST, status: 'active', source: 'vendor_load', stop_count: 2, stops_done: 1 },
      vehicle: { id: 'veh-1', plate_number: 'HR55AB1234' },
      price: 15000,
    });
    expect((await get(MANIFEST)).status).toBe(200);
  });

  it('answers 404 for an unknown reference, and only to staff', async () => {
    expect((await get('RTX-NOPE0000')).status).toBe(404);
    expect((await get(SHIP, staff('driver-1'))).status).toBe(403);
    expect((await get(SHIP, staff('vendor-1'))).status).toBe(403);
  });
});
