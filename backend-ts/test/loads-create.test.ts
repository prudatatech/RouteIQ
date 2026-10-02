/**
 * Posting a load: POST /vendor/loads, GET /vendor/loads/mine, GET /vendor/loads/:id, POST /vendor/loads/:id/repost.
 * The database is the mock, so the create_vendor_load RPC is a handler that numbers loads one after another the way
 * next_load_number() does.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { ORG, as, orgWorld, uid } from './support/org-world';
import { draft } from './support/load-draft';
import { assessLoad } from '../src/services/loads/assess';
import { goodsTables } from './support/goods-world';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;
let seq: number;
function world(opts: { vendorStatus?: string; extra?: Record<string, any[]> } = {}) {
  seq = 0;
  const fixtures = orgWorld({ vendor_profiles: [{ id: uid('vendor-1'), kyc_status: 'approved' }], vendor_shipment_requests: [], load_items: [], cargo_manifest: [], ...goodsTables(), ...opts.extra });
  if (opts.vendorStatus) {
    fixtures.organizations.find(o => o.id === ORG.vendorV)!.status = opts.vendorStatus;
    for (const m of fixtures.org_members) if (m.org_id === ORG.vendorV) m.organizations = { ...m.organizations, status: opts.vendorStatus };
  }
  supabaseMock.reset(fixtures);
  // What create_vendor_load does: number the load, keep the row and its items (a repeat inside 10 minutes returns the first)
  supabaseMock.rpcHandlers.set('create_vendor_load', ({ p }: any) => {
    const crid = p.load.client_request_id;
    const first = supabaseMock.rows('vendor_shipment_requests').find(r => r.client_request_id === crid);
    if (first) return { ...first, duplicate: true };
    const row = { id: randomUUID(), status: 'pending', created_at: new Date().toISOString(), ...p.load, load_number: `MRX-2026-${String(++seq).padStart(5, '0')}` };
    supabaseMock.rows('vendor_shipment_requests').push(row);
    p.items.forEach((i: any, n: number) => supabaseMock.rows('load_items').push({ id: randomUUID(), load_id: row.id, line_no: n + 1, ...i }));
    return { ...row, duplicate: false };
  });
}

const post = (body: unknown, who = as('vendor-1'), headers: Record<string, string> = {}) => request(app).post(api('/vendor/loads')).set(who).set(headers).send(body as object);

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); world(); });

describe('load numbers', () => {
  it('numbers each posted load MRX-YYYY-NNNNN through the database function, one after another', async () => {
    const a = await post(draft());
    const b = await post(draft());
    const c = await post(draft());
    expect([a, b, c].map(r => r.status)).toEqual([201, 201, 201]);
    expect([a, b, c].map(r => r.body.load_number)).toEqual(['MRX-2026-00001', 'MRX-2026-00002', 'MRX-2026-00003']);
    for (const r of [a, b, c]) expect(r.body.load_number).toMatch(/^MRX-\d{4}-\d{5}$/);
    expect(supabaseMock.rpcCalls.filter(c => c.name === 'create_vendor_load')).toHaveLength(3);
  });

  it('gives different numbers to loads posted at the same moment', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => post(draft())));
    const numbers = results.map(r => r.body.load_number);
    expect(new Set(numbers).size).toBe(5);
  });
});

describe('POST /vendor/loads', () => {
  it('writes the load and its items in one RPC call, stamped with the vendor organisation', async () => {
    const res = await post(draft());
    expect(res.status).toBe(201);
    const calls = supabaseMock.rpcCalls.filter(c => c.name === 'create_vendor_load');
    expect(calls).toHaveLength(1);
    const { load, items } = calls[0].args.p;
    expect(items).toHaveLength(4);
    expect(load.vendor_org_id).toBe(ORG.vendorV);
    expect(load.vendor_id).toBe(uid('vendor-1'));
    expect(res.body.items).toHaveLength(4);
    expect(res.body.load.load_number).toBe(res.body.load_number);
  });

  it('works the totals, tax and e-way need out on the server and ignores what the client sent', async () => {
    const res = await post(draft({
      total_weight_kg: 1, total_declared_value: 1, eway_required: false, tax_basis: 'intra', hazmat_mixed: true, required_capacity_kg: 5,
    }));
    expect(res.status).toBe(201);
    const { load } = supabaseMock.rpcCalls[0].args.p;
    expect(load.total_weight_kg).toBe(20900);
    expect(load.total_declared_value).toBe(762500);
    expect(load.required_capacity_kg).toBe(20900);
    expect(load.eway_required).toBe(true);
    expect(load.tax_basis).toBe('inter');
    expect(load.hazmat_mixed).toBe(false);
    // A rate the HSN master doesn't allow for the code is not trusted: cement (2523) is 12/28 in the seed, so the
    // client's 18% falls back to the code's default 12% (84,000 + paint 9,000 + tiles 1,800 + fasteners 450)
    expect(res.body.assessment.tax.gst_total).toBe(95250);
    expect(res.body.assessment.tax.igst).toBe(95250);
  });

  it('writes metadata.cargo from the primary product (the largest value) for older screens', async () => {
    await post(draft());
    const { metadata } = supabaseMock.rpcCalls[0].args.p.load;
    expect(metadata.cargo).toMatchObject({ name: 'Cement bags', hsn: '2523', gstRate: 18, grossWeightKg: 20900, declaredValue: 762500 });
  });

  it('returns the first load for the same client_request_id within 10 minutes and writes nothing more', async () => {
    const body = draft();
    const first = await post(body);
    const again = await post(body);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect(again.body.id).toBe(first.body.id);
    expect(again.body.load_number).toBe(first.body.load_number);
    expect(supabaseMock.rpcCalls.filter(c => c.name === 'create_vendor_load')).toHaveLength(1);
    expect(supabaseMock.rows('vendor_shipment_requests')).toHaveLength(1);
  });

  it('treats the same client_request_id after the window as a new load', async () => {
    const body = draft();
    const old = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    supabaseMock.rows('vendor_shipment_requests').push({ id: randomUUID(), vendor_id: uid('vendor-1'), client_request_id: body.client_request_id, created_at: old, load_number: 'MRX-2026-00099' });
    // the mock RPC would return the old row, so replace it with one that numbers a new load
    supabaseMock.rpcHandlers.set('create_vendor_load', ({ p }: any) => ({ id: randomUUID(), status: 'pending', created_at: new Date().toISOString(), ...p.load, load_number: 'MRX-2026-00100', duplicate: false }));
    const res = await post(body);
    expect(res.status).toBe(201);
    expect(res.body.load_number).toBe('MRX-2026-00100');
  });

  it('returns the stored response for a repeated Idempotency-Key', async () => {
    const key = { 'Idempotency-Key': 'vendor-load-key-0001' };
    const first = await post(draft(), as('vendor-1'), key);
    const again = await post(draft(), as('vendor-1'), key);
    expect(first.status).toBe(201);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(again.body.load_number).toBe(first.body.load_number);
    expect(supabaseMock.rpcCalls.filter(c => c.name === 'create_vendor_load')).toHaveLength(1);
  });

  it('is allowed before KYC approval and holds the load back from the companies with a status note', async () => {
    world({ vendorStatus: 'pending' });
    const res = await post(draft());
    expect(res.status).toBe(201);
    expect(res.body.status_note).toMatch(/verification pending/i);
    expect(supabaseMock.rpcCalls[0].args.p.load.metadata.hold).toBe('vendor_unverified');
    expect(supabaseMock.rows('notifications').filter(n => n.type === 'vendor_request')).toHaveLength(0);
    expect(supabaseMock.rows('notifications').filter(n => n.type === 'load_posted' && n.user_id === uid('vendor-1'))).toHaveLength(1);
  });

  it('routes to the companies when the vendor organisation is active, and tells the vendor', async () => {
    const res = await post(draft());
    expect(res.body.status_note).toBeNull();
    expect(supabaseMock.rpcCalls[0].args.p.load.metadata.hold).toBeUndefined();
    expect(supabaseMock.rows('notifications').filter(n => n.type === 'vendor_request').length).toBeGreaterThan(0);
    expect(supabaseMock.rows('notifications').filter(n => n.type === 'load_posted' && n.user_id === uid('vendor-1'))).toHaveLength(1);
  });

  it('stores the chosen companies without routing to them yet', async () => {
    const res = await post(draft({ company_ids: [ORG.companyA, ORG.companyB] }));
    expect(res.status).toBe(201);
    expect(supabaseMock.rpcCalls[0].args.p.load.company_ids).toEqual([ORG.companyA, ORG.companyB]);
  });

  it.each([
    ['a pin code that is not 6 digits', { pickup_pincode: '4000' }, /6 digits/],
    ['a pickup date in the past', { pickup_date: '2020-01-01' }, /past/],
    ['more than 50 products', { items: Array.from({ length: 51 }, () => draft().items[0]) }, /at most 50/],
    ['more than 60 tonnes', { items: [{ ...draft().items[0], weight_kg: 60000 }, { ...draft().items[1], weight_kg: 10 }] }, /60 t/],
    ['no products', { items: [] }, /at least one product/],
    ['perishable goods without a temperature', { items: [{ ...draft().items[0], is_perishable: true }] }, /temperature/],
  ])('refuses %s', async (_name, over, message) => {
    const res = await post(draft(over));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
    expect(supabaseMock.rpcCalls).toHaveLength(0);
  });

  it('stores contact phones as +91XXXXXXXXXX and refuses anything that is not an Indian mobile', async () => {
    const res = await post(draft({ pickup_contact_phone: '098765-43210', delivery_contact_phone: '91 98765 43211' }));
    expect(res.status).toBe(201);
    const { load } = supabaseMock.rpcCalls.filter(c => c.name === 'create_vendor_load')[0].args.p;
    expect(load.pickup_contact_phone).toBe('+919876543210');
    expect(load.delivery_contact_phone).toBe('+919876543211');
    for (const bad of ['1234567', '5876543210', '98765', '+1 415 555 0100', 'abcdefghij']) {
      const r = await post(draft({ pickup_contact_phone: bad }));
      expect(r.status, bad).toBe(400);
      expect(r.body.error).toMatch(/10-digit Indian mobile/);
    }
  });

  it('is for vendors only', async () => {
    expect((await post(draft(), as('driver-a'))).status).toBe(403);
    expect((await request(app).post(api('/vendor/loads')).send(draft())).status).toBe(401);
  });
});

describe('assessLoad (posting uses the goods engine)', () => {
  it('sums the lines, flags the e-way bill over 50,000 and picks the basis from the state codes', async () => {
    const a = await assessLoad({ items: [{ weight_kg: 100, declared_value: 50000, gst_rate: 18 }], pickup_state_code: '27', delivery_state_code: '27' });
    expect(a.eway.required).toBe(false);
    expect(a.tax.basis).toBe('intra');
    expect(a.tax).toMatchObject({ cgst: 4500, sgst: 4500, igst: 0, gst_total: 9000, grand_total: 59000, pickup_state_code: '27' });
    const b = await assessLoad({ items: [{ weight_kg: 100, declared_value: 50001, gst_rate: 18 }], pickup_state_code: '27', delivery_state_code: '07' });
    expect(b.eway.required).toBe(true);
    expect(b.tax.basis).toBe('inter');
    expect((await assessLoad({ items: [] })).tax.basis).toBe('unknown');
    expect(a.estimate).toBeNull();
  });
});

describe('GET /vendor/loads/mine', () => {
  it('lists the vendor organisation\'s loads, paged', async () => {
    await post(draft());
    await post(draft());
    const res = await request(app).get(api('/vendor/loads/mine?page=1&page_size=1')).set(as('vendor-1'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, page_size: 1 });
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items[0].load_number).toMatch(/^MRX-/);
  });

  it('is not shadowed by /loads/:id, and the older /loads board still answers', async () => {
    expect((await request(app).get(api('/vendor/loads/mine')).set(as('vendor-1'))).status).toBe(200);
    expect((await request(app).get(api('/vendor/loads')).set(as('vendor-1'))).status).toBe(200);
  });

  it('refuses a bad page', async () => {
    expect((await request(app).get(api('/vendor/loads/mine?page=0')).set(as('vendor-1'))).status).toBe(400);
  });
});

describe('GET /vendor/loads/:id', () => {
  const LOAD = 'bb000000-0000-4000-8000-000000000001';
  beforeEach(() => {
    world({
      extra: {
        vendor_shipment_requests: [{ id: LOAD, vendor_id: uid('vendor-1'), vendor_org_id: ORG.vendorV, status: 'assigned', load_number: 'MRX-2026-00001', pickup_location: 'Mumbai', drop_location: 'Delhi', required_capacity_kg: 100, metadata: {}, created_at: '2026-10-01T00:00:00Z' }],
        load_items: [{ id: randomUUID(), load_id: LOAD, line_no: 1, product_name: 'Cement bags', hsn_code: '2523', gst_rate: 18, quantity: 1, unit: 'bag', weight_kg: 100, declared_value: 1000 }],
        cargo_manifest: [{ id: randomUUID(), vendor_request_id: LOAD, carrier_org_id: ORG.companyA, vendor_org_id: ORG.vendorV, status: 'scheduled', pickup_location: 'x', drop_location: 'y', pickup_lat: 1, pickup_lng: 1, drop_lat: 2, drop_lng: 2, capacity_kg: 100, created_at: '2026-10-01T00:00:00Z' }],
      },
    });
  });
  const get = (who: Record<string, string>) => request(app).get(api(`/vendor/loads/${LOAD}`)).set(who);

  it('shows the load with its items to its vendor organisation, the carrier organisation and a platform admin', async () => {
    for (const who of ['vendor-1', 'admin-a', 'super-1']) {
      const res = await get(as(who));
      expect(res.status, who).toBe(200);
      expect(res.body.load.load_number).toBe('MRX-2026-00001');
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].product_name).toBe('Cement bags');
    }
  });

  it('is a 404 for any other organisation, so it never says the load exists', async () => {
    expect((await get(as('admin-b'))).status).toBe(404);
    expect((await get(as('tpl-1'))).status).toBe(404);
    expect((await request(app).get(api('/vendor/loads/bb000000-0000-4000-8000-0000000000ff')).set(as('admin-a'))).status).toBe(404);
    expect((await get(as('driver-a'))).status).toBe(403);
  });
});

describe('POST /vendor/loads/:id/repost', () => {
  const LOAD = 'bb000000-0000-4000-8000-000000000002';
  beforeEach(() => {
    world({
      extra: {
        vendor_shipment_requests: [{
          id: LOAD, vendor_id: uid('vendor-1'), vendor_org_id: ORG.vendorV, status: 'delivered', load_number: 'MRX-2026-00002',
          pickup_location: 'Mumbai', pickup_lat: 19.1, pickup_lng: 72.8, drop_location: 'Delhi', drop_lat: 28.5, drop_lng: 77.2, required_capacity_kg: 100,
          pickup_city: 'Mumbai', pickup_address: 'Plot 4', pickup_pincode: '400093', pickup_date: '2026-09-01', pickup_slot: 'morning',
          delivery_city: 'Delhi', delivery_address: 'Okhla', delivery_pincode: '110020', delivery_date: '2026-09-04',
          vehicle_class: 'sxl_32', load_type: 'ftl', special_handling: ['fragile'], metadata: {}, created_at: '2026-09-01T00:00:00Z',
        }],
        load_items: [{ id: randomUUID(), load_id: LOAD, line_no: 1, product_name: 'Cement bags', hsn_code: '2523', gst_rate: 18, quantity: 1, unit: 'bag', weight_kg: 100, declared_value: 1000, handling: [] }],
      },
    });
  });

  it('returns the load as a draft with the dates cleared and creates nothing', async () => {
    const res = await request(app).post(api(`/vendor/loads/${LOAD}/repost`)).set(as('vendor-1'));
    expect(res.status).toBe(200);
    expect(res.body.draft).toMatchObject({ source: 'repost', reposted_from: LOAD, pickup_date: null, delivery_date: null, client_request_id: null, pickup_city: 'Mumbai', delivery_city: 'Delhi', vehicle_class: 'sxl_32', special_handling: ['fragile'] });
    expect(res.body.draft.items[0]).toMatchObject({ product_name: 'Cement bags', hsn_code: '2523', gst_rate: 18 });
    expect(supabaseMock.rpcCalls).toHaveLength(0);
    expect(supabaseMock.writes('vendor_shipment_requests')).toHaveLength(0);
  });

  it('is a 404 for someone else\'s load', async () => {
    expect((await request(app).post(api(`/vendor/loads/${LOAD}/repost`)).set(as('tpl-1'))).status).toBe(404);
  });
});
