#!/usr/bin/env bash
# Shared helpers, sourced by deploy.sh and set-secrets.sh. Not meant to be run directly.

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$INFRA_DIR/.." && pwd)"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWARN:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# Loads azure.env and validates it. Sets PREFIX, LOCATION, WEB_LOCATION, RG, ...
load_azure_env() {
  [[ -f "$INFRA_DIR/azure.env" ]] || die "infra/azure.env is missing"
  set -a
  # shellcheck disable=SC1091
  source "$INFRA_DIR/azure.env"
  set +a
  PREFIX="${PREFIX:-margix}"
  LOCATION="${LOCATION:-centralindia}"
  WEB_LOCATION="${WEB_LOCATION:-eastasia}"
  SUBSCRIPTION_ID="${SUBSCRIPTION_ID:-}"
  BUDGET_EMAIL="${BUDGET_EMAIL:-}"
  CUSTOM_DOMAIN="${CUSTOM_DOMAIN:-}"
  API_DOMAIN="${API_DOMAIN:-}"
  RG="${PREFIX}-rg"
  API_APP="${PREFIX}-api"
  ML_APP="${PREFIX}-ml"
  WEB_APP="${PREFIX}-web"
}

require_az_login() {
  command -v az >/dev/null || die "Azure CLI (az) is not installed"
  az account show >/dev/null 2>&1 || die "not logged in: run 'az login' first"
  if [[ -n "$SUBSCRIPTION_ID" ]]; then
    az account set --subscription "$SUBSCRIPTION_ID"
  fi
  SUB="$(az account show --query id -o tsv)"
  log "Subscription: $(az account show --query name -o tsv) ($SUB)"
}

SECRETS_FILE="$INFRA_DIR/secrets.env"

# Prints "KEY<TAB>VALUE" for every non-comment line of secrets.env (values may be blank).
# Strips one pair of surrounding quotes. Keys must look like ENV_VAR names.
read_secrets_env() {
  [[ -f "$SECRETS_FILE" ]] || return 0
  python3 - "$SECRETS_FILE" <<'PY'
import re, sys
for raw in open(sys.argv[1], encoding="utf-8"):
    line = raw.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    key, value = key.strip(), value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        value = value[1:-1]
    if not re.fullmatch(r"[A-Z][A-Z0-9_]*", key):
        sys.stderr.write("secrets.env: ignoring invalid key name\n")
        continue
    print(f"{key}\t{value}")
PY
}

# Value of one key from secrets.env (empty when missing).
secret_value() {
  read_secrets_env | awk -F'\t' -v k="$1" '$1==k { sub(/^[^\t]*\t/, ""); print; exit }'
}

# Container App secret name for an env var: MY_KEY -> my-key
secret_name() { printf '%s' "$1" | tr 'A-Z_' 'a-z-'; }
