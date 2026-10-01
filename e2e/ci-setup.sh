#!/usr/bin/env bash
# Builds the throwaway test stack on a GitHub runner (.github/workflows/uat.yml): a local Supabase with the
# production schema (e2e/schema.sql, schema only, no data), the storage bucket the backend uses, and
# e2e/.env.local. Redis runs as a workflow service on 6380. Nothing here reaches a hosted project.
#
# Refresh e2e/schema.sql after new migrations from a local stack that has them:
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
psql_db <<'SQL'
INSERT INTO storage.buckets (id, name, public) VALUES ('kyc_documents', 'kyc_documents', false)
  ON CONFLICT (id) DO NOTHING;
NOTIFY pgrst, 'reload schema';
SQL

bash "$HERE/setup-local.sh"
echo "test stack ready"
