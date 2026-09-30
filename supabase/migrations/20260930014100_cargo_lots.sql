-- Cargo lots: one consignment split across drops, trucks and hubs. The contract is the "Lots"
-- section of docs/cargo-plan.md.
--
--   shipments / cargo_manifest   parent (the master), lot number and label, master flag, declared
--                                value, freight share, the lot's own consignee, why it was split,
--                                and the lot's own e-way bill reference and Part B flag
--   delivery_points              pieces, consignee and the lot the drop was made for
--   customer_bookings            the drops of a multi-drop booking, until it is confirmed
--   cargo_custody_events         two new kinds: split and merge
--
-- A master holds no goods of its own once it is split: its lots do. The tree is flat: a lot of a
-- lot points at the same master. The parent keys name themselves (…_parent_…_fkey) so a
-- self-embed can say which way it goes; the lot key on delivery_points makes the
-- delivery_points <-> shipments pair ambiguous, so embeds between them must name
-- delivery_points_shipment_id_fkey.
--
-- Idempotent: safe to re-run. NOT applied yet. Apply it before deploying the backend that reads
-- these columns. After applying, regenerate backend-ts/test/support/db-ambiguous-relations.json
-- with scripts/dump-ambiguous-relations.sql.

-- ── shipments: lot columns ──────────────────────────────────
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS parent_shipment_id uuid;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS lot_seq integer;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS lot_label text;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS is_master boolean NOT NULL DEFAULT false;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS declared_value numeric;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS freight_share numeric;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS consignee_name text;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS consignee_phone text;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS consignee_gstin text;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS split_reason text;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS eway_bill_ref text;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS eway_part_b_required boolean NOT NULL DEFAULT false;

-- ── cargo_manifest: the same lot columns ────────────────────
ALTER TABLE public.cargo_manifest ADD COLUMN IF NOT EXISTS parent_manifest_id uuid;
ALTER TABLE public.cargo_manifest ADD COLUMN IF NOT EXISTS lot_seq integer;
ALTER TABLE public.cargo_manifest ADD COLUMN IF NOT EXISTS lot_label text;
ALTER TABLE public.cargo_manifest ADD COLUMN IF NOT EXISTS is_master boolean NOT NULL DEFAULT false;
ALTER TABLE public.cargo_manifest ADD COLUMN IF NOT EXISTS declared_value numeric;
ALTER TABLE public.cargo_manifest ADD COLUMN IF NOT EXISTS freight_share numeric;
ALTER TABLE public.cargo_manifest ADD COLUMN IF NOT EXISTS consignee_name text;
ALTER TABLE public.cargo_manifest ADD COLUMN IF NOT EXISTS consignee_phone text;
ALTER TABLE public.cargo_manifest ADD COLUMN IF NOT EXISTS consignee_gstin text;
ALTER TABLE public.cargo_manifest ADD COLUMN IF NOT EXISTS split_reason text;
ALTER TABLE public.cargo_manifest ADD COLUMN IF NOT EXISTS eway_bill_ref text;
ALTER TABLE public.cargo_manifest ADD COLUMN IF NOT EXISTS eway_part_b_required boolean NOT NULL DEFAULT false;

-- ── delivery_points: pieces, consignee, lot ─────────────────
ALTER TABLE public.delivery_points ADD COLUMN IF NOT EXISTS pieces integer;
ALTER TABLE public.delivery_points ADD COLUMN IF NOT EXISTS consignee_name text;
ALTER TABLE public.delivery_points ADD COLUMN IF NOT EXISTS consignee_phone text;
ALTER TABLE public.delivery_points ADD COLUMN IF NOT EXISTS lot_shipment_id uuid;

-- ── customer_bookings: the drops of a multi-drop booking ────
-- [{ name, address, lat, lng, consignee_name, consignee_phone, consignee_gstin, pieces, weight_kg }]
ALTER TABLE public.customer_bookings ADD COLUMN IF NOT EXISTS drops jsonb;

