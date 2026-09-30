#!/usr/bin/env bash
# Starts this checkout's backend against the LOCAL Supabase on port 8011 (override with PORT).
# Needs e2e/.env.local from e2e/setup-local.sh. Stop it with Ctrl+C.
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
cd "$HERE/../backend-ts"
PORT="${PORT:-8011}" exec npx ts-node-dev --transpile-only src/index.ts
