-- A vendor request can be escalated to 3PL partners, then assigned to the partner
-- who accepts it. Extends the status check from 20260928000300.
-- Idempotent: safe to re-run.

ALTER TABLE public.vendor_shipment_requests DROP CONSTRAINT IF EXISTS vendor_shipment_requests_status_check;
ALTER TABLE public.vendor_shipment_requests ADD CONSTRAINT vendor_shipment_requests_status_check
  CHECK (status IN (
    'pending', 'approved', 'escalated', 'assigned_to_partner',
    'assigned', 'completed', 'cancelled', 'rejected', 'fulfilled'
  ));

NOTIFY pgrst, 'reload schema';
