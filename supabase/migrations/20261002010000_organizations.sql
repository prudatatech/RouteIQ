-- Phase 1 of the multi-company platform (docs/tenancy-design.md): organisations and data isolation.
--
--  1. organizations, org_members, tpl_affiliations, and the enums behind them.
--  2. carrier_org_id / vendor_org_id / issuer_org_id / bill_to_org_id on the operational tables.
--  3. app.user_org_ids() and app.is_platform_admin() for row-level security.
--  4. Safety nets: a null carrier_org_id (or issuer_org_id) is filled with the default company, and a new
--     public.users row joins the default company (or gets its own vendor organisation).
--  5. A backfill of today's data into one logistic company, "MargixIndia Logistics" (app.backfill_organizations(),
--     safe on an empty database and on one with data, and safe to run again).
--  6. Row-level security: the new tables, and an organisation condition added to the staff policies of the
--     tables that carry an owner column. No existing policy is loosened.
--
-- Runs in one transaction as the server administrator (no superuser). On Azure the app's tables belong to
-- app_owner, so the objects below are created as app_owner when that role exists. Additive and safe to re-run.

-- Schema "app" holds the helper functions. Created for app_owner where that role exists (Azure).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    EXECUTE 'CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION app_owner';
    SET LOCAL ROLE app_owner;
  ELSE
    CREATE SCHEMA IF NOT EXISTS app;
  END IF;
END $$;

GRANT USAGE ON SCHEMA app TO anon, authenticated, service_role;

-- ── 1. Enums and tables ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'org_kind' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.org_kind AS ENUM ('platform', 'logistic_company', 'vendor', 'tpl_partner');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'org_status' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.org_status AS ENUM ('pending', 'active', 'suspended', 'rejected');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'org_role' AND typnamespace = 'public'::regnamespace) THEN
    CREATE TYPE public.org_role AS ENUM ('owner', 'admin', 'ops', 'finance', 'dispatcher', 'driver', 'member');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        public.org_kind NOT NULL,
  name        text NOT NULL CHECK (length(btrim(name)) > 0),
  legal_name  text,
  gstin       text,
  pan         text,
  state       text,
  city        text,
  address     text,
  pincode     text,
  phone       text,
  email       text,
  status      public.org_status NOT NULL DEFAULT 'pending',
  -- invoicing details, bank, logo, settings; also where a backfilled organisation remembers where it came from
  profile     jsonb NOT NULL DEFAULT '{}'::jsonb,
  approved_by uuid,
  approved_at timestamptz,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_organizations_kind_status ON public.organizations (kind, status);
-- One organisation per legacy vendor user and per legacy 3PL partner, so the backfill and the triggers never duplicate
CREATE UNIQUE INDEX IF NOT EXISTS uq_organizations_legacy_user ON public.organizations ((profile ->> 'legacy_user_id')) WHERE kind = 'vendor' AND profile ? 'legacy_user_id';
CREATE UNIQUE INDEX IF NOT EXISTS uq_organizations_legacy_tpl ON public.organizations ((profile ->> 'legacy_tpl_partner_id')) WHERE kind = 'tpl_partner' AND profile ? 'legacy_tpl_partner_id';

CREATE TABLE IF NOT EXISTS public.org_members (
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role       public.org_role NOT NULL DEFAULT 'member',
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'removed')),
  invited_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON public.org_members (user_id, status);

CREATE TABLE IF NOT EXISTS public.tpl_affiliations (
  company_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tpl_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'paused', 'ended')),
  requested_by uuid,
  approved_by  uuid,
  approved_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, tpl_id),
  CHECK (company_id <> tpl_id)
);
CREATE INDEX IF NOT EXISTS idx_tpl_affiliations_tpl ON public.tpl_affiliations (tpl_id);

-- ── 2. Ownership columns ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vehicles', 'depots', 'routes', 'shipments', 'cargo_manifest', 'capacity_windows', 'cargo_exceptions',
                           'cargo_transfers', 'cargo_claims', 'driver_pay_entries', 'driver_pay_rates', 'driver_payouts', 'expenses',
                           'tpl_offers', 'tpl_orders', 'sos_alerts', 'maintenance_alerts', 'vehicle_maintenance_jobs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS carrier_org_id uuid REFERENCES public.organizations(id)', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (carrier_org_id)', 'idx_' || t || '_carrier_org', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['shipments', 'cargo_manifest', 'vendor_shipment_requests', 'capacity_bids', 'cargo_claims', 'customer_bookings'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS vendor_org_id uuid REFERENCES public.organizations(id)', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (vendor_org_id)', 'idx_' || t || '_vendor_org', t);
  END LOOP;
END $$;

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS issuer_org_id uuid REFERENCES public.organizations(id);
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS bill_to_org_id uuid REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_invoices_issuer_org ON public.invoices (issuer_org_id);
CREATE INDEX IF NOT EXISTS idx_invoices_bill_to_org ON public.invoices (bill_to_org_id);

DROP TRIGGER IF EXISTS organizations_updated_at ON public.organizations;
CREATE TRIGGER organizations_updated_at BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();

