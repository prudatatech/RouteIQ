#!/usr/bin/env bash
# Copies a stage's whole database from another PostgreSQL server into this account's server for the stage,
# for moving to a new Azure account. Unlike platform-db.sh --copy-from (bootstrap schema + data), the schema
# comes from the source too, so a source that is ahead of supabase/bootstrap keeps every migration it has.
#
#   ./infra/clone-db.sh --stage test --from-host margix-test-pg.postgres.database.azure.com
#
# Run after ./infra/platform.sh --stage <s> (the sign-in, storage and realtime services create their tables on
# first start). Refuses a target whose public schema already has tables. The copy runs as a one-off Container
# Apps job in <prefix>-env, so it works when the source only admits Azure-hosted clients (AllowAzureServices),
# e.g. an old subscription that is read-only. Source and target use the admin login in infra/platform.<stage>.env.
# Uploaded files are not copied: they live in the stage's blob container, not in the database.
set -euo pipefail
INFRA_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$INFRA_DIR/.." && pwd)"
STAGE="${STAGE:-live}"; FROM_HOST=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --stage) STAGE="$2"; shift ;;
    --from-host) FROM_HOST="$2"; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown option $1" >&2; exit 1 ;;
  esac; shift
done
export STAGE
# shellcheck source=lib.sh
source "$INFRA_DIR/lib.sh"
load_azure_env
require_az_login
[[ -n "$FROM_HOST" ]] || die "--from-host is required (the source server's host name)"
P="$( [[ "$STAGE" == live ]] && echo "$PREFIX" || echo "$PREFIX-test" )"
PF="$INFRA_DIR/platform.$STAGE.env"
[[ -f "$PF" ]] || die "$PF is missing"
set -a; # shellcheck disable=SC1090
source "$PF"; set +a
TO_HOST="$PG_SERVER.postgres.database.azure.com"
JOB="$P-clone-db"

# Runs inside postgres:18-alpine. SRC / DST are libpq connection strings; passwords come from the job's secrets.
# Its log is also stored in the target (clone_log.lines): Log Analytics drops lines from short-lived jobs.
read -r -d '' INNER <<'SH' || true
set -eu
echo "$ROLES_SQL_B64" | base64 -d > /tmp/roles.sql
echo "$EXT_SQL_B64" | base64 -d > /tmp/ext.sql
S() { PGPASSWORD="$PG_PW" psql "$SRC" -q -At "$@"; }
T() { PGPASSWORD="$PG_PW" psql "$DST" -q -v ON_ERROR_STOP=1 "$@"; }
TQ() { PGPASSWORD="$PG_PW" psql "$DST" -q -At "$@"; }
LOG=/tmp/clone.log; : > $LOG
say() { echo "$*"; echo "$*" >> $LOG; }
keep_log() {
  { echo "CREATE SCHEMA IF NOT EXISTS clone_log; DROP TABLE IF EXISTS clone_log.lines; CREATE TABLE clone_log.lines (body text);"
    echo "\\set body \`cat $LOG\`"; echo "INSERT INTO clone_log.lines VALUES (:'body');"; } | TQ >/dev/null 2>&1 || true
}
trap keep_log EXIT
DUMP() { PGPASSWORD="$PG_PW" pg_dump "$SRC" "$@"; }
clean() { grep -vE '^\\(restrict|unrestrict) |^SET session_replication_role|^SELECT pg_catalog.set_config'; }
# Shape of the app's part of a database: compared between source and target at the end
SHAPE="SELECT 'policies', count(*) FROM pg_policies WHERE schemaname IN ('public','app','storage')
UNION ALL SELECT 'functions', count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('public','app')
UNION ALL SELECT 'triggers', count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('public','app') AND NOT t.tgisinternal
UNION ALL SELECT 'views', count(*) FROM pg_views WHERE schemaname IN ('public','app')
UNION ALL SELECT 'rls tables', count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname IN ('public','app') AND c.relrowsecurity
UNION ALL SELECT 'realtime tables', count(*) FROM pg_publication_tables WHERE pubname = 'supabase_realtime'"

[ "$(echo "SELECT count(*) FROM pg_tables WHERE schemaname = 'auth'" | TQ)" != "0" ] || { say "FAIL: auth tables missing on target (run platform.sh first)"; exit 1; }
n="$(echo "SELECT count(*) FROM pg_tables WHERE schemaname IN ('public','app')" | TQ)"
[ "$n" = "0" ] || { say "FAIL: target already has $n tables in public/app"; exit 1; }
say "source: $(echo "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'" | S) public tables, $(echo 'SELECT count(*) FROM auth.users' | S) users"

