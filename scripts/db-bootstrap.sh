#!/usr/bin/env bash
# Sets up a NEW, empty Supabase project (any provider or self-hosted Supabase) as a MargixIndia database:
# the schema, the platform pieces (sign-up trigger, storage bucket, realtime), the settings defaults and
# the record that every current migration is already in. Refuses a database whose public schema already
# has tables, so it can never touch one in use.
#
#   DATABASE_URL=postgres://… scripts/db-bootstrap.sh
#
# Then create the first superadmin by inviting them from the project's Auth page and setting
# app_metadata.role = "superadmin" (see docs/DEPLOYMENT.md, "Environments").
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
B="$ROOT/supabase/bootstrap"
: "${DATABASE_URL:?set DATABASE_URL}"
PSQL="${PSQL:-psql}"
run() { $PSQL "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -At "$@"; }

tables="$(run -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")"
if [[ "$tables" != "0" ]]; then
  echo "REFUSING: this database already has $tables tables in public. Bootstrap is for an empty project only." >&2
  exit 2
fi

echo "0/4 extensions";        run -f "$B/00_extensions.sql" >/dev/null
echo "1/4 schema";            { echo "SET check_function_bodies = false;"; cat "$B/01_schema.sql"; } | run >/dev/null
echo "2/4 platform pieces";   run -f "$B/02_platform.sql" >/dev/null
echo "3/4 settings defaults"; run -f "$B/03_settings.sql" >/dev/null
echo "4/4 migrations record"; PSQL="$PSQL" DATABASE_URL="$DATABASE_URL" "$ROOT/scripts/db-migrate.sh" --stamp-all
echo "done: up to $(ls "$ROOT/supabase/migrations" | grep "^[0-9]\{14\}_" | tail -1)"
