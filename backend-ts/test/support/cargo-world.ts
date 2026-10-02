/**
 * A small fleet for the cargo tests: three drivers and their trucks near Pune, a truck in the
 * workshop, a hub, one shipment on the road (booked by a customer), one waiting for pickup on the
 * same route, and a vendor load on board. Ids are uuids so they pass the API's ref validation.
 */
import { supabaseMock, type Row } from './mock-supabase';
import { createAccessToken } from '../../src/core/auth';

export const ID = {
  admin: 'admin-1',
  driver1: 'driver-1',
  driver2: 'driver-2',
  driver3: 'driver-3',
  vendor: 'vendor-1',
  otherVendor: 'vendor-2',
  customer: 'c0000000-0000-4000-8000-000000000001',
  otherCustomer: 'c0000000-0000-4000-8000-000000000002',
  v1: 'a1000000-0000-4000-8000-000000000001',
  v2: 'a1000000-0000-4000-8000-000000000002',
  v3: 'a1000000-0000-4000-8000-000000000003',
  vMaint: 'a1000000-0000-4000-8000-000000000004',
  depot: 'd0000000-0000-4000-8000-000000000001',
  route1: 'b0000000-0000-4000-8000-000000000001',
  s1: '51000000-0000-4000-8000-000000000001',
  s2: '51000000-0000-4000-8000-000000000002',
  dp1: 'dd000000-0000-4000-8000-000000000001',
  dp2: 'dd000000-0000-4000-8000-000000000002',
  stop1: 'ee000000-0000-4000-8000-000000000001',
  stop2: 'ee000000-0000-4000-8000-000000000002',
  m1: 'aa110000-0000-4000-8000-000000000001',
  request1: 'ab000000-0000-4000-8000-000000000001',
  booking1: 'bb000000-0000-4000-8000-000000000001',
} as const;

export const NOW = new Date().toISOString();

export const auth = {
  admin: () => ({ Authorization: `Bearer ${supabaseMock.signUserToken(ID.admin)}` }),
  driver: (id: string = ID.driver1) => ({ Authorization: `Bearer ${createAccessToken({ sub: id, role: 'driver' })}` }),
  customer: (id: string = ID.customer) => ({ Authorization: `Bearer ${createAccessToken({ sub: id, role: 'customer' })}` }),
  vendor: (id: string = ID.vendor) => ({ Authorization: `Bearer ${createAccessToken({ sub: id, role: 'vendor' })}` }),
};

export function shipmentRow(id: string, over: Row = {}): Row {
  return {
    id, tracking_id: `RTX-${id.replace(/-/g, '').slice(-8).toUpperCase()}`, status: 'in_transit', priority: 'medium',
    origin_name: 'Bhiwandi Hub', origin_address: 'Bhiwandi', origin_lat: 19.3, origin_lng: 73.06,
    total_items: 10, total_weight_kg: 1000, freight_charge: 5000, metadata: {}, created_at: NOW, updated_at: NOW,
    current_holder: 'vehicle', current_vehicle_id: ID.v1, current_depot_id: null,
    pieces_total: 10, pieces_delivered: 0, pieces_damaged: 0, pieces_short: 0, pieces_returned: 0, seal_number: 'SEAL-1',
    delivery_attempts: 0, max_delivery_attempts: 3, delivery_otp_required: false, delivery_otp_hash: null, delivery_otp_expires_at: null,
    rto: false, on_hold_reason: null,
    ...over,
  };
}

export function manifestRow(id: string, over: Row = {}): Row {
  return {
    id, vehicle_id: ID.v1, vendor_request_id: ID.request1, status: 'in_transit', capacity_kg: 300,
    pickup_location: 'Pune', pickup_lat: 18.52, pickup_lng: 73.85, drop_location: 'Mumbai', drop_lat: 19.07, drop_lng: 72.87,
    created_at: NOW, updated_at: NOW, current_holder: 'vehicle', current_vehicle_id: ID.v1, current_depot_id: null,
    pieces_total: 4, pieces_delivered: 0, pieces_damaged: 0, pieces_short: 0, pieces_returned: 0, seal_number: null,
    delivery_attempts: 0, max_delivery_attempts: 3, rto: false, on_hold_reason: null,
    ...over,
  };
}

/** Seller details on record, so deliveries in a test world can be invoiced (invoices need a name, GSTIN and state). */
export const COMPANY_SETTING = {
  key: 'company_profile',
  value: { value: { legal_name: 'Margix Logistics Pvt Ltd', gstin: '27AAPFU0939F1ZV', state: 'Maharashtra' } },
};

/** The same seller, charging freight GST as a 18% forward charge (the default is reverse charge: no GST on the invoice). */
export const COMPANY_SETTING_FCM18 = {
  key: 'company_profile',
  value: { value: { ...COMPANY_SETTING.value.value, gta_gst_option: 'fcm_18' } },
};

