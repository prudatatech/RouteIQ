#!/usr/bin/env bash
# Applies the files in supabase/migrations that a database does not have yet, oldest first, and records
# each in public.app_migrations. The same script serves test and live, from a laptop or from CI.
#
#   DATABASE_URL=postgres://… scripts/db-migrate.sh            apply what is pending
#   DATABASE_URL=postgres://… scripts/db-migrate.sh --dry-run  apply inside a transaction, then roll back
#   DATABASE_URL=postgres://… scripts/db-migrate.sh --stamp-all record every file as applied, run nothing
#                                                              (once, for a database already up to date)
#
# Each file runs in its own transaction with a 5 s lock timeout, so a failure leaves nothing half done
# and never waits behind live traffic. The URL is read from the environment and never printed.
# Needs psql 15+ (or Docker: PSQL="docker run --rm -i postgres:18-alpine psql").
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"
MODE="${1:-apply}"
: "${DATABASE_URL:?set DATABASE_URL}"
PSQL="${PSQL:-psql}"

run() { $PSQL "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -At "$@"; }

run >/dev/null <<'SQL'
CREATE TABLE IF NOT EXISTS public.app_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.app_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_migrations FROM anon, authenticated;
SQL
applied="$(run -c "SELECT name FROM public.app_migrations")"

pending=()
for f in "$MIGRATIONS"/*.sql; do
  name="$(basename "$f")"
  grep -qxF "$name" <<<"$applied" || pending+=("$f")
done

if [[ ${#pending[@]} -eq 0 ]]; then echo "database is up to date"; exit 0; fi

if [[ "$MODE" == "--stamp-all" ]]; then
  for f in "${pending[@]}"; do run -c "INSERT INTO public.app_migrations (name) VALUES ('$(basename "$f")') ON CONFLICT DO NOTHING" >/dev/null; done
  echo "recorded ${#pending[@]} files as applied (nothing was run)"; exit 0
fi

for f in "${pending[@]}"; do
  name="$(basename "$f")"
  if [[ "$MODE" == "--dry-run" ]]; then
    { echo "SET lock_timeout = '5s'; BEGIN;"; cat "$f"; echo "ROLLBACK;"; } | run >/dev/null
    echo "ok (rolled back)  $name"
  else
    { echo "SET lock_timeout = '5s'; BEGIN;"; cat "$f"; echo "INSERT INTO public.app_migrations (name) VALUES ('$name');"; echo "COMMIT;"; } | run >/dev/null
    echo "applied  $name"
  fi
done
