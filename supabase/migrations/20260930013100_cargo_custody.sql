-- Cargo custody: who holds each consignment, how many pieces, in what condition, and what
-- happens when something goes wrong. The contract is docs/cargo-plan.md.
--
--   shipments / cargo_manifest   holder, current vehicle and depot, piece counters, seal,
--                                delivery attempts and RTO, delivery OTP (shipments only)
--   cargo_custody_events         append-only log of every handover and check
--   cargo_exceptions (+ items)   the case file for a problem, with an owner and an SLA
--   cargo_transfers (+ items)    moving goods to a relief vehicle or a hub
--   cargo_claims                 damage, shortage, loss, theft and delay claims
--
-- New shipment statuses are added with ADD VALUE IF NOT EXISTS. A value added in this file
-- cannot be used in the same transaction, so nothing below (defaults, checks, backfill)
-- names one of them; the backfill compares status::text against the old values only.
--
-- Idempotent: safe to re-run. NOT applied yet. After applying, regenerate
-- backend-ts/test/support/db-ambiguous-relations.json with scripts/dump-ambiguous-relations.sql.

-- ── Shipment statuses ───────────────────────────────────────
ALTER TYPE public.shipment_status ADD VALUE IF NOT EXISTS 'out_for_delivery';
ALTER TYPE public.shipment_status ADD VALUE IF NOT EXISTS 'at_hub';
ALTER TYPE public.shipment_status ADD VALUE IF NOT EXISTS 'partially_delivered';
ALTER TYPE public.shipment_status ADD VALUE IF NOT EXISTS 'on_hold';
ALTER TYPE public.shipment_status ADD VALUE IF NOT EXISTS 'returning';
ALTER TYPE public.shipment_status ADD VALUE IF NOT EXISTS 'returned';
ALTER TYPE public.shipment_status ADD VALUE IF NOT EXISTS 'lost';