-- ── 3. Helper functions ─────────────────────────────────────────────────────────────────────────────
-- Ids of the organisations recorded in system_settings (value is {"value": "<uuid>"}, like the other settings)
CREATE OR REPLACE FUNCTION app.default_company_org_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT o.id FROM public.system_settings s
  JOIN public.organizations o ON o.id::text = s.value ->> 'value'
  WHERE s.key = 'default_company_org_id' $$;

CREATE OR REPLACE FUNCTION app.platform_org_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT o.id FROM public.system_settings s
  JOIN public.organizations o ON o.id::text = s.value ->> 'value'
  WHERE s.key = 'platform_org_id' $$;

-- The caller's active organisations: an active membership in an active organisation
CREATE OR REPLACE FUNCTION app.user_org_ids() RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(array_agg(m.org_id), '{}'::uuid[])
  FROM public.org_members m JOIN public.organizations o ON o.id = m.org_id
  WHERE m.user_id = auth.uid() AND m.status = 'active' AND o.status = 'active' $$;

-- The caller's active memberships whatever the organisation's status (a pending organisation still sees itself)
CREATE OR REPLACE FUNCTION app.member_org_ids() RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(array_agg(m.org_id), '{}'::uuid[]) FROM public.org_members m
  WHERE m.user_id = auth.uid() AND m.status = 'active' $$;

-- The organisations where the caller holds one of the given roles
CREATE OR REPLACE FUNCTION app.org_ids_with_role(roles public.org_role[]) RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(array_agg(m.org_id), '{}'::uuid[]) FROM public.org_members m
  WHERE m.user_id = auth.uid() AND m.status = 'active' AND m.role = ANY (roles) $$;

CREATE OR REPLACE FUNCTION app.is_platform_admin() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members m JOIN public.organizations o ON o.id = m.org_id
    WHERE m.user_id = auth.uid() AND m.status = 'active' AND m.role IN ('owner', 'admin')
      AND o.kind = 'platform' AND o.status = 'active') $$;

-- Organisations linked to the caller's by a 3PL affiliation (a company sees its 3PLs, a 3PL its companies)
CREATE OR REPLACE FUNCTION app.affiliated_org_ids() RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(array_agg(x.id), '{}'::uuid[]) FROM (
    SELECT a.tpl_id AS id FROM public.tpl_affiliations a
      WHERE a.company_id = ANY (SELECT unnest(app.member_org_ids())) AND a.status <> 'ended'
    UNION
    SELECT a.company_id FROM public.tpl_affiliations a
      WHERE a.tpl_id = ANY (SELECT unnest(app.member_org_ids())) AND a.status <> 'ended') x $$;

GRANT EXECUTE ON FUNCTION app.user_org_ids(), app.member_org_ids(), app.org_ids_with_role(public.org_role[]), app.is_platform_admin(),
  app.affiliated_org_ids(), app.default_company_org_id(), app.platform_org_id()
  TO anon, authenticated, service_role;

-- ── 4. Organisations for vendors and 3PL partners (used by the backfill and by the triggers) ──────────
-- The vendor organisation of a user, made on first use. Name and status follow the vendor profile when there is one.
CREATE OR REPLACE FUNCTION app.sync_vendor_org(uid uuid) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  org uuid;
  vp public.vendor_profiles%ROWTYPE;
  u public.users%ROWTYPE;
  org_name text;
  want public.org_status;
BEGIN
  SELECT * INTO u FROM public.users WHERE id = uid;
  SELECT * INTO vp FROM public.vendor_profiles WHERE id = uid;
  IF u.id IS NULL AND vp.id IS NULL THEN RETURN NULL; END IF;
  SELECT o.id INTO org FROM public.organizations o WHERE o.kind = 'vendor' AND o.profile ->> 'legacy_user_id' = uid::text;
  org_name := coalesce(nullif(btrim(vp.company_name), ''), nullif(btrim(u.full_name), ''), nullif(btrim(u.email), ''), 'Vendor');
  want := CASE WHEN vp.kyc_status = 'approved' THEN 'active' ELSE 'pending' END;

  IF org IS NULL THEN
    INSERT INTO public.organizations (kind, name, legal_name, gstin, city, address, status, approved_at, created_by, profile)
    VALUES ('vendor', org_name, nullif(btrim(vp.company_name), ''), nullif(btrim(vp.gst_number), ''), vp.city, vp.address, want,
            CASE WHEN want = 'active' THEN now() END, uid, jsonb_build_object('legacy_user_id', uid))
    RETURNING id INTO org;
  ELSIF vp.id IS NOT NULL THEN
    UPDATE public.organizations o SET
      name = org_name,
      legal_name = coalesce(nullif(btrim(vp.company_name), ''), o.legal_name),
      gstin = coalesce(nullif(btrim(vp.gst_number), ''), o.gstin),
      city = coalesce(vp.city, o.city),
      address = coalesce(vp.address, o.address),
      -- an approved KYC activates a pending organisation; nothing here ever reverses a suspension or rejection
      status = CASE WHEN o.status = 'pending' AND want = 'active' THEN 'active'::public.org_status ELSE o.status END,
      approved_at = CASE WHEN o.status = 'pending' AND want = 'active' THEN now() ELSE o.approved_at END
    WHERE o.id = org;
  END IF;

  IF u.id IS NOT NULL THEN
    INSERT INTO public.org_members (org_id, user_id, role, status) VALUES (org, uid, 'owner', 'active') ON CONFLICT DO NOTHING;
  END IF;
  RETURN org;
