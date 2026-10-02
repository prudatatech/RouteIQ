/**
 * Phase 2, money, people and reports scoped by company (docs/tenancy-design.md): two companies share one
 * database. Each company's invoice actions, expenses, driver pay, reports, people and audit entries are its
 * own; another company's record is a 404 (never a 403); a new person joins only the company that made them;
 * the platform view sees everything; before organisations are set up nothing changes.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock, type Row } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { ORG, as, orgWorld, uid } from './support/org-world';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const NOW = new Date().toISOString();
const TODAY = NOW.slice(0, 10);
const ids = (body: any) => (Array.isArray(body) ? body : body.items ?? body.entries ?? []).map((r: any) => r.id).sort();

const U = {
  ia: 'a2000000-0000-4000-8000-0000000000a1', ib: 'a2000000-0000-4000-8000-0000000000b1',
  ia2: 'a2000000-0000-4000-8000-0000000000a2', ib2: 'a2000000-0000-4000-8000-0000000000b2',
  xa: 'e2000000-0000-4000-8000-0000000000a1', xb: 'e2000000-0000-4000-8000-0000000000b1',
  ea: 'e3000000-0000-4000-8000-0000000000a1', eb: 'e3000000-0000-4000-8000-0000000000b1',
  pa: 'e4000000-0000-4000-8000-0000000000a1', pb: 'e4000000-0000-4000-8000-0000000000b1',
  ra: 'e5000000-0000-4000-8000-0000000000a1', rb: 'e5000000-0000-4000-8000-0000000000b1',
  sa: '51000000-0000-4000-8000-0000000000a1', sb: '51000000-0000-4000-8000-0000000000b1',
  va: 'a1000000-0000-4000-8000-000000000001', vb: 'b1000000-0000-4000-8000-000000000001',
  rta: 'f1000000-0000-4000-8000-0000000000a1', rtb: 'f1000000-0000-4000-8000-0000000000b1',
  la: 'f2000000-0000-4000-8000-0000000000a1', lb: 'f2000000-0000-4000-8000-0000000000b1',
  cust: 'c1000000-0000-4000-8000-0000000000c1',
};

const invoice = (id: string, issuer: string, over: Row = {}): Row => ({
  id, invoice_number: `INV-${id.slice(-3)}`, status: 'issued', amount: 100, total: 118, gst_rate: 18, gst_amount: 18, issued_at: NOW, due_date: NOW,
  issuer_org_id: issuer, bill_to_org_id: ORG.vendorV, vendor_id: null, shipment_id: null, manifest_id: null, ...over,
});
const expense = (id: string, org: string, amount: number): Row => ({
  id, category: 'toll', amount, expense_date: TODAY, vehicle_id: null, route_id: null, litres: null, note: null, receipt_path: null, created_at: NOW, carrier_org_id: org,
});
const entry = (id: string, org: string, driver: string, vehicleId: string, over: Row = {}): Row => ({
  id, driver_id: uid(driver), vehicle_id: vehicleId, vehicle_type: 'truck', trip_date: '2026-09-10', km: 10, amount: 600, status: 'earned',
  adjustments: [], per_trip_amount: 500, per_km_amount: 10, rate_missing: false, carrier_org_id: org, ...over,
});
const delivered = (id: string, org: string, code: string): Row => ({
  id, tracking_id: code, status: 'delivered', is_master: false, parent_shipment_id: null, freight_charge: 5000, origin_name: 'Hub',
  created_at: NOW, updated_at: NOW, carrier_org_id: org, vendor_org_id: ORG.vendorV, metadata: {},
});

function seed(opts: { configured?: boolean } = {}, extra: Record<string, Row[]> = {}) {
  const base = orgWorld({}, opts);
  supabaseMock.reset({
    ...base,
    vehicles: [
      { id: U.va, plate_number: 'MH01AA0001', vehicle_type: 'truck', status: 'idle', capacity_kg: 5000, carrier_org_id: ORG.companyA },
      { id: U.vb, plate_number: 'MH01BB0001', vehicle_type: 'truck', status: 'on_route', capacity_kg: 5000, carrier_org_id: ORG.companyB },
    ],
    routes: [
      { id: U.rta, vehicle_id: U.va, status: 'completed', total_distance_km: 100, created_at: NOW, completed_at: NOW, carrier_org_id: ORG.companyA },
      { id: U.rtb, vehicle_id: U.vb, status: 'active', total_distance_km: 300, created_at: NOW, carrier_org_id: ORG.companyB },
    ],
    invoices: [invoice(U.ia, ORG.companyA), invoice(U.ib, ORG.companyB), invoice(U.ia2, ORG.companyA), invoice(U.ib2, ORG.companyB, { amount: 5000, total: 5900 })],
    invoice_payment_reports: [
      { id: U.ra, invoice_id: U.ia2, customer_id: U.cust, kind: 'query', status: 'open', created_at: NOW },
      { id: U.rb, invoice_id: U.ib2, customer_id: U.cust, kind: 'query', status: 'open', created_at: NOW },
    ],
    expenses: [expense(U.xa, ORG.companyA, 250), expense(U.xb, ORG.companyB, 900)],
    shipments: [delivered(U.sa, ORG.companyA, 'RTX-ALPHA'), delivered(U.sb, ORG.companyB, 'RTX-BETA')],
    cargo_manifest: [], vendor_shipment_requests: [], capacity_bids: [], delivery_points: [], route_stops: [], shipment_logs: [], tpl_orders: [],
    customers: [{ id: U.cust, full_name: 'Cee Customer', phone: '+919800000001' }], customer_bookings: [], vendor_profiles: [], payments: [],
    driver_pay_rates: [
      { id: U.pa, vehicle_type: 'truck', per_trip_amount: 500, per_km_amount: 10, effective_from: '2026-01-01', active: true, carrier_org_id: ORG.companyA },
      { id: U.pb, vehicle_type: 'truck', per_trip_amount: 900, per_km_amount: 15, effective_from: '2026-01-01', active: true, carrier_org_id: ORG.companyB },
    ],
    driver_pay_entries: [entry(U.ea, ORG.companyA, 'driver-a', U.va), entry(U.eb, ORG.companyB, 'driver-b', U.vb, { amount: 1050 })],
    driver_payouts: [
      { id: U.la, driver_id: uid('driver-a'), amount: 600, paid_at: NOW, carrier_org_id: ORG.companyA },
      { id: U.lb, driver_id: uid('driver-b'), amount: 1050, paid_at: NOW, carrier_org_id: ORG.companyB },
    ],
    user_profiles: [], user_documents: [], user_activity: [], user_status_history: [], user_phone_history: [], user_bank_accounts: [],
    user_emergency_contacts: [], user_notes: [], driver_vehicle_assignments: [], depots: [], tpl_partners: [], sos_alerts: [],
    ...extra,
  });
}

const get = (path: string, who: string, org?: string) => request(app).get(api(path)).set(as(who, org));
const send = (method: 'post' | 'put' | 'patch' | 'delete', path: string, who: string, body: object = {}, org?: string) =>
  request(app)[method](api(path)).set(as(who, org)).send(body);
const row = (table: string, id: string) => supabaseMock.rows(table).find(r => r.id === id)!;

describe('invoice actions are the company\'s own', () => {
  beforeEach(() => seed());

  it('pays an own invoice, and another company\'s is a 404 that changes nothing', async () => {
    const other = await send('put', `/finance/invoices/${U.ib}/pay`, 'admin-a', { method: 'cash' });
    expect(other.status).toBe(404);
    expect(row('invoices', U.ib).status).toBe('issued');
    const own = await send('put', `/finance/invoices/${U.ia}/pay`, 'admin-a', { method: 'cash' });
    expect(own.status).toBe(200);
    expect(row('invoices', U.ia).status).toBe('paid');
  });

  it('voids only an own invoice', async () => {
    expect((await send('put', `/finance/invoices/${U.ib}/void`, 'admin-a', { reason: 'wrong party' })).status).toBe(404);
    expect(row('invoices', U.ib).status).toBe('issued');
    expect((await send('put', `/finance/invoices/${U.ia}/void`, 'admin-a', { reason: 'wrong party' })).status).toBe(200);
    expect(row('invoices', U.ia).status).toBe('void');
  });

  it('a malformed invoice id is a 404 too', async () => {
    expect((await send('put', '/finance/invoices/not-an-id/pay', 'admin-a', { method: 'cash' })).status).toBe(404);
  });

  it('prices only a delivery of its own', async () => {
    const other = await send('post', '/finance/unpriced/price', 'admin-a', { kind: 'shipment', id: U.sb, amount: 4000 });
    expect(other.status).toBe(404);
    expect(row('shipments', U.sb).freight_charge).toBe(5000);
  });

  it('the to-price list shows only the company\'s deliveries, the platform\'s shows both', async () => {
    const a = await get('/finance/unpriced?from=2000-01-01', 'admin-a');
    expect(a.body.map((r: any) => r.id)).toEqual([U.sa]);
    expect((await get('/finance/unpriced?from=2000-01-01', 'admin-b')).body.map((r: any) => r.id)).toEqual([U.sb]);
    expect((await get('/finance/unpriced?from=2000-01-01', 'super-1', ORG.platform)).body.map((r: any) => r.id).sort()).toEqual([U.sa, U.sb].sort());
  });

  it('creating an invoice for another company\'s delivery is a 404', async () => {
    expect((await send('post', '/finance/invoices', 'admin-a', { shipment_id: U.sb })).status).toBe(404);
  });

  it('opens an own invoice and 404s on another company\'s', async () => {
    expect((await get(`/invoices/${U.ia}`, 'admin-a')).status).not.toBe(404);
    expect((await get(`/invoices/${U.ib}`, 'admin-a')).status).toBe(404);
  });

  it('customer reports: the list, the open count and the actions are the company\'s own', async () => {
    expect(ids((await get('/finance/invoice-reports', 'admin-a')).body)).toEqual([U.ra]);
    expect(ids((await get('/finance/invoice-reports', 'admin-b')).body)).toEqual([U.rb]);
    expect((await get('/finance/invoices/summary', 'admin-a')).body.open_reports).toBe(1);
    const other = await send('post', `/finance/invoice-reports/${U.rb}/answer`, 'admin-a', { answer: 'Paid already' });
    expect(other.status).toBe(404);
    expect(row('invoice_payment_reports', U.rb).status).toBe('open');
    expect((await send('post', `/finance/invoice-reports/${U.ra}/answer`, 'admin-a', { answer: 'Paid already' })).status).toBe(200);
    expect(row('invoice_payment_reports', U.ra).status).toBe('answered');
  });

  it('the platform sees the invoices and reports of every company', async () => {
    expect(ids((await get('/finance/invoice-reports', 'super-1', ORG.platform)).body)).toEqual([U.ra, U.rb].sort());
    expect((await get('/finance/invoices/summary', 'super-1', ORG.platform)).body.outstanding_count).toBe(4);
    expect((await get('/finance/invoices/summary', 'admin-a')).body.outstanding_count).toBe(2);
  });
});

describe('expenses', () => {
  beforeEach(() => seed());

  it('lists only the company\'s own', async () => {
    expect(ids((await get('/finance/expenses?from=2000-01-01', 'admin-a')).body)).toEqual([U.xa]);
    expect(ids((await get('/finance/expenses?from=2000-01-01', 'admin-b')).body)).toEqual([U.xb]);
    expect(ids((await get('/finance/expenses?from=2000-01-01', 'super-1', ORG.platform)).body)).toEqual([U.xa, U.xb].sort());
  });

  it('a new expense belongs to the company that made it', async () => {
    const res = await send('post', '/finance/expenses', 'admin-b', { category: 'fuel', amount: 120, expense_date: TODAY });
    expect(res.status).toBe(201);
    expect(row('expenses', res.body.id).carrier_org_id).toBe(ORG.companyB);
  });

  it('cannot attach another company\'s vehicle', async () => {
    const res = await send('post', '/finance/expenses', 'admin-a', { category: 'fuel', amount: 120, expense_date: TODAY, vehicle_id: U.vb });
    expect(res.status).toBe(400);
    expect((await send('post', '/finance/expenses', 'admin-a', { category: 'fuel', amount: 120, expense_date: TODAY, vehicle_id: U.va })).status).toBe(201);
  });

  it('update, delete and the receipt of another company\'s expense are a 404', async () => {
    expect((await send('put', `/finance/expenses/${U.xb}`, 'admin-a', { amount: 1 })).status).toBe(404);
    expect(row('expenses', U.xb).amount).toBe(900);
    expect((await send('delete', `/finance/expenses/${U.xb}`, 'admin-a')).status).toBe(404);
    expect((await get(`/finance/expenses/${U.xb}/receipt-url`, 'admin-a')).status).toBe(404);
    expect(supabaseMock.rows('expenses')).toHaveLength(2);
    expect((await send('put', `/finance/expenses/${U.xa}`, 'admin-a', { amount: 300 })).status).toBe(200);
    expect((await send('delete', `/finance/expenses/${U.xa}`, 'admin-a')).status).toBe(204);
  });
});

describe('driver pay actions', () => {
  beforeEach(() => seed());

  it('lists entries, rates and payouts per company', async () => {
    expect(ids((await get('/driver-pay/entries', 'admin-a')).body)).toEqual([U.ea]);
    expect(ids((await get('/driver-pay/entries', 'admin-b')).body)).toEqual([U.eb]);
    expect(ids((await get('/driver-pay/rates', 'admin-a')).body)).toEqual([U.pa]);
    expect(ids((await get('/driver-pay/payouts', 'admin-b')).body)).toEqual([U.lb]);
    expect(ids((await get('/driver-pay/entries', 'super-1', ORG.platform)).body)).toEqual([U.ea, U.eb].sort());
  });

  it('approve skips another company\'s entry as not found', async () => {
    const res = await send('post', '/driver-pay/entries/approve', 'admin-a', { ids: [U.ea, U.eb] });
    expect(res.status).toBe(200);
    expect(res.body.approved).toEqual([U.ea]);
    expect(res.body.skipped).toEqual([{ id: U.eb, reason: 'Not found' }]);
    expect(row('driver_pay_entries', U.eb).status).toBe('earned');
  });

  it('adjust and void of another company\'s entry are a 404 that change nothing', async () => {
    expect((await send('post', `/driver-pay/entries/${U.eb}/adjust`, 'admin-a', { amount: 50, reason: 'bonus' })).status).toBe(404);
    expect((await send('post', `/driver-pay/entries/${U.eb}/void`, 'admin-a', { reason: 'wrong trip' })).status).toBe(404);
    expect(row('driver_pay_entries', U.eb)).toMatchObject({ status: 'earned', amount: 1050 });
    expect((await send('post', `/driver-pay/entries/${U.ea}/adjust`, 'admin-a', { amount: 50, reason: 'bonus' })).status).toBe(200);
    expect((await send('post', `/driver-pay/entries/${U.ea}/void`, 'admin-a', { reason: 'wrong trip' })).status).toBe(200);
  });

  it('a payout cannot include another company\'s entry', async () => {
    supabaseMock.rows('driver_pay_entries').forEach(e => { e.status = 'approved'; });
    const res = await send('post', '/driver-pay/payouts', 'admin-a', { driver_id: uid('driver-b'), entry_ids: [U.eb], method: 'cash' });
    expect(res.status).toBe(404);
    expect(supabaseMock.rows('driver_payouts')).toHaveLength(2);
    const own = await send('post', '/driver-pay/payouts', 'admin-a', { driver_id: uid('driver-a'), entry_ids: [U.ea], method: 'cash' });
    expect(own.status).toBe(201);
    expect(supabaseMock.rows('driver_payouts').find(p => p.id === own.body.payout.id)!.carrier_org_id).toBe(ORG.companyA);
  });

  it('a rate of another company cannot be changed or withdrawn', async () => {
    expect((await send('patch', `/driver-pay/rates/${U.pb}`, 'admin-a', { per_trip_amount: 1 })).status).toBe(404);
    expect((await send('delete', `/driver-pay/rates/${U.pb}`, 'admin-a')).status).toBe(404);
    expect(row('driver_pay_rates', U.pb)).toMatchObject({ per_trip_amount: 900, active: true });
    const created = await send('post', '/driver-pay/rates', 'admin-a', { vehicle_type: 'truck', per_trip_amount: 700, effective_from: '2026-01-01' });
    expect(created.status).toBe(201);
    expect(row('driver_pay_rates', U.pb).active).toBe(true);
    expect(row('driver_pay_rates', U.pa).active).toBe(false);
  });

  it('a driver still reads their own pay', async () => {
    const res = await get('/driver/pay', 'driver-a');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain(U.ea);
    expect(JSON.stringify(res.body)).not.toContain(U.eb);
  });
});

describe('finance reports and analytics', () => {
  beforeEach(() => seed());

  it('the profit and loss covers only the company\'s own invoices and costs', async () => {
    const a = await get('/finance/summary?from=2000-01-01', 'admin-a');
    expect(a.status).toBe(200);
    expect(a.body.revenue).toBe(200);
    const b = await get('/finance/summary?from=2000-01-01', 'admin-b');
    expect(b.body.revenue).toBe(5100);
    const all = await get('/finance/summary?from=2000-01-01', 'super-1', ORG.platform);
    expect(all.body.revenue).toBe(5300);
  });

  it('fleet analytics and fleet stats count the company\'s own vehicles and trips', async () => {
    expect((await get('/fleet/analytics', 'admin-a')).body.total_vehicles).toBe(1);
    expect((await get('/fleet/analytics', 'admin-a')).body.distance.total_km).toBe(100);
    expect((await get('/fleet/analytics', 'super-1', ORG.platform)).body.total_vehicles).toBe(2);
    expect((await get('/analytics/metrics', 'admin-b')).body.active_vehicles).toBe(1);
    expect((await get('/analytics/metrics', 'admin-a')).body.active_vehicles).toBe(0);
  });

  it('driver performance lists only the company\'s vehicles', async () => {
    expect((await get('/analytics/driver-performance', 'admin-a')).body.map((r: any) => r.id)).toEqual([U.va]);
    expect((await get('/analytics/driver-performance', 'super-1', ORG.platform)).body).toHaveLength(2);
  });

  it('vendor performance shows the vendors whose loads the company runs', async () => {
    seed({}, {
      vendor_profiles: [
        { id: uid('vendor-1'), company_name: 'Acme Traders', city: 'Pune', is_verified: true, kyc_status: 'approved' },
        { id: uid('vendor-2'), company_name: 'Zed Exports', city: 'Delhi', is_verified: true, kyc_status: 'approved' },
      ],
      vendor_shipment_requests: [
        { id: 'q1', vendor_id: uid('vendor-1'), status: 'completed', cost: 1000 },
        { id: 'q2', vendor_id: uid('vendor-2'), status: 'completed', cost: 2000 },
      ],
      cargo_manifest: [{ id: 'm1', vendor_request_id: 'q1', status: 'delivered', carrier_org_id: ORG.companyA }],
    });
    expect((await get('/analytics/vendor-performance', 'admin-a')).body.map((v: any) => v.name)).toEqual(['Acme Traders']);
    expect((await get('/analytics/vendor-performance', 'admin-b')).body).toEqual([]);
    expect((await get('/analytics/vendor-performance', 'super-1', ORG.platform)).body).toHaveLength(2);
  });
});

describe('the audit log', () => {
  beforeEach(() => {
    seed({}, {
      ai_agent_logs: [
        { id: 'l1', agent_name: 'staff-console', action: 'a-own-stamped', input_data: { actor_id: uid('admin-a'), org_id: ORG.companyA }, status: 'success', created_at: '2026-09-03T00:00:00Z' },
        { id: 'l2', agent_name: 'staff-console', action: 'b-own-stamped', input_data: { actor_id: uid('admin-b'), org_id: ORG.companyB }, status: 'success', created_at: '2026-09-02T00:00:00Z' },
        { id: 'l3', agent_name: 'staff-console', action: 'a-older-by-member', input_data: { actor_id: uid('manager-a') }, status: 'success', created_at: '2026-09-01T00:00:00Z' },
        { id: 'l4', agent_name: 'staff-console', action: 'b-older-vehicle', input_data: null, vehicle_id: U.vb, status: 'success', created_at: '2026-08-30T00:00:00Z' },
        { id: 'l5', agent_name: 'system', action: 'a-older-vehicle', input_data: null, vehicle_id: U.va, status: 'success', created_at: '2026-08-29T00:00:00Z' },
      ],
    });
  });

  it('a company sees only entries about its own members and records', async () => {
    const res = await get('/analytics/audit-logs', 'super-1', ORG.companyA);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: any) => i.id)).toEqual(['l1', 'l3', 'l5']);
  });

  it('the platform sees every entry', async () => {
    expect((await get('/analytics/audit-logs', 'super-1', ORG.platform)).body.items).toHaveLength(5);
  });

  it('new entries carry the organisation they were made for', async () => {
    await send('put', `/finance/invoices/${U.ia}/void`, 'admin-a', { reason: 'wrong party' });
    const made = supabaseMock.rows('ai_agent_logs').find(l => l.action === 'invoice_void')!;
    expect(made.input_data.org_id).toBe(ORG.companyA);
  });
});

describe('people', () => {
  beforeEach(() => {
    seed();
    supabaseMock.authAdmin = true;
  });

  it('lists, opens and edits only the company\'s own people', async () => {
    // The mock does not run joins: the list asks only for the active company's members (as the Phase 1 list does)
    const asked = (org: string) => supabaseMock.requests.filter(u => u.pathname === '/rest/v1/users' && u.searchParams.get('org_members.org_id') === `eq.${org}`).length;
    await get('/people', 'admin-a');
    await get('/people', 'admin-b');
    expect(asked(ORG.companyA)).toBeGreaterThan(0);
    expect(asked(ORG.companyB)).toBeGreaterThan(0);
    const before = supabaseMock.requests.length;
    expect((await get('/people', 'super-1', ORG.platform)).body.total).toBe(PEOPLE_IN_STAFF_AND_DRIVERS);
    expect(supabaseMock.requests.slice(before).some(u => u.searchParams.has('org_members.org_id'))).toBe(false);

    expect((await get(`/people/${uid('driver-b')}`, 'admin-a')).status).toBe(404);
    expect((await get(`/people/${uid('driver-a')}`, 'admin-a')).status).toBe(200);
    expect((await send('patch', `/people/${uid('driver-b')}`, 'admin-a', { full_name: 'Hacked Name' })).status).toBe(404);
    expect((await send('post', `/people/${uid('driver-b')}/status`, 'admin-a', { status: 'suspended', reason: 'no' })).status).toBe(404);
    expect(supabaseMock.rows('users').find(u => u.id === uid('driver-b'))!.full_name).toBe('Sunil Beta');
  });

  it('documents, bank accounts, notes and contacts of another company\'s person are a 404', async () => {
    const target = uid('driver-b');
    expect((await get(`/people/${target}/documents`, 'admin-a')).status).toBe(404);
    expect((await get(`/people/${target}/bank-accounts`, 'admin-a')).status).toBe(404);
    expect((await get(`/people/${target}/notes`, 'admin-a')).status).toBe(404);
    expect((await send('post', `/people/${target}/notes`, 'admin-a', { body: 'hello' })).status).toBe(404);
    expect((await get(`/people/${target}/emergency-contacts`, 'admin-a')).status).toBe(404);
    expect((await get(`/people/${uid('driver-a')}/documents`, 'admin-a')).status).toBe(200);
  });

  it('a person reads their own record whatever company they act for', async () => {
    expect((await get('/people/me', 'driver-a')).status).toBe(200);
  });

  it('a driver created by company A joins only A, with the driver role', async () => {
    const res = await send('post', '/people', 'admin-a', { role: 'driver', full_name: 'New Driver', phone: '98765 00009' });
    expect(res.status).toBe(201);
    const seats = supabaseMock.rows('org_members').filter(m => m.user_id === res.body.user.id);
    expect(seats).toHaveLength(1);
    expect(seats[0]).toMatchObject({ org_id: ORG.companyA, role: 'driver', status: 'active' });
    expect((await get(`/people/${res.body.user.id}`, 'admin-b')).status).toBe(404);
    expect((await get(`/people/${res.body.user.id}`, 'admin-a')).status).toBe(200);
  });

  it('staff created by company B join only B, with the matching role', async () => {
    const res = await send('post', '/people', 'admin-b', { role: 'manager', full_name: 'Beta Manager', email: 'bm@example.test' });
    expect(res.status).toBe(201);
    const seats = supabaseMock.rows('org_members').filter(m => m.user_id === res.body.user.id);
    expect(seats).toHaveLength(1);
    expect(seats[0]).toMatchObject({ org_id: ORG.companyB, role: 'ops', status: 'active' });
    expect(supabaseMock.rows('org_members').filter(m => m.user_id === res.body.user.id && m.org_id === ORG.companyA)).toHaveLength(0);
  });

  it('the users list and update are the company\'s own', async () => {
    await get('/users', 'admin-b');
    const asked = supabaseMock.requests.filter(u => u.pathname === '/rest/v1/users' && u.searchParams.get('org_members.org_id') === `eq.${ORG.companyB}`);
    expect(asked.length).toBeGreaterThan(0);
    expect((await send('patch', `/users/${uid('driver-b')}`, 'admin-a', { full_name: 'Hacked' })).status).toBe(404);
    expect((await send('patch', `/users/${uid('driver-a')}`, 'admin-a', { full_name: 'Ravi Renamed' })).status).toBe(200);
  });

  it('duplicate checks only show people of the company', async () => {
    const res = await get('/people/duplicates?phone=%2B919876500002', 'admin-a');
    expect(res.body.matches).toEqual([]);
    expect((await get('/people/duplicates?phone=%2B919876500001', 'admin-a')).body.matches).toHaveLength(1);
  });
});

const PEOPLE_IN_STAFF_AND_DRIVERS = 7;

describe('before organisations are set up', () => {
  beforeEach(() => seed({ configured: false }));

  it('nothing is limited', async () => {
    expect(ids((await get('/finance/expenses?from=2000-01-01', 'admin-a')).body)).toEqual([U.xa, U.xb].sort());
    expect(ids((await get('/driver-pay/entries', 'admin-a')).body)).toEqual([U.ea, U.eb].sort());
    expect((await send('put', `/finance/invoices/${U.ib}/pay`, 'admin-a', { method: 'cash' })).status).toBe(200);
    expect((await get('/people', 'admin-a')).body.total).toBe(PEOPLE_IN_STAFF_AND_DRIVERS);
  });
});