-- ── shipments: custody columns ──────────────────────────────
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS current_holder text NOT NULL DEFAULT 'consignor';
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS current_vehicle_id uuid;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS current_depot_id uuid;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS pieces_total integer;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS pieces_delivered integer NOT NULL DEFAULT 0;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS pieces_damaged integer NOT NULL DEFAULT 0;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS pieces_short integer NOT NULL DEFAULT 0;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS pieces_returned integer NOT NULL DEFAULT 0;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS seal_number text;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS delivery_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS max_delivery_attempts integer NOT NULL DEFAULT 3;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS delivery_otp_required boolean NOT NULL DEFAULT false;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS delivery_otp_hash text;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS delivery_otp_expires_at timestamptz;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS rto boolean NOT NULL DEFAULT false;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS on_hold_reason text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipments_current_vehicle_id_fkey') THEN
    ALTER TABLE public.shipments ADD CONSTRAINT shipments_current_vehicle_id_fkey
      FOREIGN KEY (current_vehicle_id) REFERENCES public.vehicles(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipments_current_depot_id_fkey') THEN
    ALTER TABLE public.shipments ADD CONSTRAINT shipments_current_depot_id_fkey
      FOREIGN KEY (current_depot_id) REFERENCES public.depots(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── cargo_manifest: the same holder, pieces and seal columns ─
-- current_vehicle_id carries no foreign key on purpose: cargo_manifest already points at
-- vehicles through vehicle_id, and a second key would make every existing `vehicles(...)`
-- embed from cargo_manifest ambiguous (PGRST201). The backend keeps it in step with vehicle_id.
ALTER TABLE public.cargo_manifest ADD COLUMN IF NOT EXISTS current_holder text NOT NULL DEFAULT 'consignor';
ALTER TABLE public.cargo_manifest ADD COLUMN IF NOT EXISTS current_vehicle_id uuid;
ALTER TABLE public.cargo_manifest ADD COLUMN IF NOT EXISTS current_depot_id uuid;
ALTER TABLE public.cargo_manifest ADD COLUMN IF NOT EXISTS pieces_total integer;
ALTER TABLE public.cargo_manifest ADD COLUMN IF NOT EXISTS pieces_delivered integer NOT NULL DEFAULT 0;
ALTER TABLE public.cargo_manifest ADD COLUMN IF NOT EXISTS pieces_damaged integer NOT NULL DEFAULT 0;
ALTER TABLE public.cargo_manifest ADD COLUMN IF NOT EXISTS pieces_short integer NOT NULL DEFAULT 0;
ALTER TABLE public.cargo_manifest ADD COLUMN IF NOT EXISTS pieces_returned integer NOT NULL DEFAULT 0;
ALTER TABLE public.cargo_manifest ADD COLUMN IF NOT EXISTS seal_number text;
ALTER TABLE public.cargo_manifest ADD COLUMN IF NOT EXISTS delivery_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE public.cargo_manifest ADD COLUMN IF NOT EXISTS max_delivery_attempts integer NOT NULL DEFAULT 3;
ALTER TABLE public.cargo_manifest ADD COLUMN IF NOT EXISTS rto boolean NOT NULL DEFAULT false;
ALTER TABLE public.cargo_manifest ADD COLUMN IF NOT EXISTS on_hold_reason text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cargo_manifest_current_depot_id_fkey') THEN
    ALTER TABLE public.cargo_manifest ADD CONSTRAINT cargo_manifest_current_depot_id_fkey
      FOREIGN KEY (current_depot_id) REFERENCES public.depots(id) ON DELETE SET NULL;
  END IF;
END $$;

-- The manifest status check, extended with exception, on_hold, returning and returned
-- (drop whatever status check the table carries, then recreate it).
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.cargo_manifest'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.cargo_manifest DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.cargo_manifest ADD CONSTRAINT cargo_manifest_status_check
  CHECK (status IN ('scheduled', 'in_transit', 'delivered', 'completed', 'cancelled', 'exception', 'on_hold', 'returning', 'returned')) NOT VALID;

-- ── Backfill from status, the route chain and total_items ───
-- Goods not yet handed over stay with the consignor (the default). Picked up or in transit:
-- on a vehicle. A failed delivery (exception) is still on the vehicle that tried it. Delivered:
-- with the consignee. The vehicle is the one on the shipment's latest route, preferring one
-- that was not cancelled.
WITH carrier AS (
  SELECT DISTINCT ON (dp.shipment_id) dp.shipment_id, r.vehicle_id
  FROM public.delivery_points dp
  JOIN public.route_stops rs ON rs.delivery_point_id = dp.id
  JOIN public.routes r ON r.id = rs.route_id
  WHERE dp.shipment_id IS NOT NULL AND r.vehicle_id IS NOT NULL
  ORDER BY dp.shipment_id, (r.status::text <> 'cancelled') DESC, r.created_at DESC
)
UPDATE public.shipments s
SET current_vehicle_id = c.vehicle_id
FROM carrier c
WHERE c.shipment_id = s.id
  AND s.current_vehicle_id IS NULL
  AND s.status::text IN ('assigned', 'picked_up', 'in_transit', 'exception');

UPDATE public.shipments
SET current_holder = CASE
    WHEN status::text IN ('picked_up', 'in_transit') THEN 'vehicle'
    WHEN status::text = 'exception' AND current_vehicle_id IS NOT NULL THEN 'vehicle'
    WHEN status::text = 'delivered' THEN 'consignee'
    ELSE 'consignor'
  END
WHERE current_holder = 'consignor';

UPDATE public.shipments SET pieces_total = total_items WHERE pieces_total IS NULL AND total_items > 0;
UPDATE public.shipments SET pieces_delivered = pieces_total
WHERE status::text = 'delivered' AND pieces_delivered = 0 AND pieces_total IS NOT NULL;

UPDATE public.cargo_manifest
SET current_vehicle_id = vehicle_id
WHERE current_vehicle_id IS NULL AND vehicle_id IS NOT NULL AND status IN ('scheduled', 'in_transit');

UPDATE public.cargo_manifest
SET current_holder = CASE
    WHEN status = 'in_transit' THEN 'vehicle'
    WHEN status IN ('delivered', 'completed') THEN 'consignee'
    ELSE 'consignor'
  END
WHERE current_holder = 'consignor';

-- A vendor load's piece count is the number of packages the vendor declared, when it is a whole number
UPDATE public.cargo_manifest m
SET pieces_total = (r.metadata -> 'cargo' ->> 'noOfPackages')::integer
FROM public.vendor_shipment_requests r
WHERE r.id = m.vendor_request_id
  AND m.pieces_total IS NULL
  AND (r.metadata -> 'cargo' ->> 'noOfPackages') ~ '^[0-9]{1,6}$'
  AND (r.metadata -> 'cargo' ->> 'noOfPackages')::integer > 0;
UPDATE public.cargo_manifest SET pieces_delivered = pieces_total
WHERE status IN ('delivered', 'completed') AND pieces_delivered = 0 AND pieces_total IS NOT NULL;

-- ── Holder and piece invariants (after the backfill) ────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipments_current_holder_check') THEN
    ALTER TABLE public.shipments ADD CONSTRAINT shipments_current_holder_check
      CHECK (current_holder IN ('consignor', 'vehicle', 'hub', 'consignee'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipments_pieces_check') THEN
    ALTER TABLE public.shipments ADD CONSTRAINT shipments_pieces_check CHECK (
      pieces_delivered >= 0 AND pieces_damaged >= 0 AND pieces_short >= 0 AND pieces_returned >= 0
      AND delivery_attempts >= 0 AND max_delivery_attempts >= 1
      AND (pieces_total IS NULL OR (pieces_total >= 0 AND pieces_delivered + pieces_short + pieces_returned <= pieces_total))
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cargo_manifest_current_holder_check') THEN
    ALTER TABLE public.cargo_manifest ADD CONSTRAINT cargo_manifest_current_holder_check
      CHECK (current_holder IN ('consignor', 'vehicle', 'hub', 'consignee'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cargo_manifest_pieces_check') THEN
    ALTER TABLE public.cargo_manifest ADD CONSTRAINT cargo_manifest_pieces_check CHECK (
      pieces_delivered >= 0 AND pieces_damaged >= 0 AND pieces_short >= 0 AND pieces_returned >= 0
      AND delivery_attempts >= 0 AND max_delivery_attempts >= 1
      AND (pieces_total IS NULL OR (pieces_total >= 0 AND pieces_delivered + pieces_short + pieces_returned <= pieces_total))
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_shipments_current_vehicle ON public.shipments (current_vehicle_id) WHERE current_vehicle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shipments_current_depot ON public.shipments (current_depot_id) WHERE current_depot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cargo_manifest_current_vehicle ON public.cargo_manifest (current_vehicle_id) WHERE current_vehicle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cargo_manifest_current_depot ON public.cargo_manifest (current_depot_id) WHERE current_depot_id IS NOT NULL;

-- ── cargo_exceptions: the case file ─────────────────────────
CREATE TABLE IF NOT EXISTS public.cargo_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  type text NOT NULL CHECK (type IN ('vehicle_accident', 'vehicle_breakdown', 'damage', 'shortage', 'excess', 'theft', 'refused', 'undeliverable', 'delay', 'seal_tamper', 'weather', 'other')),
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'action_planned', 'resolved', 'closed')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('sos', 'maintenance', 'stop_failed', 'custody', 'eta', 'manual', 'driver')),
  sos_alert_id uuid REFERENCES public.sos_alerts(id) ON DELETE SET NULL,
  maintenance_job_id uuid REFERENCES public.vehicle_maintenance_jobs(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  route_id uuid REFERENCES public.routes(id) ON DELETE SET NULL,
  lat double precision,
  lng double precision,
  description text,
  owner_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  sla_due_at timestamptz,
  escalation_count integer NOT NULL DEFAULT 0,
  last_escalated_at timestamptz,
  resolution text CHECK (resolution IS NULL OR resolution IN ('transshipped', 'repaired_continue', 'moved_to_hub', 'returned', 'delivered_with_remarks', 'redelivered', 'written_off', 'claim_settled', 'no_action')),
  resolution_note text,
  resolved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  -- Staff notes and the actions taken on the case, oldest first: [{at, by, role, kind, text}]
  notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cargo_exceptions_status ON public.cargo_exceptions (status, sla_due_at);
CREATE INDEX IF NOT EXISTS idx_cargo_exceptions_vehicle ON public.cargo_exceptions (vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cargo_exceptions_sos ON public.cargo_exceptions (sos_alert_id) WHERE sos_alert_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cargo_exceptions_job ON public.cargo_exceptions (maintenance_job_id) WHERE maintenance_job_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.cargo_exception_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exception_id uuid NOT NULL REFERENCES public.cargo_exceptions(id) ON DELETE CASCADE,
  shipment_id uuid REFERENCES public.shipments(id) ON DELETE CASCADE,
  manifest_id uuid REFERENCES public.cargo_manifest(id) ON DELETE CASCADE,
  pieces_affected integer CHECK (pieces_affected IS NULL OR pieces_affected >= 0),
  weight_affected_kg numeric CHECK (weight_affected_kg IS NULL OR weight_affected_kg >= 0),
  condition text CHECK (condition IS NULL OR condition IN ('good', 'damaged_packaging', 'damaged_goods', 'wet', 'seal_tampered', 'shortage', 'excess')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cargo_exception_items_one_ref CHECK ((shipment_id IS NULL) <> (manifest_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_cargo_exception_items_exception ON public.cargo_exception_items (exception_id);
CREATE INDEX IF NOT EXISTS idx_cargo_exception_items_shipment ON public.cargo_exception_items (shipment_id) WHERE shipment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cargo_exception_items_manifest ON public.cargo_exception_items (manifest_id) WHERE manifest_id IS NOT NULL;

-- ── cargo_transfers ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cargo_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  exception_id uuid REFERENCES public.cargo_exceptions(id) ON DELETE SET NULL,
  from_vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  to_vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  to_depot_id uuid REFERENCES public.depots(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'completed', 'cancelled')),
  meet_lat double precision,
  meet_lng double precision,
  meet_address text,
  planned_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  new_route_id uuid REFERENCES public.routes(id) ON DELETE SET NULL,
  eway_part_b_required boolean NOT NULL DEFAULT false,
  eway_part_b_updated_at timestamptz,
  eway_part_b_ref text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  note text,
  CONSTRAINT cargo_transfers_one_target CHECK ((to_vehicle_id IS NULL) <> (to_depot_id IS NULL)),
  CONSTRAINT cargo_transfers_other_vehicle CHECK (to_vehicle_id IS NULL OR to_vehicle_id <> from_vehicle_id)
);

CREATE INDEX IF NOT EXISTS idx_cargo_transfers_status ON public.cargo_transfers (status, planned_at);
CREATE INDEX IF NOT EXISTS idx_cargo_transfers_from ON public.cargo_transfers (from_vehicle_id);
CREATE INDEX IF NOT EXISTS idx_cargo_transfers_to ON public.cargo_transfers (to_vehicle_id) WHERE to_vehicle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cargo_transfers_exception ON public.cargo_transfers (exception_id) WHERE exception_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.cargo_transfer_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES public.cargo_transfers(id) ON DELETE CASCADE,
  shipment_id uuid REFERENCES public.shipments(id) ON DELETE CASCADE,
  manifest_id uuid REFERENCES public.cargo_manifest(id) ON DELETE CASCADE,
  pieces_planned integer NOT NULL CHECK (pieces_planned >= 0),
  pieces_out integer CHECK (pieces_out IS NULL OR pieces_out >= 0),
  pieces_in integer CHECK (pieces_in IS NULL OR pieces_in >= 0),
  condition_in text CHECK (condition_in IS NULL OR condition_in IN ('good', 'damaged_packaging', 'damaged_goods', 'wet', 'seal_tampered', 'shortage', 'excess')),
  CONSTRAINT cargo_transfer_items_one_ref CHECK ((shipment_id IS NULL) <> (manifest_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_cargo_transfer_items_transfer ON public.cargo_transfer_items (transfer_id);
CREATE INDEX IF NOT EXISTS idx_cargo_transfer_items_shipment ON public.cargo_transfer_items (shipment_id) WHERE shipment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cargo_transfer_items_manifest ON public.cargo_transfer_items (manifest_id) WHERE manifest_id IS NOT NULL;

-- ── cargo_custody_events: append-only ───────────────────────
CREATE TABLE IF NOT EXISTS public.cargo_custody_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid REFERENCES public.shipments(id) ON DELETE CASCADE,
  manifest_id uuid REFERENCES public.cargo_manifest(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN (
    'booked', 'accepted', 'arrived_pickup', 'pickup', 'departed', 'arrived_drop', 'delivery', 'partial_delivery',
    'refused', 'undelivered', 'handover_out', 'handover_in', 'hub_in', 'hub_out', 'return_pickup', 'return_delivery',
    'inspection', 'hold', 'release_hold', 'lost'
  )),
  from_holder text CHECK (from_holder IS NULL OR from_holder IN ('consignor', 'vehicle', 'hub', 'consignee')),
  from_vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  from_depot_id uuid REFERENCES public.depots(id) ON DELETE SET NULL,
  to_holder text CHECK (to_holder IS NULL OR to_holder IN ('consignor', 'vehicle', 'hub', 'consignee')),
  to_vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  to_depot_id uuid REFERENCES public.depots(id) ON DELETE SET NULL,
  driver_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  pieces integer CHECK (pieces IS NULL OR pieces >= 0),
  weight_kg numeric CHECK (weight_kg IS NULL OR weight_kg >= 0),
  condition text CHECK (condition IS NULL OR condition IN ('good', 'damaged_packaging', 'damaged_goods', 'wet', 'seal_tampered', 'shortage', 'excess')),
  seal_number text,
  seal_ok boolean,
  photo_paths text[] NOT NULL DEFAULT '{}',
  signature_path text,
  otp_verified boolean,
  receiver_name text,
  lat double precision,
  lng double precision,
  notes text,
  exception_id uuid REFERENCES public.cargo_exceptions(id) ON DELETE SET NULL,
  transfer_id uuid REFERENCES public.cargo_transfers(id) ON DELETE SET NULL,
  recorded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  recorded_role text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cargo_custody_events_one_ref CHECK ((shipment_id IS NULL) <> (manifest_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_cargo_custody_events_shipment ON public.cargo_custody_events (shipment_id, recorded_at) WHERE shipment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cargo_custody_events_manifest ON public.cargo_custody_events (manifest_id, recorded_at) WHERE manifest_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cargo_custody_events_exception ON public.cargo_custody_events (exception_id) WHERE exception_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cargo_custody_events_transfer ON public.cargo_custody_events (transfer_id) WHERE transfer_id IS NOT NULL;

-- ── cargo_claims ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cargo_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  exception_id uuid REFERENCES public.cargo_exceptions(id) ON DELETE SET NULL,
  shipment_id uuid REFERENCES public.shipments(id) ON DELETE CASCADE,
  manifest_id uuid REFERENCES public.cargo_manifest(id) ON DELETE CASCADE,
  claim_type text NOT NULL CHECK (claim_type IN ('damage', 'shortage', 'loss', 'theft', 'delay')),
  declared_value numeric CHECK (declared_value IS NULL OR declared_value >= 0),
  claimed_amount numeric CHECK (claimed_amount IS NULL OR claimed_amount >= 0),
  approved_amount numeric CHECK (approved_amount IS NULL OR approved_amount >= 0),
  settled_amount numeric CHECK (settled_amount IS NULL OR settled_amount >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'filed', 'surveyed', 'approved', 'rejected', 'settled', 'withdrawn')),
  raised_by_role text NOT NULL CHECK (raised_by_role IN ('staff', 'customer', 'vendor')),
  -- A staff member or vendor (users) or a customer (customers), so no foreign key
  raised_by uuid,
  insurer text,
  policy_number text,
  fir_number text,
  surveyor_name text,
  survey_date date,
  document_paths text[] NOT NULL DEFAULT '{}',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  CONSTRAINT cargo_claims_one_ref CHECK ((shipment_id IS NULL) <> (manifest_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_cargo_claims_status ON public.cargo_claims (status, created_at);
CREATE INDEX IF NOT EXISTS idx_cargo_claims_shipment ON public.cargo_claims (shipment_id) WHERE shipment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cargo_claims_manifest ON public.cargo_claims (manifest_id) WHERE manifest_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cargo_claims_raised_by ON public.cargo_claims (raised_by) WHERE raised_by IS NOT NULL;

-- ── Row-level security ──────────────────────────────────────
-- Staff get full access. Drivers, customers and vendors read through the backend (service
-- role), which redacts what they see. Custody events are append-only: staff may read and add,
-- and no policy allows an update or a delete.
ALTER TABLE public.cargo_custody_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cargo_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cargo_exception_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cargo_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cargo_transfer_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cargo_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cargo_custody_events_staff_select ON public.cargo_custody_events;
CREATE POLICY cargo_custody_events_staff_select ON public.cargo_custody_events FOR SELECT TO authenticated
  USING ((SELECT public.is_staff()));
DROP POLICY IF EXISTS cargo_custody_events_staff_insert ON public.cargo_custody_events;
CREATE POLICY cargo_custody_events_staff_insert ON public.cargo_custody_events FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_staff()));

DROP POLICY IF EXISTS cargo_exceptions_staff ON public.cargo_exceptions;
CREATE POLICY cargo_exceptions_staff ON public.cargo_exceptions FOR ALL TO authenticated
  USING ((SELECT public.is_staff())) WITH CHECK ((SELECT public.is_staff()));

DROP POLICY IF EXISTS cargo_exception_items_staff ON public.cargo_exception_items;
CREATE POLICY cargo_exception_items_staff ON public.cargo_exception_items FOR ALL TO authenticated
  USING ((SELECT public.is_staff())) WITH CHECK ((SELECT public.is_staff()));

DROP POLICY IF EXISTS cargo_transfers_staff ON public.cargo_transfers;
CREATE POLICY cargo_transfers_staff ON public.cargo_transfers FOR ALL TO authenticated
  USING ((SELECT public.is_staff())) WITH CHECK ((SELECT public.is_staff()));

DROP POLICY IF EXISTS cargo_transfer_items_staff ON public.cargo_transfer_items;
CREATE POLICY cargo_transfer_items_staff ON public.cargo_transfer_items FOR ALL TO authenticated
  USING ((SELECT public.is_staff())) WITH CHECK ((SELECT public.is_staff()));

DROP POLICY IF EXISTS cargo_claims_staff ON public.cargo_claims;
CREATE POLICY cargo_claims_staff ON public.cargo_claims FOR ALL TO authenticated
  USING ((SELECT public.is_staff())) WITH CHECK ((SELECT public.is_staff()));

NOTIFY pgrst, 'reload schema';