END $$;

CREATE OR REPLACE FUNCTION app.vendor_org_of(uid uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT o.id FROM public.organizations o WHERE o.kind = 'vendor' AND o.profile ->> 'legacy_user_id' = uid::text $$;

-- The 3PL organisation of a partner row, and its affiliation to the default company
CREATE OR REPLACE FUNCTION app.sync_tpl_org(partner_id uuid) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  tp public.tpl_partners%ROWTYPE;
  org uuid;
  company uuid := app.default_company_org_id();
  org_status public.org_status;
  aff_status text;
BEGIN
  SELECT * INTO tp FROM public.tpl_partners WHERE id = partner_id;
  IF tp.id IS NULL THEN RETURN NULL; END IF;
  org_status := CASE tp.status WHEN 'active' THEN 'active' WHEN 'rejected' THEN 'rejected' WHEN 'paused' THEN 'suspended' ELSE 'pending' END;
  aff_status := CASE tp.status WHEN 'active' THEN 'active' WHEN 'paused' THEN 'paused' WHEN 'rejected' THEN 'ended' ELSE 'pending' END;
  SELECT o.id INTO org FROM public.organizations o WHERE o.kind = 'tpl_partner' AND o.profile ->> 'legacy_tpl_partner_id' = tp.id::text;

  IF org IS NULL THEN
    INSERT INTO public.organizations (kind, name, legal_name, gstin, pan, phone, email, status, approved_at, created_by, profile)
    VALUES ('tpl_partner', coalesce(nullif(btrim(tp.company_name), ''), '3PL partner'), nullif(btrim(tp.company_name), ''), nullif(btrim(tp.gstin), ''), nullif(btrim(tp.pan_number), ''), tp.phone, tp.email,
            org_status, CASE WHEN org_status = 'active' THEN now() END, tp.user_id,
            jsonb_build_object('legacy_tpl_partner_id', tp.id, 'custom_id', tp.custom_id))
    RETURNING id INTO org;
  ELSE
    UPDATE public.organizations o SET
      name = coalesce(nullif(btrim(tp.company_name), ''), o.name), legal_name = coalesce(nullif(btrim(tp.company_name), ''), o.legal_name),
      gstin = coalesce(nullif(btrim(tp.gstin), ''), o.gstin), pan = coalesce(nullif(btrim(tp.pan_number), ''), o.pan),
      phone = coalesce(tp.phone, o.phone), email = coalesce(tp.email, o.email),
      status = org_status,
      approved_at = CASE WHEN org_status = 'active' AND o.approved_at IS NULL THEN now() ELSE o.approved_at END
    WHERE o.id = org;
  END IF;

  IF tp.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.users WHERE id = tp.user_id) THEN
    INSERT INTO public.org_members (org_id, user_id, role, status) VALUES (org, tp.user_id, 'owner', 'active') ON CONFLICT DO NOTHING;
  END IF;
  IF company IS NOT NULL THEN
    INSERT INTO public.tpl_affiliations (company_id, tpl_id, status, approved_at)
    VALUES (company, org, aff_status, CASE WHEN aff_status = 'active' THEN now() END)
    ON CONFLICT (company_id, tpl_id) DO UPDATE SET
      status = EXCLUDED.status,
      approved_at = CASE WHEN EXCLUDED.status = 'active' THEN coalesce(public.tpl_affiliations.approved_at, now()) ELSE public.tpl_affiliations.approved_at END;
  END IF;
  RETURN org;
END $$;

-- ── 5. Triggers: default owner, auto-membership, and new vendor / 3PL records ───────────────────────────
CREATE OR REPLACE FUNCTION app.default_carrier_org() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.carrier_org_id IS NULL THEN NEW.carrier_org_id := app.default_company_org_id(); END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.default_issuer_org() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.issuer_org_id IS NULL THEN NEW.issuer_org_id := app.default_company_org_id(); END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vehicles', 'depots', 'routes', 'shipments', 'cargo_manifest', 'capacity_windows', 'cargo_exceptions',
                           'cargo_transfers', 'cargo_claims', 'driver_pay_entries', 'driver_pay_rates', 'driver_payouts', 'expenses',
                           'tpl_offers', 'tpl_orders', 'sos_alerts', 'maintenance_alerts', 'vehicle_maintenance_jobs'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_default_carrier_org ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_default_carrier_org BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION app.default_carrier_org()', t);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_default_issuer_org ON public.invoices;
CREATE TRIGGER trg_default_issuer_org BEFORE INSERT ON public.invoices FOR EACH ROW EXECUTE FUNCTION app.default_issuer_org();

-- A person's memberships follow their app role: superadmin -> platform owner and company owner, admin -> company
-- admin, manager -> company ops, driver -> company driver, vendor -> owner of their own (pending) vendor
-- organisation. A new row only adds what is missing (a removed member stays removed); a role change updates the
-- company role, and takes platform ownership away from someone who is no longer a superadmin.
CREATE OR REPLACE FUNCTION app.sync_user_membership() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  company uuid := app.default_company_org_id();
  platform uuid := app.platform_org_id();
  company_role public.org_role;
  changed boolean := TG_OP = 'UPDATE';
