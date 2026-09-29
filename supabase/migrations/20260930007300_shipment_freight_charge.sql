-- Stream B, part 3: a direct price on a shipment.
--
-- freight_charge is what the customer is charged for the shipment, in rupees
-- before GST. Staff enter it when they create the shipment. The invoice
-- created on delivery uses it when there is no winning bid on the shipment.
--
-- Additive and safe to re-run. Applied to the live project on 2026-09-29.

ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS freight_charge numeric(12,2);

ALTER TABLE public.shipments DROP CONSTRAINT IF EXISTS shipments_freight_charge_check;
ALTER TABLE public.shipments ADD CONSTRAINT shipments_freight_charge_check CHECK (freight_charge IS NULL OR freight_charge >= 0);

NOTIFY pgrst, 'reload schema';
