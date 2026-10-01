/**
 * ROL-18 (a customer profile) and ROL-19 (a customer reports a payment or queries an invoice).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { ID, auth, cargoWorld, notesFor, one } from './support/cargo-world';
import { InvoiceService } from '../src/services/invoice.service';
import { customerDisplayName } from '../src/core/customer-name';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
const GSTIN_MH = '27AAACR5055K1Z7';
const GSTIN_GJ = '24AAACC1206D1ZM';
const INV = 'f1000000-0000-4000-8000-000000000001';
const OTHER_INV = 'f1000000-0000-4000-8000-000000000002';
const VOID_INV = 'f1000000-0000-4000-8000-000000000003';
const VENDOR_INV = 'f1000000-0000-4000-8000-000000000004';
const today = () => new Date().toISOString().slice(0, 10);

function invoice(id: string, shipmentId: string | null, over: Record<string, unknown> = {}) {
  return {
    id, invoice_number: `INV-${id.slice(-1)}`, shipment_id: shipmentId, manifest_id: null, vendor_id: null, vendor_request_id: null,
    amount: 1000, gst_rate: 18, gst_amount: 180, total: 1180, status: 'issued',
    issued_at: new Date(Date.now() - 3 * 86_400_000).toISOString(), due_date: new Date(Date.now() + 10 * 86_400_000).toISOString(),
    paid_at: null, voided_at: null, payment_method: null, payment_reference: null, void_reason: null, price_source: 'freight',
    ...over,
  };
}

function world(extra: Record<string, any[]> = {}) {
  supabaseMock.reset(cargoWorld({
    customer_bookings: [
      { id: ID.booking1, customer_id: ID.customer, shipment_id: ID.s1, tracking_id: 'RTX-A', status: 'delivered', pickup_name: 'A', drop_name: 'B', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { id: 'bb000000-0000-4000-8000-000000000002', customer_id: ID.otherCustomer, shipment_id: ID.s2, tracking_id: 'RTX-B', status: 'delivered', pickup_name: 'C', drop_name: 'D', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ],
    invoices: [invoice(INV, ID.s1), invoice(OTHER_INV, ID.s2), invoice(VOID_INV, ID.s1, { status: 'void' }), invoice(VENDOR_INV, ID.s1, { vendor_id: ID.vendor })],
    invoice_payment_reports: [],
    ...extra,
  }));
}

describe('customer name shown to staff', () => {
  it('is the company, else the name, else the phone-based label', () => {
    expect(customerDisplayName({ company_name: 'Rao Traders', full_name: 'Rao', phone: '+919800007701' })).toBe('Rao Traders');
    expect(customerDisplayName({ company_name: null, full_name: 'Meera Rao', phone: '+919800007701' })).toBe('Meera Rao');
    expect(customerDisplayName({ company_name: ' ', full_name: 'Customer 7701', phone: '+919800007701' })).toBe('Customer 7701');
    expect(customerDisplayName({ phone: null })).toBe('Customer');
  });

  it('is used on the staff booking list', async () => {
    world();
    Object.assign(one('customers', ID.customer), { company_name: 'Rao Traders' });
    one('customers', ID.otherCustomer).full_name = 'Customer 0002';
    const res = await request(app).get(api('/bookings')).set(auth.admin());
    const names = res.body.map((b: any) => b.customer.name).sort();
    expect(names).toEqual(['Customer 0002', 'Rao Traders']);
  });
});

describe('GET and PATCH /customer/profile', () => {
  beforeEach(() => world());
  const patch = (body: object, headers = auth.customer()) => request(app).patch(api('/customer/profile')).set(headers).send(body);

  it('saves trimmed values, a canonical state and an upper-case GSTIN, and returns the profile', async () => {
    const res = await patch({ full_name: '  Meera Rao ', company_name: ' Rao Traders ', gstin: ` ${GSTIN_MH.toLowerCase()} `, email: 'meera@rao.in', billing_address: ' 12 MG Road ', city: 'Pune', state: 'maharashtra', pincode: '411001' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ full_name: 'Meera Rao', company_name: 'Rao Traders', gstin: GSTIN_MH, state: 'Maharashtra', billing_address: '12 MG Road', display_name: 'Rao Traders', billing_ready: true });
    expect(one('customers', ID.customer)).toMatchObject({ gstin: GSTIN_MH, state: 'Maharashtra', full_name: 'Meera Rao' });
    expect((await request(app).get(api('/customer/profile')).set(auth.customer())).body.gstin).toBe(GSTIN_MH);
  });

  it('answers 422 with a message for a bad GSTIN, PIN code, state or email, and saves nothing', async () => {
    for (const [body, message] of [
      [{ gstin: '27AAACR5055K1Z8' }, /last character/],
      [{ gstin: 'NOTAGSTIN' }, /15 characters/],
      [{ pincode: '01234' }, /6-digit PIN/],
      [{ pincode: '4110' }, /6-digit PIN/],
      [{ state: 'Narnia' }, /state from the list/],
      [{ email: 'nope' }, /valid email/],
      [{ gstin: GSTIN_GJ, state: 'Maharashtra' }, /registered in Gujarat/],
    ] as const) {
      const res = await patch(body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(res.body.detail ?? res.body.message ?? JSON.stringify(res.body)).toMatch(message);
    }
    expect(one('customers', ID.customer).gstin).toBeUndefined();
  });

  it('clears a field with an empty value, and refuses unknown fields such as phone', async () => {
    await patch({ company_name: 'Rao Traders', city: 'Pune' });
    expect((await patch({ city: '' })).body.city).toBeNull();
    expect((await patch({ phone: '+919999999999' })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
    expect(one('customers', ID.customer).phone).toBe('+919800000001');
  });

  it('shows the sign-up placeholder as no name', async () => {
    one('customers', ID.customer).full_name = 'Customer 0001';
    const res = await request(app).get(api('/customer/profile')).set(auth.customer());
    expect(res.body).toMatchObject({ full_name: null, display_name: 'Customer 0001' });
  });

  it('only ever reads and writes the signed-in customer\'s own row, and only for customers', async () => {
    await patch({ company_name: 'Mine' });
    expect(one('customers', ID.otherCustomer).company_name).toBeUndefined();
    expect((await request(app).get(api('/customer/profile')).set(auth.driver())).status).toBe(403);
    expect((await request(app).get(api('/customer/profile'))).status).toBe(401);
  });
});

describe('staff view and edit a customer\'s profile', () => {
  beforeEach(() => world());
  const url = (id = ID.customer) => api(`/bookings/customers/${id}/profile`);

  it('reads and edits it with the same checks, and customers cannot use it', async () => {
    const res = await request(app).patch(url()).set(auth.admin()).send({ company_name: 'Rao Traders', gstin: GSTIN_GJ });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ company_name: 'Rao Traders', gstin: GSTIN_GJ });
    expect((await request(app).patch(url()).set(auth.admin()).send({ gstin: 'bad' })).status).toBe(422);
    expect((await request(app).get(url()).set(auth.admin())).body.display_name).toBe('Rao Traders');
    expect((await request(app).get(url('not-a-uuid')).set(auth.admin())).status).toBe(404);
    expect((await request(app).get(url()).set(auth.customer())).status).toBe(403);
  });
});

describe('invoices use the customer profile (bill_to and the GST split)', () => {
  const issued = () => supabaseMock.rows('invoices').find(i => i.shipment_id === ID.s1)!;
  const deliver = () => { world({ invoices: [] }); Object.assign(one('shipments', ID.s1), { status: 'delivered', freight_charge: 10000 }); supabaseMock.rows('shipment_hsn').splice(0); supabaseMock.rows('shipment_hsn').push({ id: 'h1', shipment_id: ID.s1, hsn_code: '8471', gst_rate: 18 }); };

  it('bills the company with GSTIN and address, and splits CGST + SGST for a buyer in the seller\'s state', async () => {
    deliver();
    Object.assign(one('customers', ID.customer), { company_name: 'Rao Traders', gstin: GSTIN_MH, billing_address: '12 MG Road', city: 'Pune', state: 'Maharashtra', pincode: '411001', email: 'a@b.in' });
    await InvoiceService.createForShipment(ID.s1);
    expect(issued().bill_to).toMatchObject({ kind: 'customer', name: 'Rao Traders', gstin: GSTIN_MH, address: '12 MG Road, Pune, Maharashtra, 411001', state: 'Maharashtra', state_code: '27', email: 'a@b.in' });
    const res = await request(app).get(api(`/invoices/${issued().id}`)).set(auth.admin());
    expect(res.body.tax).toMatchObject({ basis: 'intra', cgst: 900, sgst: 900, igst: 0 });
  });

  it('charges IGST for a buyer in another state', async () => {
    deliver();
    Object.assign(one('customers', ID.customer), { company_name: 'Patel Exports', gstin: GSTIN_GJ, billing_address: '5 CG Road', state: 'Gujarat' });
    await InvoiceService.createForShipment(ID.s1);
    const res = await request(app).get(api(`/invoices/${issued().id}`)).set(auth.admin());
    expect(res.body.tax).toMatchObject({ basis: 'inter', igst: 1800, cgst: 0 });
    expect(res.body.buyer).toMatchObject({ name: 'Patel Exports', state_code: '24' });
  });

  it('uses the chosen state when there is no GSTIN, and leaves the place of supply unknown with neither', async () => {
    deliver();
    Object.assign(one('customers', ID.customer), { full_name: 'Meera Rao', state: 'Gujarat' });
    await InvoiceService.createForShipment(ID.s1);
    expect(issued().bill_to).toMatchObject({ name: 'Meera Rao', gstin: null, state_code: '24' });
    expect((await request(app).get(api(`/invoices/${issued().id}`)).set(auth.admin())).body.tax.basis).toBe('inter');

    deliver();
    await InvoiceService.createForShipment(ID.s1);
    expect((await request(app).get(api(`/invoices/${issued().id}`)).set(auth.admin())).body.tax.basis).toBe('unknown');
  });

  it('does not rewrite an invoice already issued when the profile changes later', async () => {
    deliver();
    Object.assign(one('customers', ID.customer), { company_name: 'Rao Traders', gstin: GSTIN_MH, billing_address: '12 MG Road', state: 'Maharashtra' });
    await InvoiceService.createForShipment(ID.s1);
    Object.assign(one('customers', ID.customer), { company_name: 'Renamed Ltd', gstin: GSTIN_GJ, state: 'Gujarat' });
    const res = await request(app).get(api(`/invoices/${issued().id}`)).set(auth.admin());
    expect(res.body.buyer).toMatchObject({ name: 'Rao Traders', gstin: GSTIN_MH });
    expect(res.body.tax.basis).toBe('intra');
  });
});

describe('POST /customer/invoices/:id/reports', () => {
  beforeEach(() => world());
  const post = (id: string, body: object, headers = auth.customer()) => request(app).post(api(`/customer/invoices/${id}/reports`)).set(headers).send(body);
  const payment = (over: object = {}) => ({ kind: 'payment', amount: 1180, paid_on: today(), method: 'upi', reference: 'UTR123456789', ...over });

  it('saves a payment report on their own invoice and tells staff', async () => {
    const res = await post(INV, payment());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ invoice_id: INV, customer_id: ID.customer, kind: 'payment', status: 'open', amount: 1180, method: 'upi', reference: 'UTR123456789' });
    const note = notesFor(ID.admin).find(n => n.type === 'invoice_payment_reported')!;
    expect(note.data).toMatchObject({ invoice_id: INV, report_id: res.body.id });
    expect(note.body).toContain('UTR123456789');
  });

  it('saves a question and tells staff', async () => {
    const res = await post(INV, { kind: 'query', message: '  Why is GST charged twice?  ' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: 'query', message: 'Why is GST charged twice?', status: 'open' });
    expect(notesFor(ID.admin).some(n => n.type === 'invoice_query' && n.data.invoice_id === INV)).toBe(true);
  });

  it('refuses another customer\'s invoice, a vendor invoice and an unknown one with the same 404', async () => {
    for (const id of [OTHER_INV, VENDOR_INV, 'f1000000-0000-4000-8000-0000000000ff', 'nope']) {
      expect((await post(id, payment())).status, id).toBe(404);
    }
    expect((await post(INV, payment(), auth.customer(ID.otherCustomer))).status).toBe(404);
    expect(supabaseMock.rows('invoice_payment_reports')).toHaveLength(0);
  });

  it('refuses a void invoice (409) and one that is already paid, for a payment', async () => {
    expect((await post(VOID_INV, payment())).status).toBe(409);
    expect((await post(VOID_INV, { kind: 'query', message: 'Hello?' })).status).toBe(409);
    one('invoices', INV).status = 'paid';
    expect((await post(INV, payment())).status).toBe(409);
    expect((await post(INV, { kind: 'query', message: 'Where is my receipt?' })).status).toBe(201);
  });

  it('refuses a payment above what is outstanding, and bad input, with 422', async () => {
    const over = await post(INV, payment({ amount: 1180.01 }));
    expect(over.status).toBe(422);
    expect(over.body.detail ?? over.body.message).toMatch(/more than what is due/);
    for (const bad of [{ amount: 0 }, { amount: -5 }, { amount: 10.123 }, { paid_on: '2999-01-01' }, { paid_on: '2020-01-01' }, { method: 'barter' }, { reference: '' }]) {
      expect((await post(INV, payment(bad))).status, JSON.stringify(bad)).toBe(422);
    }
    expect((await post(INV, { kind: 'query', message: 'x' })).status).toBe(422);
    expect((await post(INV, {})).status).toBe(422);
    expect((await post(INV, payment({ amount: 500 }))).status).toBe(201);
  });

  it('refuses the same reference twice while the first is open, and a replay with the same key is one report', async () => {
    expect((await post(INV, payment())).status).toBe(201);
    expect((await post(INV, payment())).status).toBe(409);
    const key = { 'Idempotency-Key': 'report-key-0001' };
    const a = await request(app).post(api(`/customer/invoices/${INV}/reports`)).set({ ...auth.customer(), ...key }).send({ kind: 'query', message: 'Please resend' });
    const b = await request(app).post(api(`/customer/invoices/${INV}/reports`)).set({ ...auth.customer(), ...key }).send({ kind: 'query', message: 'Please resend' });
    expect(a.body.id).toBe(b.body.id);
    expect(supabaseMock.rows('invoice_payment_reports').filter(r => r.kind === 'query')).toHaveLength(1);
  });

  it('lists only their own reports, for an invoice or all', async () => {
    await post(INV, payment());
    await request(app).post(api(`/customer/invoices/${OTHER_INV}/reports`)).set(auth.customer(ID.otherCustomer)).send({ kind: 'query', message: 'Their question' });
    const mine = await request(app).get(api(`/customer/invoices/${INV}/reports`)).set(auth.customer());
    expect(mine.body).toHaveLength(1);
    expect((await request(app).get(api(`/customer/invoices/${OTHER_INV}/reports`)).set(auth.customer())).status).toBe(404);
    expect((await request(app).post(api(`/customer/invoices/${INV}/reports`)).set(auth.driver()).send(payment())).status).toBe(403);
  });
});

describe('staff handle customer reports', () => {
  beforeEach(() => world());
  const report = async (body: object) => (await request(app).post(api(`/customer/invoices/${INV}/reports`)).set(auth.customer()).send(body)).body;
  const act = (id: string, what: 'confirm' | 'reject' | 'answer', body: object = {}, headers = auth.admin()) =>
    request(app).post(api(`/finance/invoice-reports/${id}/${what}`)).set(headers).send(body);
  const pay = { kind: 'payment', amount: 1180, paid_on: today(), method: 'neft', reference: 'NEFT998877' };

  it('lists open reports with the invoice and the customer\'s name, and counts them in the summary', async () => {
    one('customers', ID.customer).company_name = 'Rao Traders';
    await report(pay);
    await report({ kind: 'query', message: 'Why?' });
    const list = await request(app).get(api('/finance/invoice-reports?status=open')).set(auth.admin());
    expect(list.body).toHaveLength(2);
    expect(list.body[0]).toMatchObject({ invoice_number: 'INV-1', customer_name: 'Rao Traders', invoice_total: 1180 });
    expect((await request(app).get(api('/finance/invoice-reports?status=open&kind=payment')).set(auth.admin())).body).toHaveLength(1);
    const summary = await request(app).get(api('/finance/invoices/summary')).set(auth.admin());
    expect(summary.body).toMatchObject({ open_reports: 2, open_payment_reports: 1 });
    const invoices = await request(app).get(api('/finance/invoices?reports=open')).set(auth.admin());
    expect(invoices.body.map((i: any) => [i.id, i.open_reports])).toEqual([[INV, 2]]);
    expect((await request(app).get(api('/finance/invoice-reports')).set(auth.customer())).status).toBe(403);
  });

  it('confirm records the payment once through the mark-paid path, even when repeated', async () => {
    const r = await report(pay);
    const first = await act(r.id, 'confirm');
    expect(first.status).toBe(200);
    expect(first.body.report).toMatchObject({ status: 'confirmed', handled_by: ID.admin });
    expect(first.body.recorded).toBe(true);
    expect(one('invoices', INV)).toMatchObject({ status: 'paid', payment_method: 'bank', payment_reference: 'NEFT998877' });
    const paidAt = one('invoices', INV).paid_at;

    const again = await act(r.id, 'confirm');
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ recorded: false, report: { status: 'confirmed' } });
    expect(one('invoices', INV).paid_at).toBe(paidAt);
    expect(supabaseMock.rows('ai_agent_logs').filter(a => a.action === 'invoice_paid')).toHaveLength(1);
    // The customer is told once
    expect(notesFor(ID.customer).filter(n => n.type === 'payment_report_confirmed')).toHaveLength(1);
    expect(notesFor(ID.customer).find(n => n.type === 'payment_report_confirmed')!.data).toMatchObject({ invoice_id: INV, report_id: r.id });
  });

  it('confirm of an invoice staff already marked paid only confirms the report', async () => {
    const r = await report(pay);
    one('invoices', INV).status = 'paid';
    const res = await act(r.id, 'confirm');
    expect(res.body).toMatchObject({ recorded: false, report: { status: 'confirmed' } });
  });

  it('confirm refuses a part payment, a void invoice and a query; staff may correct the method', async () => {
    const part = await report({ ...pay, amount: 500, reference: 'NEFT1' });
    const partRes = await act(part.id, 'confirm');
    expect(partRes.status).toBe(409);
    expect(partRes.body.detail ?? partRes.body.message).toMatch(/Part payments/);
    expect(one('invoices', INV).status).toBe('issued');

    const other = await report({ kind: 'payment', amount: 1180, paid_on: today(), method: 'other' });
    expect((await act(other.id, 'confirm')).status).toBe(400);
    const ok = await act(other.id, 'confirm', { method: 'cash', note: 'Collected at the office' });
    expect(ok.status).toBe(200);
    expect(one('invoices', INV)).toMatchObject({ status: 'paid', payment_method: 'cash' });

    const q = await report({ kind: 'query', message: 'Hello there' });
    expect((await act(q.id, 'confirm')).status).toBe(409);
  });

  it('reject needs a reason, tells the customer, and leaves the invoice unpaid', async () => {
    const r = await report(pay);
    expect((await act(r.id, 'reject', {})).status).toBe(400);
    const res = await act(r.id, 'reject', { reason: 'No such transfer in our bank' });
    expect(res.body).toMatchObject({ status: 'rejected', staff_note: 'No such transfer in our bank' });
    expect(one('invoices', INV).status).toBe('issued');
    const note = notesFor(ID.customer).find(n => n.type === 'payment_report_rejected')!;
    expect(note.body).toContain('No such transfer in our bank');
    expect(note.data).toMatchObject({ invoice_id: INV });
    expect((await act(r.id, 'confirm')).status).toBe(409);
  });

  it('answer replies to a query and tells the customer, and is not a payment action', async () => {
    const q = await report({ kind: 'query', message: 'Why is GST charged?' });
    expect((await act(q.id, 'answer', {})).status).toBe(400);
    const res = await act(q.id, 'answer', { answer: 'GST at 18% applies to freight.' });
    expect(res.body).toMatchObject({ status: 'answered', staff_note: 'GST at 18% applies to freight.' });
    expect(notesFor(ID.customer).find(n => n.type === 'invoice_query_answered')!.body).toContain('18%');
    const p = await report(pay);
    expect((await act(p.id, 'answer', { answer: 'x' })).status).toBe(409);
  });

  it('is for admins only, and an unknown report is a 404', async () => {
    const r = await report(pay);
    expect((await act(r.id, 'confirm', {}, auth.customer())).status).toBe(403);
    expect((await act(r.id, 'confirm', {}, auth.driver())).status).toBe(403);
    expect((await act('f1000000-0000-4000-8000-0000000000ee', 'confirm')).status).toBe(404);
    expect(one('invoices', INV).status).toBe('issued');
  });

  it('Today counts open payment reports for admins', async () => {
    await report(pay);
    await report({ kind: 'query', message: 'Why?' });
    const res = await request(app).get(api('/ops/today')).set(auth.admin());
    expect(res.status).toBe(200);
    expect(res.body.queues.payment_reports).toEqual({ count: 1 });
  });
});

describe('PATCH /customer/profile leaves the fields that were not sent alone', () => {
  it('changes only what is sent', async () => {
    world();
    const patch = (body: object) => request(app).patch(api('/customer/profile')).set(auth.customer()).send(body);
    await patch({ company_name: 'Rao Traders', city: 'Pune', gstin: GSTIN_MH });
    const res = await patch({ city: 'Mumbai' });
    expect(res.body).toMatchObject({ company_name: 'Rao Traders', city: 'Mumbai', gstin: GSTIN_MH });
  });
});
