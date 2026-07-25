-- RouteIQ: Vendor Assign Vehicle Migration
-- Run this in: Supabase Dashboard > SQL Editor
-- Date: 2026-07-24

-- ── Step 1: Add assigned_vehicle_id to vendor_shipment_requests ─────────────
ALTER TABLE vendor_shipment_requests 
  ADD COLUMN IF NOT EXISTS assigned_vehicle_id uuid 
  REFERENCES vehicles(id) ON DELETE SET NULL;

-- ── Step 1.5: Fix Status Check Constraint ─────────────────────────────────────
ALTER TABLE vendor_shipment_requests DROP CONSTRAINT IF EXISTS vendor_shipment_requests_status_check;
ALTER TABLE vendor_shipment_requests ADD CONSTRAINT vendor_shipment_requests_status_check 
  CHECK (status IN ('pending', 'approved', 'assigned', 'completed', 'cancelled', 'rejected'));

-- ── Step 2: Create cargo_manifest table ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS cargo_manifest (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  vendor_request_id uuid REFERENCES vendor_shipment_requests(id) ON DELETE CASCADE,
  pickup_location text,
  pickup_lat float8,
  pickup_lng float8,
  drop_location text,
  drop_lat float8,
  drop_lng float8,
  capacity_kg float8,
  status text DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_transit','delivered','cancelled')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ── Step 3: RLS ──────────────────────────────────────────────────────────────
ALTER TABLE cargo_manifest ENABLE ROW LEVEL SECURITY;

-- Allow admins/superadmins full access
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'cargo_manifest' AND policyname = 'cargo_manifest_admin_all'
  ) THEN
    EXECUTE 'CREATE POLICY cargo_manifest_admin_all ON cargo_manifest FOR ALL TO authenticated USING (true) WITH CHECK (true)';
  END IF;
END $$;

-- ── Step 4: Helpful index ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS cargo_manifest_vehicle_idx ON cargo_manifest(vehicle_id);
CREATE INDEX IF NOT EXISTS cargo_manifest_status_idx ON cargo_manifest(status);

SELECT 'Migration complete ✅' as result;
