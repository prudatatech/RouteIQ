#!/usr/bin/env bash
# Builds the throwaway test stack on a GitHub runner (.github/workflows/uat.yml): a local Supabase with the
# production schema (e2e/schema.sql, schema only, no data), the storage bucket the backend uses, and
# e2e/.env.local. Redis (margix-e2e-redis on 6380) is started by the workflow. Nothing here reaches a hosted project.
#
# Migrations dated after SCHEMA_STAMP are applied on top of the dump. To refresh the dump (then move
# SCHEMA_STAMP to the newest migration in it), from a local stack that has them all:
#   docker exec supabase_db_margix-e2e pg_dump -U postgres -d postgres --schema-only --schema=public --no-owner > e2e/schema.sql
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
DB_CONTAINER="supabase_db_margix-e2e"

mkdir -p "$HERE/supabase"
cat > "$HERE/supabase/config.toml" <<'EOF'
project_id = "margix-e2e"

[api]
port = 54321

[db]
port = 54322
EOF

(cd "$HERE" && supabase start -x studio,edge-runtime,logflare,vector,imgproxy,supavisor,postgres-meta,mailpit)

psql_db() { docker exec -i "$DB_CONTAINER" psql -q -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"; }  # owns the default privileges in the dump

# The dump is the public schema only; its functions call these extensions.
psql_db <<'SQL'
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS moddatetime WITH SCHEMA extensions;
DROP SCHEMA IF EXISTS public CASCADE;
SQL

# pg_dump 17.6+ adds \restrict lines older psql clients reject; the schema itself is unchanged.
grep -vE '^\\(restrict|unrestrict) ' "$HERE/schema.sql" | psql_db

# The dump carries production's own grants, so permission bugs show up here too; only the bucket is added.
# Objects belong to postgres, as in production, so migrations can be applied as postgres afterwards.
psql_db <<'SQL'
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.oid::regclass AS obj, c.relkind FROM pg_class c
           WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','v','m','S','p') LOOP
    EXECUTE format('ALTER %s %s OWNER TO postgres',
      CASE r.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'S' THEN 'SEQUENCE' ELSE 'TABLE' END, r.obj);
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS obj FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace LOOP
    EXECUTE format('ALTER ROUTINE %s OWNER TO postgres', r.obj);
  END LOOP;
  FOR r IN SELECT t.oid::regtype AS obj FROM pg_type t
           WHERE t.typnamespace = 'public'::regnamespace AND t.typtype IN ('e','d','c') AND t.typrelid = 0 LOOP
    EXECUTE format('ALTER TYPE %s OWNER TO postgres', r.obj);
  END LOOP;
  ALTER SCHEMA public OWNER TO postgres;
END $$;
-- The public-only dump leaves out triggers on auth.users; this one creates the users row on sign-up.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
INSERT INTO storage.buckets (id, name, public) VALUES ('kyc_documents', 'kyc_documents', false)
  ON CONFLICT (id) DO NOTHING;
NOTIFY pgrst, 'reload schema';
SQL

# Migrations newer than the dump (it was taken after SCHEMA_STAMP), in order, as on the live project.
SCHEMA_STAMP=20260930016300
for f in "$REPO"/supabase/migrations/2*.sql; do
  name="$(basename "$f")"
  [[ "${name%%_*}" > "$SCHEMA_STAMP" ]] || continue
  echo "applying $name"
  docker exec -i "$DB_CONTAINER" psql -q -U postgres -d postgres -v ON_ERROR_STOP=1 < "$f"
done

bash "$HERE/setup-local.sh"
echo "test stack ready"
