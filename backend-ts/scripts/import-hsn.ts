/**
 * Loads the full HSN master (5,000+ codes) from a CSV into public.hsn_codes, upserting on hsn_code.
 *
 *   npm run import:hsn -- path/to/hsn.csv [--dry-run]
 *
 * Columns (header row required, order free): hsn_code, description, gst_rates, category.
 *   - gst_rates: one rate or several separated by ; | or / ("5;12"). The first is the default rate (gst_rate).
 *   - category: a goods_categories key ("textiles") or its name ("Textiles & Garments"); optional. A row without one
 *     keeps the category it already has (new codes get "general").
 * The CBIC / GST portal HSN list is the usual source; the owner supplies the file.
 *
 * Every imported row is marked needs_review = true (the platform admin confirms rates in the admin console) and
 * source = 'import'. Flags set by hand (is_hazmat, is_perishable, eway_always, synonyms, keywords, rate_note) are not
 * touched on a code that already exists. Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY like the backend.
 */
import fs from 'fs';

export interface HsnCsvRow {
  hsn_code: string;
  description: string;
  gst_rate: number;
  gst_rates: number[];
  category: string | null;
}

/** RFC 4180-ish: quoted fields, doubled quotes, commas and line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(f => f.trim() !== '')) rows.push(row);
  return rows;
}

/** Rows of the CSV as HSN records; throws on a missing header, and returns the lines it skipped with the reason. */
export function rowsFromCsv(text: string, categoryKeys: (name: string) => string | null = () => null): { rows: HsnCsvRow[]; skipped: string[] } {
  const table = parseCsv(text);
  if (!table.length) throw new Error('The CSV is empty');
  const header = table[0].map(h => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  for (const need of ['hsn_code', 'description', 'gst_rates']) if (col(need) < 0) throw new Error(`The CSV needs a "${need}" column`);
  const iCode = col('hsn_code'), iDesc = col('description'), iRates = col('gst_rates'), iCat = col('category');

  const rows: HsnCsvRow[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  table.slice(1).forEach((r, n) => {
    const line = n + 2;
    const code = (r[iCode] ?? '').replace(/\s+/g, '');
    const description = (r[iDesc] ?? '').trim();
    if (!/^\d{2,8}$/.test(code)) return void skipped.push(`line ${line}: "${code}" is not an HSN code`);
    if (!description) return void skipped.push(`line ${line}: ${code} has no description`);
    if (seen.has(code)) return void skipped.push(`line ${line}: ${code} is repeated`);
    const rates = (r[iRates] ?? '').split(/[;|/]|,(?=\s*\d)/).map(s => s.replace('%', '').trim()).filter(Boolean).map(Number);
    if (!rates.length || rates.some(x => !Number.isFinite(x) || x < 0 || x > 100)) return void skipped.push(`line ${line}: ${code} has no valid GST rate`);
    seen.add(code);
    const rawCat = iCat >= 0 ? (r[iCat] ?? '').trim() : '';
    rows.push({ hsn_code: code, description, gst_rate: rates[0], gst_rates: [...new Set(rates)], category: rawCat ? (categoryKeys(rawCat) ?? null) : null });
  });
  return { rows, skipped };
}

const BATCH = 500;

async function main() {
  const args = process.argv.slice(2);
  const file = args.find(a => !a.startsWith('--'));
  const dry = args.includes('--dry-run');
  if (!file) {
    console.error('Usage: npm run import:hsn -- path/to/hsn.csv [--dry-run]');
    process.exit(1);
  }
  const { supabase } = await import('../src/core/supabase');

  const { data: cats, error: catError } = await supabase.from('goods_categories').select('key, name');
  if (catError) throw new Error(`Failed to read goods_categories: ${catError.message}`);
  const lookup = new Map<string, string>();
  for (const c of cats ?? []) { lookup.set(c.key.toLowerCase(), c.key); lookup.set(c.name.toLowerCase(), c.key); }

  const { rows, skipped } = rowsFromCsv(fs.readFileSync(file, 'utf8'), name => lookup.get(name.toLowerCase()) ?? null);
  console.log(`${rows.length} codes read, ${skipped.length} lines skipped`);
  for (const s of skipped.slice(0, 20)) console.log('  skipped', s);
  if (skipped.length > 20) console.log(`  ... and ${skipped.length - 20} more`);
  if (dry) return;

  // Rows with a category and rows without go in separate upserts, so a missing category never blanks an existing one
  const withCat = rows.filter(r => r.category).map(r => ({ ...r, source: 'import', needs_review: true, is_active: true }));
  const withoutCat = rows.filter(r => !r.category).map(({ category: _c, ...r }) => ({ ...r, source: 'import', needs_review: true, is_active: true }));
  let done = 0;
  for (const set of [withCat, withoutCat]) {
    for (let i = 0; i < set.length; i += BATCH) {
      const { error } = await supabase.from('hsn_codes').upsert(set.slice(i, i + BATCH), { onConflict: 'hsn_code' });
      if (error) throw new Error(`Upsert failed after ${done} codes: ${error.message}`);
      done += Math.min(BATCH, set.length - i);
    }
  }
  console.log(`Imported ${done} HSN codes (needs_review = true). The platform admin confirms the rates.`);
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