BEGIN
  IF NEW.role::text = 'vendor' THEN
    PERFORM app.sync_vendor_org(NEW.id);
    RETURN NEW;
  END IF;
  company_role := CASE NEW.role::text
    WHEN 'superadmin' THEN 'owner' WHEN 'admin' THEN 'admin' WHEN 'manager' THEN 'ops' WHEN 'driver' THEN 'driver' END;
  IF company_role IS NULL THEN RETURN NEW; END IF;

  IF company IS NOT NULL THEN
    IF changed THEN
      INSERT INTO public.org_members (org_id, user_id, role, status) VALUES (company, NEW.id, company_role, 'active')
      ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role WHERE public.org_members.status <> 'removed';
    ELSE
      INSERT INTO public.org_members (org_id, user_id, role, status) VALUES (company, NEW.id, company_role, 'active') ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  IF platform IS NOT NULL THEN
    IF NEW.role::text = 'superadmin' THEN
      INSERT INTO public.org_members (org_id, user_id, role, status) VALUES (platform, NEW.id, 'owner', 'active')
      ON CONFLICT (org_id, user_id) DO UPDATE SET role = 'owner', status = 'active' WHERE public.org_members.status <> 'removed' OR changed;
    ELSIF changed THEN
      UPDATE public.org_members SET status = 'removed' WHERE org_id = platform AND user_id = NEW.id AND status <> 'removed';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_user_membership_insert ON public.users;
CREATE TRIGGER trg_user_membership_insert AFTER INSERT ON public.users
  FOR EACH ROW EXECUTE FUNCTION app.sync_user_membership();
DROP TRIGGER IF EXISTS trg_user_membership_role ON public.users;
CREATE TRIGGER trg_user_membership_role AFTER UPDATE OF role ON public.users
  FOR EACH ROW WHEN (OLD.role IS DISTINCT FROM NEW.role) EXECUTE FUNCTION app.sync_user_membership();

CREATE OR REPLACE FUNCTION app.sync_vendor_profile_org() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app.sync_vendor_org(NEW.id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_vendor_profile_org ON public.vendor_profiles;
CREATE TRIGGER trg_vendor_profile_org AFTER INSERT OR UPDATE OF company_name, gst_number, city, address, kyc_status ON public.vendor_profiles
  FOR EACH ROW EXECUTE FUNCTION app.sync_vendor_profile_org();

CREATE OR REPLACE FUNCTION app.sync_tpl_partner_org() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app.sync_tpl_org(NEW.id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_tpl_partner_org ON public.tpl_partners;
CREATE TRIGGER trg_tpl_partner_org AFTER INSERT OR UPDATE OF company_name, gstin, pan_number, phone, email, status, user_id ON public.tpl_partners
  FOR EACH ROW EXECUTE FUNCTION app.sync_tpl_partner_org();

-- An affiliation joins a logistic company and a 3PL partner, nothing else
CREATE OR REPLACE FUNCTION app.check_tpl_affiliation() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = NEW.company_id AND kind = 'logistic_company') THEN
    RAISE EXCEPTION 'company_id must be a logistic company' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = NEW.tpl_id AND kind = 'tpl_partner') THEN
    RAISE EXCEPTION 'tpl_id must be a 3PL partner' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_check_tpl_affiliation ON public.tpl_affiliations;
CREATE TRIGGER trg_check_tpl_affiliation BEFORE INSERT OR UPDATE OF company_id, tpl_id ON public.tpl_affiliations
  FOR EACH ROW EXECUTE FUNCTION app.check_tpl_affiliation();

-- Owners and admins of an organisation edit its details; only a platform admin changes what it is or whether it is approved
CREATE OR REPLACE FUNCTION app.guard_org_update() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'authenticated' OR app.is_platform_admin() THEN RETURN NEW; END IF;
  IF NEW.kind IS DISTINCT FROM OLD.kind OR NEW.status IS DISTINCT FROM OLD.status OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
     OR NEW.approved_at IS DISTINCT FROM OLD.approved_at OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Only a platform admin can change the type or approval of an organisation' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_org_update ON public.organizations;
CREATE TRIGGER trg_guard_org_update BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION app.guard_org_update();

-- ── 6. Backfill ─────────────────────────────────────────────────────────────────────────────────────
-- Creates the platform organisation and the default company when they do not exist yet, hands today's rows to
-- the company, turns vendor profiles and 3PL partners into organisations, and gives everyone their memberships.
-- Every step skips what is already done, so it can run on an empty database, on one with data, and again.
CREATE OR REPLACE FUNCTION app.backfill_organizations() RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  plat uuid := app.platform_org_id();
  comp uuid := app.default_company_org_id();
  raw jsonb;
  t text;
  r record;
