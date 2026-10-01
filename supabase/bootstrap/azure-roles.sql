-- Prepares an Azure Database for PostgreSQL server for the app's services (infra/platform.bicep):
-- the roles they log in as, the API roles JWTs map to, their schemas and the extensions.
-- Run once as the server administrator by infra/platform.sh, BEFORE the services start (they create
-- their own tables in auth, storage and _realtime on first start). Idempotent.
-- Passwords arrive as psql variables: authenticator_pw, auth_admin_pw, storage_admin_pw, realtime_admin_pw.

\set ON_ERROR_STOP on

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;

-- API roles: PostgREST switches to one of these per request, from the JWT's "role"
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN CREATE ROLE authenticator LOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin LOGIN NOINHERIT CREATEROLE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN CREATE ROLE supabase_storage_admin LOGIN NOINHERIT CREATEROLE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_realtime_admin') THEN CREATE ROLE supabase_realtime_admin LOGIN NOINHERIT; END IF;
  -- names the dumped schema grants to and policies mention
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN CREATE ROLE supabase_admin NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN CREATE ROLE postgres NOLOGIN; END IF;
END $$;

ALTER ROLE authenticator WITH PASSWORD :'authenticator_pw';
ALTER ROLE supabase_auth_admin WITH PASSWORD :'auth_admin_pw';
ALTER ROLE supabase_storage_admin WITH PASSWORD :'storage_admin_pw';
ALTER ROLE supabase_realtime_admin WITH PASSWORD :'realtime_admin_pw';
ALTER ROLE supabase_realtime_admin WITH REPLICATION;

GRANT anon, authenticated, service_role TO authenticator;
GRANT anon, authenticated, service_role TO supabase_storage_admin;
GRANT CREATE ON DATABASE postgres TO supabase_auth_admin, supabase_storage_admin, supabase_realtime_admin;

-- service_role skips row-level security like on Supabase. Azure does not hand out BYPASSRLS, so the
-- app's tables belong to app_owner, which service_role inherits (owners are exempt from RLS, and no table
-- uses FORCE RLS). infra/platform.sh hands public's objects to app_owner after loading the schema.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN CREATE ROLE app_owner NOLOGIN; END IF;
END $$;
DO $$ BEGIN EXECUTE format('GRANT app_owner TO %I WITH INHERIT TRUE, SET TRUE', current_user); END $$;
GRANT app_owner TO service_role WITH INHERIT TRUE;
ALTER ROLE service_role INHERIT;
GRANT CREATE, USAGE ON SCHEMA public TO app_owner;
GRANT USAGE ON SCHEMA extensions, auth, storage TO app_owner;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO app_owner;

-- Schemas each service owns
CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION supabase_auth_admin;
CREATE SCHEMA IF NOT EXISTS storage AUTHORIZATION supabase_storage_admin;
CREATE SCHEMA IF NOT EXISTS _realtime AUTHORIZATION supabase_realtime_admin;
CREATE SCHEMA IF NOT EXISTS realtime AUTHORIZATION supabase_realtime_admin;
ALTER ROLE supabase_auth_admin SET search_path = auth;
ALTER ROLE supabase_storage_admin SET search_path = storage;

GRANT USAGE ON SCHEMA public, extensions TO anon, authenticated, service_role, supabase_auth_admin, supabase_storage_admin;
GRANT USAGE ON SCHEMA auth, storage TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA realtime TO anon, authenticated, service_role;

-- auth.uid(), auth.role() and auth.jwt() as Supabase defines them (GoTrue also creates them; same body).
-- The public schema's policies call them, so they must exist before 01_schema.sql loads.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                  nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;
ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin;
ALTER FUNCTION auth.role() OWNER TO supabase_auth_admin;
ALTER FUNCTION auth.jwt() OWNER TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), auth.jwt() TO anon, authenticated, service_role;

-- The app's tables reference auth.users (owned by the sign-in service's role): let app_owner point
-- foreign keys at it and read it. Granted as the owner, which the administrator may act as.
DO $$ BEGIN EXECUTE format('GRANT supabase_auth_admin, supabase_storage_admin TO %I WITH INHERIT FALSE, SET TRUE', current_user); END $$;
SET ROLE supabase_auth_admin;
DO $$ BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    GRANT REFERENCES, SELECT ON auth.users TO app_owner;
  END IF;
END $$;
RESET ROLE;
