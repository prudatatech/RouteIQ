-- Rows the API inserts without an id failed on the hosted stage: the alarm sweep logged
-- "null value in column "id" of relation "maintenance_alerts" violates not-null constraint" on every run, so no
-- fleet alarm was ever raised there, and a stoppage report would fail the same way. The tables of the original
-- schema were created with `id uuid NOT NULL` and no default (the Python models generated the ids), and the schema
-- the platform is built from (supabase/bootstrap/01_schema.sql) kept them that way. Give the tables the API
-- inserts into the default every newer table already has. Ids the API supplies are unaffected. Idempotent.
--
-- Not touched: users, vendor_profiles, customers and kyc_profiles, whose id IS the sign-in account's id.

DO $$
DECLARE
  t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    SET LOCAL ROLE app_owner;
  END IF;
  FOREACH t IN ARRAY ARRAY['maintenance_alerts', 'vehicle_stoppages', 'traffic_incidents', 'telemetry', 'vehicles', 'depots'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = t AND column_name = 'id' AND data_type = 'uuid' AND column_default IS NULL) THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN id SET DEFAULT gen_random_uuid()', t);
    END IF;
  END LOOP;
  RESET ROLE;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'id defaults not applied: insufficient privilege';
END $$;
