/**
 * Bulk load upload: GET /vendor/loads/template.csv and POST /vendor/loads/bulk (at most 50 rows, one load per row,
 * validated per row, a batch row that keeps the errors).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { ORG, as, orgWorld, uid } from './support/org-world';
import { tomorrow } from './support/load-draft';
import { BULK_COLUMNS, bulkTemplateCsv, validateBulk } from '../src/services/loads/loads.service';
import { csvLine, parseCsv } from '../src/services/loads/csv';

const app = testApp();
const api = (p: string) => `/api/v1${p}`;

const goodRow = (over: Record<string, string> = {}): string[] => {
  const base: Record<string, string> = {
    product_name: 'Cement bags', hsn_code: '2523', gst_rate: '18', quantity: '400', unit: 'bags', weight_kg: '20000', declared_value: '150000',
    pickup_city: 'Mumbai', pickup_address: 'Plot 4, MIDC', pickup_pincode: '400093', pickup_lat: '19.1197', pickup_lng: '72.8464', pickup_date: tomorrow(),
    pickup_slot: 'morning', pickup_contact_name: 'Ravi', pickup_contact_phone: '+919800000000',
    delivery_city: 'Delhi', delivery_address: 'Okhla', delivery_pincode: '110020', delivery_lat: '28.5355', delivery_lng: '77.275', delivery_date: '',
    delivery_contact_name: '', delivery_contact_phone: '', load_type: 'ftl', vehicle_class: '', budget_inr: '', ...over,
  };
  return BULK_COLUMNS.map(c => base[c] ?? '');
};
const file = (...rows: string[][]) => [csvLine([...BULK_COLUMNS]), ...rows.map(r => csvLine(r))].join('\r\n');

let seq = 0;
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  seq = 0;
  supabaseMock.reset(orgWorld({ vendor_profiles: [{ id: uid('vendor-1'), kyc_status: 'approved' }], vendor_shipment_requests: [], load_items: [], load_bulk_batches: [] }));
  supabaseMock.rpcHandlers.set('create_vendor_load', ({ p }: any) => ({ id: randomUUID(), status: 'pending', created_at: new Date().toISOString(), ...p.load, load_number: `MRX-2026-${String(++seq).padStart(5, '0')}`, duplicate: false }));
});

const upload = (csv: string, who = as('vendor-1')) => request(app).post(api('/vendor/loads/bulk')).set(who).send({ file_name: 'loads.csv', csv });

describe('the CSV helpers', () => {
  it('reads quoted cells, doubled quotes and line breaks', () => {
    expect(parseCsv('a,"b,c","d ""q"""\r\n1,2,3\n\n')).toEqual([['a', 'b,c', 'd "q"'], ['1', '2', '3']]);
  });
  it('quotes what needs it and defuses formulas', () => {
    expect(csvLine(['a,b', 'x"y', '=SUM(A1)'])).toBe('"a,b","x""y",\'=SUM(A1)');
  });
});

describe('GET /vendor/loads/template.csv', () => {
  it('downloads the header and one example row, which is itself a valid row', async () => {
    const res = await request(app).get(api('/vendor/loads/template.csv')).set(as('vendor-1'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    const table = parseCsv(res.text);
    expect(table[0]).toEqual([...BULK_COLUMNS]);
    expect(table).toHaveLength(2);
    expect(bulkTemplateCsv()).toBe(res.text);
  });
});

describe('POST /vendor/loads/bulk', () => {
  it('posts the valid rows as separate loads and reports the bad ones by row', async () => {
    const res = await upload(file(goodRow(), goodRow({ pickup_pincode: '4000' }), goodRow({ weight_kg: '1000', declared_value: '9000' }), goodRow({ pickup_date: '2020-01-01' })));
    expect(res.status).toBe(201);
    expect(res.body.loads.map((l: any) => l.row)).toEqual([1, 3]);
    expect(res.body.loads.map((l: any) => l.load_number)).toEqual(['MRX-2026-00001', 'MRX-2026-00002']);
    expect(res.body.errors).toHaveLength(2);
    expect(res.body.errors[0]).toMatchObject({ row: 2 });
    expect(res.body.errors[0].message).toMatch(/6 digits/);
    expect(res.body.errors[1]).toMatchObject({ row: 4 });
    expect(res.body.errors[1].message).toMatch(/past/);
    expect(res.body.batch).toMatchObject({ row_count: 4, ok_count: 2, error_count: 2, status: 'done' });
  });

  it('keeps a batch row with the errors, and marks every load with its batch and source', async () => {
    await upload(file(goodRow(), goodRow({ hsn_code: 'abc' })));
    const batches = supabaseMock.rows('load_bulk_batches');
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ file_name: 'loads.csv', row_count: 2, ok_count: 1, error_count: 1, vendor_org_id: ORG.vendorV, status: 'done' });
    expect(batches[0].errors).toEqual([expect.objectContaining({ row: 2 })]);
    const created = supabaseMock.rpcCalls.filter(c => c.name === 'create_vendor_load');
    expect(created).toHaveLength(1);
    expect(created[0].args.p.load).toMatchObject({ source: 'bulk', bulk_batch_id: batches[0].id, vendor_org_id: ORG.vendorV });
    expect(created[0].args.p.items).toHaveLength(1);
  });

  it('refuses a file of more than 50 rows without posting anything', async () => {
    const res = await upload(file(...Array.from({ length: 51 }, () => goodRow())));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at most 50/);
    expect(supabaseMock.rpcCalls).toHaveLength(0);
    expect(supabaseMock.rows('load_bulk_batches')).toHaveLength(0);
  });

  it('accepts exactly 50 rows', async () => {
    const res = await upload(file(...Array.from({ length: 50 }, () => goodRow())));
    expect(res.status).toBe(201);
    expect(res.body.loads).toHaveLength(50);
  });

  it('refuses a file without the template columns, an empty file and a file with no loads', async () => {
    const noCols = await upload('product_name,hsn_code\r\nx,2523');
    expect(noCols.status).toBe(400);
    expect(noCols.body.error).toMatch(/missing these columns/);
    expect((await upload(csvLine([...BULK_COLUMNS]))).body.error).toMatch(/no loads/);
    expect((await request(app).post(api('/vendor/loads/bulk')).set(as('vendor-1')).send({})).status).toBe(400);
  });

  it('is for vendors only', async () => {
    expect((await upload(file(goodRow()), as('driver-a'))).status).toBe(403);
  });
});

describe('validateBulk', () => {
  it('numbers rows from 1 below the header and validates each row on its own', () => {
    const out = validateBulk(file(goodRow(), goodRow({ quantity: '0' }), goodRow()));
    expect(out.rowCount).toBe(3);
    expect(out.drafts.map(d => d.row)).toEqual([1, 3]);
    expect(out.errors).toEqual([expect.objectContaining({ row: 2 })]);
    expect(out.drafts[0].draft.items[0]).toMatchObject({ product_name: 'Cement bags', weight_kg: 20000 });
  });
});
