-- Load priority and the recommended freight range (docs/order-routing.md, docs/load-posting-v2.md).
--
--  1. vendor_shipment_requests gets `priority` (high | medium | low, default medium: the vendor's urgency, used to rank who
--     is told first) and `price_min_inr` / `price_max_inr` (the recommended freight range the server worked out when the
--     load was posted; a company books the load at any price inside it). Both prices are null when no estimate was possible.
--  2. An index for the company board, which lists pending, unawarded loads by priority, pickup date and age.
--  3. create_vendor_load(jsonb) writes the three new columns (the same function as in 20261004010000, plus them).
--
-- Runs as app_owner where that role exists (Azure). Idempotent.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    SET LOCAL ROLE app_owner;
  END IF;
END $$;

ALTER TABLE public.vendor_shipment_requests ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'medium';
ALTER TABLE public.vendor_shipment_requests ADD COLUMN IF NOT EXISTS price_min_inr numeric(12,2);
ALTER TABLE public.vendor_shipment_requests ADD COLUMN IF NOT EXISTS price_max_inr numeric(12,2);

ALTER TABLE public.vendor_shipment_requests DROP CONSTRAINT IF EXISTS vendor_shipment_requests_priority_check;
ALTER TABLE public.vendor_shipment_requests ADD CONSTRAINT vendor_shipment_requests_priority_check CHECK (priority IN ('high', 'medium', 'low'));
ALTER TABLE public.vendor_shipment_requests DROP CONSTRAINT IF EXISTS vendor_shipment_requests_price_range_check;
ALTER TABLE public.vendor_shipment_requests ADD CONSTRAINT vendor_shipment_requests_price_range_check
  CHECK (price_min_inr IS NULL OR price_max_inr IS NULL OR price_min_inr <= price_max_inr);

CREATE INDEX IF NOT EXISTS idx_vsr_board ON public.vendor_shipment_requests (priority, pickup_date, created_at)
  WHERE status = 'pending' AND carrier_org_id IS NULL;

-- ── create_vendor_load: the same function, plus priority and the price range ────────────────────────
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
    company_ids, routing, quote_deadline, source, client_request_id, bulk_batch_id, reposted_from,
    priority, price_min_inr, price_max_inr
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
    coalesce(l ->> 'source', 'web'), crid, nullif(l ->> 'bulk_batch_id', '')::uuid, nullif(l ->> 'reposted_from', '')::uuid,
    coalesce(nullif(l ->> 'priority', ''), 'medium'), nullif(l ->> 'price_min_inr', '')::numeric, nullif(l ->> 'price_max_inr', '')::numeric
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