BEGIN
  IF plat IS NULL THEN
    INSERT INTO public.organizations (kind, name, legal_name, status, approved_at)
    VALUES ('platform', 'MargixIndia', 'MargixIndia', 'active', now()) RETURNING id INTO plat;
    INSERT INTO public.system_settings (key, value) VALUES ('platform_org_id', jsonb_build_object('value', plat))
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  END IF;

  IF comp IS NULL THEN
    SELECT s.value -> 'value' INTO raw FROM public.system_settings s WHERE s.key = 'company_profile';
    IF raw IS NULL OR jsonb_typeof(raw) <> 'object' THEN raw := '{}'::jsonb; END IF;
    INSERT INTO public.organizations (kind, name, legal_name, gstin, pan, state, city, address, pincode, phone, email, status, approved_at, profile)
    VALUES ('logistic_company', 'MargixIndia Logistics',
            coalesce(nullif(raw ->> 'legal_name', ''), 'MargixIndia Logistics'),
            nullif(raw ->> 'gstin', ''), nullif(raw ->> 'pan', ''), nullif(raw ->> 'state', ''), nullif(raw ->> 'city', ''),
            nullif(raw ->> 'address', ''), nullif(raw ->> 'pincode', ''), nullif(raw ->> 'phone', ''), nullif(raw ->> 'email', ''),
            'active', now(), raw)
    RETURNING id INTO comp;
    INSERT INTO public.system_settings (key, value) VALUES ('default_company_org_id', jsonb_build_object('value', comp))
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  END IF;

  -- Vendors and 3PL partners become organisations first, so the rows below can point at them
  FOR r IN SELECT id FROM public.vendor_profiles LOOP
    PERFORM app.sync_vendor_org(r.id);
  END LOOP;
  FOR r IN SELECT id FROM public.tpl_partners LOOP
    PERFORM app.sync_tpl_org(r.id);
  END LOOP;

  -- Everything that runs the logistics belongs to the default company
  FOREACH t IN ARRAY ARRAY['vehicles', 'depots', 'routes', 'shipments', 'cargo_manifest', 'capacity_windows', 'cargo_exceptions',
                           'cargo_transfers', 'cargo_claims', 'driver_pay_entries', 'driver_pay_rates', 'driver_payouts', 'expenses',
                           'tpl_offers', 'tpl_orders', 'sos_alerts', 'maintenance_alerts', 'vehicle_maintenance_jobs'] LOOP
    EXECUTE format('UPDATE public.%I SET carrier_org_id = $1 WHERE carrier_org_id IS NULL', t) USING comp;
  END LOOP;
  UPDATE public.invoices SET issuer_org_id = comp WHERE issuer_org_id IS NULL;

  -- Vendor side: each vendor's requests, bids, loads, claims and invoices carry the vendor's organisation
  UPDATE public.vendor_shipment_requests x SET vendor_org_id = app.vendor_org_of(x.vendor_id)
    WHERE x.vendor_org_id IS NULL AND x.vendor_id IS NOT NULL AND app.vendor_org_of(x.vendor_id) IS NOT NULL;
  UPDATE public.capacity_bids x SET vendor_org_id = app.vendor_org_of(x.vendor_id)
    WHERE x.vendor_org_id IS NULL AND x.vendor_id IS NOT NULL AND app.vendor_org_of(x.vendor_id) IS NOT NULL;
  UPDATE public.cargo_manifest m SET vendor_org_id = q.vendor_org_id
    FROM public.vendor_shipment_requests q
    WHERE m.vendor_request_id = q.id AND m.vendor_org_id IS NULL AND q.vendor_org_id IS NOT NULL;
  UPDATE public.shipments s SET vendor_org_id = b.vendor_org_id
    FROM public.capacity_bids b
    WHERE s.bid_id = b.id AND s.vendor_org_id IS NULL AND b.vendor_org_id IS NOT NULL;
  UPDATE public.cargo_claims c SET vendor_org_id = app.vendor_org_of(c.raised_by)
    WHERE c.vendor_org_id IS NULL AND c.raised_by_role = 'vendor' AND c.raised_by IS NOT NULL AND app.vendor_org_of(c.raised_by) IS NOT NULL;
  UPDATE public.invoices i SET bill_to_org_id = app.vendor_org_of(i.vendor_id)
    WHERE i.bill_to_org_id IS NULL AND i.vendor_id IS NOT NULL AND app.vendor_org_of(i.vendor_id) IS NOT NULL;

  -- Memberships by app role (vendors and 3PL owners were handled above)
  INSERT INTO public.org_members (org_id, user_id, role, status)
    SELECT plat, u.id, 'owner', 'active' FROM public.users u WHERE u.role = 'superadmin' ON CONFLICT DO NOTHING;
  INSERT INTO public.org_members (org_id, user_id, role, status)
    SELECT comp, u.id,
           CASE u.role::text WHEN 'superadmin' THEN 'owner' WHEN 'admin' THEN 'admin' WHEN 'manager' THEN 'ops' ELSE 'driver' END::public.org_role,
           'active'
    FROM public.users u WHERE u.role::text IN ('superadmin', 'admin', 'manager', 'driver') ON CONFLICT DO NOTHING;
END $$;

REVOKE ALL ON FUNCTION app.backfill_organizations(), app.sync_vendor_org(uuid), app.sync_tpl_org(uuid) FROM PUBLIC;

SELECT app.backfill_organizations();

-- ── 7. Row-level security: the new tables ───────────────────────────────────────────────────────────
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tpl_affiliations ENABLE ROW LEVEL SECURITY;

