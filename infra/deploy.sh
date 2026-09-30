#!/usr/bin/env bash
# One-command, idempotent deploy of MargixIndia to Azure.
#   ./infra/deploy.sh                 everything
#   ./infra/deploy.sh --only-infra    resource group, Bicep, budget; no images, no web
#   ./infra/deploy.sh --images-only   build + push images, swap them in, deploy the web; keeps the secrets
#                                     and settings already in Azure (used by GitHub Actions on push)
#   ./infra/deploy.sh --skip-api      do not build/push/roll the api and ml images
#   ./infra/deploy.sh --skip-web      do not build/deploy the frontend
# Re-running is safe: Bicep is declarative and images are tagged with the git sha.
set -euo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SKIP_WEB=0; SKIP_API=0; ONLY_INFRA=0; IMAGES_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --skip-web) SKIP_WEB=1 ;;
    --skip-api) SKIP_API=1 ;;
    --only-infra) ONLY_INFRA=1 ;;
    --images-only) IMAGES_ONLY=1 ;;
    -h|--help) sed -n '2,7p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "unknown flag: $arg (use --skip-web, --skip-api, --only-infra, --images-only)" ;;
  esac
done

PLACEHOLDER_IMAGE="mcr.microsoft.com/k8se/quickstart:latest"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# 1 + 2. login and subscription
load_azure_env
require_az_login
[[ ${#PREFIX} -ge 2 && ${#PREFIX} -le 12 ]] || die "PREFIX must be 2 to 12 characters"

# 3. resource providers
for ns in Microsoft.App Microsoft.OperationalInsights Microsoft.ContainerRegistry Microsoft.Web Microsoft.Consumption; do
  state="$(az provider show --namespace "$ns" --query registrationState -o tsv 2>/dev/null || echo NotRegistered)"
  if [[ "$state" != "Registered" ]]; then
    log "Registering provider $ns (takes a minute)"
    az provider register --namespace "$ns" --wait
  fi
done

# 4. Bicep CLI
if ! az bicep version >/dev/null 2>&1; then
  log "Installing Bicep"
  az bicep install
fi

# Build the secretValues parameter from secrets.env, in a private temp file removed on exit.
build_secret_params() {
  local out="$TMP_DIR/secrets.json"
  ( umask 077
    if [[ -f "$SECRETS_FILE" ]]; then
      read_secrets_env | python3 -c '
import json, sys
d = {}
for line in sys.stdin:
    k, _, v = line.rstrip("\n").partition("\t")
    if k.startswith("VITE_") or not v:
        continue
    d[k] = v
print(json.dumps(d))' > "$out"
    else
      echo '{}' > "$out"
    fi )
  if [[ ! -f "$SECRETS_FILE" ]]; then
    warn "infra/secrets.env not found: apps will start without secrets (fill it in, then run set-secrets.sh)"
  fi
  SECRET_PARAMS_FILE="$out"
}

current_image() { # app -> image currently deployed, or empty
  az containerapp show -g "$RG" -n "$1" --query 'properties.template.containers[0].image' -o tsv 2>/dev/null || true
}

deploy_bicep() { # api image, ml image
  log "Deploying infra/main.bicep (api=$1, ml=$2)"
  az deployment group create \
    --resource-group "$RG" \
    --name "${PREFIX}-main" \
    --template-file "$INFRA_DIR/main.bicep" \
    --parameters \
      prefix="$PREFIX" location="$LOCATION" webLocation="$WEB_LOCATION" \
      apiImage="$1" mlImage="$2" customDomain="$CUSTOM_DOMAIN" \
      secretValues=@"$SECRET_PARAMS_FILE" \
    --only-show-errors -o none
}

out() { az deployment group show -g "$RG" -n "${PREFIX}-main" --query "properties.outputs.$1.value" -o tsv; }

if [[ $IMAGES_ONLY -eq 1 ]]; then
  # No Bicep and no secrets: read the names from the last infra deployment and only swap images.
  log "Images only: reading $RG from the last infra deployment"
  ACR_NAME="$(out acrName)"; ACR_SERVER="$(out acrLoginServer)"
  API_FQDN="$(out apiFqdn)"; WEB_HOST="$(out webHostname)"
  [[ -n "$ACR_SERVER" && -n "$API_FQDN" ]] || die "no infra deployment found in $RG: run ./infra/deploy.sh once first"
else
# 5. resource group + infra, keeping whatever image is already running
log "Resource group $RG in $LOCATION"
az group create --name "$RG" --location "$LOCATION" --only-show-errors -o none
build_secret_params
API_IMAGE="$(current_image "$API_APP")"; API_IMAGE="${API_IMAGE:-$PLACEHOLDER_IMAGE}"
ML_IMAGE="$(current_image "$ML_APP")";  ML_IMAGE="${ML_IMAGE:-$PLACEHOLDER_IMAGE}"
deploy_bicep "$API_IMAGE" "$ML_IMAGE"

ACR_NAME="$(out acrName)"
ACR_SERVER="$(out acrLoginServer)"
API_FQDN="$(out apiFqdn)"
WEB_HOST="$(out webHostname)"

# Budget (subscription scope). Created once; skipped when it exists. Not every offer supports budgets.
if [[ -n "$BUDGET_EMAIL" ]]; then
  if az consumption budget show --budget-name "${PREFIX}-budget" >/dev/null 2>&1; then
    log "Budget ${PREFIX}-budget already exists"
  else
    log "Creating budget ${PREFIX}-budget (alerts to $BUDGET_EMAIL)"
    az deployment sub create --location "$LOCATION" --name "${PREFIX}-budget" \
      --template-file "$INFRA_DIR/budget.bicep" \
      --parameters prefix="$PREFIX" contactEmail="$BUDGET_EMAIL" --only-show-errors -o none \
      || warn "BUDGET NOT CREATED. Your subscription type may not support budgets; set one in Cost Management."
  fi
else
  warn "BUDGET_EMAIL is empty in azure.env: no budget alerts configured"
fi

fi

if [[ $ONLY_INFRA -eq 1 ]]; then
  log "Infra only: done. API: https://$API_FQDN  Web: https://$WEB_HOST"
  exit 0
fi

# Image tag: git short sha; a dirty tree gets a timestamp so the tag is never reused for different code.
TAG="$(git -C "$ROOT_DIR" rev-parse --short HEAD)"
if [[ -n "$(git -C "$ROOT_DIR" status --porcelain -- backend-ts ml-service)" ]]; then
  TAG="${TAG}-dirty$(date +%H%M%S)"
fi
NEW_API_IMAGE=""

# backend-ts and ml-service exit at start-up without Supabase credentials, so rolling real images
# before secrets exist would only crash-loop. Keep the placeholder until they are filled in.
if [[ $IMAGES_ONLY -eq 0 && $SKIP_API -eq 0 && ( -z "$(secret_value SUPABASE_URL)" || -z "$(secret_value SUPABASE_SERVICE_ROLE_KEY)" ) ]]; then
  warn "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in infra/secrets.env: skipping the api and ml images."
  warn "Fill infra/secrets.env, then run ./infra/deploy.sh again (or with --skip-web)."
  SKIP_API=1
fi

if [[ $SKIP_API -eq 0 ]]; then
  command -v docker >/dev/null || die "docker is required to build the images"
  NEW_API_IMAGE="$ACR_SERVER/${PREFIX}-api:$TAG"
  NEW_ML_IMAGE="$ACR_SERVER/${PREFIX}-ml:$TAG"

  # 6. build for linux/amd64 (Container Apps), even from Apple Silicon
  log "Building $NEW_API_IMAGE"
  docker build --platform linux/amd64 -t "$NEW_API_IMAGE" "$ROOT_DIR/backend-ts"
  log "Building $NEW_ML_IMAGE"
  docker build --platform linux/amd64 -t "$NEW_ML_IMAGE" "$ROOT_DIR/ml-service"

  # 7. push
  az acr login --name "$ACR_NAME"
  docker push "$NEW_API_IMAGE"
  docker push "$NEW_ML_IMAGE"

  # 8. roll the apps
  if [[ $IMAGES_ONLY -eq 1 ]]; then
    # Only the image changes; secrets, env vars, ingress and probes stay as Bicep last set them.
    log "Swapping in $NEW_API_IMAGE and $NEW_ML_IMAGE"
    az containerapp update -g "$RG" -n "$API_APP" --image "$NEW_API_IMAGE" --only-show-errors -o none
    az containerapp update -g "$RG" -n "$ML_APP" --image "$NEW_ML_IMAGE" --only-show-errors -o none
  else
    # re-run Bicep with the real images (also fixes the ingress port and adds probes)
    deploy_bicep "$NEW_API_IMAGE" "$NEW_ML_IMAGE"
  fi
fi

# 9. frontend
if [[ $SKIP_WEB -eq 0 ]]; then
  API_URL="https://${API_DOMAIN:-$API_FQDN}"
  # The public pk. token: from secrets.env locally, or the VITE_MAPBOX_TOKEN variable in CI
  MAPBOX_PUBLIC="$(secret_value VITE_MAPBOX_TOKEN)"; MAPBOX_PUBLIC="${MAPBOX_PUBLIC:-${VITE_MAPBOX_TOKEN:-}}"
  [[ -n "$MAPBOX_PUBLIC" ]] || warn "VITE_MAPBOX_TOKEN is blank in secrets.env: the map builds without a public Mapbox token"
  log "Building frontend against $API_URL"
  ( cd "$ROOT_DIR/frontend"
    npm ci
    VITE_API_URL="$API_URL" VITE_MAPBOX_TOKEN="$MAPBOX_PUBLIC" npm run build )
  log "Deploying frontend to Static Web App $WEB_APP"
  # The token is fetched now and handed over through the environment: never written to disk.
  SWA_CLI_DEPLOYMENT_TOKEN="$(az staticwebapp secrets list --name "$WEB_APP" --resource-group "$RG" --query properties.apiKey -o tsv)"
  export SWA_CLI_DEPLOYMENT_TOKEN
  # Run the uploader from an empty temp folder with a pinned version: inside frontend/ npx resolved
  # the package against the project on GitHub's runners and failed (ENOENT frontend/margix).
  ( cd "$TMP_DIR" && npx --yes @azure/static-web-apps-cli@2.0.10 deploy "$ROOT_DIR/frontend/dist" --env production )
  unset SWA_CLI_DEPLOYMENT_TOKEN
fi

# 10. wait for health, and (when we rolled images) for the running revision to carry the new tag
RUNNING_IMAGE="$(current_image "$API_APP")"
if [[ "$RUNNING_IMAGE" == "$PLACEHOLDER_IMAGE" ]]; then
  log "Done (infra only: the api still runs the placeholder image, so there is no /health to check yet)."
  echo "  API:  https://$API_FQDN"
  echo "  Web:  https://$WEB_HOST"
  exit 0
fi
log "Waiting for https://$API_FQDN/health"
deadline=$((SECONDS + 600))
healthy=0
while [[ $SECONDS -lt $deadline ]]; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$API_FQDN/health" || true)"
  if [[ "$code" == "200" ]]; then healthy=1; break; fi
  sleep 10
done
[[ $healthy -eq 1 ]] || die "API did not return 200 on /health within 10 minutes (last status: ${code:-none}). Check: az containerapp logs show -g $RG -n $API_APP --follow"

if [[ -n "$NEW_API_IMAGE" ]]; then
  log "Checking the running revision uses $NEW_API_IMAGE"
  matched=0
  while [[ $SECONDS -lt $deadline ]]; do
    rev="$(az containerapp show -g "$RG" -n "$API_APP" --query properties.latestReadyRevisionName -o tsv)"
    img="$(az containerapp revision show -g "$RG" -n "$API_APP" --revision "$rev" --query 'properties.template.containers[0].image' -o tsv)"
    if [[ "$img" == "$NEW_API_IMAGE" ]]; then matched=1; break; fi
    sleep 10
  done
  [[ $matched -eq 1 ]] || die "latest ready revision runs '$img', expected '$NEW_API_IMAGE'"
fi

# 11. summary
log "Done."
echo "  API:  https://$API_FQDN   (health: /health)"
echo "  ML:   internal only"
echo "  Web:  https://$WEB_HOST"
[[ -f "$SECRETS_FILE" ]] || echo "  Next: cp infra/secrets.env.example infra/secrets.env, fill it in, run ./infra/set-secrets.sh"
