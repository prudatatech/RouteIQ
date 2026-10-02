-- vehicle_stoppages was created outside the migrations with an `id uuid NOT NULL` that has no default on Azure
-- PostgreSQL, so every stoppage a driver or staff member reported failed with "null value in column id" (a 500).
-- Give the column the default every other table has. The API also sends an id now, so either side alone works.
-- Runs as app_owner where that role exists (Azure: the tables belong to it). Idempotent; safe to run again.

DO $$
BEGIN
  IF to_regclass('public.vehicle_stoppages') IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    SET LOCAL ROLE app_owner;
  END IF;
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'vehicle_stoppages' AND column_name = 'id') = 'uuid' THEN
    ALTER TABLE public.vehicle_stoppages ALTER COLUMN id SET DEFAULT gen_random_uuid();
  END IF;
  RESET ROLE;
END $$;

NOTIFY pgrst, 'reload schema';