export function cargoWorld(over: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    users: [
      { id: ID.admin, role: 'admin', is_active: true, full_name: 'Asha Admin' },
      { id: ID.driver1, role: 'driver', is_active: true, full_name: 'Ravi Driver' },
      { id: ID.driver2, role: 'driver', is_active: true, full_name: 'Sunil Driver' },
      { id: ID.driver3, role: 'driver', is_active: true, full_name: 'Kiran Driver' },
      { id: ID.vendor, role: 'vendor', is_active: true },
      { id: ID.otherVendor, role: 'vendor', is_active: true },
    ],
    customers: [
      { id: ID.customer, phone: '+919800000001', full_name: 'Meera Customer' },
      { id: ID.otherCustomer, phone: '+919800000002', full_name: 'Other Customer' },
    ],
    vehicles: [
      { id: ID.v1, plate_number: 'MH12AB0001', vehicle_type: 'truck', status: 'on_route', driver_id: ID.driver1, driver_name: 'Ravi Driver', capacity_kg: 5000, available_capacity_kg: 3700, current_load_kg: 300, latitude: 18.60, longitude: 73.80, cargo_types: ['general'] },
      { id: ID.v2, plate_number: 'MH12AB0002', vehicle_type: 'truck', status: 'available', driver_id: ID.driver2, driver_name: 'Sunil Driver', capacity_kg: 5000, available_capacity_kg: 5000, current_load_kg: 0, latitude: 18.62, longitude: 73.82, cargo_types: ['general'] },
      { id: ID.v3, plate_number: 'MH12AB0003', vehicle_type: 'truck', status: 'available', driver_id: ID.driver3, driver_name: 'Kiran Driver', capacity_kg: 800, available_capacity_kg: 800, current_load_kg: 0, latitude: 18.62, longitude: 73.82, cargo_types: [] },
      { id: ID.vMaint, plate_number: 'MH12AB0004', vehicle_type: 'truck', status: 'maintenance', driver_id: null, capacity_kg: 5000, available_capacity_kg: 5000, current_load_kg: 0, latitude: 18.6, longitude: 73.8 },
    ],
    depots: [{ id: ID.depot, name: 'Chakan', address: 'Chakan MIDC, Pune', latitude: 18.76, longitude: 73.86 }],
    routes: [{ id: ID.route1, vehicle_id: ID.v1, status: 'active', started_at: NOW, created_at: NOW }],
    delivery_points: [
      { id: ID.dp1, shipment_id: ID.s1, name: 'Hinjewadi warehouse', address: 'Hinjewadi, Pune', latitude: 18.59, longitude: 73.74, demand_kg: 1000, status: 'pending', created_at: NOW },
      { id: ID.dp2, shipment_id: ID.s2, name: 'Wakad store', address: 'Wakad, Pune', latitude: 18.6, longitude: 73.76, demand_kg: 500, status: 'pending', created_at: NOW },
    ],
    route_stops: [
      { id: ID.stop1, route_id: ID.route1, delivery_point_id: ID.dp1, sequence: 1, status: 'pending', routes: { status: 'active', vehicle_id: ID.v1 } },
      { id: ID.stop2, route_id: ID.route1, delivery_point_id: ID.dp2, sequence: 2, status: 'pending', routes: { status: 'active', vehicle_id: ID.v1 } },
    ],
    shipments: [
      shipmentRow(ID.s1),
      shipmentRow(ID.s2, { status: 'assigned', current_holder: 'consignor', total_items: 5, pieces_total: 5, total_weight_kg: 500, seal_number: null }),
    ],
    customer_bookings: [
      { id: ID.booking1, customer_id: ID.customer, shipment_id: ID.s1, tracking_id: shipmentRow(ID.s1).tracking_id, status: 'in_transit', pickup_name: 'Bhiwandi', drop_name: 'Hinjewadi', created_at: NOW, updated_at: NOW },
    ],
    cargo_manifest: [manifestRow(ID.m1)],
    vendor_shipment_requests: [{ id: ID.request1, vendor_id: ID.vendor, status: 'assigned', assigned_vehicle_id: ID.v1, pickup_location: 'Pune', drop_location: 'Mumbai', cost: 8000, metadata: { cargo: { declaredValue: '150000' } } }],
    shipment_hsn: [{ id: 'h1', shipment_id: ID.s1, hsn_code: '8471', declared_value: 200000 }, { id: 'h2', shipment_id: ID.s1, hsn_code: '8528', declared_value: 50000 }],
    sos_alerts: [], vehicle_maintenance_jobs: [], shipment_logs: [], notifications: [], invoices: [], parcel_scans: [],
    cargo_custody_events: [], cargo_exceptions: [], cargo_exception_items: [], cargo_transfers: [], cargo_transfer_items: [], cargo_claims: [],
    capacity_bids: [], capacity_windows: [], idempotency_keys: [], system_settings: [COMPANY_SETTING], driver_confirmations: [],
    vehicle_service_attachments: [],
    ...over,
  };
}

export const one = (table: string, id: string) => supabaseMock.rows(table).find(r => r.id === id)!;
export const notesFor = (userId: string) => supabaseMock.rows('notifications').filter(n => n.user_id === userId);
