/**
 * Read scoping by organisation (docs/tenancy-design.md §5): two logistic companies and two vendors share one
 * database. A company sees only the rows it runs (carrier_org_id), a vendor only the rows made for it
 * (vendor_org_id, or bill_to_org_id on invoices), a platform admin acting as the platform sees everything,
 * and another organisation's record is a 404, never a 403, so ids cannot be probed.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock, type Row } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { ORG, ORGS, as, orgWorld, uid } from './support/org-world';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const NOW = new Date().toISOString();
const ids = (body: any) => (Array.isArray(body) ? body : body.items ?? body.entries ?? []).map((r: any) => r.id).sort();

/** A second vendor next to the world's first one, and an admin who sits in each vendor organisation. */
const VENDOR_W = 'a0000000-0000-4000-8000-0000000000e5';
const EXTRA_ORGS: Row[] = [{ id: VENDOR_W, kind: 'vendor', name: 'Zed Exports', status: 'active', profile: {}, created_at: NOW }];
const EXTRA_PEOPLE = [
  { id: 'vendor-2', role: 'vendor', full_name: 'Wen Vendor', email: 'wen@example.test', is_active: true },
  { id: 'desk-v', role: 'vendor', full_name: 'Desk Vee', email: 'deskv@example.test', is_active: true },
  { id: 'desk-w', role: 'vendor', full_name: 'Desk Dub', email: 'deskw@example.test', is_active: true },
].map(p => ({ ...p, id: uid(p.id) }));
const vendorSeat = (user: string, org: string, role = 'member'): Row => ({
  org_id: org, user_id: uid(user), role, status: 'active', created_at: NOW, organizations: [...ORGS, ...EXTRA_ORGS].find(o => o.id === org),
});

const vehicle = (id: string, org: string, plate: string): Row => ({ id, plate_number: plate, vehicle_type: 'truck', capacity_kg: 5000, status: 'idle', carrier_org_id: org });
const shipment = (id: string, carrier: string, vendor: string | null): Row => ({
  id, tracking_id: `RTX-${id.toUpperCase()}`, status: 'created', priority: 'medium', origin_name: 'Hub', total_items: 1, total_weight_kg: 100,
  created_at: NOW, updated_at: NOW, metadata: {}, carrier_org_id: carrier, vendor_org_id: vendor,
});
const route = (id: string, org: string, vehicleId: string): Row => ({ id, vehicle_id: vehicleId, status: 'active', created_at: NOW, carrier_org_id: org });
const invoice = (id: string, issuer: string, billTo: string, vendorUser: string): Row => ({
  id, invoice_number: `INV-${id}`, status: 'issued', amount: 100, total: 118, gst_rate: 18, gst_amount: 18, issued_at: NOW, due_date: NOW,
  issuer_org_id: issuer, bill_to_org_id: billTo, vendor_id: uid(vendorUser), shipment_id: null,
});

const U = {
  va1: 'a1000000-0000-4000-8000-000000000001', va2: 'a1000000-0000-4000-8000-000000000002', vb1: 'b1000000-0000-4000-8000-000000000001',
  sa1: '51000000-0000-4000-8000-0000000000a1', sa2: '51000000-0000-4000-8000-0000000000a2', sb1: '51000000-0000-4000-8000-0000000000b1',
  ra1: 'b0000000-0000-4000-8000-0000000000a1', rb1: 'b0000000-0000-4000-8000-0000000000b1',
  ia1: 'f0000000-0000-4000-8000-0000000000a1', ia2: 'f0000000-0000-4000-8000-0000000000a2', ib1: 'f0000000-0000-4000-8000-0000000000b1',
  da1: 'd0000000-0000-4000-8000-0000000000a1', db1: 'd0000000-0000-4000-8000-0000000000b1',
  ea1: 'e0000000-0000-4000-8000-0000000000a1', eb1: 'e0000000-0000-4000-8000-0000000000b1',
  ta1: '70000000-0000-4000-8000-0000000000a1', tb1: '70000000-0000-4000-8000-0000000000b1',
  ca1: 'c1000000-0000-4000-8000-0000000000a1', cb1: 'c1000000-0000-4000-8000-0000000000b1',
};