-- Members read their own organisations and the ones linked to them by a 3PL affiliation; owners and admins edit
-- their own organisation's details; platform admins read and write everything. Organisations are created by the
-- backend (service role).
DROP POLICY IF EXISTS organizations_read ON public.organizations;
CREATE POLICY organizations_read ON public.organizations FOR SELECT TO authenticated
  USING (id = ANY ((SELECT app.member_org_ids())) OR id = ANY ((SELECT app.affiliated_org_ids())) OR (SELECT app.is_platform_admin()));
DROP POLICY IF EXISTS organizations_update_admin ON public.organizations;
CREATE POLICY organizations_update_admin ON public.organizations FOR UPDATE TO authenticated
  USING (id = ANY ((SELECT app.org_ids_with_role(ARRAY['owner', 'admin']::public.org_role[]))))
  WITH CHECK (id = ANY ((SELECT app.org_ids_with_role(ARRAY['owner', 'admin']::public.org_role[]))));
DROP POLICY IF EXISTS organizations_platform ON public.organizations;
CREATE POLICY organizations_platform ON public.organizations FOR ALL TO authenticated
  USING ((SELECT app.is_platform_admin())) WITH CHECK ((SELECT app.is_platform_admin()));

-- Members read each other; owners and admins manage members (only an owner touches an owner)
DROP POLICY IF EXISTS org_members_read ON public.org_members;
CREATE POLICY org_members_read ON public.org_members FOR SELECT TO authenticated
  USING (org_id = ANY ((SELECT app.member_org_ids())) OR (SELECT app.is_platform_admin()));
DROP POLICY IF EXISTS org_members_manage ON public.org_members;
CREATE POLICY org_members_manage ON public.org_members FOR ALL TO authenticated
  USING (org_id = ANY ((SELECT app.org_ids_with_role(ARRAY['owner', 'admin']::public.org_role[])))
         AND (role <> 'owner' OR org_id = ANY ((SELECT app.org_ids_with_role(ARRAY['owner']::public.org_role[])))))
  WITH CHECK (org_id = ANY ((SELECT app.org_ids_with_role(ARRAY['owner', 'admin']::public.org_role[])))
              AND (role <> 'owner' OR org_id = ANY ((SELECT app.org_ids_with_role(ARRAY['owner']::public.org_role[])))));
DROP POLICY IF EXISTS org_members_platform ON public.org_members;
CREATE POLICY org_members_platform ON public.org_members FOR ALL TO authenticated
  USING ((SELECT app.is_platform_admin())) WITH CHECK ((SELECT app.is_platform_admin()));

-- Either side of an affiliation reads it; a 3PL's owner or admin asks to join (always pending); the company's owner or
-- admin decides; platform admins do anything
DROP POLICY IF EXISTS tpl_affiliations_read ON public.tpl_affiliations;
CREATE POLICY tpl_affiliations_read ON public.tpl_affiliations FOR SELECT TO authenticated
  USING (company_id = ANY ((SELECT app.member_org_ids())) OR tpl_id = ANY ((SELECT app.member_org_ids())) OR (SELECT app.is_platform_admin()));
DROP POLICY IF EXISTS tpl_affiliations_request ON public.tpl_affiliations;
CREATE POLICY tpl_affiliations_request ON public.tpl_affiliations FOR INSERT TO authenticated
  WITH CHECK (status = 'pending' AND tpl_id = ANY ((SELECT app.org_ids_with_role(ARRAY['owner', 'admin']::public.org_role[]))));
DROP POLICY IF EXISTS tpl_affiliations_decide ON public.tpl_affiliations;
CREATE POLICY tpl_affiliations_decide ON public.tpl_affiliations FOR UPDATE TO authenticated
  USING (company_id = ANY ((SELECT app.org_ids_with_role(ARRAY['owner', 'admin']::public.org_role[]))))
  WITH CHECK (company_id = ANY ((SELECT app.org_ids_with_role(ARRAY['owner', 'admin']::public.org_role[]))));
DROP POLICY IF EXISTS tpl_affiliations_platform ON public.tpl_affiliations;
CREATE POLICY tpl_affiliations_platform ON public.tpl_affiliations FOR ALL TO authenticated
  USING ((SELECT app.is_platform_admin())) WITH CHECK ((SELECT app.is_platform_admin()));

-- The API roles read through RLS; writes by the app go through the service role
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations, public.org_members, public.tpl_affiliations TO authenticated, service_role;

-- ── 8. Row-level security: an organisation condition on the existing staff policies ───────────────────
-- The condition is: carrier_org_id (and vendor_org_id where the table has one) is one of the caller's active
-- organisations, or the caller is a platform admin. Only tables that carry an owner column. Each policy keeps its name and every existing branch; the staff
-- branch (or the admin branch, for driver pay) now also needs the row to belong to one of the caller's
-- organisations, or the caller to be a platform admin. Driver, vendor and own-row branches are unchanged.
-- Tables owned only by a vendor (vendor_shipment_requests, capacity_bids, customer_bookings) keep their policies
-- until orders are routed to companies in Phase 2.
DROP POLICY IF EXISTS vehicles_select ON public.vehicles;
CREATE POLICY vehicles_select ON public.vehicles FOR SELECT TO authenticated
  USING ((( SELECT public.is_staff() AS is_staff) AND (carrier_org_id = ANY ((SELECT app.user_org_ids())) OR (SELECT app.is_platform_admin()))) OR (driver_id = auth.uid()));

