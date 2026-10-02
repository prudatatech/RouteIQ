/**
 * The full official HSN master as production has it: supabase/seed/hsn_master.csv (the rows migration
 * 20261005010000_hsn_master_gst2.sql loads) with the hand-curated description, category, keywords, synonyms and flags of
 * migration 20261003010000_goods_master.sql on top (that migration's rows keep them when the master is loaded).
 */
import fs from 'fs';
import path from 'path';
import { parseCsv } from '../../scripts/import-hsn';
import type { HsnRow } from '../../src/services/goods/hsn-index';

const ROOT = path.resolve(__dirname, '../../..');

/** Splits "a, 'b, c', ARRAY['x', 'y']::text[]" at the top-level commas. */
function sqlFields(tuple: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  let depth = 0;
  for (let i = 0; i < tuple.length; i++) {
    const c = tuple[i];
    if (quoted) {
      if (c === "'" && tuple[i + 1] === "'") { cur += "''"; i++; continue; }
      if (c === "'") quoted = false;
      cur += c;
    } else if (c === "'") { quoted = true; cur += c; }
    else if (c === '[') { depth++; cur += c; }
    else if (c === ']') { depth--; cur += c; }
    else if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}
const sqlText = (v: string) => (v === 'NULL' ? null : v.replace(/^'|'$/g, '').replace(/''/g, "'"));
const sqlTextArray = (v: string) => [...v.matchAll(/'((?:[^']|'')*)'/g)].map(m => m[1].replace(/''/g, "'"));

/** The curated rows of the goods master migration: code -> description, category, keywords, synonyms, flags. */
export function curatedHsnRows(): Map<string, Partial<HsnRow>> {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261003010000_goods_master.sql'), 'utf8');
  const body = sql.slice(sql.indexOf('INSERT INTO public.hsn_codes'));
  const out = new Map<string, Partial<HsnRow>>();
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*\((.*)\),?$/);
    if (!m) continue;
    const f = sqlFields(m[1]);
    if (f.length < 13 || !/^'\d+'$/.test(f[0])) continue;
    out.set(sqlText(f[0])!, {
      description: sqlText(f[1])!, category: sqlText(f[5]), keywords: sqlTextArray(f[6]), synonyms: sqlTextArray(f[7]),
      is_hazmat: f[8] === 'true', is_perishable: f[9] === 'true', eway_always: f[10] === 'true',
    });
  }
  return out;
}

/** Every row of the official master; `curated: false` leaves out the hand-curated layer. */
export function hsnMasterRows({ curated = true } = {}): HsnRow[] {
  const table = parseCsv(fs.readFileSync(path.join(ROOT, 'supabase/seed/hsn_master.csv'), 'utf8'));
  const head = table[0];
  const col = (n: string) => head.indexOf(n);
  const extra = curated ? curatedHsnRows() : new Map<string, Partial<HsnRow>>();
  return table.slice(1).map(r => {
    const code = r[col('hsn_code')];
    return {
      hsn_code: code,
      description: r[col('description')],
      gst_rate: Number(r[col('gst_rate')]),
      gst_rates: r[col('gst_rates')].replace(/[{}]/g, '').split(',').map(Number),
      rate_note: r[col('rate_note')] || null,
      category: null,
      is_active: true,
      ...extra.get(code),
    };
  });
}