function seed(opts: { configured?: boolean } = {}) {
  const base = orgWorld({}, opts);
  supabaseMock.reset({
    ...base,
    users: [...base.users, ...EXTRA_PEOPLE],
    organizations: [...base.organizations, ...EXTRA_ORGS],
    org_members: [...base.org_members, vendorSeat('vendor-2', VENDOR_W, 'owner'), vendorSeat('desk-v', ORG.vendorV), vendorSeat('desk-w', VENDOR_W)],
    vehicles: [vehicle(U.va1, ORG.companyA, 'MH01AA0001'), vehicle(U.va2, ORG.companyA, 'MH01AA0002'), vehicle(U.vb1, ORG.companyB, 'MH01BB0001')],
    shipments: [shipment(U.sa1, ORG.companyA, ORG.vendorV), shipment(U.sa2, ORG.companyA, VENDOR_W), shipment(U.sb1, ORG.companyB, ORG.vendorV)],
    routes: [route(U.ra1, ORG.companyA, U.va1), route(U.rb1, ORG.companyB, U.vb1)],
    depots: [
      { id: U.da1, name: 'Alpha hub', address: 'Pune', latitude: 18.5, longitude: 73.8, carrier_org_id: ORG.companyA },
      { id: U.db1, name: 'Beta hub', address: 'Delhi', latitude: 28.6, longitude: 77.2, carrier_org_id: ORG.companyB },
    ],
    invoices: [invoice(U.ia1, ORG.companyA, ORG.vendorV, 'vendor-1'), invoice(U.ia2, ORG.companyA, VENDOR_W, 'vendor-2'), invoice(U.ib1, ORG.companyB, ORG.vendorV, 'vendor-1')],
    cargo_exceptions: [
      { id: U.ea1, code: 'EXC-AAA111', type: 'damage', severity: 'medium', status: 'open', carrier_org_id: ORG.companyA, created_at: NOW },
      { id: U.eb1, code: 'EXC-BBB111', type: 'damage', severity: 'medium', status: 'open', carrier_org_id: ORG.companyB, created_at: NOW },
    ],
    cargo_transfers: [
      { id: U.ta1, code: 'TRF-AAA111', status: 'planned', planned_at: NOW, carrier_org_id: ORG.companyA },
      { id: U.tb1, code: 'TRF-BBB111', status: 'planned', planned_at: NOW, carrier_org_id: ORG.companyB },
    ],
    cargo_claims: [
      { id: U.ca1, code: 'CLM-AAA111', status: 'filed', claim_type: 'damage', carrier_org_id: ORG.companyA, vendor_org_id: ORG.vendorV, created_at: NOW },
      { id: U.cb1, code: 'CLM-BBB111', status: 'filed', claim_type: 'damage', carrier_org_id: ORG.companyB, vendor_org_id: VENDOR_W, created_at: NOW },
    ],
    cargo_exception_items: [], cargo_transfer_items: [], cargo_manifest: [], vendor_shipment_requests: [], capacity_windows: [], capacity_bids: [],
    delivery_points: [], route_stops: [], parcels: [], shipment_logs: [], payments: [], gps_points: [], vendor_profiles: [], customers: [], customer_bookings: [],
    invoice_payment_reports: [], user_profiles: [], user_documents: [], sos_alerts: [], vehicle_maintenance_jobs: [], cargo_custody_events: [],
    driver_pay_rates: [
      { id: 'pa1', vehicle_type: 'truck', per_trip_amount: 500, per_km_amount: 10, effective_from: '2026-01-01', active: true, carrier_org_id: ORG.companyA },
      { id: 'pb1', vehicle_type: 'truck', per_trip_amount: 900, per_km_amount: 15, effective_from: '2026-01-01', active: true, carrier_org_id: ORG.companyB },
    ],
    driver_pay_entries: [
      { id: 'xa1', driver_id: 'driver-a', vehicle_id: U.va1, vehicle_type: 'truck', trip_date: '2026-09-10', km: 10, amount: 600, status: 'earned', adjustments: [], carrier_org_id: ORG.companyA },
      { id: 'xb1', driver_id: 'driver-b', vehicle_id: U.vb1, vehicle_type: 'truck', trip_date: '2026-09-10', km: 10, amount: 1050, status: 'earned', adjustments: [], carrier_org_id: ORG.companyB },
    ],
    driver_payouts: [
      { id: 'oa1', driver_id: 'driver-a', amount: 600, paid_at: NOW, carrier_org_id: ORG.companyA },
      { id: 'ob1', driver_id: 'driver-b', amount: 1050, paid_at: NOW, carrier_org_id: ORG.companyB },
    ],
  });
}

const get = (path: string, who: string, org?: string) => request(app).get(api(path)).set(as(who, org));

