-- GST on freight (a goods transport agency). Freight is taxed at the transporter's rate, never at the rate of the goods.
-- Each company picks how it charges it (organizations.profile.gta_gst_option):
--   rcm_5 (default)  reverse charge: the recipient pays 5%, the invoice charges no GST
--   fcm_5            5% forward charge, without input tax credit
--   fcm_18           18% forward charge, with input tax credit
-- The option an invoice was issued under is stored on it. Existing invoices keep their amounts and have no option (NULL).
-- Idempotent; safe to run again.
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS tax_mode text;
DO $$ BEGIN
  ALTER TABLE public.invoices ADD CONSTRAINT invoices_tax_mode_check CHECK (tax_mode IS NULL OR tax_mode IN ('rcm_5', 'fcm_5', 'fcm_18'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
