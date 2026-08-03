-- 1. Ensure required columns exist on vendor_shipment_requests
ALTER TABLE vendor_shipment_requests 
  ADD COLUMN IF NOT EXISTS assigned_vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cost NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_per_km NUMERIC DEFAULT 0;

-- 2. Drop and re-add the CHECK constraint for status to include 'assigned', 'completed', 'cancelled'
ALTER TABLE vendor_shipment_requests DROP CONSTRAINT IF EXISTS vendor_shipment_requests_status_check;
ALTER TABLE vendor_shipment_requests ADD CONSTRAINT vendor_shipment_requests_status_check 
  CHECK (status IN ('pending', 'approved', 'assigned', 'completed', 'cancelled', 'rejected', 'fulfilled'));

-- 3. Add cargo_manifest and vendor_shipment_requests to realtime publication so the driver app can hear it
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'cargo_manifest') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE cargo_manifest;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'vendor_shipment_requests') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE vendor_shipment_requests;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'notifications') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'routes') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE routes;
    END IF;
END $$;

-- Reload pgrst cache
NOTIFY pgrst, 'reload schema';
