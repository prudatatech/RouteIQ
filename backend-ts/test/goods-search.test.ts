import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { goodsTables, hsnIndex } from './support/goods-world';
import { buildHsnIndex, findHsn, levenshtein, MAX_HSN_HITS, searchHsn, toEntry } from '../src/services/goods/hsn-index';

const index = hsnIndex();
const codes = (q: string) => searchHsn(index, q).map(h => h.hsn_code);

describe('HSN search', () => {
  it('finds cement first: "cement" -> 2523', () => {
    const hits = searchHsn(index, 'cement');
    expect(hits[0].hsn_code).toBe('2523');
    expect(hits[0]).toMatchObject({ description: 'Portland cement, aluminous cement', gst_rates: [12, 28], category: 'construction', rate_note: '28% for bags over 25 kg' });
  });

  it('does not pad "cement" with weak fuzzy hits', () => {
    const padded = buildHsnIndex([
      ...index.entries.map(e => ({ hsn_code: e.hsn_code, description: e.description, gst_rate: e.gst_rate, gst_rates: e.gst_rates, category: e.category, keywords: e.terms })),
      { hsn_code: '2106', description: 'Food preparations not elsewhere specified or included', gst_rate: 18, category: 'food', keywords: ['cement mix', 'cemented'] },
      { hsn_code: '4410', description: 'Particle board and similar board of wood', gst_rate: 18, category: 'wood', keywords: ['cemet board'] },
    ]);
    const hits = searchHsn(padded, 'cement').map(h => h.hsn_code);
    expect(hits[0]).toBe('2523');
    for (const weak of ['4410', '61']) expect(hits).not.toContain(weak);
    expect(codes('cement')).not.toContain('61');
  });

  it('keeps typo tolerance when nothing matches properly', () => {
    expect(codes('cemnt')).toContain('2523');
    expect(codes('clothes')).toContain('61');
  });

  it('maps everyday words to the master: "clothes" -> textiles 61 and 62', () => {
    const hits = codes('clothes');
    expect(hits).toContain('61');
    expect(hits).toContain('62');
    expect(hits.slice(0, 2).sort()).toEqual(['61', '62']);
  });

  it('understands Hindi words through the synonym map', () => {
    expect(codes('chawal')[0]).toBe('1006');
    expect(codes('doodh')[0]).toBe('0401');
  });

  it('finds medicines at 5% or 12%', () => {
    const hit = searchHsn(index, 'medicine')[0];
    expect(hit.hsn_code).toBe('3004');
    expect(hit.gst_rates).toEqual([5, 12]);
  });

  it('tolerates typos', () => {
    expect(codes('cemnt')[0]).toBe('2523');
    expect(codes('ciment')[0]).toBe('2523');
    expect(codes('smartfone')[0]).toBe('8517');
    expect(codes('sunflowr oil')[0]).toBe('1512');
  });

  it('matches a code prefix first', () => {
    expect(codes('25')[0]).toBe('2523');
    expect(codes('3004')[0]).toBe('3004');
  });

  it('returns at most 8 hits, each with only the public fields, and nothing for a blank or one-letter query', () => {
    const many = buildHsnIndex(Array.from({ length: 30 }, (_, i) => ({
      hsn_code: `90${String(i).padStart(2, '0')}`, description: `Cement product ${i}`, gst_rate: 18, category: 'construction', keywords: ['cement'],
    })));
    expect(searchHsn(many, 'cement')).toHaveLength(MAX_HSN_HITS);
    expect(Object.keys(searchHsn(index, 'rice')[0]).sort()).toEqual(['category', 'description', 'gst_rates', 'hsn_code', 'is_hazmat', 'is_perishable', 'rate_note']);
    expect(searchHsn(index, '')).toEqual([]);
    expect(searchHsn(index, 'c')).toEqual([]);
  });

  it('flags hazardous and perishable goods', () => {
    expect(searchHsn(index, 'fireworks')[0]).toMatchObject({ hsn_code: '3604', is_hazmat: true });
    expect(searchHsn(index, 'banana')[0]).toMatchObject({ hsn_code: '0803', is_perishable: true });
  });

  it('falls back to the default rate when a code has no rate list, and hazmat implies an e-way bill', () => {
    const e = toEntry({ hsn_code: '9999', description: 'Thing', gst_rate: '12.00', gst_rates: null, is_hazmat: true });
    expect(e.gst_rates).toEqual([12]);
    expect(e.eway_always).toBe(true);
  });

  it('looks one code up', () => {
    expect(findHsn(index, '2523')?.gst_rates).toEqual([12, 28]);
    expect(findHsn(index, ' 2523 ')?.hsn_code).toBe('2523');
    expect(findHsn(index, '0000')).toBeNull();
  });

  it('computes edit distance', () => {
    expect(levenshtein('cement', 'cemnt')).toBe(1);
    expect(levenshtein('rice', 'rice')).toBe(0);
    expect(levenshtein('abc', 'xyz')).toBe(3);
  });
});

describe('public goods endpoints', () => {
  const app = testApp();
  beforeEach(() => supabaseMock.reset(goodsTables()));

  it('GET /public/hsn/search needs 3 characters and needs no sign-in', async () => {
    expect((await request(app).get('/api/v1/public/hsn/search?q=ce')).status).toBe(400);
    expect((await request(app).get('/api/v1/public/hsn/search')).status).toBe(400);
    const res = await request(app).get('/api/v1/public/hsn/search?q=cement');
    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({ hsn_code: '2523', gst_rates: [12, 28] });
    expect(res.headers['cache-control']).toMatch(/public/);
  });

  it('GET /public/hsn/:code returns the code or 404', async () => {
    const ok = await request(app).get('/api/v1/public/hsn/2523');
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ hsn_code: '2523', gst_rate: 12, gst_rates: [12, 28], eway_always: false });
    expect((await request(app).get('/api/v1/public/hsn/0001')).status).toBe(404);
    expect((await request(app).get('/api/v1/public/hsn/abc')).status).toBe(400);
  });

  it('GET /public/vehicle-classes and /public/goods-categories list the reference tables', async () => {
    const vehicles = await request(app).get('/api/v1/public/vehicle-classes');
    expect(vehicles.status).toBe(200);
    expect(vehicles.body.items.map((v: { key: string }) => v.key)).toContain('container_32ft_sxl');
    const cats = await request(app).get('/api/v1/public/goods-categories');
    expect(cats.status).toBe(200);
    expect(cats.body.items.find((c: { key: string }) => c.key === 'hazmat')).toMatchObject({ is_hazmat: true, eway_threshold_inr: 0 });
  });
});
