#!/usr/bin/env bash
# Applies the stage's secrets file to the running container apps without a full deploy.
#   ./infra/set-secrets.sh                 live: infra/secrets.live.env (falls back to secrets.env with a WARN)
#   ./infra/set-secrets.sh --stage test    test: infra/secrets.test.env (falls back to secrets.env with a WARN); also STAGE=test
# Values are never printed. Blank keys are skipped with a warning. Keys starting VITE_ stay local.
# The file stays the source of truth: deploy.sh applies the same file, so a later deploy
# will not undo what you set here as long as you keep the file in sync.
set -euo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

while [[ $# -gt 0 ]]; do
  arg="$1"; shift
  case "$arg" in
    --stage) [[ $# -gt 0 ]] || die "--stage needs a value (live or test)"; STAGE="$1"; shift ;;
    --stage=*) STAGE="${arg#--stage=}" ;;
    -h|--help) sed -n '2,6p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "unknown flag: $arg (use --stage live|test)" ;;
  esac
done

load_azure_env
require_az_login
log "Stage: $STAGE ($API_APP, $ML_APP), secrets from ${SECRETS_FILE#$ROOT_DIR/}"
[[ -f "$SECRETS_FILE" ]] || die "${SECRETS_FILE#$ROOT_DIR/} not found. Copy infra/secrets.env.example to it and fill it in."

ML_KEYS=" SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY "

api_secrets=(); api_env=()
ml_secrets=();  ml_env=()
while IFS=$'\t' read -r key value; do
  [[ -z "$key" || "$key" == VITE_* ]] && continue
  if [[ -z "$value" ]]; then
    warn "$key is blank, skipped"
    continue
  fi
  name="$(secret_name "$key")"
  api_secrets+=("$name=$value")
  api_env+=("$key=secretref:$name")
  if [[ "$ML_KEYS" == *" $key "* ]]; then
    ml_secrets+=("$name=$value")
    ml_env+=("$key=secretref:$name")
  fi
done < <(read_secrets_env)

# apply APP NAME=VALUE... -- ENV=secretref:NAME...   (bash 3.2 safe: no namerefs)
apply() {
  local app="$1"; shift
  local s=() e=() seen=0 x
  for x in "$@"; do
    if [[ "$x" == "--" ]]; then seen=1; elif [[ $seen -eq 0 ]]; then s+=("$x"); else e+=("$x"); fi
  done
  if [[ ${#s[@]} -eq 0 ]]; then warn "$app: nothing to apply"; return; fi
  log "$app: setting ${#s[@]} secret(s)"
  az containerapp secret set -g "$RG" -n "$app" --secrets "${s[@]}" -o none
  az containerapp update -g "$RG" -n "$app" --set-env-vars "${e[@]}" -o none
  # An update that changes nothing creates no new revision, so restart the active one explicitly.
  local rev
  rev="$(az containerapp show -g "$RG" -n "$app" --query properties.latestRevisionName -o tsv)"
  log "$app: restarting revision $rev"
  az containerapp revision restart -g "$RG" -n "$app" --revision "$rev" -o none
}

apply "$API_APP" ${api_secrets[@]+"${api_secrets[@]}"} -- ${api_env[@]+"${api_env[@]}"}
apply "$ML_APP" ${ml_secrets[@]+"${ml_secrets[@]}"} -- ${ml_env[@]+"${ml_env[@]}"}
log "Done. Verify: curl -fsS https://\$(az containerapp show -g $RG -n $API_APP --query properties.configuration.ingress.fqdn -o tsv)/health"
