import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { goodsTables, hsnIndex } from './support/goods-world';
import { buildHsnIndex, findHsn, levenshtein, MAX_HSN_HITS, resolveHsn, searchHsn, toEntry } from '../src/services/goods/hsn-index';

const index = hsnIndex();
const codes = (q: string) => searchHsn(index, q).map(h => h.hsn_code);

describe('HSN search', () => {
  it('finds cement first: "cement" -> 2523', () => {
    const hits = searchHsn(index, 'cement');
    expect(hits[0].hsn_code).toBe('2523');
    expect(hits[0]).toMatchObject({ description: 'Portland cement, aluminous cement', gst_rates: [18], category: 'construction', rate_note: null });
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

  it('ranks the code that covers the goods, not a broader heading that shares a word', () => {
    expect(codes('atta')[0]).toBe('1101');
    expect(codes('flour')[0]).toBe('1101');
    expect(codes('biscuit')[0]).toBe('1905');
    expect(codes('noodles')[0]).toBe('1902');
    expect(codes('pasta')[0]).toBe('1902');
    expect(codes('chocolate')[0]).toBe('1806');
    expect(codes('mustard oil')[0]).toBe('1514');
    expect(codes('ghee')[0]).toBe('0405');
    expect(codes('tiles')[0]).toBe('6907');
    expect(codes('shoes')[0]).toBe('6403');
    expect(codes('timber')[0]).toBe('4407');
  });

  it('does not match a short word inside a longer one, and prefers the whole phrase', () => {
    // "air" inside "hair" used to put shampoo (3305) above air conditioners (8415).
    expect(codes('air conditioner')[0]).toBe('8415');
    expect(codes('steel pipe')[0]).toBe('7304');
    expect(codes('plastic chair')[0]).toBe('9401');
  });

  it('finds medicines at 5% or nil', () => {
    const hit = searchHsn(index, 'medicine')[0];
    expect(hit.hsn_code).toBe('3004');
    expect(hit.gst_rates).toEqual([0, 5]);
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
    expect(findHsn(index, '2523')?.gst_rates).toEqual([18]);
    expect(findHsn(index, ' 2523 ')?.hsn_code).toBe('2523');
    expect(findHsn(index, '0000')).toBeNull();
  });

  it('computes edit distance', () => {
    expect(levenshtein('cement', 'cemnt')).toBe(1);
    expect(levenshtein('rice', 'rice')).toBe(0);
    expect(levenshtein('abc', 'xyz')).toBe(3);
  });
});

describe('HSN keyword cleanup', () => {
  // A slice of the second-pass data cleanup: each pair is a word that used to rank the broader or wrong heading.
  const cleanup = buildHsnIndex([
    { hsn_code: '0802', description: 'Other nuts', gst_rate: 0, category: 'food_agri', keywords: ['cashew', 'almond', 'walnut', 'pistachio', 'dry fruit'] },
    { hsn_code: '1202', description: 'Groundnuts', gst_rate: 0, category: 'food_agri', keywords: ['groundnut', 'peanut', 'moongfali'] },
    { hsn_code: '3102', description: 'Mineral or chemical fertilisers, nitrogenous', gst_rate: 5, category: 'chemicals', keywords: ['urea', 'khad', 'nitrogenous fertilizer'] },
    { hsn_code: '3105', description: 'Mineral or chemical fertilisers containing NPK', gst_rate: 5, category: 'chemicals', keywords: ['fertilizer', 'fertiliser', 'npk', 'dap', 'potash'] },
    { hsn_code: '3904', description: 'Polymers of vinyl chloride', gst_rate: 18, category: 'chemicals', keywords: ['pvc', 'pvc resin'] },
    { hsn_code: '3917', description: 'Tubes, pipes and hoses of plastics (PVC pipes)', gst_rate: 18, category: 'chemicals', keywords: ['pvc pipe', 'plastic pipe', 'hdpe pipe', 'upvc'] },
    { hsn_code: '4410', description: 'Particle board', gst_rate: 18, category: 'wood', keywords: ['particle board', 'osb'] },
    { hsn_code: '4411', description: 'Fibre board of wood', gst_rate: 18, category: 'wood', keywords: ['mdf', 'fibre board', 'hardboard'] },
    { hsn_code: '4412', description: 'Plywood, veneered panels and similar laminated wood', gst_rate: 18, category: 'wood', keywords: ['plywood', 'ply', 'veneer', 'laminate', 'block board'] },
    { hsn_code: '5201', description: 'Cotton, not carded or combed', gst_rate: 0, category: 'textiles', keywords: ['raw cotton', 'cotton bale', 'ginned cotton'] },
    { hsn_code: '5601', description: 'Wadding of textile materials', gst_rate: 12, category: 'textiles', keywords: ['cotton wadding', 'wadding'] },
    { hsn_code: '6301', description: 'Blankets and travelling rugs', gst_rate: 5, category: 'textiles', keywords: ['blanket', 'comforter', 'duvet', 'quilt'] },
    { hsn_code: '6302', description: 'Bed linen, table linen, toilet linen', gst_rate: 5, category: 'textiles', keywords: ['bedsheet', 'pillowcase', 'towel', 'napkin'] },
    { hsn_code: '7208', description: 'Flat-rolled products of iron or non-alloy steel (steel sheets)', gst_rate: 18, category: 'steel_metal', keywords: ['steel sheet', 'sheet', 'coil', 'hr coil', 'plate'] },
    { hsn_code: '7209', description: 'Flat-rolled products of iron or non-alloy steel, cold-rolled', gst_rate: 18, category: 'steel_metal', keywords: ['cr coil', 'cold rolled coil', 'cold rolled sheet'] },
    { hsn_code: '7210', description: 'Flat-rolled products of iron or steel, coated', gst_rate: 18, category: 'steel_metal', keywords: ['steel sheet', 'galvanized sheet', 'tin plate', 'coated steel', 'gi sheet'] },
    { hsn_code: '7403', description: 'Refined copper and alloys', gst_rate: 18, category: 'steel_metal', keywords: ['copper', 'copper rod', 'copper cathode'] },
    { hsn_code: '7408', description: 'Copper wire', gst_rate: 18, category: 'steel_metal', keywords: ['copper wire', 'copper', 'tamba'] },
    { hsn_code: '8544', description: 'Insulated wire, cable', gst_rate: 18, category: 'electronics', keywords: ['wire', 'cable', 'electric wire', 'copper wire', 'data cable'] },
    { hsn_code: '8432', description: 'Agricultural, horticultural or forestry machinery', gst_rate: 12, category: 'steel_metal', keywords: ['plough', 'harvester', 'seeder', 'cultivator', 'farm equipment', 'thresher'] },
    { hsn_code: '8701', description: 'Tractors', gst_rate: 12, category: 'steel_metal', keywords: ['tractor', 'farm tractor'] },
  ]);
  const top = (q: string) => searchHsn(cleanup, q)[0]?.hsn_code;

  it('keeps fertiliser words on the right heading', () => {
    expect(top('fertilizer')).toBe('3105');
    expect(top('dap')).toBe('3105');
    expect(top('npk')).toBe('3105');
    expect(top('urea')).toBe('3102');
  });

  it('separates PVC resin from PVC pipe', () => {
    expect(top('pvc')).toBe('3904');
    expect(top('pvc pipe')).toBe('3917');
  });

  it('separates particle board, MDF and plywood', () => {
    expect(top('plywood')).toBe('4412');
    expect(top('laminate')).toBe('4412');
    expect(top('mdf')).toBe('4411');
  });

  it('keeps raw cotton and bedsheets on their own headings', () => {
    expect(top('raw cotton')).toBe('5201');
    expect(top('cotton bale')).toBe('5201');
    expect(top('bedsheet')).toBe('6302');
  });

  it('keeps groundnut, CR coil, copper wire and tractors specific', () => {
    expect(top('groundnut')).toBe('1202');
    expect(top('peanut')).toBe('1202');
    expect(top('cr coil')).toBe('7209');
    expect(['7408', '8544']).toContain(top('copper wire'));
    expect(top('tractor')).toBe('8701');
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
    expect(res.body.items[0]).toMatchObject({ hsn_code: '2523', gst_rates: [18] });
    expect(res.headers['cache-control']).toMatch(/public/);
  });

  it('GET /public/hsn/:code returns the code or 404', async () => {
    const ok = await request(app).get('/api/v1/public/hsn/2523');
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ hsn_code: '2523', gst_rate: 18, gst_rates: [18], eway_always: false });
    expect((await request(app).get('/api/v1/public/hsn/0001')).status).toBe(404);
    expect((await request(app).get('/api/v1/public/hsn/abc')).status).toBe(400);
  });

  it('GET /public/hsn/:code falls back to the longest known prefix for 6 and 8 digit codes', async () => {
    const six = await request(app).get('/api/v1/public/hsn/252310');
    expect(six.status).toBe(200);
    expect(six.body).toMatchObject({ hsn_code: '2523', gst_rates: [18], matched_prefix: '2523' });
    const eight = await request(app).get('/api/v1/public/hsn/25232010');
    expect(eight.status).toBe(200);
    expect(eight.body.matched_prefix).toBe('2523');
    expect((await request(app).get('/api/v1/public/hsn/2523')).body.matched_prefix).toBe('2523');
    expect((await request(app).get('/api/v1/public/hsn/99991234')).status).toBe(404);
  });

  it('resolveHsn prefers the longest known prefix; search matches 6 and 8 digit codes', () => {
    const wider = buildHsnIndex([
      ...index.entries.map(e => ({ hsn_code: e.hsn_code, description: e.description, gst_rate: e.gst_rate, gst_rates: e.gst_rates })),
      { hsn_code: '252310', description: 'Portland cement', gst_rate: 18 },
    ]);
    expect(resolveHsn(wider, '25231090')?.matched_prefix).toBe('252310');
    expect(resolveHsn(wider, '252320')?.matched_prefix).toBe('2523');
    expect(resolveHsn(wider, '61')?.matched_prefix).toBe('61');
    expect(resolveHsn(wider, '999999')).toBeNull();
    expect(codes('25232010')).toContain('2523');
    expect(codes('252310')[0]).toBe('2523');
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
