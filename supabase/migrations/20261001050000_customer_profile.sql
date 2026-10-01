-- ROL-18 and ROL-19: a customer profile, and a customer reporting a payment or querying an invoice.
--
-- 1. customers: full name, company, GSTIN, email and a billing address. Invoices use them as the
--    buyer (bill_to) and for the CGST + SGST or IGST decision. Every column is optional.
-- 2. invoice_payment_reports: "I have paid" (amount, date, method, reference) or "I have a question"
--    (message), raised by the customer on their own invoice and handled by staff.
--
-- Customers sign in through the backend (they have no public.users row), so the backend, which uses the
-- service role, does the writing. The policies below are the safety net for any direct access:
-- a customer reads and updates only their own row, and staff read every row.
-- Additive and safe to re-run. Do not apply by hand: it runs with the other migrations.

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS full_name text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS company_name text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS gstin text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS billing_address text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS pincode text;

-- GSTIN: 2-digit state code, 5 letters, 4 digits, a letter, a letter or digit, Z, a check character. Optional.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_gstin_format') THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_gstin_format
      CHECK (gstin IS NULL OR gstin ~ '^(0[1-9]|[12][0-9]|3[0-8]|97|99)[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_pincode_format') THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_pincode_format
      CHECK (pincode IS NULL OR pincode ~ '^[1-9][0-9]{5}$') NOT VALID;
  END IF;
END $$;

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customers_own_read ON public.customers;
CREATE POLICY customers_own_read ON public.customers FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS customers_own_update ON public.customers;
CREATE POLICY customers_own_update ON public.customers FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS customers_staff_read ON public.customers;
CREATE POLICY customers_staff_read ON public.customers FOR SELECT TO authenticated
  USING ((SELECT public.is_staff()));

-- ── Payments reported and invoices queried by the customer ──
CREATE TABLE IF NOT EXISTS public.invoice_payment_reports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  customer_id   uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('payment', 'query')),
  -- A payment report
  amount        numeric(14, 2) CHECK (amount IS NULL OR amount > 0),
  paid_on       date,
  method        text CHECK (method IS NULL OR method IN ('upi', 'neft', 'rtgs', 'imps', 'cheque', 'cash', 'other')),
  reference     text CHECK (reference IS NULL OR length(reference) <= 100),
  -- A query
  message       text CHECK (message IS NULL OR length(message) <= 1000),
  -- A proof the customer attached: a path in the documents bucket. Not used until uploads are added.
  attachment_path text,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'confirmed', 'rejected', 'answered')),
  staff_note    text CHECK (staff_note IS NULL OR length(staff_note) <= 1000),
  handled_by    uuid,
  handled_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT invoice_payment_reports_kind_fields CHECK (
    (kind = 'payment' AND amount IS NOT NULL AND paid_on IS NOT NULL AND method IS NOT NULL)
    OR (kind = 'query' AND message IS NOT NULL)
  ),
  -- A payment is confirmed or rejected, a query is answered
  CONSTRAINT invoice_payment_reports_status_kind CHECK (
    status = 'open'
    OR (kind = 'payment' AND status IN ('confirmed', 'rejected'))
    OR (kind = 'query' AND status = 'answered')
  )
);

CREATE INDEX IF NOT EXISTS idx_invoice_payment_reports_invoice ON public.invoice_payment_reports (invoice_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_payment_reports_customer ON public.invoice_payment_reports (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_payment_reports_open ON public.invoice_payment_reports (status, created_at) WHERE status = 'open';

ALTER TABLE public.invoice_payment_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_payment_reports_own_read ON public.invoice_payment_reports;
CREATE POLICY invoice_payment_reports_own_read ON public.invoice_payment_reports FOR SELECT TO authenticated
  USING (customer_id = (SELECT auth.uid()));

-- A customer may add a report as themselves, always open; staff alone change its outcome
DROP POLICY IF EXISTS invoice_payment_reports_own_insert ON public.invoice_payment_reports;
CREATE POLICY invoice_payment_reports_own_insert ON public.invoice_payment_reports FOR INSERT TO authenticated
  WITH CHECK (customer_id = (SELECT auth.uid()) AND status = 'open');

DROP POLICY IF EXISTS invoice_payment_reports_staff ON public.invoice_payment_reports;
CREATE POLICY invoice_payment_reports_staff ON public.invoice_payment_reports FOR ALL TO authenticated
  USING ((SELECT public.is_staff()))
  WITH CHECK ((SELECT public.is_staff()));

NOTIFY pgrst, 'reload schema';
