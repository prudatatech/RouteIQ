#!/usr/bin/env bash
# Shared helpers, sourced by deploy.sh and set-secrets.sh. Not meant to be run directly.

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$INFRA_DIR/.." && pwd)"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWARN:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# Two stages share one resource group, registry, logs, pull identity and Container Apps environment:
#   live (default): margix-api, margix-ml, margix-web
#   test:           margix-test-api, margix-test-ml, margix-test-web
# Select with STAGE=test or a --stage flag (see parse_stage_arg). Everything else keeps the same names.
STAGE="${STAGE:-live}"

# Scripts accept `--stage test`, `--stage=test` or STAGE=test in the environment (default live).

# Resolves which secrets file the stage uses and sets SECRETS_FILE:
#   secrets.<stage>.env when it exists; otherwise the shared secrets.env (with a WARN).
resolve_secrets_file() {
  local staged="$INFRA_DIR/secrets.${STAGE}.env" shared="$INFRA_DIR/secrets.env"
  if [[ -f "$staged" ]]; then
    SECRETS_FILE="$staged"
  elif [[ -f "$shared" ]]; then
    SECRETS_FILE="$shared"
    if [[ "$STAGE" == live ]]; then
      warn "!!! LIVE is using the SHARED infra/secrets.env because infra/secrets.live.env does not exist."
      warn "!!! If secrets.env holds TEST keys (test Supabase project), live would run against them. Create secrets.live.env."
    else
      warn "infra/secrets.test.env not found: the test stage is using the shared infra/secrets.env."
    fi
  else
    SECRETS_FILE="$staged"   # nothing exists yet: callers report the missing file by this name
  fi
}

# Loads azure.env and validates it. Sets PREFIX, LOCATION, WEB_LOCATION, RG, STAGE, API_APP, ...
load_azure_env() {
  [[ -f "$INFRA_DIR/azure.env" ]] || die "infra/azure.env is missing"
  set -a
  # shellcheck disable=SC1091
  source "$INFRA_DIR/azure.env"
  # Account-specific values (subscription, alert email) live in a gitignored file next to it,
  # so moving to a new Azure account only means editing azure.local.env.
  if [[ -f "$INFRA_DIR/azure.local.env" ]]; then
    # shellcheck disable=SC1091
    source "$INFRA_DIR/azure.local.env"
  fi
  set +a
  PREFIX="${PREFIX:-margix}"
  LOCATION="${LOCATION:-centralindia}"
  WEB_LOCATION="${WEB_LOCATION:-eastasia}"
  SUBSCRIPTION_ID="${SUBSCRIPTION_ID:-}"
  BUDGET_EMAIL="${BUDGET_EMAIL:-}"
  CUSTOM_DOMAIN="${CUSTOM_DOMAIN:-}"
  API_DOMAIN="${API_DOMAIN:-}"
  case "$STAGE" in
    live) APP_PREFIX="$PREFIX" ;;
    test) APP_PREFIX="${PREFIX}-test" ;;
    *) die "STAGE must be 'live' or 'test' (got '$STAGE')" ;;
  esac
  RG="${PREFIX}-rg"   # shared by both stages, like the registry, logs, pull identity and environment
  API_APP="${APP_PREFIX}-api"
  ML_APP="${APP_PREFIX}-ml"
  WEB_APP="${APP_PREFIX}-web"
  # The custom domains belong to live only.
  DATA_DOMAIN="${DATA_DOMAIN:-}"
  # The test stage uses its own names (TEST_*), never live's
  if [[ "$STAGE" != live ]]; then CUSTOM_DOMAIN="${TEST_CUSTOM_DOMAIN:-}"; API_DOMAIN="${TEST_API_DOMAIN:-}"; DATA_DOMAIN="${TEST_DATA_DOMAIN:-}"; fi
  resolve_secrets_file
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

SECRETS_FILE="$INFRA_DIR/secrets.env"   # replaced by resolve_secrets_file once the stage is known

# Prints "KEY<TAB>VALUE" for every non-comment line of the stage's secrets file (values may be blank).
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
        sys.stderr.write("secrets file: ignoring invalid key name\n")
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
