"""6. Write supabase/migrations/20261005010000_hsn_master_gst2.sql from hsn_master.csv (+ extra.json)."""
import csv, json, os, sys

OUT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else sys.exit('Usage: gen_sql.py <path of the migration .sql>')
WORK = os.environ.get('GST_WORK') or sys.exit('Set GST_WORK to the folder that holds the downloads (never commit them)')
os.chdir(WORK)
out_path = OUT
ext = json.load(open('extra.json'))
rows = list(csv.DictReader(open('hsn_master.csv', encoding='utf-8')))
stats = json.load(open('stats.json'))


def q(s):
    return "'" + s.replace("'", "''") + "'"


def n(s):
    return 'NULL' if s == '' else q(s)


BATCH = 500
parts = []
parts.append(f"""-- HSN master with the current GST rates (GST 2.0). docs/gst-rates.md has the sources, the method and the limits.
--
-- Every code of the official HSN list (GST portal HSN_SAC.xlsx, sheet HSN_MSTR: {stats['total']} codes of 2, 4, 6 and 8
-- digits) with the rate the CBIC notifications give it today:
--   9/2025-Central Tax (Rate), 17 Sep 2025, in force 22 Sep 2025 (Schedules I-VII: GST 5 / 18 / 40 / 3 / 0.25 / 1.5 / 28),
--   10/2025-Central Tax (Rate) (nil-rated goods), 14/2025-Central Tax (Rate) (bricks, 12%),
--   19/2025-Central Tax (Rate), in force 1 Feb 2026 (tobacco and pan masala to 40%, biris 18%, Schedule VII omitted),
--   01/2026-Central Tax (Rate) + corrigendum of 6 May 2026, in force 1 May 2026 (2202 tariff items renumbered).
-- The same rows are in supabase/seed/hsn_master.csv (reviewable source data).
--
-- UPSERT on hsn_code, 500 rows a statement:
--   - a new code gets its description, rates, a goods category from its chapter, effective_from, source, needs_review;
--   - an existing code gets the official rates (gst_rate, gst_rates, rate_note, effective_from, source, needs_review)
--     and keeps what was curated by hand: description (when it has keywords or synonyms), category, keywords,
--     synonyms, is_hazmat, is_perishable, eway_always, is_active.
-- Then goods_categories.default_rates that still hold the retired 12% / 28% slabs move to the GST 2.0 ones.
--
-- Runs as app_owner where that role exists. Idempotent; safe to run again.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    SET LOCAL ROLE app_owner;
  END IF;
END $$;
""")
cols = '(hsn_code, description, gst_rate, gst_rates, rate_note, category, effective_from, needs_review, source, is_active)'
upd = """ON CONFLICT (hsn_code) DO UPDATE SET
  gst_rate = EXCLUDED.gst_rate,
  gst_rates = EXCLUDED.gst_rates,
  rate_note = EXCLUDED.rate_note,
  effective_from = EXCLUDED.effective_from,
  needs_review = EXCLUDED.needs_review,
  source = EXCLUDED.source,
  description = CASE WHEN cardinality(coalesce(h.keywords, '{}')) > 0 OR cardinality(coalesce(h.synonyms, '{}')) > 0
                     THEN h.description ELSE EXCLUDED.description END,
  updated_at = now();
"""
for i in range(0, len(rows), BATCH):
    chunk = rows[i:i + BATCH]
    vals = []
    for r in chunk:
        e = ext[r['hsn_code']]
        vals.append(f"({q(r['hsn_code'])}, {q(r['description'])}, {r['gst_rate']}, {q(r['gst_rates'])}, {n(r['rate_note'])}, "
                    f"{q(e['cat'])}, {q(e['eff'])}, {r['needs_review']}, {q(r['source'])}, true)")
    parts.append(f"-- rows {i + 1}-{i + len(chunk)}\nINSERT INTO public.hsn_codes AS h {cols} VALUES\n" + ',\n'.join(vals) + '\n' + upd)

parts.append("""-- Goods categories: the GST 2.0 rates, only where the retired 12% / 28% slabs are still there (an admin's edit stays)
UPDATE public.goods_categories AS g SET default_rates = v.rates
  FROM (VALUES
    ('textiles',        ARRAY[5, 18]::numeric[]),
    ('food_agri',       ARRAY[0, 5]::numeric[]),
    ('fmcg',            ARRAY[5, 18]::numeric[]),
    ('pharma',          ARRAY[0, 5]::numeric[]),
    ('auto_parts',      ARRAY[5, 18]::numeric[]),
    ('plastics_rubber', ARRAY[5, 18]::numeric[]),
    ('paper_packaging', ARRAY[5, 18]::numeric[]),
    ('furniture_wood',  ARRAY[5, 18]::numeric[]),
    ('construction',    ARRAY[5, 18]::numeric[])
  ) AS v(key, rates)
 WHERE g.key = v.key AND g.default_rates && ARRAY[12, 28]::numeric[];

-- Anything left on a retired slab is a hand-made row outside the HSN list; flag it for the platform admin
UPDATE public.hsn_codes SET needs_review = true
 WHERE gst_rate = 28 OR 28 = ANY(gst_rates)
    OR (12 = ANY(gst_rates) AND left(hsn_code, 4) NOT IN ('6815', '6901', '6904', '6905'));
""")
open(out_path, 'w', encoding='utf-8').write('\n'.join(parts))
print('wrote', out_path, os.path.getsize(out_path), 'bytes')