describe('each company sees only the rows it runs', () => {
  beforeEach(() => seed());

  it('vehicles', async () => {
    expect(ids((await get('/vehicles', 'admin-a')).body)).toEqual([U.va1, U.va2]);
    expect(ids((await get('/vehicles', 'admin-b')).body)).toEqual([U.vb1]);
  });

  it('the fleet summary counts only the company\'s vehicles', async () => {
    expect((await get('/vehicles/summary', 'admin-a')).body.total).toBe(2);
    expect((await get('/vehicles/summary', 'admin-b')).body.total).toBe(1);
  });

  it('shipments', async () => {
    expect(ids((await get('/shipments', 'admin-a')).body)).toEqual([U.sa1, U.sa2]);
    expect(ids((await get('/shipments', 'admin-b')).body)).toEqual([U.sb1]);
  });

  it('trips', async () => {
    expect(ids((await get('/routes', 'admin-a')).body)).toEqual([U.ra1]);
    expect(ids((await get('/routes', 'admin-b')).body)).toEqual([U.rb1]);
  });

  it('invoices, and the money summary', async () => {
    const a = await get('/finance/invoices?range=all', 'admin-a');
    expect(a.status).toBe(200);
    expect(ids(a.body)).toEqual([U.ia1, U.ia2]);
    expect(ids((await get('/finance/invoices?range=all', 'admin-b')).body)).toEqual([U.ib1]);
    expect((await get('/finance/invoices/summary', 'admin-b')).body.outstanding_count).toBe(1);
  });

  it('depots and hubs', async () => {
    expect(ids((await get('/depots', 'admin-a')).body)).toEqual([U.da1]);
    expect(ids((await get('/depots', 'admin-b')).body)).toEqual([U.db1]);
    expect(ids((await get('/cargo/hubs', 'admin-b')).body)).toEqual([U.db1]);
  });

  it('cargo cases, transfers and claims', async () => {
    expect(ids((await get('/cargo/exceptions', 'admin-a')).body)).toEqual([U.ea1]);
    expect(ids((await get('/cargo/transfers', 'admin-b')).body)).toEqual([U.tb1]);
    expect(ids((await get('/cargo/claims', 'admin-a')).body)).toEqual([U.ca1]);
    expect(ids((await get('/cargo/claims', 'admin-b')).body)).toEqual([U.cb1]);
  });

  it('driver pay rates, entries and payouts', async () => {
    expect(ids((await get('/driver-pay/rates', 'admin-a')).body)).toEqual(['pa1']);
    expect(ids((await get('/driver-pay/rates', 'admin-b')).body)).toEqual(['pb1']);
    expect(ids((await get('/driver-pay/entries', 'admin-a')).body)).toEqual(['xa1']);
    expect(ids((await get('/driver-pay/payouts', 'admin-b')).body)).toEqual(['ob1']);
  });

  it('people: only the active organisation\'s members are asked for', async () => {
    await get('/people', 'admin-a');
    const asked = supabaseMock.requests.filter(u => u.pathname === '/rest/v1/users' && u.searchParams.has('org_members.org_id'));
    expect(asked.length).toBeGreaterThan(0);
    expect(asked[0].searchParams.get('org_members.org_id')).toBe(`eq.${ORG.companyA}`);
    expect(asked[0].searchParams.get('org_members.status')).toBe('eq.active');
  });

  it('a manager of company A never sees company B, whatever they ask for', async () => {
    expect(ids((await get('/vehicles?status=idle', 'manager-a')).body)).toEqual([U.va1, U.va2]);
    expect((await get('/vehicles', 'manager-a', ORG.companyB)).status).toBe(403);
  });

  it('keeps each company\'s cached vehicle list apart', async () => {
    await get('/vehicles', 'admin-a');
    expect(ids((await get('/vehicles', 'admin-b')).body)).toEqual([U.vb1]);
  });
});

