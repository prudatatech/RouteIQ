/**
 * Money: invoice due dates, paying and voiding, the invoice document, its PDF and who may download it,
 * setting a price on an unpriced delivery, and the company profile the seller comes from.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';
import { InvoiceService } from '../src/services/invoice.service';
import { rupeesInWords } from '../src/core/words';
import { ID, auth, cargoWorld, one } from './support/cargo-world';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const DAY = 86_400_000;
const manager = () => ({ Authorization: `Bearer ${createAccessToken({ sub: 'mgr-1', role: 'manager' })}` });

// A valid GSTIN in Maharashtra (27) and one in Gujarat (24): the check character is real
const SELLER_GSTIN = '27AAPFU0939F1ZV';
const BUYER_GSTIN_MH = '27AAACR5055K1Z7';
const BUYER_GSTIN_GJ = '24AAACC1206D1ZM';

const COMPANY = {
  legal_name: 'Margix Logistics Pvt Ltd', gstin: SELLER_GSTIN, address: 'Plot 4, Bhiwandi', city: 'Thane', state: 'Maharashtra',
  sac_code: '996511', bank_name: 'HDFC Bank', bank_account_no: '50200012345678', bank_ifsc: 'HDFC0000123', payment_terms_days: 15,
};

function world(extra: Record<string, any[]> = {}) {
  const base = cargoWorld();
  supabaseMock.reset({
    ...base,
    users: [
      ...base.users,
      { id: 'mgr-1', role: 'manager', is_active: true },
      { id: 'super-1', role: 'superadmin', is_active: true },
      { ...base.users.find(u => u.id === ID.vendor)!, email: 'ops@acme.test', phone: '+919811100000' },
    ].filter((u, i, all) => all.findIndex(x => x.id === u.id) === i).map(u => (u.id === ID.vendor ? { ...u, email: 'ops@acme.test', phone: '+919811100000' } : u)),
    vendor_profiles: [
      { id: ID.vendor, company_name: 'Acme Logistics', gst_number: BUYER_GSTIN_MH, address: '12 MIDC Road', city: 'Pune' },
      { id: ID.otherVendor, company_name: 'Other Co', gst_number: null },
    ],
    system_settings: [{ key: 'company_profile', value: { value: COMPANY } }],
    ...extra,
  });
}

const deliver = (table: string, id: string) => Object.assign(one(table, id), { status: 'delivered' });

describe('due date on issue', () => {
  it('is issue date plus the payment terms in Settings', async () => {
    world();
    deliver('shipments', ID.s1);
    await InvoiceService.createForShipment(ID.s1);
    const inv = supabaseMock.rows('invoices')[0];
    expect(Date.parse(inv.due_date) - Date.parse(inv.issued_at)).toBe(15 * DAY);
  });

  it('defaults to 15 days when no terms are set, and follows a changed setting', async () => {
    const { payment_terms_days: _terms, ...noTerms } = COMPANY;
    world({ system_settings: [{ key: 'company_profile', value: { value: noTerms } }] });
    deliver('shipments', ID.s1);
    await InvoiceService.createForShipment(ID.s1);
    expect(Date.parse(supabaseMock.rows('invoices')[0].due_date) - Date.parse(supabaseMock.rows('invoices')[0].issued_at)).toBe(15 * DAY);

    world({ system_settings: [{ key: 'company_profile', value: { value: { ...COMPANY, payment_terms_days: 30 } } }] });
    deliver('shipments', ID.s1);
    await InvoiceService.createForShipment(ID.s1);
    expect(Date.parse(supabaseMock.rows('invoices')[0].due_date) - Date.parse(supabaseMock.rows('invoices')[0].issued_at)).toBe(30 * DAY);
  });
});

describe('paying and voiding', () => {
  let id: string;
  beforeEach(async () => {
    world();
    deliver('cargo_manifest', ID.m1);
    await InvoiceService.createForManifest(ID.m1);
    id = supabaseMock.rows('invoices')[0].id;
  });
  const pay = (body: object) => request(app).put(api(`/finance/invoices/${id}/pay`)).set(auth.admin()).send(body);
  const void_ = (body: object) => request(app).put(api(`/finance/invoices/${id}/void`)).set(auth.admin()).send(body);

  it('records method, reference and date, and tells the vendor', async () => {
    const res = await pay({ method: 'upi', reference: 'UTR 4455', paid_on: new Date().toISOString().slice(0, 10) });
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('invoices')[0]).toMatchObject({ status: 'paid', payment_method: 'upi', payment_reference: 'UTR 4455' });
    expect(supabaseMock.rows('invoices')[0].paid_at).toBeTruthy();
    expect(supabaseMock.rows('notifications').filter(n => n.type === 'invoice_paid' && n.user_id === ID.vendor)).toHaveLength(1);
    expect(supabaseMock.rows('notifications').find(n => n.type === 'invoice_paid')!.data).toMatchObject({ invoice_id: id });
  });

  it('needs a method, and refuses a future date, a bad date and a date before the invoice', async () => {
    expect((await pay({})).status).toBe(400);
    expect((await pay({ method: 'card' })).status).toBe(400);
    expect((await pay({ method: 'cash', paid_on: '2999-01-01' })).status).toBe(400);
    expect((await pay({ method: 'cash', paid_on: 'yesterday' })).status).toBe(400);
    expect((await pay({ method: 'cash', paid_on: '2001-01-01' })).status).toBe(400);
    expect(supabaseMock.rows('invoices')[0].status).toBe('issued');
  });

  it('keeps an earlier payment date the staff entered', async () => {
    const day = new Date(Date.now() - 0).toISOString().slice(0, 10);
    const res = await pay({ method: 'cheque', reference: '000123', paid_on: day });
    expect(res.status).toBe(200);
    expect(res.body.payment_reference).toBe('000123');
  });

  it('voids with a reason, and needs one', async () => {
    expect((await void_({})).status).toBe(400);
    expect((await void_({ reason: 'ab' })).status).toBe(400);
    expect((await void_({ reason: 'Price was wrong' })).status).toBe(200);
    expect(supabaseMock.rows('invoices')[0]).toMatchObject({ status: 'void', void_reason: 'Price was wrong' });
  });
});

describe('GET /invoices/:id', () => {
  const get = (id: string, who: object = auth.admin()) => request(app).get(api(`/invoices/${id}`)).set(who);

  it('gives a vendor invoice in the same state as the seller: CGST and SGST, words, links and trip', async () => {
    world({
      routes: [{ id: ID.route1, vehicle_id: ID.v1, status: 'active', created_at: new Date().toISOString() }],
    });
    deliver('cargo_manifest', ID.m1);
    one('vendor_shipment_requests', ID.request1).metadata = { cargo: { gstRate: 18 } };
    await InvoiceService.createForManifest(ID.m1);
    const inv = supabaseMock.rows('invoices')[0];
    const res = await get(inv.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: inv.id, invoice_number: inv.invoice_number, status: 'issued', overdue: false, amount: 8000, gst_rate: 18, gst_amount: 1440, total: 9440,
      seller: { legal_name: 'Margix Logistics Pvt Ltd', gstin: SELLER_GSTIN, state_code: '27', sac_code: '996511' },
      buyer: { kind: 'vendor', name: 'Acme Logistics', gstin: BUYER_GSTIN_MH, state_code: '27', email: 'ops@acme.test' },
      tax: { basis: 'intra', cgst: 720, sgst: 720, igst: 0 },
      total_in_words: 'Rupees Nine Thousand Four Hundred Forty Only',
      seller_gaps: [],
    });
    expect(res.body.lines).toHaveLength(1);
    expect(res.body.lines[0]).toMatchObject({ amount: 8000, sac_code: '996511' });
    expect(res.body.lines[0].description).toContain('Pune');
    expect(res.body.links.shipment).toMatchObject({ id: ID.m1 });
    expect(res.body.links.request_id).toBe(ID.request1);
    expect(res.body.links.requester).toMatchObject({ kind: 'vendor_load', name: 'Acme Logistics' });
  });

  it('uses IGST for a buyer in another state, and says so when the place of supply is not known', async () => {
    // The recipient and the tax split are fixed when the invoice is issued
    for (const [gstin, expected] of [[BUYER_GSTIN_GJ, { basis: 'inter', igst: 1440, cgst: 0, sgst: 0 }], [null, { basis: 'unknown', total: 1440 }]] as const) {
      world();
      deliver('cargo_manifest', ID.m1);
      one('vendor_shipment_requests', ID.request1).metadata = { cargo: { gstRate: 18 } };
      supabaseMock.rows('vendor_profiles')[0].gst_number = gstin;
      await InvoiceService.createForManifest(ID.m1);
      const res = await get(supabaseMock.rows('invoices')[0].id);
      expect(res.body.tax).toMatchObject(expected);
      if (!gstin) expect(res.body.tax.note).toMatch(/place of supply/);
    }
  });

  it('shows a customer invoice with the HSN lines of the goods and the trip', async () => {
    world();
    // The mock does not embed delivery points the way the database does
    deliver('shipments', ID.s1).delivery_points = [{ id: ID.dp1, name: 'Hinjewadi warehouse', address: 'Hinjewadi, Pune', shipment_id: ID.s1 }];
    await InvoiceService.createForShipment(ID.s1);
    const res = await get(supabaseMock.rows('invoices')[0].id);
    expect(res.status).toBe(200);
    expect(res.body.buyer).toMatchObject({ kind: 'customer', id: ID.customer, name: 'Meera Customer' });
    expect(res.body.goods.map((g: any) => g.hsn_code)).toEqual(['8471', '8528']);
    expect(res.body.links.shipment.code).toMatch(/^RTX-/);
    expect(res.body.links.trip).toMatchObject({ id: ID.route1 });
    expect(res.body.lines[0].description).toContain('Hinjewadi warehouse');
  });

  it('flags an issued invoice past its due date, and lists what is missing from the company profile', async () => {
    world();
    deliver('shipments', ID.s1);
    await InvoiceService.createForShipment(ID.s1);
    // The profile loses its details after the invoice was issued: the page lists what is missing
    supabaseMock.rows('system_settings').length = 0;
    const inv = supabaseMock.rows('invoices')[0];
    inv.issued_at = new Date(Date.now() - 20 * DAY).toISOString();
    inv.due_date = new Date(Date.now() - 5 * DAY).toISOString();
    const res = await get(inv.id);
    expect(res.body).toMatchObject({ overdue: true, days_overdue: 5 });
    expect(res.body.seller_gaps).toEqual(['company name', 'GSTIN', 'address', 'SAC code']);
    inv.status = 'paid';
    expect((await get(inv.id)).body.overdue).toBe(false);
  });

  it('is for admins: not managers, vendors, customers or anonymous callers, and 404 for an unknown id', async () => {
    world();
    deliver('shipments', ID.s1);
    await InvoiceService.createForShipment(ID.s1);
    const id = supabaseMock.rows('invoices')[0].id;
    expect((await get(id, manager())).status).toBe(403);
    expect((await get(id, auth.vendor())).status).toBe(403);
    expect((await get(id, auth.customer())).status).toBe(403);
    expect((await request(app).get(api(`/invoices/${id}`))).status).toBe(401);
    expect((await get('00000000-0000-4000-8000-00000000dead')).status).toBe(404);
    expect((await get(id, { Authorization: `Bearer ${supabaseMock.signUserToken('super-1')}` })).status).toBe(200);
  });
});

describe('GET /invoices/:id/pdf', () => {
  const pdf = (id: string, who: object) => request(app).get(api(`/invoices/${id}/pdf`)).set(who).buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });

  let shipmentInvoice: string;
  let vendorInvoice: string;
  beforeEach(async () => {
    world();
    deliver('shipments', ID.s1);
    deliver('cargo_manifest', ID.m1);
    await InvoiceService.createForShipment(ID.s1);
    await InvoiceService.createForManifest(ID.m1);
    shipmentInvoice = supabaseMock.rows('invoices').find(i => i.shipment_id)!.id;
    vendorInvoice = supabaseMock.rows('invoices').find(i => i.manifest_id)!.id;
  });

  it('gives staff a PDF file named after the invoice', async () => {
    const res = await pdf(vendorInvoice, auth.admin());
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain(supabaseMock.rows('invoices').find(i => i.id === vendorInvoice)!.invoice_number);
    const body = res.body as Buffer;
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(body.length).toBeGreaterThan(1500);
  });

  it('gives the vendor their own invoice and the customer theirs', async () => {
    expect((await pdf(vendorInvoice, auth.vendor())).status).toBe(200);
    expect((await pdf(shipmentInvoice, auth.customer())).status).toBe(200);
  });

  it('answers 404 for another vendor or customer, so ids cannot be probed', async () => {
    expect((await pdf(vendorInvoice, auth.vendor(ID.otherVendor))).status).toBe(404);
    expect((await pdf(shipmentInvoice, auth.customer(ID.otherCustomer))).status).toBe(404);
    expect((await pdf(shipmentInvoice, auth.vendor())).status).toBe(404);
    expect((await pdf(vendorInvoice, auth.customer())).status).toBe(404);
  });

  it('refuses managers, drivers and anonymous callers', async () => {
    expect((await pdf(vendorInvoice, manager())).status).toBe(403);
    expect((await pdf(vendorInvoice, auth.driver())).status).toBe(403);
    expect((await request(app).get(api(`/invoices/${vendorInvoice}/pdf`))).status).toBe(401);
  });

  it('does not give a void invoice to the vendor, but staff can still print it', async () => {
    Object.assign(supabaseMock.rows('invoices').find(i => i.id === vendorInvoice)!, { status: 'void', void_reason: 'Wrong price' });
    expect((await pdf(vendorInvoice, auth.vendor())).status).toBe(404);
    expect((await pdf(vendorInvoice, auth.admin())).status).toBe(200);
  });
});

describe('vendor invoice list and load', () => {
  const late = () => new Date(Date.now() - 10 * DAY).toISOString();
  beforeEach(() => {
    world({
      invoices: [
        { id: 'v-late', invoice_number: 'INV-1', vendor_id: ID.vendor, manifest_id: ID.m1, vendor_request_id: ID.request1, amount: 1000, gst_rate: 0, gst_amount: 0, total: 1000, status: 'issued', issued_at: new Date(Date.now() - 30 * DAY).toISOString(), due_date: late() },
        { id: 'v-old', invoice_number: 'INV-2', vendor_id: ID.vendor, shipment_id: ID.s1, amount: 500, gst_rate: 0, gst_amount: 0, total: 500, status: 'issued', issued_at: new Date(Date.now() - 20 * DAY).toISOString() },
        { id: 'v-paid', invoice_number: 'INV-3', vendor_id: ID.vendor, manifest_id: ID.m1, amount: 700, gst_rate: 0, gst_amount: 0, total: 700, status: 'paid', issued_at: new Date(Date.now() - 40 * DAY).toISOString(), due_date: late(), paid_at: new Date().toISOString(), payment_method: 'upi', payment_reference: 'UTR 1' },
      ],
    });
  });

  it('returns due date, overdue and the payment fields on the vendor list', async () => {
    const res = await request(app).get(api('/vendor/invoices')).set(auth.vendor());
    expect(res.status).toBe(200);
    const byId = (id: string) => res.body.find((i: any) => i.id === id);
    expect(byId('v-late')).toMatchObject({ overdue: true, days_overdue: 10 });
    // No saved due date: issue date plus the 15 day terms, so 5 days overdue
    expect(byId('v-old')).toMatchObject({ overdue: true, days_overdue: 5 });
    expect(byId('v-old').due_date).toBeTruthy();
    expect(byId('v-paid')).toMatchObject({ overdue: false, days_overdue: 0, payment_method: 'upi', payment_reference: 'UTR 1' });
  });

  it('returns the same on the invoice of a load', async () => {
    const res = await request(app).get(api(`/vendor/loads/${ID.request1}`)).set(auth.vendor());
    expect(res.status).toBe(200);
    expect(res.body.invoice).toHaveProperty('due_date');
    expect(res.body.invoice).toHaveProperty('overdue');
    expect(res.body.invoice).toHaveProperty('days_overdue');
  });
});

describe('GET /invoices/payment-details', () => {
  const get = (who?: object) => { const r = request(app).get(api('/invoices/payment-details')); return who ? r.set(who) : r; };

  it('gives a vendor and a customer only where to pay', async () => {
    world({ system_settings: [{ key: 'company_profile', value: { value: { ...COMPANY, upi_id: 'margix@hdfc', payment_terms_days: 30 } } }] });
    for (const who of [auth.vendor(), auth.customer(), auth.admin()]) {
      const res = await get(who);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        account_name: 'Margix Logistics Pvt Ltd', bank_name: 'HDFC Bank', bank_account_no: '50200012345678', bank_ifsc: 'HDFC0000123',
        upi_id: 'margix@hdfc', payment_terms_days: 30, available: true,
      });
    }
  });

  it('never leaks the rest of the company settings', async () => {
    world({ system_settings: [{ key: 'company_profile', value: { value: { ...COMPANY, pan: 'AAPFU0939F', phone: '+911', email: 'a@b.co', invoice_footer: 'secret footer' } } }] });
    const text = JSON.stringify((await get(auth.vendor())).body);
    for (const leak of [SELLER_GSTIN, 'AAPFU0939F', 'Bhiwandi', '996511', 'secret footer', 'a@b.co']) expect(text).not.toContain(leak);
  });

  it('says nothing is available when no bank or UPI details are saved', async () => {
    world({ system_settings: [{ key: 'company_profile', value: { value: { legal_name: 'Margix' } } }] });
    const res = await get(auth.customer());
    expect(res.body).toMatchObject({ available: false, bank_account_no: null, upi_id: null, payment_terms_days: 15 });
  });

  it('is not for managers, drivers or anonymous callers', async () => {
    world();
    expect((await get(manager())).status).toBe(403);
    expect((await get(auth.driver())).status).toBe(403);
    expect((await get()).status).toBe(401);
  });
});

describe('list, filters and totals', () => {
  beforeEach(() => {
    world({
      invoices: [
        { id: 'i-late', invoice_number: 'INV-1', vendor_id: ID.vendor, manifest_id: ID.m1, amount: 1000, gst_rate: 0, gst_amount: 0, total: 1000, status: 'issued', issued_at: new Date(Date.now() - 30 * DAY).toISOString(), due_date: new Date(Date.now() - 10 * DAY).toISOString() },
        { id: 'i-ok', invoice_number: 'INV-2', shipment_id: ID.s1, amount: 2000, gst_rate: 0, gst_amount: 0, total: 2000, status: 'issued', issued_at: new Date().toISOString(), due_date: new Date(Date.now() + 10 * DAY).toISOString() },
        { id: 'i-paid', invoice_number: 'INV-3', vendor_id: ID.otherVendor, amount: 500, gst_rate: 0, gst_amount: 0, total: 500, status: 'paid', issued_at: new Date().toISOString(), paid_at: new Date().toISOString() },
        { id: 'i-old-paid', invoice_number: 'INV-4', vendor_id: ID.vendor, amount: 700, gst_rate: 0, gst_amount: 0, total: 700, status: 'paid', issued_at: '2020-01-01T00:00:00Z', paid_at: '2020-01-05T00:00:00Z' },
      ],
    });
  });
  const list = (q = '') => request(app).get(api(`/finance/invoices?from=2020-01-01${q ? `&${q}` : ''}`)).set(auth.admin());

  it('marks overdue invoices and tells who is billed', async () => {
    const res = await list();
    const byId = (id: string) => res.body.find((i: any) => i.id === id);
    expect(byId('i-late')).toMatchObject({ overdue: true, days_overdue: 10, requester_type: 'vendor', requester_name: 'Acme Logistics' });
    expect(byId('i-ok')).toMatchObject({ overdue: false, requester_type: 'customer', requester_name: 'Meera Customer' });
    expect(byId('i-paid').overdue).toBe(false);
  });

  it('filters by overdue and by requester type', async () => {
    expect((await list('overdue=1')).body.map((i: any) => i.id)).toEqual(['i-late']);
    expect((await list('requester=customer')).body.map((i: any) => i.id)).toEqual(['i-ok']);
    expect((await list('requester=vendor')).body.map((i: any) => i.id).sort()).toEqual(['i-late', 'i-old-paid', 'i-paid']);
  });

  it('totals outstanding and collected this month', async () => {
    const res = await request(app).get(api('/finance/invoices/summary')).set(auth.admin());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ outstanding: 3000, outstanding_count: 2, overdue: 1000, overdue_count: 1, collected_this_month: 500, collected_count: 1 });
  });

  it('is not for managers', async () => {
    expect((await request(app).get(api('/finance/invoices/summary')).set(manager())).status).toBe(403);
  });
});

describe('set a price on a delivery', () => {
  const price = (body: object) => request(app).post(api('/finance/unpriced/price')).set(auth.admin()).send(body);

  it('prices a delivered shipment and issues its invoice at once', async () => {
    world();
    Object.assign(deliver('shipments', ID.s1), { freight_charge: null });
    const res = await price({ kind: 'shipment', id: ID.s1, amount: 4200.5 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ amount: 4200.5 });
    expect(res.body.invoice_number).toMatch(/^INV-\d{6}-0001$/);
    expect(one('shipments', ID.s1).freight_charge).toBe(4200.5);
    expect(supabaseMock.rows('invoices')[0]).toMatchObject({ shipment_id: ID.s1, amount: 4200.5, price_source: 'freight_charge' });
    expect(supabaseMock.rows('notifications').filter(n => n.type === 'invoice_issued')).toHaveLength(1);
  });

  it('prices a delivered vendor load through its request', async () => {
    world();
    Object.assign(deliver('cargo_manifest', ID.m1));
    one('vendor_shipment_requests', ID.request1).cost = null;
    const res = await price({ kind: 'manifest', id: ID.m1, amount: 9000 });
    expect(res.status).toBe(201);
    expect(one('vendor_shipment_requests', ID.request1).cost).toBe(9000);
    expect(supabaseMock.rows('invoices')[0]).toMatchObject({ manifest_id: ID.m1, vendor_id: ID.vendor, amount: 9000 });
  });

  it('refuses bad amounts, undelivered goods, a second invoice and a bid-priced shipment', async () => {
    world();
    deliver('shipments', ID.s1);
    expect((await price({ kind: 'shipment', id: ID.s1, amount: 0 })).status).toBe(400);
    expect((await price({ kind: 'shipment', id: ID.s1, amount: 'abc' })).status).toBe(400);
    expect((await price({ kind: 'thing', id: ID.s1, amount: 100 })).status).toBe(400);
    expect((await price({ kind: 'shipment', id: ID.s2, amount: 100 })).status).toBe(409);
    expect((await price({ kind: 'shipment', id: ID.s1, amount: 100 })).status).toBe(201);
    expect((await price({ kind: 'shipment', id: ID.s1, amount: 200 })).status).toBe(409);
    expect(supabaseMock.rows('invoices')).toHaveLength(1);

    world();
    Object.assign(deliver('shipments', ID.s1), { bid_id: 'bid-1' });
    supabaseMock.rows('capacity_bids').push({ id: 'bid-1', vendor_id: ID.vendor, bid_amount: 6000, status: 'won' });
    expect((await price({ kind: 'shipment', id: ID.s1, amount: 100 })).status).toBe(409);
  });

  it('is not for managers or vendors', async () => {
    world();
    deliver('shipments', ID.s1);
    const asManager = await request(app).post(api('/finance/unpriced/price')).set(manager()).send({ kind: 'shipment', id: ID.s1, amount: 100 });
    expect(asManager.status).toBe(403);
    const asVendor = await request(app).post(api('/finance/unpriced/price')).set(auth.vendor()).send({ kind: 'shipment', id: ID.s1, amount: 100 });
    expect(asVendor.status).toBe(403);
  });
});

describe('company profile', () => {
  it('saves the seller, checks the GSTIN, and keeps 15 days when no terms were set', async () => {
    world({ system_settings: [] });
    const get = await request(app).get(api('/finance/company')).set(auth.admin());
    expect(get.body).toMatchObject({ legal_name: null, gstin: null, payment_terms_days: 15 });

    const bad = await request(app).put(api('/finance/company')).set(auth.admin()).send({ gstin: '27AAPFU0939F1ZX' });
    expect(bad.status).toBe(400);

    const ok = await request(app).put(api('/finance/company')).set(auth.admin()).send({ legal_name: ' Margix ', gstin: '27aapfu0939f1zv', sac_code: '996511', payment_terms_days: 7 });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ legal_name: 'Margix', gstin: SELLER_GSTIN, sac_code: '996511', payment_terms_days: 7 });
    expect((await request(app).put(api('/finance/company')).set(auth.admin()).send({ payment_terms_days: 400 })).status).toBe(400);
    expect((await request(app).put(api('/finance/company')).set(auth.admin()).send({ sac_code: '12' })).status).toBe(400);
    expect((await request(app).get(api('/finance/company')).set(auth.admin())).body.payment_terms_days).toBe(7);
  });

  it('is not for managers', async () => {
    world();
    expect((await request(app).get(api('/finance/company')).set(manager())).status).toBe(403);
  });
});

describe('amount in words', () => {
  it('reads rupees the Indian way', () => {
    expect(rupeesInWords(0)).toBe('Rupees Zero Only');
    expect(rupeesInWords(125000)).toBe('Rupees One Lakh Twenty Five Thousand Only');
    expect(rupeesInWords(10_000_000)).toBe('Rupees One Crore Only');
    expect(rupeesInWords(2950.59)).toBe('Rupees Two Thousand Nine Hundred Fifty and Fifty Nine Paise Only');
    expect(rupeesInWords(19.5)).toBe('Rupees Nineteen and Fifty Paise Only');
    expect(rupeesInWords(null)).toBe('');
    expect(rupeesInWords(-5)).toBe('');
  });
});
