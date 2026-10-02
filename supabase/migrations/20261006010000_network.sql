-- Phase N1: the anchor network (docs/network-design.md, section 1).
--
--  1. tpl_affiliations.rules: what a company allows of one partner (vehicle classes, lanes, minimum rate per km,
--     GPS and insurance), applied when work is offered.
--  2. tpl_orders: the vehicle, driver and trip a partner runs an order with, and the proof of delivery (photo,
--     signature, receiver). pod_note stays for old rows.
--  3. tpl_offers.targeted: an offer sent to chosen partners only.
--  4. vehicles: a member of a 3PL partner organisation reads the vehicles that organisation owns. The partner's fleet
--     is the same vehicles table (carrier_org_id = the partner organisation); the existing policies are staff-only
--     (public.is_staff() looks at the app role, which a partner member does not have), so this adds one more
--     permissive SELECT policy and loosens nothing.
--  5. tpl_partner_statements: the monthly settlement of what a company owes a partner. The company writes, the
--     partner reads, the platform reads. The backend writes through the service role; the policies are the floor.
--
-- Runs as app_owner where that role exists (Azure: the tables belong to it). Idempotent; safe to run again.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    SET LOCAL ROLE app_owner;
  END IF;
END $$;

-- ── 1. Affiliation rules ────────────────────────────────────────────────────────────────────────────
-- { vehicle_classes?: text[], corridor_ids?: uuid[], min_rate_per_km?: number, gps_required?: bool, insurance_required?: bool }
ALTER TABLE public.tpl_affiliations ADD COLUMN IF NOT EXISTS rules jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ── 2. Orders run on a real vehicle with a real proof of delivery ───────────────────────────────────
ALTER TABLE public.tpl_orders
  ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS driver_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manifest_id uuid REFERENCES public.cargo_manifest(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pod_photo_url text,
  ADD COLUMN IF NOT EXISTS pod_signature_url text,
  ADD COLUMN IF NOT EXISTS pod_received_by text;
CREATE INDEX IF NOT EXISTS idx_tpl_orders_vehicle ON public.tpl_orders (vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tpl_orders_driver ON public.tpl_orders (driver_id) WHERE driver_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tpl_orders_manifest ON public.tpl_orders (manifest_id) WHERE manifest_id IS NOT NULL;

-- ── 3. Targeted offers ──────────────────────────────────────────────────────────────────────────────
-- Who actually runs a company's trip (a 3PL partner) travels on the trip itself. 020_add_shipment_metadata
-- added metadata to shipments only, so cargo_manifest never had one.
ALTER TABLE public.cargo_manifest ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.tpl_offers ADD COLUMN IF NOT EXISTS targeted boolean NOT NULL DEFAULT false;

-- ── 4. A partner member reads the vehicles of the partner organisation ──────────────────────────────
DROP POLICY IF EXISTS vehicles_select_tpl_partner ON public.vehicles;
CREATE POLICY vehicles_select_tpl_partner ON public.vehicles FOR SELECT TO authenticated
  USING (
    carrier_org_id = ANY ((SELECT app.member_org_ids())::uuid[])
    AND EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = vehicles.carrier_org_id AND o.kind = 'tpl_partner')
  );

-- ── 5. Partner statements ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tpl_partner_statements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_org_id      uuid NOT NULL REFERENCES public.organizations(id),
  company_org_id      uuid NOT NULL REFERENCES public.organizations(id),
  period              text NOT NULL CHECK (period ~ '^[0-9]{4}(0[1-9]|1[0-2])$'),
  order_ids           jsonb NOT NULL DEFAULT '[]'::jsonb,
  orders_total_paise  bigint NOT NULL DEFAULT 0 CHECK (orders_total_paise >= 0),
  deductions          jsonb NOT NULL DEFAULT '[]'::jsonb,
  balance_paise       bigint NOT NULL DEFAULT 0 CHECK (balance_paise >= 0),
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued', 'paid')),
  issued_at           timestamptz,
  paid_at             timestamptz,
  paid_reference      text,
  created_by          uuid,
  issued_by           uuid,
  paid_by             uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tpl_partner_statements_unique UNIQUE (partner_org_id, company_org_id, period),
  CONSTRAINT tpl_partner_statements_distinct CHECK (partner_org_id <> company_org_id)
);
CREATE INDEX IF NOT EXISTS idx_tpl_statements_company ON public.tpl_partner_statements (company_org_id, period DESC);
CREATE INDEX IF NOT EXISTS idx_tpl_statements_partner ON public.tpl_partner_statements (partner_org_id, period DESC);

DROP TRIGGER IF EXISTS tpl_partner_statements_updated_at ON public.tpl_partner_statements;
CREATE TRIGGER tpl_partner_statements_updated_at BEFORE UPDATE ON public.tpl_partner_statements
  FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();

ALTER TABLE public.tpl_partner_statements ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.tpl_partner_statements TO authenticated;
GRANT ALL ON public.tpl_partner_statements TO service_role;

-- The partner reads statements that were issued to it (a draft is the company's working copy); the company reads
-- its own; the platform reads all.
DROP POLICY IF EXISTS tpl_statements_select ON public.tpl_partner_statements;
CREATE POLICY tpl_statements_select ON public.tpl_partner_statements FOR SELECT TO authenticated
  USING (
    company_org_id = ANY ((SELECT app.member_org_ids())::uuid[])
    OR (status IN ('issued', 'paid') AND partner_org_id = ANY ((SELECT app.member_org_ids())::uuid[]))
    OR (SELECT app.is_platform_admin())
  );

-- Only an owner or admin of the company writes, and only about a partner affiliated with it
DROP POLICY IF EXISTS tpl_statements_insert ON public.tpl_partner_statements;
CREATE POLICY tpl_statements_insert ON public.tpl_partner_statements FOR INSERT TO authenticated
  WITH CHECK (
    status = 'draft'
    AND company_org_id = ANY ((SELECT app.org_ids_with_role(ARRAY['owner', 'admin']::public.org_role[]))::uuid[])
    AND EXISTS (SELECT 1 FROM public.tpl_affiliations a WHERE a.company_id = company_org_id AND a.tpl_id = partner_org_id AND a.status <> 'ended')
  );

DROP POLICY IF EXISTS tpl_statements_update ON public.tpl_partner_statements;
CREATE POLICY tpl_statements_update ON public.tpl_partner_statements FOR UPDATE TO authenticated
  USING (company_org_id = ANY ((SELECT app.org_ids_with_role(ARRAY['owner', 'admin']::public.org_role[]))::uuid[]))
  WITH CHECK (company_org_id = ANY ((SELECT app.org_ids_with_role(ARRAY['owner', 'admin']::public.org_role[]))::uuid[]));

DROP POLICY IF EXISTS tpl_statements_platform ON public.tpl_partner_statements;
CREATE POLICY tpl_statements_platform ON public.tpl_partner_statements FOR ALL TO authenticated
  USING ((SELECT app.is_platform_admin())) WITH CHECK ((SELECT app.is_platform_admin()));

RESET ROLE;
NOTIFY pgrst, 'reload schema';
