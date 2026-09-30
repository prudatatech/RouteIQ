#!/usr/bin/env bash
# Fill infra/secrets.env from .env files you already have (for example the backend's .env, or an
# export of the Railway variables), so no key has to be copied by hand.
#
#   ./infra/import-secrets.sh path/to/backend.env [path/to/other.env ...]
#
# Only keys listed in secrets.env.example are copied. A key that already has a value in
# secrets.env is kept. Values are never printed: the script lists key names only.
set -euo pipefail

INFRA_DIR="$(cd "$(dirname "$0")" && pwd)"
EXAMPLE="$INFRA_DIR/secrets.env.example"
TARGET="$INFRA_DIR/secrets.env"

[[ $# -ge 1 ]] || { echo "usage: $0 <source.env> [more.env ...]" >&2; exit 1; }
for src in "$@"; do [[ -f "$src" ]] || { echo "not found: $src" >&2; exit 1; }; done

[[ -f "$TARGET" ]] || cp "$EXAMPLE" "$TARGET"
chmod 600 "$TARGET"

# The value of KEY in a .env file: last assignment wins, surrounding quotes removed.
value_in() {
  local key="$1" file="$2" line
  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" "$file" | tail -n 1 || true)"
  [[ -n "$line" ]] || return 1
  line="${line#*=}"
  line="${line%$'\r'}"
  if [[ "$line" == \"*\" || "$line" == \'*\' ]]; then line="${line:1:${#line}-2}"; fi
  [[ -n "$line" ]] || return 1
  printf '%s' "$line"
}

filled=() missing=() kept=()
tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
cp "$TARGET" "$tmp"

while IFS= read -r key; do
  if current="$(value_in "$key" "$TARGET")"; then kept+=("$key"); continue; fi
  found=""
  for src in "$@"; do
    if v="$(value_in "$key" "$src")"; then found="$v"; fi
  done
  if [[ -n "$found" ]]; then
    # Replace the empty KEY= line (or append) without echoing the value.
    KEY="$key" VAL="$found" python3 - "$tmp" <<'PY'
import os, re, sys
path = sys.argv[1]
key, val = os.environ["KEY"], os.environ["VAL"]
text = open(path).read()
pattern = re.compile(rf"^{re.escape(key)}=.*$", re.M)
line = f"{key}={val}"
text = pattern.sub(lambda _: line, text, count=1) if pattern.search(text) else text.rstrip("\n") + f"\n{line}\n"
open(path, "w").write(text)
PY
    filled+=("$key")
  else
    missing+=("$key")
  fi
done < <(grep -E '^[A-Z0-9_]+=' "$EXAMPLE" | cut -d= -f1)

cp "$tmp" "$TARGET"; chmod 600 "$TARGET"

echo "Filled from your files: ${#filled[@]}"; for k in "${filled[@]+"${filled[@]}"}"; do echo "  + $k"; done
echo "Already set, kept:      ${#kept[@]}"
echo "Still empty:            ${#missing[@]}"; for k in "${missing[@]+"${missing[@]}"}"; do echo "  - $k"; done
echo
echo "Required to start the api: SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_JWT_SECRET SECRET_KEY PEOPLE_HASH_SALT"
echo "Fill any required key still empty in $TARGET, then tell Claude to deploy (or run ./infra/deploy.sh)."
