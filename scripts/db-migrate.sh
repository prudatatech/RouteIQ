#!/usr/bin/env bash
# Applies the files in supabase/migrations that a database does not have yet, oldest first, and records
# each in public.app_migrations. The same script serves test and live, from a laptop or from CI.
#
#   DATABASE_URL=postgres://… scripts/db-migrate.sh            apply what is pending
#   DATABASE_URL=postgres://… scripts/db-migrate.sh --dry-run  apply inside a transaction, then roll back
#   DATABASE_URL=postgres://… scripts/db-migrate.sh --stamp-all record every file as applied, run nothing
#                                                              (once, for a database already up to date)
#   DATABASE_URL=postgres://… scripts/db-migrate.sh --stamp-through 20261001060000
#                                                              record the files up to that version as applied
#                                                              (a new database built from supabase/bootstrap, which
#                                                              already contains them), leave newer ones pending
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

# Files older than the bootstrap baseline are already in the schema; undated legacy files count as older.
if [[ "$MODE" == "--stamp-through" ]]; then
  through="${2:?give the last version the schema already contains}"
  older=()
  for f in "${pending[@]}"; do
    name="$(basename "$f")"
    if [[ ! "$name" =~ ^[0-9]{14}_ || ! "${name:0:14}" > "$through" ]]; then older+=("$f"); fi
  done
  for f in "${older[@]}"; do run -c "INSERT INTO public.app_migrations (name) VALUES ('$(basename "$f")') ON CONFLICT DO NOTHING" >/dev/null; done
  echo "recorded ${#older[@]} files up to $through as applied (nothing was run); $((${#pending[@]} - ${#older[@]})) newer ones are pending"; exit 0
fi

if [[ ${#pending[@]} -eq 0 ]]; then echo "database is up to date"; exit 0; fi

if [[ "$MODE" == "--stamp-all" ]]; then
  for f in "${pending[@]}"; do run -c "INSERT INTO public.app_migrations (name) VALUES ('$(basename "$f")') ON CONFLICT DO NOTHING" >/dev/null; done
  echo "recorded ${#pending[@]} files as applied (nothing was run)"; exit 0
fi

# Dry run: every pending file in ONE transaction, in order, then roll back. A later file can depend on an earlier
# pending one (a table it creates), exactly as when they are applied for real.
if [[ "$MODE" == "--dry-run" ]]; then
  if [[ ${#pending[@]} -gt 0 ]]; then
    log="$(mktemp)"
    if ! { echo "SET lock_timeout = '5s'; BEGIN;"
           # each file starts as the login role, as it does when applied on its own (a file may SET LOCAL ROLE)
           for f in "${pending[@]}"; do echo "RESET ROLE;"; echo "\\echo 'checking  $(basename "$f")'"; cat "$f"; echo; done
           echo "ROLLBACK;"; } | run >"$log"; then
      echo "FAILED in $(grep '^checking' "$log" | tail -1 | sed 's/^checking  //')" >&2
      exit 3
    fi
    grep '^checking' "$log" | sed 's/^checking/ok (rolled back)/'
  fi
  exit 0
fi

for f in "${pending[@]}"; do
  name="$(basename "$f")"
  { echo "SET lock_timeout = '5s'; BEGIN;"; cat "$f"; echo "INSERT INTO public.app_migrations (name) VALUES ('$name');"; echo "COMMIT;"; } | run >/dev/null
  echo "applied  $name"
done
