-- Workflow fixes, 3PL and vendor billing. NOT applied to the live project yet: apply before deploying
-- the backend that reads these columns.
--
-- 1. A 3PL corridor rate is a number with a unit (per trip or per km) instead of free text that the
--    backend used to read the first number out of ("Base + 12%" became 12 rupees). The old text
--    column `proposed_rate` stays and is shown as written for legacy rows; only plain numbers are
--    carried over below, everything else keeps a null rate and is never used to price a load.
-- 2. A vendor load carried by a 3PL partner has no cargo manifest, so its invoice points at the
--    vendor request instead. One live invoice per request, like invoices_one_per_shipment.
--
-- Additive and safe to re-run.

ALTER TABLE public.tpl_corridors ADD COLUMN IF NOT EXISTS rate_amount numeric(12,2);
ALTER TABLE public.tpl_corridors ADD COLUMN IF NOT EXISTS rate_unit text;

ALTER TABLE public.tpl_corridors DROP CONSTRAINT IF EXISTS tpl_corridors_rate_check;
ALTER TABLE public.tpl_corridors ADD CONSTRAINT tpl_corridors_rate_check CHECK (
  (rate_amount IS NULL AND rate_unit IS NULL)
  OR (rate_amount > 0 AND rate_unit IN ('per_trip', 'per_km'))
);

-- Carry over legacy rates that are only a number: "41200", "₹41,200", "1500.50 per trip", "₹22 per km"
UPDATE public.tpl_corridors
SET rate_amount = replace(regexp_replace(proposed_rate, '[^0-9.,]', '', 'g'), ',', '')::numeric,
    rate_unit = CASE WHEN proposed_rate ~* '(per\s*km|/\s*km)' THEN 'per_km' ELSE 'per_trip' END
WHERE rate_amount IS NULL
  AND proposed_rate ~* '^\s*(₹|rs\.?|inr)?\s*[0-9][0-9,]*(\.[0-9]+)?\s*((per\s*|/\s*)(trip|km))?\s*$'
  AND replace(regexp_replace(proposed_rate, '[^0-9.,]', '', 'g'), ',', '') ~ '^[0-9]+(\.[0-9]+)?$'
  AND replace(regexp_replace(proposed_rate, '[^0-9.,]', '', 'g'), ',', '')::numeric > 0;

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS vendor_request_id uuid REFERENCES public.vendor_shipment_requests(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_per_request ON public.invoices (vendor_request_id) WHERE vendor_request_id IS NOT NULL AND status <> 'void';

NOTIFY pgrst, 'reload schema';
