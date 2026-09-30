#!/usr/bin/env bash
# Prepares the LOCAL Supabase used by the end-to-end run. Local only: nothing here touches a hosted project.
#
#  1. Re-creates the (gitignored) Supabase project folder e2e/supabase, project_id "margix-e2e", so the
#     CLI can find the running containers (supabase_*_margix-e2e).
#  2. Writes e2e/.env.local (gitignored) with the local API URL, keys and JWT secret, and the backend
#     settings the run needs.
#  3. Applies supabase/migrations/20260930016200_invoice_notes.sql to the local database.
#
# Start the local stack first (see e2e/README.md). Run from anywhere: bash e2e/setup-local.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
DB_CONTAINER="supabase_db_margix-e2e"

# The CLI's standard local-dev defaults, used when `supabase status` cannot see the containers.
DEFAULT_JWT_SECRET="super-secret-jwt-token-with-at-least-32-characters-long"

mkdir -p "$HERE/supabase"
if [ ! -f "$HERE/supabase/config.toml" ]; then
  cat > "$HERE/supabase/config.toml" <<'EOF'
project_id = "margix-e2e"

[api]
port = 54321

[db]
port = 54322
EOF
fi

API_URL="http://127.0.0.1:54321"
JWT_SECRET=""
ANON_KEY=""
SERVICE_ROLE_KEY=""

if status="$(cd "$HERE" && npx -y supabase@latest status -o env 2>/dev/null)"; then
  get() { printf '%s\n' "$status" | sed -n "s/^$1=\"\(.*\)\"$/\1/p" | head -1; }
  API_URL="$(get API_URL)"; API_URL="${API_URL:-http://127.0.0.1:54321}"
  JWT_SECRET="$(get JWT_SECRET)"
  ANON_KEY="$(get ANON_KEY)"
  SERVICE_ROLE_KEY="$(get SERVICE_ROLE_KEY)"
fi

if [ -z "$JWT_SECRET" ] || [ -z "$ANON_KEY" ] || [ -z "$SERVICE_ROLE_KEY" ]; then
  echo "supabase status gave no keys; signing the anon and service_role keys with the local-dev default secret"
  JWT_SECRET="$DEFAULT_JWT_SECRET"
  sign() {
    JWT_SECRET="$JWT_SECRET" ROLE="$1" node -e '
      const c = require("crypto");
      const b = o => Buffer.from(JSON.stringify(o)).toString("base64url");
      const head = b({ alg: "HS256", typ: "JWT" });
      const body = b({ iss: "supabase-demo", role: process.env.ROLE, exp: 1983812996 });
      const sig = c.createHmac("sha256", process.env.JWT_SECRET).update(head + "." + body).digest("base64url");
      process.stdout.write(head + "." + body + "." + sig);'
  }
  ANON_KEY="$(sign anon)"
  SERVICE_ROLE_KEY="$(sign service_role)"
fi

case "$API_URL" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) echo "REFUSING: $API_URL is not a local address" >&2; exit 2 ;;
esac

cat > "$HERE/.env.local" <<EOF
# Written by e2e/setup-local.sh. Local Supabase only. Not committed.
SUPABASE_URL=$API_URL
SUPABASE_ANON_KEY=$ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY
SUPABASE_JWT_SECRET=$JWT_SECRET
SECRET_KEY=$JWT_SECRET
REDIS_URL=redis://127.0.0.1:6380/0
PEOPLE_HASH_SALT=e2e-local-salt
APP_ENV=development
ALLOWED_ORIGINS=http://localhost:5173
EOF
echo "wrote e2e/.env.local"

# The database container is local; apply the migrations this run depends on (idempotent).
if ! docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
  echo "container $DB_CONTAINER is not running; start the local stack first (e2e/README.md)" >&2
  exit 1
fi
docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$REPO/supabase/migrations/20260930016200_invoice_notes.sql"
echo "applied 20260930016200_invoice_notes.sql to the local database"