-- ── Keys and checks ─────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipments_parent_shipment_id_fkey') THEN
    ALTER TABLE public.shipments ADD CONSTRAINT shipments_parent_shipment_id_fkey
      FOREIGN KEY (parent_shipment_id) REFERENCES public.shipments(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cargo_manifest_parent_manifest_id_fkey') THEN
    ALTER TABLE public.cargo_manifest ADD CONSTRAINT cargo_manifest_parent_manifest_id_fkey
      FOREIGN KEY (parent_manifest_id) REFERENCES public.cargo_manifest(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'delivery_points_lot_shipment_id_fkey') THEN
    ALTER TABLE public.delivery_points ADD CONSTRAINT delivery_points_lot_shipment_id_fkey
      FOREIGN KEY (lot_shipment_id) REFERENCES public.shipments(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipments_split_reason_check') THEN
    ALTER TABLE public.shipments ADD CONSTRAINT shipments_split_reason_check
      CHECK (split_reason IS NULL OR split_reason IN ('multi_drop', 'partial_transfer', 'hub_crossdock', 'partial_delivery_remainder', 'manual'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cargo_manifest_split_reason_check') THEN
    ALTER TABLE public.cargo_manifest ADD CONSTRAINT cargo_manifest_split_reason_check
      CHECK (split_reason IS NULL OR split_reason IN ('multi_drop', 'partial_transfer', 'hub_crossdock', 'partial_delivery_remainder', 'manual'));
  END IF;

  -- A lot has a parent, a number and a label; a master has none of them; nothing is both
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipments_lot_check') THEN
    ALTER TABLE public.shipments ADD CONSTRAINT shipments_lot_check CHECK (
      (parent_shipment_id IS NULL OR (lot_seq IS NOT NULL AND lot_seq >= 1 AND lot_label IS NOT NULL AND NOT is_master))
      AND (parent_shipment_id IS NULL OR parent_shipment_id <> id)
      AND (declared_value IS NULL OR declared_value >= 0)
      AND (freight_share IS NULL OR freight_share >= 0)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cargo_manifest_lot_check') THEN
    ALTER TABLE public.cargo_manifest ADD CONSTRAINT cargo_manifest_lot_check CHECK (
      (parent_manifest_id IS NULL OR (lot_seq IS NOT NULL AND lot_seq >= 1 AND lot_label IS NOT NULL AND NOT is_master))
      AND (parent_manifest_id IS NULL OR parent_manifest_id <> id)
      AND (declared_value IS NULL OR declared_value >= 0)
      AND (freight_share IS NULL OR freight_share >= 0)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'delivery_points_pieces_check') THEN
    ALTER TABLE public.delivery_points ADD CONSTRAINT delivery_points_pieces_check CHECK (pieces IS NULL OR pieces >= 0);
  END IF;
END $$;

-- One label per lot under a master
CREATE UNIQUE INDEX IF NOT EXISTS shipments_lot_label_unique ON public.shipments (parent_shipment_id, lot_label) WHERE parent_shipment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cargo_manifest_lot_label_unique ON public.cargo_manifest (parent_manifest_id, lot_label) WHERE parent_manifest_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shipments_parent ON public.shipments (parent_shipment_id) WHERE parent_shipment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cargo_manifest_parent ON public.cargo_manifest (parent_manifest_id) WHERE parent_manifest_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_delivery_points_lot ON public.delivery_points (lot_shipment_id) WHERE lot_shipment_id IS NOT NULL;

-- ── cargo_custody_events: split and merge ───────────────────
-- Drop whatever kind check the table carries, then recreate it with the two new kinds.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.cargo_custody_events'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE public.cargo_custody_events DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.cargo_custody_events ADD CONSTRAINT cargo_custody_events_kind_check CHECK (kind IN (
  'booked', 'accepted', 'arrived_pickup', 'pickup', 'departed', 'arrived_drop', 'delivery', 'partial_delivery',
  'refused', 'undelivered', 'handover_out', 'handover_in', 'hub_in', 'hub_out', 'return_pickup', 'return_delivery',
  'inspection', 'hold', 'release_hold', 'lost', 'split', 'merge'
));
