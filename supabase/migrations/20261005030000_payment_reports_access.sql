-- invoice_payment_reports (20261001050000) was created by the admin login with no GRANTs. On Supabase default
-- privileges covered that; on Azure only app_owner's tables get them, so the API (service_role) was refused
-- ("permission denied for table invoice_payment_reports") and the Today page failed for admins. Hand it to app_owner
-- and grant it like every other app table; row security still decides what each user sees. Idempotent.

DO $$
BEGIN
  IF to_regclass('public.invoice_payment_reports') IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    ALTER TABLE public.invoice_payment_reports OWNER TO app_owner;
  END IF;
  GRANT ALL ON public.invoice_payment_reports TO authenticated, service_role;
  GRANT SELECT ON public.invoice_payment_reports TO anon;
END $$;
