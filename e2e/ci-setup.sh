#!/usr/bin/env bash
# Builds the throwaway test stack on a GitHub runner (.github/workflows/uat.yml): a local Supabase set up
# exactly as a new live project is (scripts/db-bootstrap.sh from supabase/bootstrap/, then
# scripts/db-migrate.sh) and e2e/.env.local. Redis (margix-e2e-redis on 6380) is started by the workflow.
# Nothing here reaches a hosted project.
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

# The same path a new live project takes: scripts/db-bootstrap.sh (schema, platform pieces, settings,
# migrations record) and then scripts/db-migrate.sh for anything newer. Every UAT run proves it works.
export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
bash "$REPO/scripts/db-bootstrap.sh"
bash "$REPO/scripts/db-migrate.sh"

bash "$HERE/setup-local.sh"
echo "test stack ready"
