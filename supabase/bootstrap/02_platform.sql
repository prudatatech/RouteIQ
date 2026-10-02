-- The parts of the app that live outside the public schema, so 01_schema.sql alone does not carry them.
-- Taken from the running project on 1 Oct 2026. Idempotent.

-- A users row for every sign-up
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Private bucket for KYC, vehicle and POD documents, read through can_read_kyc_object()
INSERT INTO storage.buckets (id, name, public) VALUES ('kyc_documents', 'kyc_documents', false)
  ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS kyc_documents_read ON storage.objects;
CREATE POLICY kyc_documents_read ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING ((bucket_id = 'kyc_documents'::text) AND public.can_read_kyc_object(name));

-- Tables the web app listens to for live updates
DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  FOREACH t IN ARRAY ARRAY['cargo_manifest', 'driver_confirmations', 'messages', 'notifications', 'routes', 'sos_alerts',
                           'system_settings', 'telemetry', 'tpl_offers', 'tpl_orders', 'vehicles', 'vendor_shipment_requests',
                           -- the screens that refresh by themselves (20261010080100_realtime_web_tables.sql)
                           'shipments', 'route_stops', 'cargo_exceptions', 'customer_bookings', 'capacity_windows', 'capacity_bids',
                           'invoices', 'invoice_payment_reports', 'user_documents', 'vendor_profiles', 'tpl_partners', 'tpl_corridors', 'tpl_documents'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- Which files of supabase/migrations this database already has (scripts/db-migrate.sh keeps it)
CREATE TABLE IF NOT EXISTS public.app_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_migrations FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