say "1/6 roles and grants"
T -v authenticator_pw="$AUTHENTICATOR_PASSWORD" -v auth_admin_pw="$AUTH_ADMIN_PASSWORD" \
  -v storage_admin_pw="$STORAGE_ADMIN_PASSWORD" -v realtime_admin_pw="$REALTIME_ADMIN_PASSWORD" < /tmp/roles.sql >/dev/null 2>&1
say "2/6 extensions"
T < /tmp/ext.sql >/dev/null 2>&1
say "3/6 schemas public and app, with the source's owners and grants"
# The roles have the same names on both servers (azure-roles.sql). Run as the admin: the app schema and four
# security-definer functions belong to it or to app_owner, and keeping that keeps what those functions may do.
# A few statements always fail harmlessly (public already exists and belongs to azure_pg_admin); the shape
# check below catches anything that matters.
DUMP --schema=public --schema=app --schema-only | clean > /tmp/schema.sql
echo "SET check_function_bodies = false;" | cat - /tmp/schema.sql | PGPASSWORD="$PG_PW" psql "$DST" -q 2> /tmp/schema.err >/dev/null || true
say "   statements that failed: $(grep -c 'ERROR' /tmp/schema.err || true)"
grep 'ERROR' /tmp/schema.err | sort | uniq -c | sort -rn | head -10 >> $LOG || true
say "4/6 data: sign-in users, file records, app tables (triggers paused)"
{ echo "SET session_replication_role = replica; SET ROLE supabase_auth_admin;"
  DUMP --no-owner --data-only --table=auth.users --table=auth.identities | clean; } | T >/dev/null
{ echo "SET session_replication_role = replica; SET ROLE supabase_storage_admin;"
  DUMP --no-owner --data-only --table=storage.buckets --table=storage.objects | clean; } | T >/dev/null
{ echo "SET session_replication_role = replica;"
  DUMP --no-owner --data-only --schema=public --schema=app | clean; } | T >/dev/null 2>/tmp/data.err
say "5/6 sign-up trigger, storage policies, realtime"
T >/dev/null <<'SQL'
SET ROLE supabase_auth_admin;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
RESET ROLE;
SQL
# Policies on the storage tables come from the migrations, not from the storage service: copy their definitions
echo "SELECT format('DROP POLICY IF EXISTS %I ON storage.%I; CREATE POLICY %I ON storage.%I AS %s FOR %s TO %s%s%s;',
  policyname, tablename, policyname, tablename, permissive, cmd, array_to_string(roles, ', '),
  CASE WHEN qual IS NOT NULL THEN ' USING (' || qual || ')' ELSE '' END,
  CASE WHEN with_check IS NOT NULL THEN ' WITH CHECK (' || with_check || ')' ELSE '' END)
  FROM pg_policies WHERE schemaname = 'storage'" | S > /tmp/storage_policies.sql
{ echo "SET ROLE supabase_storage_admin;"; cat /tmp/storage_policies.sql; echo "RESET ROLE;"; } | T >/dev/null
# The same tables as the source's realtime publication
for t in $(echo "SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public'" | S); do
  echo "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN CREATE PUBLICATION supabase_realtime; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = '$t')
    THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.\"$t\"; END IF; END \$\$;"
done | T >/dev/null
echo "NOTIFY pgrst, 'reload schema';" | T >/dev/null
say "6/6 checks, source vs target"
ok=1
echo "$SHAPE" | S -F'|' | sort > /tmp/src.shape
echo "$SHAPE" | TQ -F'|' | sort > /tmp/dst.shape
if diff /tmp/src.shape /tmp/dst.shape > /tmp/shape.diff; then say "OK: $(tr '\n' ' ' < /tmp/src.shape)"
else ok=0; say "FAIL: schema shape differs (< source, > target)"; cat /tmp/shape.diff >> $LOG; cat /tmp/shape.diff; fi
q="SELECT string_agg(format('SELECT %L, count(*) FROM %I.%I', schemaname || '.' || tablename, schemaname, tablename), ' UNION ALL ' ORDER BY schemaname, tablename) FROM pg_tables WHERE schemaname IN ('public','app')"
echo "$(echo "$q" | S);" | S | sort > /tmp/src.counts
echo "$(echo "$q" | S);" | TQ | sort > /tmp/dst.counts
for x in auth.users auth.identities storage.buckets storage.objects; do
  echo "$x|$(echo "SELECT count(*) FROM $x" | S)" >> /tmp/src.counts
  echo "$x|$(echo "SELECT count(*) FROM $x" | TQ)" >> /tmp/dst.counts
