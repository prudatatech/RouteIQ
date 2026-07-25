-- Fix foreign key constraint to allow deleting shipments that are used as fallbacks
ALTER TABLE capacity_windows DROP CONSTRAINT IF EXISTS capacity_windows_fallback_shipment_id_fkey;
ALTER TABLE capacity_windows ADD CONSTRAINT capacity_windows_fallback_shipment_id_fkey FOREIGN KEY (fallback_shipment_id) REFERENCES shipments(id) ON DELETE SET NULL;
