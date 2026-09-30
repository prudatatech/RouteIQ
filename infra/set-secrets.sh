#!/usr/bin/env bash
# Applies infra/secrets.env to the running container apps without a full deploy.
# Values are never printed. Blank keys are skipped with a warning. Keys starting VITE_ stay local.
# secrets.env stays the source of truth: deploy.sh applies the same file, so a later deploy
# will not undo what you set here as long as you keep the file in sync.
set -euo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

load_azure_env
require_az_login
[[ -f "$SECRETS_FILE" ]] || die "infra/secrets.env not found. Copy infra/secrets.env.example and fill it in."

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