DROP POLICY IF EXISTS shipments_select_staff ON public.shipments;
CREATE POLICY shipments_select_staff ON public.shipments FOR SELECT TO authenticated
  USING (( SELECT public.is_staff() AS is_staff) AND (carrier_org_id = ANY ((SELECT app.user_org_ids())) OR vendor_org_id = ANY ((SELECT app.user_org_ids())) OR (SELECT app.is_platform_admin())));

DROP POLICY IF EXISTS routes_select ON public.routes;
CREATE POLICY routes_select ON public.routes FOR SELECT TO authenticated
  USING ((( SELECT public.is_staff() AS is_staff) AND (carrier_org_id = ANY ((SELECT app.user_org_ids())) OR (SELECT app.is_platform_admin()))) OR (vehicle_id IN ( SELECT public.my_vehicle_ids() AS my_vehicle_ids)));

DROP POLICY IF EXISTS cargo_manifest_select ON public.cargo_manifest;
CREATE POLICY cargo_manifest_select ON public.cargo_manifest FOR SELECT TO authenticated
  USING ((( SELECT public.is_staff() AS is_staff) AND (carrier_org_id = ANY ((SELECT app.user_org_ids())) OR vendor_org_id = ANY ((SELECT app.user_org_ids())) OR (SELECT app.is_platform_admin()))) OR (vehicle_id IN ( SELECT public.my_vehicle_ids() AS my_vehicle_ids)) OR (vendor_request_id IN ( SELECT vendor_shipment_requests.id
   FROM public.vendor_shipment_requests
  WHERE (vendor_shipment_requests.vendor_id = auth.uid()))));

DROP POLICY IF EXISTS capacity_windows_select ON public.capacity_windows;
CREATE POLICY capacity_windows_select ON public.capacity_windows FOR SELECT TO authenticated
  USING ((( SELECT public.is_staff() AS is_staff) AND (carrier_org_id = ANY ((SELECT app.user_org_ids())) OR (SELECT app.is_platform_admin()))) OR (vehicle_id IN ( SELECT public.my_vehicle_ids() AS my_vehicle_ids)) OR ((( SELECT public.current_app_role() AS current_app_role) = 'vendor'::text) AND (id IN ( SELECT public.vendor_visible_window_ids() AS vendor_visible_window_ids))));

DROP POLICY IF EXISTS sos_alerts_select_staff ON public.sos_alerts;
CREATE POLICY sos_alerts_select_staff ON public.sos_alerts FOR SELECT TO authenticated
  USING (( SELECT public.is_staff() AS is_staff) AND (carrier_org_id = ANY ((SELECT app.user_org_ids())) OR (SELECT app.is_platform_admin())));

DROP POLICY IF EXISTS cargo_claims_staff ON public.cargo_claims;
CREATE POLICY cargo_claims_staff ON public.cargo_claims TO authenticated
  USING (( SELECT public.is_staff() AS is_staff) AND (carrier_org_id = ANY ((SELECT app.user_org_ids())) OR vendor_org_id = ANY ((SELECT app.user_org_ids())) OR (SELECT app.is_platform_admin())))
  WITH CHECK (( SELECT public.is_staff() AS is_staff) AND (carrier_org_id = ANY ((SELECT app.user_org_ids())) OR vendor_org_id = ANY ((SELECT app.user_org_ids())) OR (SELECT app.is_platform_admin())));

DROP POLICY IF EXISTS cargo_exceptions_staff ON public.cargo_exceptions;
CREATE POLICY cargo_exceptions_staff ON public.cargo_exceptions TO authenticated
  USING (( SELECT public.is_staff() AS is_staff) AND (carrier_org_id = ANY ((SELECT app.user_org_ids())) OR (SELECT app.is_platform_admin())))
  WITH CHECK (( SELECT public.is_staff() AS is_staff) AND (carrier_org_id = ANY ((SELECT app.user_org_ids())) OR (SELECT app.is_platform_admin())));

DROP POLICY IF EXISTS cargo_transfers_staff ON public.cargo_transfers;
CREATE POLICY cargo_transfers_staff ON public.cargo_transfers TO authenticated
  USING (( SELECT public.is_staff() AS is_staff) AND (carrier_org_id = ANY ((SELECT app.user_org_ids())) OR (SELECT app.is_platform_admin())))
  WITH CHECK (( SELECT public.is_staff() AS is_staff) AND (carrier_org_id = ANY ((SELECT app.user_org_ids())) OR (SELECT app.is_platform_admin())));

DROP POLICY IF EXISTS expenses_staff ON public.expenses;
CREATE POLICY expenses_staff ON public.expenses TO authenticated
  USING (( SELECT public.is_staff() AS is_staff) AND (carrier_org_id = ANY ((SELECT app.user_org_ids())) OR (SELECT app.is_platform_admin())))
  WITH CHECK (( SELECT public.is_staff() AS is_staff) AND (carrier_org_id = ANY ((SELECT app.user_org_ids())) OR (SELECT app.is_platform_admin())));

