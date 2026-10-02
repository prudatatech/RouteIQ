#!/usr/bin/env bash
# Loads the app into a stage's Azure PostgreSQL server once infra/platform.sh has started the services
# (they create the auth, storage and realtime tables on first start):
#   1. roles and grants again (azure-roles.sql; now that auth.users exists, app_owner may reference it)
#   2. the public schema, owned by app_owner (supabase/bootstrap/00_extensions.sql + 01_schema.sql)
#   3. data: either the settings defaults (03_settings.sql) for a new database, or a full copy from
#      another database with --copy-from <postgres URL> (auth users with their password hashes, then
#      every public table, triggers paused)
#   4. platform pieces: sign-up trigger, storage bucket and policy, realtime publication
#   5. the migrations the schema already contains (up to supabase/bootstrap/BASELINE) recorded in public.app_migrations;
#      the deploy's migrate job applies anything newer
#
#   ./infra/platform-db.sh --stage live
#   ./infra/platform-db.sh --stage test --copy-from "$(cat ~/.routeiq/db_url)"
#
# Refuses a database whose public schema already has tables. Secrets: infra/platform.<stage>.env.
set -euo pipefail
INFRA_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$INFRA_DIR/.." && pwd)"
B="$ROOT_DIR/supabase/bootstrap"
STAGE="${STAGE:-live}"; COPY_FROM=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage) STAGE="$2"; shift ;;
    --copy-from) COPY_FROM="$2"; shift ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "unknown option $1" >&2; exit 1 ;;
  esac; shift
done
export STAGE
# shellcheck source=lib.sh
source "$INFRA_DIR/lib.sh"
load_azure_env
P="$( [[ "$STAGE" == live ]] && echo "$PREFIX" || echo "$PREFIX-test" )"
PF="$INFRA_DIR/platform.$STAGE.env"
[[ -f "$PF" ]] || die "$PF is missing: run ./infra/platform.sh --stage $STAGE --init first"
set -a; # shellcheck disable=SC1090
source "$PF"; set +a
PG_HOST="$P-pg.postgres.database.azure.com"
PG=(docker run --rm -i -e PGPASSWORD="$PG_ADMIN_PASSWORD" postgres:18-alpine psql "host=$PG_HOST port=5432 dbname=postgres user=$PG_ADMIN_USER sslmode=require" -q -v ON_ERROR_STOP=1)

[[ "$(echo "SELECT count(*) FROM pg_tables WHERE schemaname = 'auth'" | "${PG[@]}" -At)" != "0" ]] \
  || die "auth tables are missing: the sign-in service has not started yet (./infra/platform.sh --stage $STAGE)"
tables="$(echo "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'" | "${PG[@]}" -At)"
[[ "$tables" == "0" ]] || die "REFUSING: $PG_HOST already has $tables tables in public"

log "1/5 roles and grants"
"${PG[@]}" -v authenticator_pw="$AUTHENTICATOR_PASSWORD" -v auth_admin_pw="$AUTH_ADMIN_PASSWORD" \
  -v storage_admin_pw="$STORAGE_ADMIN_PASSWORD" -v realtime_admin_pw="$REALTIME_ADMIN_PASSWORD" \
  < "$ROOT_DIR/supabase/bootstrap/azure-roles.sql" >/dev/null 2>&1

log "2/5 schema"
{ cat "$B/00_extensions.sql"
  echo "SET ROLE app_owner; SET check_function_bodies = false;"
  # Azure has no "postgres" superuser to set default privileges for; app_owner's are set below
  grep -v "^ALTER DEFAULT PRIVILEGES FOR ROLE postgres " "$B/01_schema.sql"
  cat <<'SQL'
CREATE TABLE IF NOT EXISTS public.app_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.app_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_migrations FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE app_owner IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
RESET ROLE;
SQL
} | "${PG[@]}" >/dev/null 2>&1

if [[ -n "$COPY_FROM" ]]; then
  DUMP=(docker run --rm postgres:18-alpine pg_dump "$COPY_FROM" --data-only --no-owner --no-privileges)
  clean() { grep -vE '^\\(restrict|unrestrict) |^SET session_replication_role|^SELECT pg_catalog.set_config'; }
  log "3/5 data: sign-in users (password hashes kept)"
  { echo "SET session_replication_role = replica; SET ROLE supabase_auth_admin;"
    "${DUMP[@]}" --table=auth.users --table=auth.identities 2>/dev/null | clean; } | "${PG[@]}" >/dev/null
  log "3/5 data: app tables"
  { echo "SET session_replication_role = replica;"
    "${DUMP[@]}" --schema=public 2>/dev/null | clean; } | "${PG[@]}" >/dev/null
else
  log "3/5 settings defaults"
  { echo "SET ROLE app_owner;"; cat "$B/03_settings.sql"; } | "${PG[@]}" >/dev/null
fi

log "4/5 sign-up trigger, storage bucket, realtime"
"${PG[@]}" >/dev/null <<'SQL'
SET ROLE supabase_auth_admin;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
RESET ROLE;
SET ROLE supabase_storage_admin;
INSERT INTO storage.buckets (id, name, public) VALUES ('kyc_documents', 'kyc_documents', false) ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS kyc_documents_read ON storage.objects;
CREATE POLICY kyc_documents_read ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated
  USING ((bucket_id = 'kyc_documents'::text) AND public.can_read_kyc_object(name));
RESET ROLE;
DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN CREATE PUBLICATION supabase_realtime; END IF;
  FOREACH t IN ARRAY ARRAY['cargo_manifest','driver_confirmations','messages','notifications','routes','sos_alerts',
                           'system_settings','telemetry','tpl_offers','tpl_orders','vehicles','vendor_shipment_requests',
                           'shipments','route_stops','cargo_exceptions','customer_bookings','capacity_windows','capacity_bids',
                           'invoices','invoice_payment_reports','user_documents','vendor_profiles','tpl_partners','tpl_corridors','tpl_documents'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
SQL

log "5/5 migrations record"
# One statement for all files (a container per file would be slow and heavy on a laptop)
if [[ -z "$COPY_FROM" ]]; then
  { echo "INSERT INTO public.app_migrations (name) VALUES"
    # only what 01_schema.sql already contains (supabase/bootstrap/BASELINE); newer files are for scripts/db-migrate.sh
    base="$(tr -d '[:space:]' < "$ROOT_DIR/supabase/bootstrap/BASELINE")"
    ls "$ROOT_DIR/supabase/migrations/"*.sql | xargs -n1 basename | awk -v base="$base" '!/^[0-9]+_/ || substr($0,1,14) <= base' | sed "s/.*/('&')/" | paste -sd, -
    echo "ON CONFLICT DO NOTHING;"; } | "${PG[@]}" >/dev/null
fi
echo "SELECT count(*) || ' tables, ' || (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') || ' policies, ' || (SELECT count(*) FROM auth.users) || ' users' FROM pg_tables WHERE schemaname = 'public'" | "${PG[@]}" -At
log "Done: $PG_HOST"