done
if diff /tmp/src.counts /tmp/dst.counts > /tmp/rows.diff; then say "OK: all $(wc -l < /tmp/src.counts) tables match ($(awk -F'|' '{s+=$2} END{print s}' /tmp/src.counts) rows)"
else ok=0; say "FAIL: row counts differ (< source, > target)"; cat /tmp/rows.diff >> $LOG; head -5 /tmp/data.err >> $LOG 2>/dev/null || true; fi
[ "$ok" = "1" ] || exit 1
SH

log "Cloning $FROM_HOST -> $TO_HOST (stage $STAGE) with job $JOB"
SRC="host=$FROM_HOST port=5432 dbname=postgres user=$PG_ADMIN_USER sslmode=require"
DST="host=$TO_HOST port=5432 dbname=postgres user=$PG_ADMIN_USER sslmode=require"
b64() { base64 < "$1" | tr -d '\n'; }
az containerapp job delete -g "$RG" -n "$JOB" --yes -o none 2>/dev/null || true
# The job is created from a spec file: az's --args would read the shell's "-c" as one of its own flags.
# The file holds secrets, so it is private and removed on exit.
SPEC="$(umask 077; mktemp)"; trap 'rm -f "$SPEC"' EXIT
ENV_ID="$(az containerapp env show -g "$RG" -n "${PREFIX}-env" --query id -o tsv)"
ENV_LOCATION="$(az containerapp env show -g "$RG" -n "${PREFIX}-env" --query location -o tsv)"
ENV_ID="$ENV_ID" ENV_LOCATION="$ENV_LOCATION" SRC="$SRC" DST="$DST" INNER="$INNER" \
ROLES_SQL_B64="$(b64 "$ROOT_DIR/supabase/bootstrap/azure-roles.sql")" EXT_SQL_B64="$(b64 "$ROOT_DIR/supabase/bootstrap/00_extensions.sql")" \
  python3 - "$SPEC" <<'PY'
import base64, json, os, sys
e = os.environ
secrets = {'pg-pw': 'PG_ADMIN_PASSWORD', 'authenticator-pw': 'AUTHENTICATOR_PASSWORD', 'auth-admin-pw': 'AUTH_ADMIN_PASSWORD',
           'storage-admin-pw': 'STORAGE_ADMIN_PASSWORD', 'realtime-admin-pw': 'REALTIME_ADMIN_PASSWORD'}
env = [{'name': 'PG_PW', 'secretRef': 'pg-pw'}] + [{'name': v, 'secretRef': k} for k, v in secrets.items() if k != 'pg-pw']
env += [{'name': k, 'value': e[k]} for k in ('SRC', 'DST', 'ROLES_SQL_B64', 'EXT_SQL_B64')]
env.append({'name': 'SCRIPT_B64', 'value': base64.b64encode(e['INNER'].encode()).decode()})
spec = {'location': e['ENV_LOCATION'], 'properties': {
  'environmentId': e['ENV_ID'],
  'configuration': {'triggerType': 'Manual', 'replicaTimeout': 3600, 'replicaRetryLimit': 0,
                    'manualTriggerConfig': {'parallelism': 1, 'replicaCompletionCount': 1},
                    'secrets': [{'name': k, 'value': e[v]} for k, v in secrets.items()]},
  'template': {'containers': [{'name': 'clone', 'image': 'postgres:18-alpine', 'resources': {'cpu': 1, 'memory': '2Gi'},
    'command': ['/bin/sh', '-c', 'echo "$SCRIPT_B64" | base64 -d > /tmp/clone.sh && sh /tmp/clone.sh'], 'env': env}]}}}
json.dump(spec, open(sys.argv[1], 'w'))
PY
az containerapp job create -g "$RG" -n "$JOB" --yaml "$SPEC" --only-show-errors -o none
rm -f "$SPEC"
EXEC="$(az containerapp job start -g "$RG" -n "$JOB" --query name -o tsv)"
log "Started $EXEC; waiting (a small database takes a few minutes)"
status=Running
for _ in $(seq 1 180); do
  status="$(az containerapp job execution show -g "$RG" -n "$JOB" --job-execution-name "$EXEC" --query properties.status -o tsv 2>/dev/null || echo Running)"
  [[ "$status" == Running || "$status" == Processing ]] || break
  sleep 10
done
az containerapp job delete -g "$RG" -n "$JOB" --yes -o none 2>/dev/null || true
log "Job $EXEC: $status. Its log, read back from the target:"
PSQL=(docker run --rm -i -e PGPASSWORD="$PG_ADMIN_PASSWORD" postgres:18-alpine psql "$DST" -q -At)
echo "SELECT body FROM clone_log.lines; DROP SCHEMA clone_log CASCADE;" | "${PSQL[@]}" \
  || warn "could not read the log from $TO_HOST (is this machine's IP in its firewall?)"
[[ "$status" == Succeeded ]] || die "clone failed ($status)"
log "Done: $TO_HOST"
