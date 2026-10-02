-- Load posting (docs/load-posting-design.md section 2, PRD sections 2, 4, 6-11).
--
--  1. vendor_shipment_requests stays the vendor load; it gains the posting columns (route, goods totals, tax,
--     transport, origin). The pickup and drop coordinates stay NOT NULL: the web always sends them.
--  2. load_items: the goods lines of a load. Read access follows the parent load.
--  3. load_counters + next_load_number(): MRX-YYYY-NNNNN, platform-wide, one atomic upsert, reset each year (IST).
--  4. load_bulk_batches: one row per bulk upload, with the per-row errors.
--  5. create_vendor_load(jsonb): inserts the load and its items in one transaction (no half-written loads) and
--     returns the load row. A repeat of the same client_request_id inside 10 minutes returns the first load.
--  6. shipment_hsn gains manifest_id / load_id and the goods columns, so a load's items can be copied there when
--     it becomes a manifest (the backend does the copy in assignVehicleToRequest).
--
-- Idempotent; safe to run again.

-- ── 1. The load ─────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.vendor_shipment_requests
  ADD COLUMN IF NOT EXISTS load_number text,
  ADD COLUMN IF NOT EXISTS load_type text,
  ADD COLUMN IF NOT EXISTS vehicle_class text,
  ADD COLUMN IF NOT EXISTS capacity_t numeric(6,2),
  ADD COLUMN IF NOT EXISTS temp_min_c numeric(5,1),
  ADD COLUMN IF NOT EXISTS temp_max_c numeric(5,1),
  ADD COLUMN IF NOT EXISTS special_handling text[],
  ADD COLUMN IF NOT EXISTS budget_inr numeric(14,2),
  ADD COLUMN IF NOT EXISTS quote_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS loading_help boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS unloading_help boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pickup_city text,
  ADD COLUMN IF NOT EXISTS pickup_address text,
  ADD COLUMN IF NOT EXISTS pickup_pincode text,
  ADD COLUMN IF NOT EXISTS pickup_state_code text,
  ADD COLUMN IF NOT EXISTS pickup_date date,
  ADD COLUMN IF NOT EXISTS pickup_slot text,
  ADD COLUMN IF NOT EXISTS pickup_contact_name text,
  ADD COLUMN IF NOT EXISTS pickup_contact_phone text,
  ADD COLUMN IF NOT EXISTS delivery_city text,
  ADD COLUMN IF NOT EXISTS delivery_address text,
  ADD COLUMN IF NOT EXISTS delivery_pincode text,
  ADD COLUMN IF NOT EXISTS delivery_state_code text,
  ADD COLUMN IF NOT EXISTS delivery_date date,
  ADD COLUMN IF NOT EXISTS delivery_contact_name text,
  ADD COLUMN IF NOT EXISTS delivery_contact_phone text,
  ADD COLUMN IF NOT EXISTS loading_dock boolean,
  ADD COLUMN IF NOT EXISTS access_restrictions text,
  ADD COLUMN IF NOT EXISTS total_weight_kg numeric(12,2),
  ADD COLUMN IF NOT EXISTS total_declared_value numeric(14,2),
  ADD COLUMN IF NOT EXISTS tax_basis text,
  ADD COLUMN IF NOT EXISTS eway_required boolean,
  ADD COLUMN IF NOT EXISTS hazmat_mixed boolean,
  ADD COLUMN IF NOT EXISTS company_ids uuid[],
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS client_request_id uuid,
  ADD COLUMN IF NOT EXISTS bulk_batch_id uuid,
  ADD COLUMN IF NOT EXISTS reposted_from uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendor_shipment_requests_load_type_check') THEN
    ALTER TABLE public.vendor_shipment_requests ADD CONSTRAINT vendor_shipment_requests_load_type_check
      CHECK (load_type IS NULL OR load_type IN ('ftl', 'ptl'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendor_shipment_requests_pickup_slot_check') THEN
    ALTER TABLE public.vendor_shipment_requests ADD CONSTRAINT vendor_shipment_requests_pickup_slot_check
      CHECK (pickup_slot IS NULL OR pickup_slot IN ('morning', 'afternoon', 'evening'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendor_shipment_requests_source_check') THEN
    ALTER TABLE public.vendor_shipment_requests ADD CONSTRAINT vendor_shipment_requests_source_check
      CHECK (source IS NULL OR source IN ('web', 'app', 'bulk', 'api', 'repost'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendor_shipment_requests_tax_basis_check') THEN
    ALTER TABLE public.vendor_shipment_requests ADD CONSTRAINT vendor_shipment_requests_tax_basis_check
      CHECK (tax_basis IS NULL OR tax_basis IN ('intra', 'inter', 'unknown', 'none'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_shipment_requests_load_number
  ON public.vendor_shipment_requests (load_number) WHERE load_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vendor_shipment_requests_client_request
  ON public.vendor_shipment_requests (vendor_org_id, client_request_id) WHERE client_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vendor_shipment_requests_vendor_created
  ON public.vendor_shipment_requests (vendor_id, created_at DESC);

-- ── 2. Goods lines ──────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.load_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  load_id        uuid NOT NULL REFERENCES public.vendor_shipment_requests(id) ON DELETE CASCADE,
  line_no        integer NOT NULL CHECK (line_no >= 1),
  product_name   text NOT NULL,
  hsn_code       text,
  gst_rate       numeric(5,2),
  quantity       numeric(14,3),
  unit           text,
  weight_kg      numeric(12,2),
  declared_value numeric(14,2),
  handling       text[],
  category       text,
  is_hazmat      boolean NOT NULL DEFAULT false,
  is_perishable  boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (load_id, line_no)
);
CREATE INDEX IF NOT EXISTS idx_load_items_load ON public.load_items (load_id);

ALTER TABLE public.load_items ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.load_items TO authenticated;
GRANT ALL ON public.load_items TO service_role;

-- Follows the parent load: the vendor organisation (or the vendor who posted it), the carrier organisation of the
-- manifest once a vehicle is assigned, and platform admins. Writes only through the backend (service role).
DROP POLICY IF EXISTS load_items_select ON public.load_items;
CREATE POLICY load_items_select ON public.load_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vendor_shipment_requests r
      WHERE r.id = load_items.load_id
        AND (r.vendor_id = auth.uid() OR r.vendor_org_id = ANY ((SELECT app.user_org_ids())::uuid[]))
    )
    OR EXISTS (
      SELECT 1 FROM public.cargo_manifest m
      WHERE m.vendor_request_id = load_items.load_id
        AND m.carrier_org_id = ANY ((SELECT app.user_org_ids())::uuid[])
    )
    OR (SELECT app.is_platform_admin())
  );

-- ── 3. Load numbers ─────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.load_counters (
  year     integer PRIMARY KEY,
  last_seq integer NOT NULL DEFAULT 0 CHECK (last_seq >= 0)
);
ALTER TABLE public.load_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.load_counters FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.load_counters TO service_role;

-- MRX-YYYY-NNNNN. One upsert takes the row lock, so concurrent callers queue and always get different numbers.
-- The year is the Indian calendar year, so the sequence restarts at 00001 on 1 January IST.
CREATE OR REPLACE FUNCTION public.next_load_number() RETURNS text
  LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO public.load_counters AS c (year, last_seq)
  VALUES (extract(year FROM (now() AT TIME ZONE 'Asia/Kolkata'))::int, 1)
  ON CONFLICT (year) DO UPDATE SET last_seq = c.last_seq + 1
  RETURNING 'MRX-' || c.year::text || '-' || lpad(c.last_seq::text, 5, '0') $$;
REVOKE ALL ON FUNCTION public.next_load_number() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_load_number() TO service_role;

-- ── 4. Bulk upload batches ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.load_bulk_batches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_org_id uuid REFERENCES public.organizations(id),
  file_name     text,
  row_count     integer NOT NULL DEFAULT 0,
  ok_count      integer NOT NULL DEFAULT 0,
  error_count   integer NOT NULL DEFAULT 0,
  errors        jsonb NOT NULL DEFAULT '[]'::jsonb,
  status        text NOT NULL DEFAULT 'done' CHECK (status IN ('processing', 'done', 'failed')),
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_load_bulk_batches_org ON public.load_bulk_batches (vendor_org_id, created_at DESC);
ALTER TABLE public.load_bulk_batches ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.load_bulk_batches TO authenticated;
GRANT ALL ON public.load_bulk_batches TO service_role;
DROP POLICY IF EXISTS load_bulk_batches_select ON public.load_bulk_batches;
CREATE POLICY load_bulk_batches_select ON public.load_bulk_batches FOR SELECT TO authenticated
  USING (vendor_org_id = ANY ((SELECT app.user_org_ids())::uuid[]) OR created_by = auth.uid() OR (SELECT app.is_platform_admin()));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendor_shipment_requests_bulk_batch_fk') THEN
    ALTER TABLE public.vendor_shipment_requests ADD CONSTRAINT vendor_shipment_requests_bulk_batch_fk
      FOREIGN KEY (bulk_batch_id) REFERENCES public.load_bulk_batches(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── 5. Create a load and its items together ─────────────────────────────────────────────────────────
-- p = { "load": { ...columns of vendor_shipment_requests... }, "items": [ { ...columns of load_items... } ] }.
-- The backend has already validated and recomputed everything; this only writes it, atomically, and numbers it.
-- Returns the load row, with "duplicate": true when the same client_request_id already made a load in the last
-- 10 minutes for this vendor (the first load is returned and nothing is written).
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
    company_ids, source, client_request_id, bulk_batch_id, reposted_from
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

-- ── 6. Items on the manifest ────────────────────────────────────────────────────────────────────────
-- shipment_hsn belonged to shipments only. A vendor load travels as a cargo_manifest, so a goods line can hang
-- off a manifest (and name its load) as well; the invoice then shows the real goods lines.
ALTER TABLE public.shipment_hsn
  ADD COLUMN IF NOT EXISTS manifest_id uuid REFERENCES public.cargo_manifest(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS load_id uuid REFERENCES public.vendor_shipment_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS product_name text,
  ADD COLUMN IF NOT EXISTS quantity numeric(14,3),
  ADD COLUMN IF NOT EXISTS unit text,
  ADD COLUMN IF NOT EXISTS weight_kg numeric(12,2);
CREATE INDEX IF NOT EXISTS idx_shipment_hsn_manifest ON public.shipment_hsn (manifest_id) WHERE manifest_id IS NOT NULL;
