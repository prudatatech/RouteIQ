-- Order routing and quotes (docs/order-routing.md, Data section).
--
--  1. vendor_shipment_requests: routing (open | chosen), carrier_org_id (the winning company), quote_deadline,
--     awarded_at, awarded_quote_id, quote_escalated_at (set once when the scheduler escalates a load nobody quoted).
--     Loads that were already accepted before this migration are given their company (the manifest's, else the
--     default company), so they stay with the company that has them.
--  2. load_quotes: one quote per company per load (a single live 'submitted' quote), with row-level security.
--  3. app.can_see_load(load): who may see a load. Used by the policies on vendor_shipment_requests, load_items and
--     load_quotes. It replaces the old "vendor or any staff" policy: staff of company B no longer see a load that was
--     awarded to company A, and a load held for the vendor's business verification reaches no company.
--  4. vehicles: hazmat_certified, is_reefer, body_type (the fit rules of a vehicle for a load).
--  5. create_vendor_load(jsonb) now writes routing and quote_deadline too (the same function as in
--     20261003020000, plus those two columns).
--  6. award_load(...): the atomic award. It locks the load, checks it is still open, accepts one quote, declines the
--     rest and sets the carrier, all in one transaction, so only one award can ever happen. A direct accept (a
--     company takes the load at the vendor's budget) is the same function, creating the accepted quote itself.
--
-- Runs as app_owner where that role exists (Azure: the tables belong to it). Idempotent; safe to run again.

-- 0. The load-posting and shipment-documents migrations ran as the admin login, so their tables and functions
--    belong to it; hand them to app_owner (the owner of every other app table) before switching to it below.
--    Without this, changing load_items as app_owner fails ("must be owner of relation load_items").
DO $$
DECLARE
  t text;
  f text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    RETURN;
  END IF;

  FOREACH t IN ARRAY ARRAY['load_items', 'load_counters', 'load_bulk_batches',
                           'load_documents', 'load_document_events', 'lr_counters', 'trip_settlements'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I OWNER TO app_owner', t);
    END IF;
  END LOOP;

  FOREACH f IN ARRAY ARRAY['public.next_load_number()', 'public.create_vendor_load(jsonb)',
                           'public.next_lr_number(uuid, text, integer)', 'public.can_read_load_object(text)'] LOOP
    IF to_regprocedure(f) IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION %s OWNER TO app_owner', f);
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    SET LOCAL ROLE app_owner;
  END IF;
END $$;

-- ── 1. The load ─────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.vendor_shipment_requests
  ADD COLUMN IF NOT EXISTS routing text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS carrier_org_id uuid REFERENCES public.organizations(id),
  ADD COLUMN IF NOT EXISTS quote_deadline timestamptz,
  ADD COLUMN IF NOT EXISTS awarded_at timestamptz,
  ADD COLUMN IF NOT EXISTS awarded_quote_id uuid,
  ADD COLUMN IF NOT EXISTS quote_escalated_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendor_shipment_requests_routing_check') THEN
    ALTER TABLE public.vendor_shipment_requests ADD CONSTRAINT vendor_shipment_requests_routing_check
      CHECK (routing IN ('open', 'chosen'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_vendor_shipment_requests_carrier ON public.vendor_shipment_requests (carrier_org_id);
CREATE INDEX IF NOT EXISTS idx_vendor_shipment_requests_quote_deadline
  ON public.vendor_shipment_requests (quote_deadline) WHERE status = 'pending' AND quote_requested AND quote_escalated_at IS NULL;

-- Loads accepted before routing existed belong to the company that has them: the carrier of their manifest,
-- else the default company. Pending, rejected and cancelled loads stay unowned.
UPDATE public.vendor_shipment_requests r
   SET carrier_org_id = coalesce(
         (SELECT m.carrier_org_id FROM public.cargo_manifest m
           WHERE m.vendor_request_id = r.id AND m.carrier_org_id IS NOT NULL ORDER BY m.created_at LIMIT 1),
         app.default_company_org_id()),
       awarded_at = coalesce(r.awarded_at, r.updated_at)
 WHERE r.carrier_org_id IS NULL
   AND r.status IN ('approved', 'escalated', 'assigned_to_partner', 'assigned', 'completed', 'fulfilled')
   AND coalesce(
         (SELECT m.carrier_org_id FROM public.cargo_manifest m
           WHERE m.vendor_request_id = r.id AND m.carrier_org_id IS NOT NULL ORDER BY m.created_at LIMIT 1),
         app.default_company_org_id()) IS NOT NULL;

-- ── 2. Quotes ───────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.load_quotes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  load_id        uuid NOT NULL REFERENCES public.vendor_shipment_requests(id) ON DELETE CASCADE,
  carrier_org_id uuid NOT NULL REFERENCES public.organizations(id),
  amount_inr     numeric(12,2) NOT NULL CHECK (amount_inr > 0),
  valid_until    timestamptz,
  vehicle_class  text,
  pickup_eta     date,
  notes          text,
  status         text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'accepted', 'declined', 'withdrawn', 'expired')),
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
-- One live quote per company per load
CREATE UNIQUE INDEX IF NOT EXISTS uq_load_quotes_live
  ON public.load_quotes (load_id, carrier_org_id) WHERE status = 'submitted';
CREATE INDEX IF NOT EXISTS idx_load_quotes_load ON public.load_quotes (load_id);
CREATE INDEX IF NOT EXISTS idx_load_quotes_carrier ON public.load_quotes (carrier_org_id, status);
CREATE INDEX IF NOT EXISTS idx_load_quotes_valid_until ON public.load_quotes (valid_until) WHERE status = 'submitted';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendor_shipment_requests_awarded_quote_fk') THEN
    ALTER TABLE public.vendor_shipment_requests ADD CONSTRAINT vendor_shipment_requests_awarded_quote_fk
      FOREIGN KEY (awarded_quote_id) REFERENCES public.load_quotes(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── 3. Who sees a load ──────────────────────────────────────────────────────────────────────────────
-- The vendor (vendor_id is me, or vendor_org_id is one of my organisations), the awarded company, a company the
-- load is routed to while it is pending and its vendor organisation is active (not held for verification), and
-- platform admins. The company branches also need a staff role, as every staff policy does.
CREATE OR REPLACE FUNCTION app.can_see_load(p_load uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT
      r.vendor_id = auth.uid()
      OR (r.vendor_org_id IS NOT NULL AND r.vendor_org_id = ANY (app.member_org_ids()))
      OR app.is_platform_admin()
      OR (
        public.is_staff()
        AND (
          (r.carrier_org_id IS NOT NULL AND r.carrier_org_id = ANY (app.user_org_ids()))
          OR (
            r.status = 'pending'
            AND r.carrier_org_id IS NULL
            AND coalesce(r.metadata ->> 'hold', '') <> 'vendor_unverified'
            AND (r.vendor_org_id IS NULL
                 OR EXISTS (SELECT 1 FROM public.organizations v WHERE v.id = r.vendor_org_id AND v.status = 'active'))
            AND EXISTS (
              SELECT 1 FROM public.organizations c
              WHERE c.id = ANY (app.user_org_ids()) AND c.kind = 'logistic_company'
                AND (r.routing <> 'chosen' OR c.id = ANY (coalesce(r.company_ids, '{}'::uuid[]))))
          )
        )
      )
    FROM public.vendor_shipment_requests r WHERE r.id = p_load
  ), false) $$;
GRANT EXECUTE ON FUNCTION app.can_see_load(uuid) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS vendor_shipment_requests_select ON public.vendor_shipment_requests;
CREATE POLICY vendor_shipment_requests_select ON public.vendor_shipment_requests FOR SELECT TO authenticated
  USING (app.can_see_load(id));

-- load_items follow the load; the manifest branch of the old policy stays (the carrier of the manifest)
DROP POLICY IF EXISTS load_items_select ON public.load_items;
CREATE POLICY load_items_select ON public.load_items FOR SELECT TO authenticated
  USING (
    app.can_see_load(load_id)
    OR EXISTS (
      SELECT 1 FROM public.cargo_manifest m
      WHERE m.vendor_request_id = load_items.load_id
        AND m.carrier_org_id = ANY ((SELECT app.user_org_ids())::uuid[])
    )
  );

-- load_quotes: a company reads and writes its own; the vendor reads the quotes on its loads; platform admins read.
-- (The backend writes through the service role; these policies are the floor for any direct access.)
ALTER TABLE public.load_quotes ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.load_quotes TO authenticated;
GRANT ALL ON public.load_quotes TO service_role;

DROP POLICY IF EXISTS load_quotes_select ON public.load_quotes;
CREATE POLICY load_quotes_select ON public.load_quotes FOR SELECT TO authenticated
  USING (
    carrier_org_id = ANY ((SELECT app.user_org_ids())::uuid[])
    OR EXISTS (
      SELECT 1 FROM public.vendor_shipment_requests r
      WHERE r.id = load_quotes.load_id
        AND (r.vendor_id = auth.uid() OR r.vendor_org_id = ANY ((SELECT app.member_org_ids())::uuid[])))
    OR (SELECT app.is_platform_admin())
  );

DROP POLICY IF EXISTS load_quotes_insert ON public.load_quotes;
CREATE POLICY load_quotes_insert ON public.load_quotes FOR INSERT TO authenticated
  WITH CHECK (
    status = 'submitted'
    AND carrier_org_id = ANY ((SELECT app.user_org_ids())::uuid[])
    AND app.can_see_load(load_id)
  );

DROP POLICY IF EXISTS load_quotes_update ON public.load_quotes;
CREATE POLICY load_quotes_update ON public.load_quotes FOR UPDATE TO authenticated
  USING (carrier_org_id = ANY ((SELECT app.user_org_ids())::uuid[]) AND status = 'submitted')
  WITH CHECK (carrier_org_id = ANY ((SELECT app.user_org_ids())::uuid[]) AND status IN ('submitted', 'withdrawn'));

-- Realtime: the vendor's quotes card and the company's market refresh when a quote changes
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'load_quotes') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.load_quotes;
  END IF;
END $$;

-- ── 4. Vehicles ─────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS hazmat_certified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_reefer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS body_type text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicles_body_type_check') THEN
    ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_body_type_check
      CHECK (body_type IS NULL OR body_type IN ('closed', 'open', 'container', 'reefer', 'tanker', 'trailer'));
  END IF;
END $$;

-- A vehicle model that already says reefer is one
UPDATE public.vehicles SET is_reefer = true, body_type = coalesce(body_type, 'reefer')
 WHERE NOT is_reefer AND (lower(coalesce(vehicle_model, '')) LIKE '%reefer%' OR lower(coalesce(vehicle_model, '')) LIKE '%refrigerat%');

-- ── 5. create_vendor_load: the same function, plus routing and quote_deadline ───────────────────────
CREATE OR REPLACE FUNCTION public.create_vendor_load(p jsonb) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  l jsonb := p -> 'load';
  r public.vendor_shipment_requests%ROWTYPE;
  crid uuid := nullif(l ->> 'client_request_id', '')::uuid;
  vid uuid := nullif(l ->> 'vendor_id', '')::uuid;
BEGIN
  IF l IS NULL OR vid IS NULL THEN RAISE EXCEPTION 'create_vendor_load: load and vendor_id are required'; END IF;

  IF crid IS NOT NULL THEN
    -- Serialise two requests carrying the same id, then look for the first one
    PERFORM pg_advisory_xact_lock(hashtextextended(vid::text || crid::text, 0));
    SELECT * INTO r FROM public.vendor_shipment_requests x
      WHERE x.vendor_id = vid AND x.client_request_id = crid AND x.created_at > now() - interval '10 minutes'
      ORDER BY x.created_at LIMIT 1;
    IF FOUND THEN RETURN to_jsonb(r) || jsonb_build_object('duplicate', true); END IF;
  END IF;

  INSERT INTO public.vendor_shipment_requests (
    vendor_id, vendor_org_id, status, load_number,
    pickup_location, pickup_lat, pickup_lng, drop_location, drop_lat, drop_lng, required_capacity_kg, metadata,
    load_type, vehicle_class, capacity_t, temp_min_c, temp_max_c, special_handling, budget_inr, quote_requested,
    loading_help, unloading_help,
    pickup_city, pickup_address, pickup_pincode, pickup_state_code, pickup_date, pickup_slot,
    pickup_contact_name, pickup_contact_phone,
    delivery_city, delivery_address, delivery_pincode, delivery_state_code, delivery_date,
    delivery_contact_name, delivery_contact_phone,
    loading_dock, access_restrictions, total_weight_kg, total_declared_value, tax_basis, eway_required, hazmat_mixed,
    company_ids, routing, quote_deadline, source, client_request_id, bulk_batch_id, reposted_from
  ) VALUES (
    vid, nullif(l ->> 'vendor_org_id', '')::uuid, 'pending', public.next_load_number(),
    l ->> 'pickup_location', (l ->> 'pickup_lat')::double precision, (l ->> 'pickup_lng')::double precision,
    l ->> 'drop_location', (l ->> 'drop_lat')::double precision, (l ->> 'drop_lng')::double precision,
    (l ->> 'required_capacity_kg')::numeric, coalesce(l -> 'metadata', '{}'::jsonb),
    l ->> 'load_type', l ->> 'vehicle_class', (l ->> 'capacity_t')::numeric, (l ->> 'temp_min_c')::numeric,
    (l ->> 'temp_max_c')::numeric,
    CASE WHEN jsonb_typeof(l -> 'special_handling') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(l -> 'special_handling')) END,
    (l ->> 'budget_inr')::numeric, coalesce((l ->> 'quote_requested')::boolean, false),
    coalesce((l ->> 'loading_help')::boolean, false), coalesce((l ->> 'unloading_help')::boolean, false),
    l ->> 'pickup_city', l ->> 'pickup_address', l ->> 'pickup_pincode', l ->> 'pickup_state_code',
    (l ->> 'pickup_date')::date, l ->> 'pickup_slot', l ->> 'pickup_contact_name', l ->> 'pickup_contact_phone',
    l ->> 'delivery_city', l ->> 'delivery_address', l ->> 'delivery_pincode', l ->> 'delivery_state_code',
    (l ->> 'delivery_date')::date, l ->> 'delivery_contact_name', l ->> 'delivery_contact_phone',
    (l ->> 'loading_dock')::boolean, l ->> 'access_restrictions', (l ->> 'total_weight_kg')::numeric,
    (l ->> 'total_declared_value')::numeric, l ->> 'tax_basis', (l ->> 'eway_required')::boolean,
    (l ->> 'hazmat_mixed')::boolean,
    CASE WHEN jsonb_typeof(l -> 'company_ids') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(l -> 'company_ids'))::uuid[] END,
    coalesce(nullif(l ->> 'routing', ''), 'open'), nullif(l ->> 'quote_deadline', '')::timestamptz,
    coalesce(l ->> 'source', 'web'), crid, nullif(l ->> 'bulk_batch_id', '')::uuid, nullif(l ->> 'reposted_from', '')::uuid
  ) RETURNING * INTO r;

  INSERT INTO public.load_items (load_id, line_no, product_name, hsn_code, gst_rate, quantity, unit, weight_kg,
                                 declared_value, handling, category, is_hazmat, is_perishable)
  SELECT r.id, e.n::int, e.v ->> 'product_name', e.v ->> 'hsn_code', (e.v ->> 'gst_rate')::numeric,
         (e.v ->> 'quantity')::numeric, e.v ->> 'unit', (e.v ->> 'weight_kg')::numeric,
         (e.v ->> 'declared_value')::numeric,
         CASE WHEN jsonb_typeof(e.v -> 'handling') = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(e.v -> 'handling')) END,
         e.v ->> 'category', coalesce((e.v ->> 'is_hazmat')::boolean, false), coalesce((e.v ->> 'is_perishable')::boolean, false)
  FROM jsonb_array_elements(coalesce(p -> 'items', '[]'::jsonb)) WITH ORDINALITY AS e(v, n);

  RETURN to_jsonb(r) || jsonb_build_object('duplicate', false);
