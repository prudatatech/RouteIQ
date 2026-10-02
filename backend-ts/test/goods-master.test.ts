/**
 * The search on the full official HSN master (supabase/seed/hsn_master.csv, the rows migration
 * 20261005010000_hsn_master_gst2.sql loads), with the hand-curated keywords and synonyms of migration
 * 20261003010000_goods_master.sql on top, as production has them.
 */
import { describe, expect, it } from 'vitest';
import { buildHsnIndex, findHsn, readableDescription, resolveHsn, searchHsn } from '../src/services/goods/hsn-index';
import { hsnMasterRows } from './support/hsn-master';

const GST2_SLABS = [0, 0.25, 1.5, 3, 5, 12, 18, 28, 40];

const rows = hsnMasterRows();
const index = buildHsnIndex(rows);
const top = (q: string) => searchHsn(index, q)[0];

describe('the official HSN master (GST 2.0 rates)', () => {
  it('has every code of the official list, each with current GST 2.0 rates only', () => {
    expect(rows.length).toBeGreaterThan(21_800);
    expect(index.entries.length).toBe(rows.length);
    for (const r of rows) {
      expect(/^\d{2}(\d{2}){0,3}$/.test(r.hsn_code)).toBe(true);
      for (const rate of r.gst_rates as number[]) expect(GST2_SLABS).toContain(rate);
      expect(r.gst_rates).toContain(r.gst_rate);
    }
  });

  it('cement: 2523 at 18%', () => {
    expect(top('cement')).toMatchObject({ hsn_code: '2523', gst_rates: [18] });
    expect(findHsn(index, '2523')?.gst_rate).toBe(18);
  });

  it('rice: 1006, nil loose and 5% when pre-packaged and labelled', () => {
    const hit = top('rice');
    expect(hit).toMatchObject({ hsn_code: '1006', gst_rates: [0, 5] });
    expect(hit.rate_note).toMatch(/pre-packaged and labelled/);
    expect(findHsn(index, '1006')?.gst_rate).toBe(5);
  });

  it('soap: 3401, toilet soap 5% and other soap 18%', () => {
    const hit = top('soap');
    expect(hit).toMatchObject({ hsn_code: '3401', gst_rates: [5, 18] });
    expect(hit.rate_note).toMatch(/Toilet Soap/);
    // A toilet soap tariff item defaults to 5%
    expect(findHsn(index, '34011110')).toMatchObject({ gst_rate: 5, gst_rates: [5, 18] });
  });

  it('mobile phones: 8517 at 18%', () => {
    expect(top('mobile phones')).toMatchObject({ hsn_code: '8517', gst_rates: [18] });
    expect(top('mobile')).toMatchObject({ hsn_code: '8517' });
  });

  it('aerated drinks: 2202 at 40%', () => {
    expect(top('aerated drinks')?.hsn_code).toBe('2202');
    expect(findHsn(index, '2202')?.gst_rate).toBe(40);
    expect(findHsn(index, '22021010')).toMatchObject({ gst_rate: 40, gst_rates: [40] });
  });

  it('clothes: the apparel chapters 61 and 62 first, 5% up to Rs 2,500 a piece and 18% above', () => {
    const hits = searchHsn(index, 'clothes');
    expect(hits.slice(0, 2).map(h => h.hsn_code).sort()).toEqual(['61', '62']);
    expect(hits[0].gst_rates).toEqual([5, 18]);
  });

  it('resolves an 8-digit code to its own row', () => {
    expect(resolveHsn(index, '85171300')).toMatchObject({ matched_prefix: '85171300', entry: { gst_rates: [18] } });
    expect(resolveHsn(index, '10063010')?.entry).toMatchObject({ hsn_code: '10063010', gst_rates: [0, 5] });
    expect(resolveHsn(index, '21069020')?.entry.gst_rates).toEqual([40]);   // pan masala, 19/2025 from 1 Feb 2026
    expect(resolveHsn(index, '24031921')?.entry.gst_rates).toEqual([18]);   // biris
    expect(searchHsn(index, '85171300')[0].hsn_code).toBe('85171300');
  });

  it('shows the capitals of the official list as a sentence, and a bare "Other" with its heading', () => {
    expect(readableDescription('PORTLAND CEMENT, ALUMINOUS CEMENT')).toBe('Portland cement, aluminous cement');
    expect(readableDescription('LPG (for non-automotive purposes)')).toBe('LPG (for non-automotive purposes)');
    expect(readableDescription('AUTOMOTIVE DIESEL FUEL CONFORMING TO STANDARD IS 1459')).toBe('Automotive diesel fuel conforming to standard IS 1459');
    const hit = searchHsn(index, '34011190')[0];
    expect(hit.hsn_code).toBe('34011190');
    expect(hit.description).not.toBe('OTHER');
    expect(hit.description).toMatch(/^[A-Z][^A-Z]*[a-z]/);
    expect(hit.description.toLowerCase()).toContain('other');
  });

  it('searches 22,000 codes in under 20 ms a query', () => {
    const queries = ['cement', 'rice', 'soap', 'mobile phones', 'clothes', 'aerated drinks', 'steel pipes', 'cotton yarn',
      'sunflower oil', 'tyres', 'medicine', 'furniture', 'cemnt', 'smartfone', '8517', '2523', 'paper boxes', 'chawal'];
    for (const q of queries) searchHsn(index, q);   // warm up
    const rounds = 3;
    const started = performance.now();
    for (let r = 0; r < rounds; r++) for (const q of queries) searchHsn(index, q);
    const perQuery = (performance.now() - started) / (rounds * queries.length);
    expect(perQuery).toBeLessThan(20);
  });
});
