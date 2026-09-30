-- Free text on an invoice: a partial delivery writes the pieces short or refused here, so a claim can offset it.
-- Additive and safe to re-run.

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS notes text;

NOTIFY pgrst, 'reload schema';
