-- The rules of 20261002030000_company_settings.sql, checked in a throwaway transaction (rolled back at the end):
--  * app.copy_company_settings() moves the platform-wide company profile into the default company's row, once
--  * app.seed_invoice_counters() starts each company's counter at the highest number it has issued
--  * public.next_invoice_number() counts per company, prefix and month, and is closed to everyone but the service role
--  * two companies cannot share an invoice prefix
-- Run as the database owner: docker exec -i supabase_db_margix-e2e psql -U postgres -v ON_ERROR_STOP=1 -f - < e2e/company-settings.sql
-- The concurrent part (many sessions at once) is e2e/company-settings-concurrency.sh.
\set ON_ERROR_STOP on
BEGIN;

CREATE FUNCTION pg_temp.expect(ok boolean, what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'COMPANY SETTINGS CHECK FAILED: %', what; END IF; RAISE NOTICE 'ok: %', what; END $$;

-- ── The default company takes over the platform-wide profile ────────────────────────────────────────
DO $$
DECLARE comp uuid := app.default_company_org_id();
BEGIN
  IF comp IS NULL THEN
    INSERT INTO public.organizations (kind, name, status) VALUES ('logistic_company', 'Default Test Co', 'active') RETURNING id INTO comp;
    INSERT INTO public.system_settings (key, value) VALUES ('default_company_org_id', jsonb_build_object('value', comp))
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  END IF;
  -- as Phase 1 left it: an older copy of the profile, no marker, no prefix
  UPDATE public.organizations SET legal_name = 'Old Name', gstin = NULL, state = 'Gujarat', city = NULL,
         profile = jsonb_build_object('legal_name', 'Old Name', 'state', 'Gujarat', 'bank_name', 'Old Bank')
   WHERE id = comp;
  INSERT INTO public.system_settings (key, value) VALUES ('company_profile', '{"value": {"legal_name": "Margix Logistics Pvt Ltd", "gstin": "27AAPFU0939F1ZV", "state": "Maharashtra", "city": "", "address": "Plot 4, Bhiwandi", "sac_code": "996511", "bank_name": "HDFC Bank", "bank_account_no": "50200012345678", "payment_terms_days": 30}}')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
END $$;

SELECT app.copy_company_settings();
SELECT pg_temp.expect((SELECT legal_name = 'Margix Logistics Pvt Ltd' AND gstin = '27AAPFU0939F1ZV' AND state = 'Maharashtra' AND address = 'Plot 4, Bhiwandi'
                         FROM public.organizations WHERE id = app.default_company_org_id()), 'the profile columns now hold the company profile');
SELECT pg_temp.expect((SELECT profile ->> 'sac_code' = '996511' AND profile ->> 'bank_name' = 'HDFC Bank' AND profile ->> 'bank_account_no' = '50200012345678'
                              AND (profile ->> 'payment_terms_days')::int = 30
                         FROM public.organizations WHERE id = app.default_company_org_id()), 'the profile holds SAC, bank and payment terms (the newer settings win over the Phase 1 copy)');
SELECT pg_temp.expect((SELECT profile ->> 'invoice_prefix' = 'INV' AND (profile ->> 'company_settings_copied')::boolean
                         FROM public.organizations WHERE id = app.default_company_org_id()), 'the default company keeps the INV prefix its invoices carry, and the copy is marked done');
SELECT pg_temp.expect((SELECT city IS NULL FROM public.organizations WHERE id = app.default_company_org_id()), 'a blank value does not overwrite anything');

-- A later edit in the company's own Settings is never overwritten by running it again
UPDATE public.organizations SET gstin = '24AAACC1206D1ZM', profile = profile || '{"gstin": "24AAACC1206D1ZM"}' WHERE id = app.default_company_org_id();
UPDATE public.system_settings SET value = '{"value": {"legal_name": "Platform Stale Name", "gstin": "27AAPFU0939F1ZV"}}' WHERE key = 'company_profile';
SELECT app.copy_company_settings();
SELECT pg_temp.expect((SELECT gstin = '24AAACC1206D1ZM' AND legal_name = 'Margix Logistics Pvt Ltd' FROM public.organizations WHERE id = app.default_company_org_id()),
                      'running the copy again keeps the company''s own edits');

-- ── Counters continue from the numbers already issued ───────────────────────────────────────────────
CREATE TEMP TABLE t_orgs AS
  WITH x AS (INSERT INTO public.organizations (kind, name, status, profile) VALUES ('logistic_company', 'Xylo Freight', 'active', '{"invoice_prefix": "XF"}') RETURNING id),
       y AS (INSERT INTO public.organizations (kind, name, status, profile) VALUES ('logistic_company', 'Yard Cargo', 'active', '{"invoice_prefix": "YC"}') RETURNING id)
  SELECT (SELECT id FROM x) AS x, (SELECT id FROM y) AS y;

INSERT INTO public.invoices (invoice_number, issuer_org_id) SELECT v.n, (SELECT x FROM t_orgs) FROM (VALUES
  ('XF-202610-0007'), ('XF-202610-0003'), ('XF-202609-0012'), ('NOT-A-NUMBER'), ('XF-2026-0001')) AS v(n);
INSERT INTO public.invoices (invoice_number, issuer_org_id) VALUES ('YC-202610-0002', (SELECT y FROM t_orgs));

SELECT app.seed_invoice_counters();
SELECT pg_temp.expect((SELECT last_seq FROM public.invoice_counters WHERE org_id = (SELECT x FROM t_orgs) AND prefix = 'XF' AND period = '202610') = 7, 'the counter starts at the highest number issued that month (0007)');
SELECT pg_temp.expect((SELECT last_seq FROM public.invoice_counters WHERE org_id = (SELECT x FROM t_orgs) AND prefix = 'XF' AND period = '202609') = 12, 'another month has its own counter (0012)');
SELECT pg_temp.expect((SELECT count(*) FROM public.invoice_counters WHERE org_id IN (SELECT x FROM t_orgs UNION SELECT y FROM t_orgs)) = 3, 'numbers that are not PREFIX-YYYYMM-NNNN are ignored; one counter per company, prefix and month');
SELECT pg_temp.expect((SELECT last_seq FROM public.invoice_counters WHERE org_id = (SELECT y FROM t_orgs)) = 2, 'a second company counts on its own');

SELECT pg_temp.expect(public.next_invoice_number((SELECT x FROM t_orgs), 'XF', '202610') = 8, 'live carries on from the current number (0008)');
SELECT app.seed_invoice_counters();
SELECT pg_temp.expect((SELECT last_seq FROM public.invoice_counters WHERE org_id = (SELECT x FROM t_orgs) AND prefix = 'XF' AND period = '202610') = 8, 'seeding again never moves a counter back');

-- ── Per company, per month, unique ──────────────────────────────────────────────────────────────────
SELECT pg_temp.expect(public.next_invoice_number((SELECT y FROM t_orgs), 'YC', '202610') = 3, 'the other company is not affected by the first one''s numbers');
SELECT pg_temp.expect(public.next_invoice_number((SELECT x FROM t_orgs), 'XF', '202611') = 1, 'a new month starts at 1');
SELECT pg_temp.expect((SELECT count(DISTINCT n) = 60 AND min(n) = 9 AND max(n) = 68
                         FROM (SELECT public.next_invoice_number((SELECT x FROM t_orgs), 'XF', '202610') AS n FROM generate_series(1, 60)) s),
                      '60 numbers in a row are all different and consecutive');

-- ── One prefix per company ──────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  BEGIN
    INSERT INTO public.organizations (kind, name, status, profile) VALUES ('logistic_company', 'Other Xylo', 'active', '{"invoice_prefix": "XF"}');
    RAISE EXCEPTION 'COMPANY SETTINGS CHECK FAILED: a second company took the prefix XF';
  EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'ok: two companies cannot share an invoice prefix';
  END;
END $$;

-- ── Only the backend can count ──────────────────────────────────────────────────────────────────────
SELECT pg_temp.expect(has_function_privilege('service_role', 'public.next_invoice_number(uuid,text,text)', 'EXECUTE')
                      AND NOT has_function_privilege('anon', 'public.next_invoice_number(uuid,text,text)', 'EXECUTE')
                      AND NOT has_function_privilege('authenticated', 'public.next_invoice_number(uuid,text,text)', 'EXECUTE'), 'only the service role can call next_invoice_number');
SELECT pg_temp.expect(NOT has_table_privilege('authenticated', 'public.invoice_counters', 'SELECT') AND NOT has_table_privilege('anon', 'public.invoice_counters', 'SELECT'),
                      'signed-in users and the public cannot read the counters');

ROLLBACK;
