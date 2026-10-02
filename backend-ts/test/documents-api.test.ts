/**
 * Shipment documents over HTTP (mocked Supabase): permissions by organisation, recording and versioning,
 * LR generation and numbering, the dispatch checklist, the settlement and its close, the timeline.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock, type Row } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { ORG, ORGS, as, orgWorld, uid } from './support/org-world';

const app = testApp();
const api = (p: string) => `/api/v1/loads${p}`;

const LOAD = 'ab000000-0000-4000-8000-000000000001';
const MAN = 'aa110000-0000-4000-8000-000000000001';
const VEH = 'a1000000-0000-4000-8000-000000000001';
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const vendor = () => as('vendor-1', ORG.vendorV);
const carrier = () => as('admin-a', ORG.companyA);
const other = () => as('admin-b', ORG.companyB);
const platform = () => as('super-1', ORG.platform);

function world(over: { load?: Row; vehicle?: Row; orgs?: Row[]; extra?: Record<string, Row[]> } = {}) {
  supabaseMock.reset(orgWorld({
    organizations: over.orgs ?? ORGS.map(o => ({ ...o })),
    vendor_shipment_requests: [{
      id: LOAD, vendor_id: uid('vendor-1'), vendor_org_id: ORG.vendorV, status: 'assigned', assigned_vehicle_id: VEH, cost: 25000,
      pickup_location: 'Pune', drop_location: 'Mumbai', required_capacity_kg: 5200,
      metadata: { cargo: { category: 'Cement', noOfPackages: 120, declaredValue: 20000 } },
      created_at: '2026-10-01T06:00:00.000Z', updated_at: '2026-10-01T07:00:00.000Z', ...over.load,
    }],
    cargo_manifest: [{ id: MAN, vendor_request_id: LOAD, vehicle_id: VEH, current_vehicle_id: VEH, carrier_org_id: ORG.companyA, vendor_org_id: ORG.vendorV, status: 'in_transit', pieces_total: 120, pieces_delivered: 0, created_at: '2026-10-01T08:00:00.000Z' }],
    vehicles: [{
      id: VEH, plate_number: 'MH12AB1234', capacity_kg: 6000, vehicle_type: 'truck', carrier_org_id: ORG.companyA, driver_id: uid('driver-a'),
      rc_expiry: day(400), insurance_expiry: day(200), fitness_expiry: day(200), puc_expiry: day(100), ...over.vehicle,
    }],
    user_documents: [{ id: 'ud1', user_id: uid('driver-a'), doc_type: 'driving_licence', status: 'verified', expires_on: day(500), metadata: {}, archived_at: null }],
    load_documents: [], load_document_events: [], trip_settlements: [],
    cargo_custody_events: [], cargo_exception_items: [], cargo_exceptions: [],
    ...over.extra,
  }));
}

const eway = (vehicle_number = 'MH12AB1234', validDays = 2) => ({
  kind: 'eway_bill', valid_until: new Date(Date.now() + validDays * 86_400_000).toISOString(),
  fields: { ewb_number: '123456789012', vehicle_number, transporter_name: 'Alpha Logistics', approx_distance_km: 150 },
});
const invoice = (over: Row = {}) => ({ kind: 'tax_invoice', number: 'INV-100', doc_date: '2026-10-01', fields: { seller_name: 'Acme Traders', total_value: 20000 }, ...over });

const pdfBody = (res: any, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

const delivered = (over: Row = {}): Row => ({
  id: 'ce-1', manifest_id: MAN, kind: 'delivery', pieces: 118, weight_kg: 5100, condition: 'good', receiver_name: 'Store manager', notes: null,
  photo_paths: [], signature_path: null, recorded_by: uid('driver-a'), recorded_role: 'driver', recorded_at: '2026-10-02T10:00:00.000Z', ...over,
});

beforeEach(() => world());

describe('who may reach a load', () => {
  it('lets the vendor, the carrier and a platform admin read; another company gets 404', async () => {
    for (const who of [vendor(), carrier(), platform()]) {
      const res = await request(app).get(api(`/${LOAD}/documents`)).set(who);
      expect(res.status).toBe(200);
      expect(res.body.documents).toEqual([]);
    }
    expect((await request(app).get(api(`/${LOAD}/documents`)).set(vendor())).body.load).toMatchObject({ id: LOAD, viewer: 'vendor', carrier_org_id: ORG.companyA });
    expect((await request(app).get(api(`/${LOAD}/documents`)).set(platform())).body.load.viewer).toBe('platform');
    for (const path of ['/documents', '/dispatch-check', '/settlement', '/timeline']) {
      expect((await request(app).get(api(`/${LOAD}${path}`)).set(other())).status, path).toBe(404);
    }
    expect((await request(app).post(api(`/${LOAD}/documents`)).set(other()).send(invoice())).status).toBe(404);
    expect((await request(app).get(api('/not-a-uuid/documents')).set(carrier())).status).toBe(404);
    expect((await request(app).get(api('/ab000000-0000-4000-8000-0000000000ff/documents')).set(carrier())).status).toBe(404);
    expect((await request(app).get(api(`/${LOAD}/documents`))).status).toBe(401);
  });

  it('a 3PL partner that does not carry the load gets 404 too', async () => {
    expect((await request(app).get(api(`/${LOAD}/documents`)).set(as('tpl-1', ORG.tplT))).status).toBe(404);
  });

  it('the vendor cannot generate an LR or touch the settlement; a platform admin cannot write', async () => {
    expect((await request(app).post(api(`/${LOAD}/documents/generate/lr`)).set(vendor()).send({})).status).toBe(403);
    expect((await request(app).post(api(`/${LOAD}/settlement`)).set(vendor()).send({})).status).toBe(403);
    expect((await request(app).post(api(`/${LOAD}/settlement/close`)).set(vendor()).send({})).status).toBe(403);
    expect((await request(app).post(api(`/${LOAD}/documents/generate/lr`)).set(platform()).send({})).status).toBe(403);
    expect((await request(app).post(api(`/${LOAD}/documents`)).set(platform()).send(invoice())).status).toBe(403);
    // The vendor may only record its own papers
    const lr = await request(app).post(api(`/${LOAD}/documents`)).set(vendor()).send({ kind: 'lr', fields: {} });
    expect(lr.status).toBe(403);
    expect(supabaseMock.rows('load_documents')).toHaveLength(0);
  });
});

describe('recording documents and their history', () => {
  it('the vendor uploads an invoice and an e-way bill; the load then shows them to the carrier', async () => {
    const inv = await request(app).post(api(`/${LOAD}/documents`)).set(vendor()).send(invoice());
    expect(inv.status).toBe(201);
    expect(inv.body).toMatchObject({ kind: 'tax_invoice', number: 'INV-100', status: 'final', version: 1, org_id: ORG.vendorV, vendor_org_id: ORG.vendorV, carrier_org_id: ORG.companyA, created_by: uid('vendor-1') });
    const ewb = await request(app).post(api(`/${LOAD}/documents`)).set(vendor()).send(eway());
    expect(ewb.status).toBe(201);
    expect(ewb.body).toMatchObject({ kind: 'eway_bill', number: '123456789012', expired: false });
    const list = await request(app).get(api(`/${LOAD}/documents`)).set(carrier());
    expect(list.body.documents.map((d: any) => d.kind)).toEqual(['tax_invoice', 'eway_bill']);
  });

  it('validates each kind: a bad e-way bill number, a missing invoice number and a path from another load are 400', async () => {
    const post = (b: object) => request(app).post(api(`/${LOAD}/documents`)).set(vendor()).send(b);
    expect((await post({ ...eway(), fields: { ...eway().fields, ewb_number: '12345' } })).status).toBe(400);
    expect((await post({ kind: 'eway_bill', fields: eway().fields })).body.detail).toMatch(/valid_until/);
    expect((await post({ kind: 'tax_invoice', fields: {} })).body.detail).toMatch(/number/);
    expect((await post({ kind: 'tax_invoice', number: 'X', file_path: 'loads/other-load/tax_invoice/a.pdf' })).status).toBe(400);
    expect((await post({ kind: 'nonsense' })).status).toBe(400);
    expect(supabaseMock.rows('load_documents')).toHaveLength(0);
  });

  it('every update is a new version with who, when and what changed', async () => {
    const created = (await request(app).post(api(`/${LOAD}/documents`)).set(vendor()).send(eway('MH12AB1234'))).body;
    const upd = await request(app).patch(api(`/${LOAD}/documents/${created.id}`)).set(carrier()).send({ fields: { vehicle_number: 'mh14 xy 9999' } });
    expect(upd.status).toBe(200);
    expect(upd.body).toMatchObject({ version: 2, updated_by: uid('admin-a') });
    expect(upd.body.fields.vehicle_number).toBe('MH14XY9999');
    // A change that changes nothing writes nothing
    const same = await request(app).patch(api(`/${LOAD}/documents/${created.id}`)).set(carrier()).send({ fields: { vehicle_number: 'MH14XY9999' } });
    expect(same.body.version).toBe(2);

    const hist = await request(app).get(api(`/${LOAD}/documents/${created.id}/history`)).set(vendor());
    expect(hist.status).toBe(200);
    expect(hist.body.events).toHaveLength(2);
    const [latest, first] = hist.body.events;
    expect(latest).toMatchObject({ action: 'updated', version: 2, by: uid('admin-a'), by_name: 'Asha Alpha', by_role: 'carrier' });
    expect(latest.changes['fields.vehicle_number']).toEqual({ from: 'MH12AB1234', to: 'MH14XY9999' });
    expect(first).toMatchObject({ action: 'created', version: 1, by: uid('vendor-1'), by_role: 'vendor' });
    expect(latest.at).toBeTruthy();
  });

  it('the vendor can update its own upload but not a document the carrier issued; cancelled is a status change', async () => {
    const inv = (await request(app).post(api(`/${LOAD}/documents`)).set(vendor()).send(invoice())).body;
    expect((await request(app).patch(api(`/${LOAD}/documents/${inv.id}`)).set(vendor()).send({ number: 'INV-101' })).body.number).toBe('INV-101');
    const cancel = await request(app).patch(api(`/${LOAD}/documents/${inv.id}`)).set(vendor()).send({ status: 'cancelled' });
    expect(cancel.body.status).toBe('cancelled');
    expect(supabaseMock.rows('load_document_events').at(-1)).toMatchObject({ action: 'status' });
    expect((await request(app).patch(api(`/${LOAD}/documents/${inv.id}`)).set(vendor()).send({ status: 'expired' })).status).toBe(400);

    supabaseMock.onRpc('next_lr_number', () => 1);
    const lr = (await request(app).post(api(`/${LOAD}/documents/generate/lr`)).set(carrier()).send({})).body;
    expect((await request(app).patch(api(`/${LOAD}/documents/${lr.id}`)).set(vendor()).send({ fields: { remarks: 'x' } })).status).toBe(403);
    expect((await request(app).patch(api(`/${LOAD}/documents/${lr.id}`)).set(other()).send({ fields: { remarks: 'x' } })).status).toBe(404);
  });

  it('an e-way bill past its validity reads as expired', async () => {
    const created = (await request(app).post(api(`/${LOAD}/documents`)).set(vendor()).send({ ...eway(), valid_until: new Date(Date.now() - 3_600_000).toISOString() })).body;
    expect(created).toMatchObject({ expired: true, effective_status: 'expired', status: 'final' });
  });

  it('issues a signed upload URL for one path in the load folder, for PDF, JPG or PNG', async () => {
    const ok = await request(app).post(api(`/${LOAD}/documents/upload-url`)).set(vendor()).send({ kind: 'tax_invoice', content_type: 'application/pdf', size: 1000 });
    expect(ok.status).toBe(200);
    expect(ok.body.path).toMatch(new RegExp(`^loads/${LOAD}/tax_invoice/[0-9a-f-]+\\.pdf$`));
    expect(ok.body).toMatchObject({ bucket: 'load_documents' });
    expect(ok.body.upload_url).toBeTruthy();
    expect(ok.body.token).toBeTruthy();
    expect(supabaseMock.signedUploads).toContain(`load_documents/${ok.body.path}`);
    expect((await request(app).post(api(`/${LOAD}/documents/upload-url`)).set(vendor()).send({ kind: 'tax_invoice', content_type: 'text/html', size: 10 })).status).toBe(415);
    expect((await request(app).post(api(`/${LOAD}/documents/upload-url`)).set(vendor()).send({ kind: 'tax_invoice', content_type: 'application/pdf', size: 50_000_000 })).status).toBe(413);
    expect((await request(app).post(api(`/${LOAD}/documents/upload-url`)).set(vendor()).send({ kind: 'lr', content_type: 'application/pdf', size: 10 })).status).toBe(403);
    expect((await request(app).post(api(`/${LOAD}/documents/upload-url`)).set(other()).send({ kind: 'tax_invoice', content_type: 'application/pdf', size: 10 })).status).toBe(404);
    // The uploaded file is then recorded with its path and shown through a signed link
    const rec = await request(app).post(api(`/${LOAD}/documents`)).set(vendor()).send(invoice({ file_path: ok.body.path }));
    expect(rec.status).toBe(201);
    expect(rec.body.file_url).toContain('token=');
    expect(supabaseMock.rows('load_document_events')[0].action).toBe('uploaded');
    const pdf = await request(app).get(api(`/${LOAD}/documents/${rec.body.id}/pdf`)).set(carrier());
    expect(pdf.body.url).toContain('token=');
  });
});

describe('generated documents', () => {
  it('generates the LR from the load, transporter, route, goods and vehicle, numbered LR-YYYY-NNNNN', async () => {
    supabaseMock.onRpc('next_lr_number', () => 7);
    await request(app).post(api(`/${LOAD}/documents`)).set(vendor()).send(invoice());
    const res = await request(app).post(api(`/${LOAD}/documents/generate/lr`)).set(carrier()).send({});
    expect(res.status).toBe(201);
    const year = new Date(Date.now() + 330 * 60_000).getUTCFullYear();
    expect(res.body.number).toBe(`LR-${year}-00007`);
    expect(res.body).toMatchObject({ kind: 'lr', status: 'final', version: 1, org_id: ORG.companyA, generated: true });
    expect(res.body.fields).toMatchObject({
      transporter_name: 'Alpha Logistics', consignor_name: 'Acme Traders', pickup_address: 'Pune', delivery_address: 'Mumbai',
      vehicle_number: 'MH12AB1234', packages: 120, actual_weight_kg: 5200, freight_amount: 25000, invoice_number: 'INV-100',
    });
    expect(supabaseMock.rpcCalls).toEqual([{ name: 'next_lr_number', fn: 'next_lr_number', args: { p_org: ORG.companyA, p_prefix: 'LR', p_year: year } }]);

    // Generating again keeps the number and consumes none
    const again = await request(app).post(api(`/${LOAD}/documents/generate/lr`)).set(carrier()).send({});
    expect(again.body.number).toBe(`LR-${year}-00007`);
    expect(supabaseMock.rpcCalls).toHaveLength(1);
    expect(supabaseMock.rows('load_documents').filter(d => d.kind === 'lr')).toHaveLength(1);

    // The company's own prefix, and an override of a value taken from the load
    supabaseMock.reset(orgWorld({ ...Object.fromEntries(['vendor_shipment_requests', 'cargo_manifest', 'vehicles', 'load_documents', 'load_document_events'].map(t => [t, supabaseMock.rows(t).map(r => ({ ...r }))])), organizations: ORGS.map(o => (o.id === ORG.companyA ? { ...o, profile: { lr_prefix: 'alp' } } : { ...o })) }));
    supabaseMock.rows('load_documents').length = 0;
    supabaseMock.onRpc('next_lr_number', () => 1);
    const prefixed = await request(app).post(api(`/${LOAD}/documents/generate/lr`)).set(carrier()).send({ overrides: { payment_terms: 'paid' } });
    expect(prefixed.body.number).toBe(`ALP-${year}-00001`);
    expect(prefixed.body.fields.payment_terms).toBe('paid');
  });

  it('refuses an LR before a company has accepted the load', async () => {
    world({ load: { status: 'pending', assigned_vehicle_id: null }, extra: { cargo_manifest: [] } });
    // With no manifest or vehicle, no company carries the load, so nobody on the carrier side can reach it
    expect((await request(app).post(api(`/${LOAD}/documents/generate/lr`)).set(carrier()).send({})).status).toBe(404);
  });

  it('renders the LR as a PDF, to every side that may read it', async () => {
    supabaseMock.onRpc('next_lr_number', () => 3);
    const lr = (await request(app).post(api(`/${LOAD}/documents/generate/lr`)).set(carrier()).send({})).body;
    for (const who of [carrier(), vendor(), platform()]) {
      const res = await request(app).get(api(`/${LOAD}/documents/${lr.id}/pdf`)).set(who).buffer(true).parse(pdfBody);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/pdf/);
      expect(res.body.length).toBeGreaterThan(1000);
      expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
    }
    expect((await request(app).get(api(`/${LOAD}/documents/${lr.id}/pdf`)).set(other())).status).toBe(404);
  });

  it('generates the freight sheet from the agreed freight and the advance', async () => {
    supabaseMock.onRpc('next_lr_number', () => 2);
    await request(app).post(api(`/${LOAD}/settlement`)).set(carrier()).send({ advance_paid: 10000, payment_terms: 'to_pay' });
    const fs = await request(app).post(api(`/${LOAD}/documents/generate/freight_sheet`)).set(carrier()).send({});
    expect(fs.status).toBe(201);
    expect(fs.body.number).toMatch(/^FS-\d{4}-00002$/);
    expect(fs.body.fields).toMatchObject({ total_freight: 25000, paid_advance: 10000, amount_to_pay: 15000, payment_terms: 'to_pay', vehicle_number: 'MH12AB1234' });
    expect(supabaseMock.rpcCalls[0].args.p_prefix).toBe('FS');
    const pdf = await request(app).get(api(`/${LOAD}/documents/${fs.body.id}/pdf`)).set(vendor()).buffer(true).parse(pdfBody);
    expect(pdf.body.length).toBeGreaterThan(1000);
  });

  it('builds the loading and unloading reports from custody events, and 409 when none are recorded', async () => {
    expect((await request(app).post(api(`/${LOAD}/documents/generate/loading_report`)).set(carrier()).send({})).status).toBe(409);
    supabaseMock.rows('cargo_custody_events').push(
      { id: 'ce-0', manifest_id: MAN, kind: 'pickup', pieces: 120, weight_kg: 5200, condition: 'good', receiver_name: null, notes: null, photo_paths: ['cargo/a/p.jpg'], signature_path: null, recorded_by: uid('driver-a'), recorded_role: 'driver', recorded_at: '2026-10-01T09:00:00.000Z' },
      delivered({ condition: 'damaged_goods', notes: 'Two cartons wet' }),
    );
    const loading = await request(app).post(api(`/${LOAD}/documents/generate/loading_report`)).set(carrier()).send({});
    expect(loading.status).toBe(201);
    expect(loading.body.fields).toMatchObject({ loaded_quantity: 120, weight_kg: 5200, occurred_at: '2026-10-01T09:00:00.000Z' });
    const unloading = await request(app).post(api(`/${LOAD}/documents/generate/unloading_report`)).set(carrier()).send({});
    expect(unloading.body.fields).toMatchObject({ loaded_quantity: 118, confirmed_by: 'Store manager' });
    expect(unloading.body.fields.events).toHaveLength(1);
    for (const d of [loading.body, unloading.body]) {
      const pdf = await request(app).get(api(`/${LOAD}/documents/${d.id}/pdf`)).set(carrier()).buffer(true).parse(pdfBody);
      expect(pdf.body.length).toBeGreaterThan(1000);
    }
  });

  it('builds the damage report from exception cases and their items', async () => {
    expect((await request(app).post(api(`/${LOAD}/documents/generate/damage_report`)).set(carrier()).send({})).status).toBe(409);
    supabaseMock.rows('cargo_exceptions').push({ id: 'ex-1', code: 'EXC-0001', type: 'damage', severity: 'medium', status: 'open', description: 'Two cartons wet', owner_id: uid('admin-a'), resolution: null, created_at: '2026-10-02T11:00:00.000Z', resolved_at: null });
    supabaseMock.rows('cargo_exception_items').push({ id: 'ei-1', exception_id: 'ex-1', manifest_id: MAN, pieces_affected: 2, weight_affected_kg: 40, condition: 'wet', note: 'Rain', created_at: '2026-10-02T11:00:00.000Z' });
    const res = await request(app).post(api(`/${LOAD}/documents/generate/damage_report`)).set(carrier()).send({});
    expect(res.status).toBe(201);
    expect(res.body.fields).toMatchObject({ exception_type: 'damage', affected_quantity: 2, description: 'Two cartons wet', responsible_person: 'Asha Alpha' });
    expect(res.body.fields.items).toEqual([{ exception_code: 'EXC-0001', type: 'damage', pieces_affected: 2, weight_affected_kg: 40, condition: 'wet', note: 'Rain' }]);
    const pdf = await request(app).get(api(`/${LOAD}/documents/${res.body.id}/pdf`)).set(carrier()).buffer(true).parse(pdfBody);
    expect(pdf.body.length).toBeGreaterThan(1000);
  });

  it('shows the POD as a document over the custody delivery data: final when fully delivered, draft when part', async () => {
    expect((await request(app).post(api(`/${LOAD}/documents/generate/pod`)).set(carrier()).send({})).status).toBe(409);
    supabaseMock.rows('cargo_custody_events').push(delivered({ kind: 'partial_delivery', photo_paths: ['cargo/a/photo.jpg'] }));
    Object.assign(supabaseMock.rows('cargo_manifest')[0], { pieces_delivered: 100, pieces_short: 2, pieces_damaged: 1 });
    const part = await request(app).post(api(`/${LOAD}/documents/generate/pod`)).set(carrier()).send({});
    expect(part.body).toMatchObject({ kind: 'pod', status: 'draft' });
    expect(part.body.fields).toMatchObject({ receiver_name: 'Store manager', delivered_quantity: 100, shortage_quantity: 2, damaged_quantity: 1, complete: false });
    expect(part.body.evidence.photo_urls).toHaveLength(1);
    supabaseMock.rows('cargo_custody_events').push(delivered({ id: 'ce-2', recorded_at: '2026-10-02T12:00:00.000Z' }));
    const full = await request(app).post(api(`/${LOAD}/documents/generate/pod`)).set(carrier()).send({});
    expect(full.body).toMatchObject({ id: part.body.id, status: 'final', version: 2 });
  });

  it('only known kinds are generated; invoices are recorded, not generated', async () => {
    expect((await request(app).post(api(`/${LOAD}/documents/generate/tax_invoice`)).set(carrier()).send({})).status).toBe(404);
  });
});

describe('dispatch checklist', () => {
  const check = (who = carrier()) => request(app).get(api(`/${LOAD}/dispatch-check`)).set(who);
  const byKey = (body: any, key: string) => body.items.find((i: any) => i.key === key);

  it('flags the missing invoice and LR, warning only', async () => {
    const res = await check();
    expect(res.status).toBe(200);
    expect(byKey(res.body, 'invoice').status).toBe('missing');
    expect(byKey(res.body, 'lr').status).toBe('missing');
    expect(byKey(res.body, 'eway_bill').status).toBe('not_required');
    expect(res.body).toMatchObject({ mode: 'warn', can_dispatch: true, ready: false });
    expect(res.body.issues).toBe(2);
    // The vendor and platform read the same checklist
    expect((await check(vendor())).body.issues).toBe(2);
    expect((await check(platform())).status).toBe(200);
  });

  it('requires the e-way bill over Rs 50,000, flags it missing, then valid, expired and for the wrong vehicle', async () => {
    world({ load: { metadata: { cargo: { category: 'Steel', declaredValue: 75000 } } } });
    expect((await check()).body.eway).toMatchObject({ required: true, declared_value: 75000, threshold: 50000 });
    expect(byKey((await check()).body, 'eway_bill')).toMatchObject({ status: 'missing', required: true });

    const doc = (await request(app).post(api(`/${LOAD}/documents`)).set(vendor()).send(eway('MH12AB1234', 2))).body;
    let res = await check();
    expect(byKey(res.body, 'eway_bill').status).toBe('ok');
    expect(byKey(res.body, 'eway_bill_vehicle').status).toBe('ok');

    await request(app).patch(api(`/${LOAD}/documents/${doc.id}`)).set(carrier()).send({ fields: { vehicle_number: 'MH14XY9999' } });
    res = await check();
    expect(byKey(res.body, 'eway_bill_vehicle')).toMatchObject({ status: 'inconsistent' });

    await request(app).patch(api(`/${LOAD}/documents/${doc.id}`)).set(carrier()).send({ fields: { vehicle_number: 'MH12AB1234' }, valid_until: new Date(Date.now() - 3_600_000).toISOString() });
    res = await check();
    expect(byKey(res.body, 'eway_bill')).toMatchObject({ status: 'expired' });
  });

  it('takes the declared value from the posted load, hazardous goods at any value, and the invoice total as a fallback', async () => {
    world({ load: { special_handling: ['hazmat'], metadata: {} } });
    expect((await check()).body.eway).toMatchObject({ required: true });
    world({ load: { metadata: {} } });
    expect((await check()).body.eway.required).toBe(false);
    await request(app).post(api(`/${LOAD}/documents`)).set(vendor()).send(invoice({ fields: { total_value: 90000 } }));
    expect((await check()).body.eway).toMatchObject({ required: true, declared_value: 90000 });
  });

  it('reads vehicle documents and the driver licence', async () => {
    world({ vehicle: { insurance_expiry: day(-2), puc_expiry: null }, extra: { user_documents: [{ id: 'ud1', user_id: uid('driver-a'), doc_type: 'driving_licence', status: 'verified', expires_on: day(-10), metadata: {}, archived_at: null }] } });
    const res = await check();
    expect(byKey(res.body, 'vehicle_insurance').status).toBe('expired');
    expect(byKey(res.body, 'vehicle_puc').status).toBe('missing');
    expect(byKey(res.body, 'driver_licence').status).toBe('expired');
  });

  it('blocks dispatch only when the company has turned the setting on', async () => {
    const orgs = ORGS.map(o => (o.id === ORG.companyA ? { ...o, profile: { settings: { dispatch_block_on_missing_docs: true } } } : { ...o }));
    world({ orgs });
    const res = await check();
    expect(res.body).toMatchObject({ mode: 'block', can_dispatch: false });
    // Once nothing is missing, dispatch is allowed even with blocking on
    supabaseMock.onRpc('next_lr_number', () => 1);
    await request(app).post(api(`/${LOAD}/documents`)).set(vendor()).send(invoice());
    await request(app).post(api(`/${LOAD}/documents/generate/lr`)).set(carrier()).send({});
    const clear = await check();
    expect(clear.body).toMatchObject({ issues: 0, ready: true, mode: 'block', can_dispatch: true });
  });
});

describe('dispatch block at pickup', () => {
  const pickup = () => request(app).post('/api/v1/telemetry/driver-ping/complete-stop').set(as('driver-a', ORG.companyA)).send({ stop_id: `${MAN}_pickup`, status: 'completed' });
  const scheduled = { cargo_manifest: [{ id: MAN, vendor_request_id: LOAD, vehicle_id: VEH, current_vehicle_id: VEH, carrier_org_id: ORG.companyA, vendor_org_id: ORG.vendorV, status: 'scheduled', pieces_total: 120, pieces_delivered: 0, created_at: '2026-10-01T08:00:00.000Z' }] };
  const blocking = (on: boolean) => ORGS.map(o => (o.id === ORG.companyA ? { ...o, profile: { settings: { dispatch_block_on_missing_docs: on } } } : { ...o }));

  it('refuses the pickup with a 409 listing what is missing when the company blocks dispatch', async () => {
    world({ orgs: blocking(true), extra: scheduled });
    const res = await pickup();
    expect(res.status).toBe(409);
    expect(res.body.detail ?? res.body.error).toMatch(/Invoice or challan/);
    expect(supabaseMock.rows('cargo_manifest')[0].status).toBe('scheduled');
  });

  it('lets the goods leave once nothing is missing, even with blocking on', async () => {
    world({ orgs: blocking(true), extra: scheduled });
    supabaseMock.onRpc('next_lr_number', () => 1);
    await request(app).post(api(`/${LOAD}/documents`)).set(vendor()).send(invoice());
    await request(app).post(api(`/${LOAD}/documents/generate/lr`)).set(carrier()).send({});
    expect((await pickup()).status).toBe(200);
    expect(supabaseMock.rows('cargo_manifest')[0].status).toBe('in_transit');
  });

  it('holds the pickup recorded through the custody API too, so the block cannot be bypassed', async () => {
    world({ orgs: blocking(true), extra: scheduled });
    const res = await request(app).post('/api/v1/cargo/custody').set(as('driver-a', ORG.companyA)).send({ ref: { manifest_id: MAN }, kind: 'pickup' });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/Invoice or challan/);
    expect(supabaseMock.rows('cargo_manifest')[0].status).toBe('scheduled');
  });

  it('only warns with the setting off: the pickup goes ahead with documents missing', async () => {
    world({ orgs: blocking(false), extra: scheduled });
    expect((await pickup()).status).toBe(200);
    expect(supabaseMock.rows('cargo_manifest')[0].status).toBe('in_transit');
  });
});

describe('trip settlement', () => {
  const settle = (path: string, body: object = {}, who = carrier()) => request(app).post(api(`/${LOAD}/settlement${path}`)).set(who).send(body);

  it('has no settlement until the carrier opens one; the vendor can read it', async () => {
    expect((await request(app).get(api(`/${LOAD}/settlement`)).set(carrier())).status).toBe(404);
    const opened = await settle('');
    expect(opened.status).toBe(200);
    // Freight defaults to the load's price; everything is in rupees at the edge and paise in the row
    expect(opened.body).toMatchObject({ agreed_freight: 25000, advance_paid: 0, balance: 25000, status: 'open', payment_terms: 'to_be_billed', carrier_org_id: ORG.companyA });
    expect(supabaseMock.rows('trip_settlements')[0]).toMatchObject({ agreed_freight: 2_500_000, advance_paid: 0, balance: 2_500_000 });
    const read = await request(app).get(api(`/${LOAD}/settlement`)).set(vendor());
    expect(read.status).toBe(200);
    expect(read.body.balance).toBe(25000);
    expect((await settle('', {}, other())).status).toBe(404);
  });

  it('balance = freight + approved extras - deductions - advance; unapproved extras are excluded', async () => {
    await settle('', { advance_paid: 10000 });
    const added = await settle('/extra-charges', { label: 'Toll', amount: 3000 });
    expect(added.status).toBe(201);
    expect(added.body.balance).toBe(15000);
    expect(added.body).toMatchObject({ pending_extras_total: 3000, approved_extras_total: 0 });
    expect(added.body.extra_charges[0]).toMatchObject({ idx: 0, label: 'Toll', amount: 3000, approved: false });

    const approved = await settle('/extra-charges/0/approve');
    expect(approved.body).toMatchObject({ balance: 18000, approved_extras_total: 3000, pending_extras_total: 0 });
    expect(approved.body.extra_charges[0]).toMatchObject({ approved: true, approved_by: uid('admin-a') });
    expect((await settle('/extra-charges/9/approve')).status).toBe(404);

    const ded = await settle('/deductions', { label: 'Short delivery', amount: 500.5, reason: 'Two cartons short' });
    expect(ded.status).toBe(201);
    expect(ded.body.balance).toBe(17499.5);
    expect(supabaseMock.rows('trip_settlements')[0]).toMatchObject({ balance: 1_749_950, advance_paid: 1_000_000 });
    expect((await settle('/deductions', { label: 'x', amount: 5 })).status).toBe(400);
    expect((await settle('/extra-charges', { label: 'Zero', amount: 0 })).status).toBe(400);

    const updated = await settle('', { agreed_freight: 26000.25, advance_paid: 5000 });
    expect(updated.body).toMatchObject({ agreed_freight: 26000.25, advance_paid: 5000, balance: 26000.25 + 3000 - 500.5 - 5000 });
    // Only the carrier writes
    expect((await settle('/extra-charges', { label: 'Toll', amount: 1 }, vendor())).status).toBe(403);
    expect((await settle('/extra-charges/0/approve', {}, vendor())).status).toBe(403);
    expect((await settle('/deductions', { label: 'x', amount: 1, reason: 'because' }, vendor())).status).toBe(403);
  });

  it('refuses extras before the settlement is opened', async () => {
    expect((await settle('/extra-charges', { label: 'Toll', amount: 100 })).status).toBe(409);
  });

  it('close without a final POD is rejected, and the settlement stays open', async () => {
    await settle('');
    const res = await settle('/close');
    expect(res.status).toBe(409);
    expect(res.body.detail).toMatch(/proof of delivery/i);
    expect(supabaseMock.rows('trip_settlements')[0].status).toBe('open');
    // A part delivery is not a final POD
    supabaseMock.rows('cargo_custody_events').push(delivered({ kind: 'partial_delivery' }));
    expect((await settle('/close')).status).toBe(409);
    expect(supabaseMock.rows('trip_settlements')[0].status).toBe('open');
  });

  it('closes with a final POD: fixes the balance, links the POD and writes the trip closure report', async () => {
    await settle('', { advance_paid: 10000 });
    await settle('/extra-charges', { label: 'Toll', amount: 3000 });
    await settle('/extra-charges/0/approve');
    await settle('/extra-charges', { label: 'Waiting', amount: 1000 });
    await settle('/deductions', { label: 'Short delivery', amount: 500, reason: 'Two cartons short' });
    supabaseMock.rows('cargo_custody_events').push(delivered());

    const res = await settle('/close', {});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'closed', balance: 17500, payment_status: 'pending', closed_by: uid('admin-a') });
    expect(res.body.closed_at).toBeTruthy();
    expect(res.body.pod_document_id).toBeTruthy();
    expect(res.body.trip_closure_document_id).toBeTruthy();

    const docs = supabaseMock.rows('load_documents');
    const pod = docs.find(d => d.kind === 'pod')!;
    expect(pod).toMatchObject({ status: 'final', id: res.body.pod_document_id });
    const closure = docs.find(d => d.kind === 'trip_closure')!;
    expect(closure).toMatchObject({ status: 'final', id: res.body.trip_closure_document_id });
    expect(closure.fields).toMatchObject({ final_freight: 25000, additional_charges: 3000, deductions_total: 500, advance_paid: 10000, balance_payable: 17500 });
    const pdf = await request(app).get(api(`/${LOAD}/documents/${closure.id}/pdf`)).set(vendor()).buffer(true).parse(pdfBody);
    expect(pdf.body.length).toBeGreaterThan(1000);

    // Closed means closed
    expect((await settle('/close')).status).toBe(409);
    expect((await settle('/extra-charges', { label: 'Late', amount: 10 })).status).toBe(409);
    expect((await settle('', { advance_paid: 1 })).status).toBe(409);
  });

  it('takes a POD the carrier recorded as final, and marks a fully covered trip paid', async () => {
    await settle('', { agreed_freight: 10000, advance_paid: 10000 });
    const pod = await request(app).post(api(`/${LOAD}/documents`)).set(carrier()).send({ kind: 'pod', status: 'final', fields: { delivered_at: '2026-10-02T10:00:00Z', receiver_name: 'Store', complete: true } });
    expect(pod.status).toBe(201);
    const res = await settle('/close');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ balance: 0, payment_status: 'paid', pod_document_id: pod.body.id });
  });

  it('is idempotent: the same key opens one settlement', async () => {
    const key = 'settle-key-0001';
    const a = await request(app).post(api(`/${LOAD}/settlement/extra-charges`)).set(carrier()).send({ idempotency_key: key, label: 'Toll', amount: 100 });
    expect(a.status).toBe(409); // not opened yet; failures are not stored
    await settle('');
    const first = await request(app).post(api(`/${LOAD}/settlement/extra-charges`)).set(carrier()).send({ idempotency_key: key, label: 'Toll', amount: 100 });
    const second = await request(app).post(api(`/${LOAD}/settlement/extra-charges`)).set(carrier()).send({ idempotency_key: key, label: 'Toll', amount: 100 });
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(supabaseMock.rows('trip_settlements')[0].extra_charges).toHaveLength(1);
  });
});

describe('timeline', () => {
  it('merges the load, documents, custody, exceptions and settlement in time order', async () => {
    supabaseMock.onRpc('next_lr_number', () => 1);
    await request(app).post(api(`/${LOAD}/documents`)).set(vendor()).send(invoice());
    await request(app).post(api(`/${LOAD}/documents/generate/lr`)).set(carrier()).send({});
    await request(app).post(api(`/${LOAD}/settlement`)).set(carrier()).send({});
    supabaseMock.rows('cargo_custody_events').push(delivered());
    supabaseMock.rows('cargo_exceptions').push({ id: 'ex-1', code: 'EXC-1', type: 'shortage', severity: 'low', status: 'open', description: 'Two short', owner_id: null, resolution: null, created_at: '2026-10-02T11:00:00.000Z', resolved_at: null });
    supabaseMock.rows('cargo_exception_items').push({ id: 'ei-1', exception_id: 'ex-1', manifest_id: MAN, pieces_affected: 2, weight_affected_kg: null, condition: 'shortage', note: null });

    for (const who of [vendor(), carrier(), platform()]) {
      const res = await request(app).get(api(`/${LOAD}/timeline`)).set(who);
      expect(res.status).toBe(200);
      const types = new Set(res.body.entries.map((e: any) => e.type));
      expect([...types].sort()).toEqual(['custody', 'document', 'exception', 'load', 'settlement']);
      const times = res.body.entries.map((e: any) => Date.parse(e.at));
      expect(times).toEqual([...times].sort((a, b) => a - b));
    }
    const entries = (await request(app).get(api(`/${LOAD}/timeline`)).set(carrier())).body.entries;
    expect(entries[0]).toMatchObject({ type: 'load', title: 'Load posted' });
    expect(entries.map((e: any) => e.title)).toEqual(expect.arrayContaining(['Delivered', 'Settlement opened', 'Problem reported: Shortage']));
    expect(entries.find((e: any) => e.type === 'document' && /Tax invoice/.test(e.title)).by).toBe('Vik Vendor');
    expect((await request(app).get(api(`/${LOAD}/timeline`)).set(other())).status).toBe(404);
  });
});