describe('another company\'s record is a 404, never a 403', () => {
  beforeEach(() => seed());

  it.each([
    ['vehicle', U.vb1, U.va1, '/vehicles/'],
    ['shipment', U.sb1, U.sa1, '/shipments/'],
    ['trip', U.rb1, U.ra1, '/routes/'],
    ['cargo case', U.eb1, U.ea1, '/cargo/exceptions/'],
    ['transfer', U.tb1, U.ta1, '/cargo/transfers/'],
    ['claim', U.cb1, U.ca1, '/cargo/claims/'],
    ['hub', U.db1, U.da1, '/cargo/hubs/', '/inventory'],
  ])('%s', async (_name, foreign, own, base, suffix = '') => {
    const theirs = await get(`${base}${foreign}${suffix}`, 'admin-a');
    expect(theirs.status).toBe(404);
    expect(theirs.body.detail).toBeTruthy();
    expect((await get(`${base}${own}${suffix}`, 'admin-a')).status).toBe(200);
    // and the other way round
    expect((await get(`${base}${own}${suffix}`, 'admin-b')).status).toBe(404);
  });

  it('a shipment page (overview)', async () => {
    expect((await get(`/shipments/${U.sb1}/overview`, 'admin-a')).status).toBe(404);
    expect((await get(`/shipments/${U.sa1}/overview`, 'admin-a')).status).toBe(200);
  });

  it('an invoice and its PDF', async () => {
    expect((await get(`/invoices/${U.ib1}`, 'admin-a')).status).toBe(404);
    expect((await get(`/invoices/${U.ib1}/pdf`, 'admin-a')).status).toBe(404);
    expect((await get(`/invoices/${U.ia1}`, 'admin-a')).status).toBe(200);
    const pdf = await get(`/invoices/${U.ia1}/pdf`, 'admin-a');
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
  });
});

describe('a vendor sees only what is made for it', () => {
  beforeEach(() => seed());

  it('a desk in a vendor organisation has the vendor role: no staff lists, nobody else\'s shipment or invoice', async () => {
    expect(ids((await get('/shipments', 'desk-v')).body)).toEqual([]);
    expect(ids((await get('/finance/invoices?range=all', 'desk-v')).body)).toEqual([]);
    expect([403, 404]).toContain((await get(`/shipments/${U.sa2}/overview`, 'desk-v')).status);
    expect([403, 404]).toContain((await get(`/invoices/${U.ia2}`, 'desk-v')).status);
    expect([403, 404]).toContain((await get(`/invoices/${U.ia1}`, 'desk-w')).status);
  });

  it('the vendor\'s own sign-in gets its invoice PDF and nobody else\'s', async () => {
    expect((await get(`/invoices/${U.ia2}/pdf`, 'vendor-1')).status).toBe(404);
    expect((await get(`/invoices/${U.ia1}/pdf`, 'vendor-2')).status).toBe(404);
    const own = await get(`/invoices/${U.ia1}/pdf`, 'vendor-1');
    expect(own.status).toBe(200);
  });

  it('tables with no vendor column show a vendor nothing', async () => {
    expect(ids((await get('/vehicles', 'desk-v')).body)).toEqual([]);
    expect(ids((await get('/depots', 'desk-v')).body)).toEqual([]);
  });
});

describe('who sees everything', () => {
  beforeEach(() => seed());

  it('a platform admin acting as the platform sees every company, and as a company only that one', async () => {
    expect(ids((await get('/vehicles', 'super-1', ORG.platform)).body)).toEqual([U.va1, U.va2, U.vb1]);
    expect(ids((await get('/shipments', 'super-1', ORG.platform)).body)).toEqual([U.sa1, U.sa2, U.sb1]);
    expect(ids((await get('/routes', 'super-1', ORG.platform)).body)).toEqual([U.ra1, U.rb1]);
    expect(ids((await get('/finance/invoices?range=all', 'super-1', ORG.platform)).body)).toEqual([U.ia1, U.ia2, U.ib1]);
    expect((await get(`/vehicles/${U.vb1}`, 'super-1', ORG.platform)).status).toBe(200);
    expect(ids((await get('/vehicles', 'super-1')).body)).toEqual([U.va1, U.va2]);
  });

  it('a staff member who belongs to no organisation sees nothing once organisations are set up', async () => {
    expect(ids((await get('/vehicles', 'loner')).body)).toEqual([]);
    expect(ids((await get('/shipments', 'loner')).body)).toEqual([]);
  });

  it('before the organisations migration nothing is scoped: results are what they always were', async () => {
    seed({ configured: false });
    expect(ids((await get('/vehicles', 'admin-a')).body)).toEqual([U.va1, U.va2, U.vb1]);
    expect(ids((await get('/shipments', 'admin-a')).body)).toEqual([U.sa1, U.sa2, U.sb1]);
    expect((await get(`/vehicles/${U.vb1}`, 'admin-a')).status).toBe(200);
  });

  it('a driver still sees their own vehicle through the driver filter', async () => {
    supabaseMock.rows('vehicles').find(v => v.id === U.va1)!.driver_id = uid('driver-a');
    expect(ids((await get('/vehicles', 'driver-a')).body)).toEqual([U.va1]);
  });
});
