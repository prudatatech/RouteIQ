-- Align enums and constraints with the states the application writes.
-- Every statement is idempotent: production may already have some of these
-- changes from manual edits.

-- Shipments are 'assigned' when dispatched to a vehicle (optimizer, bid
-- approval) and marked 'exception' when a delivery attempt fails.
ALTER TYPE shipment_status ADD VALUE IF NOT EXISTS 'assigned';
ALTER TYPE shipment_status ADD VALUE IF NOT EXISTS 'exception';

-- Vendor requests move pending → approved → assigned → completed
-- ('fulfilled' kept for rows written by the previous workaround).
ALTER TABLE public.vendor_shipment_requests DROP CONSTRAINT IF EXISTS vendor_shipment_requests_status_check;
ALTER TABLE public.vendor_shipment_requests ADD CONSTRAINT vendor_shipment_requests_status_check
  CHECK (status IN ('pending', 'approved', 'assigned', 'completed', 'cancelled', 'rejected', 'fulfilled'));

-- Routes created from bid approvals and manual assignment have no depot.
ALTER TABLE public.routes ALTER COLUMN depot_id DROP NOT NULL;
