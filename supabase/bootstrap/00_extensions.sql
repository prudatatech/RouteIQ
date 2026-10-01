-- Loaded before 01_schema.sql, whose functions and triggers call these. Idempotent, and works on both
-- Supabase and Azure Database for PostgreSQL (which offers no moddatetime extension).
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- moddatetime(<column>): sets that column to now() on UPDATE. The extension where it exists, else the
-- same behaviour in plpgsql under the same name, so the schema's triggers need no change.
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS moddatetime WITH SCHEMA extensions;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION extensions.moddatetime() RETURNS trigger LANGUAGE plpgsql AS $b$
      BEGIN
        NEW := jsonb_populate_record(NEW, jsonb_build_object(TG_ARGV[0], now()));
        RETURN NEW;
      END $b$
    $f$;
  END;
END $$;
