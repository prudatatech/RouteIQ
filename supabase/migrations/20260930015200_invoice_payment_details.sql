-- Money section: how an invoice was paid (offline, marked by staff) and why one was voided.
--
-- Payments are offline for now (docs/workflow-blueprint.html, Decisions): staff mark an invoice paid
-- when the money arrives and record the method, the reference and the date it was received.
-- `paid_at` already exists and holds that date. `due_date` also exists; the backend fills it on issue
-- from the payment terms in system_settings (company_profile.payment_terms_days, default 15).
--
-- Additive and safe to re-run.

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS payment_reference text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS void_reason text;

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_payment_method_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_payment_method_check
  CHECK (payment_method IS NULL OR payment_method IN ('bank', 'upi', 'cash', 'cheque'));

CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON public.invoices (due_date) WHERE status = 'issued';

NOTIFY pgrst, 'reload schema';
