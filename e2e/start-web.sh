#!/usr/bin/env bash
# Starts this checkout's web app on port 5174 against the LOCAL backend (8011) and LOCAL Supabase.
# Shell variables beat frontend/.env.local in Vite, so nothing here can reach the hosted project.
# Needs e2e/.env.local (e2e/setup-local.sh) and the backend from e2e/start-backend.sh. Stop with Ctrl+C.
# Sign in with a seeded account from e2e/accounts.json (password E2e-Local-Pass-1, local only).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$HERE/.env.local" ] || { echo "run e2e/setup-local.sh first" >&2; exit 1; }
set -a
# shellcheck disable=SC1091
. "$HERE/.env.local"
set +a
case "$SUPABASE_URL" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *) echo "REFUSING: $SUPABASE_URL is not a local address" >&2; exit 2 ;;
esac
API_PORT="${API_PORT:-8011}"
export VITE_API_URL="/api/v1"   # same origin through the Vite proxy, so no CORS setup is needed
export VITE_PROXY_TARGET="http://localhost:${API_PORT}"
export VITE_SUPABASE_URL="$SUPABASE_URL"
export VITE_SUPABASE_DIRECT_URL="$SUPABASE_URL"
export VITE_SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY"
cd "$HERE/../frontend"
exec npx vite --port "${WEB_PORT:-5174}" --strictPort
