-- Live updates the web app subscribes to (frontend/src: useRealtimeRefresh, the menu badges, the Today page, the live
-- map, the KYC review and partner pages) that were never published, so those screens never refreshed by themselves:
-- Realtime only streams the tables in the supabase_realtime publication, and that held a dozen tables (bootstrap/02_platform.sql
-- and earlier migrations) while the web listens on these as well. Publishing a table streams its changes; what a user
-- receives is still decided by the row-level security of that table (Realtime checks it per subscriber).
--
-- The publication belongs to the admin login (infra/platform-db.sh), which may add app_owner's tables through its
-- membership of that role. Skipped where there is no publication (a database that has not been through the platform
-- bootstrap) or a table does not exist. Idempotent.

DO $$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY[
    'shipments', 'route_stops', 'cargo_exceptions', 'customer_bookings', 'capacity_windows', 'capacity_bids',
    'invoices', 'invoice_payment_reports', 'user_documents', 'vendor_profiles', 'tpl_partners', 'tpl_corridors', 'tpl_documents'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      BEGIN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE '% not published: insufficient privilege', t;
      END;
    END IF;
  END LOOP;
END $$;
