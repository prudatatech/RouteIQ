import { describe, expect, it } from 'vitest';
import { parseCsv, rowsFromCsv } from '../scripts/import-hsn';

const cats = (name: string) => ({ 'textiles & garments': 'textiles', textiles: 'textiles' } as Record<string, string>)[name.toLowerCase()] ?? null;

describe('HSN CSV import', () => {
  it('parses quoted fields, commas and line breaks inside quotes, CRLF and a BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n"line\nbreak",z\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['line\nbreak', 'z']]);
  });

  it('reads codes, rates (one or several) and categories', () => {
    const csv = [
      'hsn_code,description,gst_rates,category',
      '2523,"Portland cement, aluminous cement","12;28",',
      '0401,Milk and cream,0,',
      '6109,T-shirts,"5, 12",Textiles & Garments',
      '3004,Medicaments,5|12,textiles',
    ].join('\n');
    const { rows, skipped } = rowsFromCsv(csv, cats);
    expect(skipped).toEqual([]);
    expect(rows).toEqual([
      { hsn_code: '2523', description: 'Portland cement, aluminous cement', gst_rate: 12, gst_rates: [12, 28], category: null },
      { hsn_code: '0401', description: 'Milk and cream', gst_rate: 0, gst_rates: [0], category: null },
      { hsn_code: '6109', description: 'T-shirts', gst_rate: 5, gst_rates: [5, 12], category: 'textiles' },
      { hsn_code: '3004', description: 'Medicaments', gst_rate: 5, gst_rates: [5, 12], category: 'textiles' },
    ]);
  });

  it('skips bad lines and says why, and needs the columns', () => {
    const csv = ['hsn_code,description,gst_rates', 'abc,Thing,5', '1001,,0', '1002,Wheat,x', '1003,Rice,5', '1003,Rice again,5'].join('\n');
    const { rows, skipped } = rowsFromCsv(csv);
    expect(rows.map(r => r.hsn_code)).toEqual(['1003']);
    expect(skipped).toHaveLength(4);
    expect(skipped[0]).toMatch(/line 2/);
    expect(skipped[3]).toMatch(/repeated/);
    expect(() => rowsFromCsv('hsn_code,description\n1,2')).toThrow(/gst_rates/);
    expect(() => rowsFromCsv('')).toThrow(/empty/);
  });
});
