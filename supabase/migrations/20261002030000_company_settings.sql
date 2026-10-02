-- Phase 2 of the multi-company platform: each logistic company has its own settings, invoicing identity and
-- invoice numbers (docs/tenancy-design.md, docs/platform-model.md).
--
--  1. public.invoice_counters: one row per (company, prefix, month). public.next_invoice_number() bumps it with a
--     single INSERT ... ON CONFLICT DO UPDATE ... RETURNING, so two deliveries issuing at once always get
--     different numbers (the row lock makes the second wait for the first), and a company counts its own sequence.
--  2. A unique index on organizations.profile ->> 'invoice_prefix': no two companies share a prefix, so the
--     existing UNIQUE (invoice_number) can never be hit by another company's number.
--  3. app.copy_company_settings(): copies the platform-wide company profile (system_settings.company_profile) into
--     the default company's organizations row (columns and profile), once. Its invoice prefix stays INV, the one
--     its invoices already carry.
--  4. app.seed_invoice_counters(): reads the numbers already issued (PREFIX-YYYYMM-NNNN) and starts each company's
--     counter at the highest, so live carries on from the current number.
--
-- Operational settings (fuel price, rates, dispatch phone, ...) need no schema: they live in
-- organizations.profile -> 'settings' and fall back to system_settings. Idempotent; safe to run again.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    EXECUTE 'CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION app_owner';
    SET LOCAL ROLE app_owner;
  ELSE
    CREATE SCHEMA IF NOT EXISTS app;
  END IF;
END $$;

-- ── 1. The counter ──────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoice_counters (
  org_id   uuid    NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  prefix   text    NOT NULL CHECK (prefix ~ '^[A-Z0-9]{1,8}$'),
  period   text    NOT NULL CHECK (period ~ '^[0-9]{6}$'),   -- YYYYMM, the Indian calendar month
  last_seq integer NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  PRIMARY KEY (org_id, prefix, period)
);
-- Only the backend (service role) reads and bumps it; no policy, so nobody else can
ALTER TABLE public.invoice_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoice_counters FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.invoice_counters TO service_role;

-- The next number of a company's sequence. Atomic: the upsert takes the row lock, so concurrent callers queue up.
CREATE OR REPLACE FUNCTION public.next_invoice_number(p_org uuid, p_prefix text, p_period text) RETURNS integer
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO public.invoice_counters AS c (org_id, prefix, period, last_seq)
  VALUES (p_org, p_prefix, p_period, 1)
  ON CONFLICT (org_id, prefix, period) DO UPDATE SET last_seq = c.last_seq + 1
  RETURNING c.last_seq $$;
REVOKE ALL ON FUNCTION public.next_invoice_number(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_invoice_number(uuid, text, text) TO service_role;

-- ── 2. One prefix per company ───────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_organizations_invoice_prefix
  ON public.organizations ((profile ->> 'invoice_prefix')) WHERE nullif(profile ->> 'invoice_prefix', '') IS NOT NULL;

-- ── 3. The default company takes over the platform-wide company profile ─────────────────────────────
-- system_settings.company_profile held the one company's details until now. They move into the company's own
-- row, once (company_settings_copied marks it), so a later edit in the company's Settings is never overwritten.
CREATE OR REPLACE FUNCTION app.copy_company_settings() RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  comp uuid := app.default_company_org_id();
  raw jsonb;
  clean jsonb;
BEGIN
  IF comp IS NULL THEN RETURN; END IF;
  SELECT s.value -> 'value' INTO raw FROM public.system_settings s WHERE s.key = 'company_profile';
  IF raw IS NULL OR jsonb_typeof(raw) <> 'object' THEN raw := '{}'::jsonb; END IF;
  -- blank values do not overwrite anything
  SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) INTO clean
    FROM jsonb_each(raw) e WHERE e.value NOT IN ('""'::jsonb, 'null'::jsonb);

  UPDATE public.organizations o SET
    profile    = o.profile || clean || jsonb_build_object('company_settings_copied', true,
                   'invoice_prefix', coalesce(nullif(o.profile ->> 'invoice_prefix', ''), 'INV')),
    legal_name = coalesce(nullif(clean ->> 'legal_name', ''), o.legal_name),
    gstin      = coalesce(nullif(clean ->> 'gstin', ''), o.gstin),
    pan        = coalesce(nullif(clean ->> 'pan', ''), o.pan),
    state      = coalesce(nullif(clean ->> 'state', ''), o.state),
    city       = coalesce(nullif(clean ->> 'city', ''), o.city),
    address    = coalesce(nullif(clean ->> 'address', ''), o.address),
    pincode    = coalesce(nullif(clean ->> 'pincode', ''), o.pincode),
    phone      = coalesce(nullif(clean ->> 'phone', ''), o.phone),
    email      = coalesce(nullif(clean ->> 'email', ''), o.email),
    updated_at = now()
  WHERE o.id = comp AND NOT (o.profile ? 'company_settings_copied');
END $$;

-- ── 4. Counters continue from the numbers already issued ────────────────────────────────────────────
-- Numbers look like PREFIX-YYYYMM-NNNN. Each company's counter starts at the highest it has issued per prefix and
-- month; a counter already ahead of that (numbers issued since) is left alone.
CREATE OR REPLACE FUNCTION app.seed_invoice_counters() RETURNS void
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO public.invoice_counters AS c (org_id, prefix, period, last_seq)
  SELECT i.issuer_org_id, m[1], m[2], max(m[3]::integer)
    FROM public.invoices i
    CROSS JOIN LATERAL regexp_match(i.invoice_number, '^([A-Z0-9]{1,8})-([0-9]{6})-([0-9]{1,9})$') AS m
   WHERE i.issuer_org_id IS NOT NULL AND m IS NOT NULL AND m[3]::bigint < 2000000000
   GROUP BY i.issuer_org_id, m[1], m[2]
  ON CONFLICT (org_id, prefix, period) DO UPDATE SET last_seq = greatest(c.last_seq, EXCLUDED.last_seq) $$;

SELECT app.copy_company_settings();
SELECT app.seed_invoice_counters();

RESET ROLE;
NOTIFY pgrst, 'reload schema';
