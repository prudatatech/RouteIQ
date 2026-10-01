-- The parts of the app that live outside the public schema, so 01_schema.sql alone does not carry them.
-- Taken from the running project on 1 Oct 2026. Idempotent.

-- Extensions the public schema calls (Supabase creates the "extensions" schema)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS moddatetime WITH SCHEMA extensions;

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
                           'system_settings', 'telemetry', 'tpl_offers', 'tpl_orders', 'vehicles', 'vendor_shipment_requests'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
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