DROP POLICY IF EXISTS vehicle_maintenance_jobs_staff ON public.vehicle_maintenance_jobs;
CREATE POLICY vehicle_maintenance_jobs_staff ON public.vehicle_maintenance_jobs TO authenticated
  USING (( SELECT public.is_staff() AS is_staff) AND (carrier_org_id = ANY ((SELECT app.user_org_ids())) OR (SELECT app.is_platform_admin())))
  WITH CHECK (( SELECT public.is_staff() AS is_staff) AND (carrier_org_id = ANY ((SELECT app.user_org_ids())) OR (SELECT app.is_platform_admin())));

DROP POLICY IF EXISTS tpl_offers_staff_all ON public.tpl_offers;
CREATE POLICY tpl_offers_staff_all ON public.tpl_offers TO authenticated
  USING (( SELECT public.is_staff() AS is_staff) AND (carrier_org_id = ANY ((SELECT app.user_org_ids())) OR (SELECT app.is_platform_admin())))
  WITH CHECK (( SELECT public.is_staff() AS is_staff) AND (carrier_org_id = ANY ((SELECT app.user_org_ids())) OR (SELECT app.is_platform_admin())));

DROP POLICY IF EXISTS tpl_orders_staff_all ON public.tpl_orders;
CREATE POLICY tpl_orders_staff_all ON public.tpl_orders TO authenticated
  USING (( SELECT public.is_staff() AS is_staff) AND (carrier_org_id = ANY ((SELECT app.user_org_ids())) OR (SELECT app.is_platform_admin())))
  WITH CHECK (( SELECT public.is_staff() AS is_staff) AND (carrier_org_id = ANY ((SELECT app.user_org_ids())) OR (SELECT app.is_platform_admin())));

-- Invoices: the vendor reads the ones billed to them (as before); staff the ones their company issued
DROP POLICY IF EXISTS invoices_select ON public.invoices;
CREATE POLICY invoices_select ON public.invoices FOR SELECT TO authenticated
  USING ((vendor_id = auth.uid()) OR (( SELECT public.is_staff() AS is_staff) AND (issuer_org_id = ANY ((SELECT app.user_org_ids())) OR (SELECT app.is_platform_admin()))));
DROP POLICY IF EXISTS invoices_write_staff ON public.invoices;
CREATE POLICY invoices_write_staff ON public.invoices TO authenticated
  USING (( SELECT public.is_staff() AS is_staff) AND (issuer_org_id = ANY ((SELECT app.user_org_ids())) OR (SELECT app.is_platform_admin())))
  WITH CHECK (( SELECT public.is_staff() AS is_staff) AND (issuer_org_id = ANY ((SELECT app.user_org_ids())) OR (SELECT app.is_platform_admin())));

-- Driver pay is for admins; now for admins of the owning company
DROP POLICY IF EXISTS driver_pay_entries_admin ON public.driver_pay_entries;
CREATE POLICY driver_pay_entries_admin ON public.driver_pay_entries TO authenticated
  USING (( SELECT COALESCE((public.current_app_role() = ANY (ARRAY['superadmin'::text, 'admin'::text])), false) AS "coalesce") AND (carrier_org_id = ANY ((SELECT app.user_org_ids())) OR (SELECT app.is_platform_admin())))
  WITH CHECK (( SELECT COALESCE((public.current_app_role() = ANY (ARRAY['superadmin'::text, 'admin'::text])), false) AS "coalesce") AND (carrier_org_id = ANY ((SELECT app.user_org_ids())) OR (SELECT app.is_platform_admin())));
DROP POLICY IF EXISTS driver_pay_rates_admin ON public.driver_pay_rates;
CREATE POLICY driver_pay_rates_admin ON public.driver_pay_rates TO authenticated
  USING (( SELECT COALESCE((public.current_app_role() = ANY (ARRAY['superadmin'::text, 'admin'::text])), false) AS "coalesce") AND (carrier_org_id = ANY ((SELECT app.user_org_ids())) OR (SELECT app.is_platform_admin())))
  WITH CHECK (( SELECT COALESCE((public.current_app_role() = ANY (ARRAY['superadmin'::text, 'admin'::text])), false) AS "coalesce") AND (carrier_org_id = ANY ((SELECT app.user_org_ids())) OR (SELECT app.is_platform_admin())));
DROP POLICY IF EXISTS driver_payouts_admin ON public.driver_payouts;
CREATE POLICY driver_payouts_admin ON public.driver_payouts TO authenticated
  USING (( SELECT COALESCE((public.current_app_role() = ANY (ARRAY['superadmin'::text, 'admin'::text])), false) AS "coalesce") AND (carrier_org_id = ANY ((SELECT app.user_org_ids())) OR (SELECT app.is_platform_admin())))
  WITH CHECK (( SELECT COALESCE((public.current_app_role() = ANY (ARRAY['superadmin'::text, 'admin'::text])), false) AS "coalesce") AND (carrier_org_id = ANY ((SELECT app.user_org_ids())) OR (SELECT app.is_platform_admin())));

RESET ROLE;
NOTIFY pgrst, 'reload schema';