END $$;
REVOKE ALL ON FUNCTION public.create_vendor_load(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_vendor_load(jsonb) TO service_role;

-- ── 6. The atomic award ─────────────────────────────────────────────────────────────────────────────
-- Vendor accepts a quote:   award_load(load, quote, NULL, NULL, actor, false)
-- Company accepts directly: award_load(load, NULL, company, amount, actor, true, cost_per_km)
-- The load row is locked first, so two accepts at once queue; the second finds the load already awarded.
-- Raises (message is the code the backend maps to a status):
--   load_not_found, load_already_awarded (not pending, or a company already holds it), quote_required (a direct
--   accept of a load that asked for quotes), amount_required, quote_not_found, quote_not_open, quote_expired.
-- Returns { load, quote, declined: [ { id, carrier_org_id } ] }.
CREATE OR REPLACE FUNCTION public.award_load(
  p_load uuid, p_quote uuid, p_carrier uuid, p_amount numeric, p_actor uuid, p_direct boolean,
  p_cost_per_km numeric DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  l public.vendor_shipment_requests%ROWTYPE;
  q public.load_quotes%ROWTYPE;
  declined jsonb;
BEGIN
  SELECT * INTO l FROM public.vendor_shipment_requests WHERE id = p_load FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'load_not_found'; END IF;
  IF l.status <> 'pending' OR l.carrier_org_id IS NOT NULL THEN RAISE EXCEPTION 'load_already_awarded'; END IF;

  IF p_direct THEN
    IF l.quote_requested THEN RAISE EXCEPTION 'quote_required'; END IF;
    IF p_carrier IS NULL OR p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'amount_required'; END IF;
    -- The company's live quote (if it sent one) becomes the accepted one, at the amount it accepted
    SELECT * INTO q FROM public.load_quotes WHERE load_id = p_load AND carrier_org_id = p_carrier AND status = 'submitted' FOR UPDATE;
    IF FOUND THEN
      UPDATE public.load_quotes SET status = 'accepted', amount_inr = p_amount, updated_at = now() WHERE id = q.id RETURNING * INTO q;
    ELSE
      INSERT INTO public.load_quotes (load_id, carrier_org_id, amount_inr, status, created_by)
        VALUES (p_load, p_carrier, p_amount, 'accepted', p_actor) RETURNING * INTO q;
    END IF;
  ELSE
    SELECT * INTO q FROM public.load_quotes WHERE id = p_quote AND load_id = p_load FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'quote_not_found'; END IF;
    IF q.status <> 'submitted' THEN RAISE EXCEPTION 'quote_not_open'; END IF;
    IF q.valid_until IS NOT NULL AND q.valid_until < now() THEN RAISE EXCEPTION 'quote_expired'; END IF;
    UPDATE public.load_quotes SET status = 'accepted', updated_at = now() WHERE id = q.id RETURNING * INTO q;
  END IF;

  WITH d AS (
    UPDATE public.load_quotes SET status = 'declined', updated_at = now()
     WHERE load_id = p_load AND status = 'submitted' AND id <> q.id
     RETURNING id, carrier_org_id)
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'carrier_org_id', d.carrier_org_id)), '[]'::jsonb) INTO declined FROM d;

  UPDATE public.vendor_shipment_requests
     SET carrier_org_id = q.carrier_org_id, awarded_at = now(), awarded_quote_id = q.id,
         status = 'approved', cost = q.amount_inr,
         cost_per_km = coalesce(p_cost_per_km, cost_per_km), updated_at = now()
   WHERE id = p_load RETURNING * INTO l;

  RETURN jsonb_build_object('load', to_jsonb(l), 'quote', to_jsonb(q), 'declined', declined);
END $$;
REVOKE ALL ON FUNCTION public.award_load(uuid, uuid, uuid, numeric, uuid, boolean, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.award_load(uuid, uuid, uuid, numeric, uuid, boolean, numeric) TO service_role;

NOTIFY pgrst, 'reload schema';
