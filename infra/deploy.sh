#!/usr/bin/env bash
# One-command, idempotent deploy of MargixIndia to Azure.
#   ./infra/deploy.sh                 everything
#   ./infra/deploy.sh --only-infra    resource group, Bicep, budget; no images, no web
#   ./infra/deploy.sh --images-only   build + push images, swap them in, deploy the web; keeps the secrets
#                                     and settings already in Azure (used by GitHub Actions on push)
#   ./infra/deploy.sh --skip-api      do not build/push/roll the api and ml images
#   ./infra/deploy.sh --skip-web      do not build/deploy the frontend
#   ./infra/deploy.sh --api-only | --ml-only | --web-only
#                                     build/roll just that part (combine them, e.g. --api-only --web-only;
#                                     usually with --images-only). GitHub Actions runs one job per part.
# Re-running is safe: Bicep is declarative and images are tagged with the git sha.
set -euo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SKIP_WEB=0; SKIP_API=0; ONLY_INFRA=0; IMAGES_ONLY=0; PICK_API=0; PICK_ML=0; PICK_WEB=0
for arg in "$@"; do
  case "$arg" in
    --skip-web) SKIP_WEB=1 ;;
    --skip-api) SKIP_API=1 ;;
    --only-infra) ONLY_INFRA=1 ;;
    --images-only) IMAGES_ONLY=1 ;;
    --api-only) PICK_API=1 ;;
    --ml-only) PICK_ML=1 ;;
    --web-only) PICK_WEB=1 ;;
    -h|--help) sed -n '2,10p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "unknown flag: $arg (use --skip-web, --skip-api, --only-infra, --images-only, --api-only, --ml-only, --web-only)" ;;
  esac
done

# What to build and roll. With none of --api-only/--ml-only/--web-only everything is selected;
# otherwise only the named parts. --skip-api / --skip-web still remove parts.
DO_API=1; DO_ML=1; DO_WEB=1; SELECTED=0
if [[ $((PICK_API + PICK_ML + PICK_WEB)) -gt 0 ]]; then
  SELECTED=1; DO_API=$PICK_API; DO_ML=$PICK_ML; DO_WEB=$PICK_WEB
fi
[[ $SKIP_API -eq 1 ]] && { DO_API=0; DO_ML=0; }
[[ $SKIP_WEB -eq 1 ]] && DO_WEB=0

PLACEHOLDER_IMAGE="mcr.microsoft.com/k8se/quickstart:latest"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# 1 + 2. login and subscription
load_azure_env
require_az_login
[[ ${#PREFIX} -ge 2 && ${#PREFIX} -le 12 ]] || die "PREFIX must be 2 to 12 characters"

# 3. resource providers (not needed to swap images: the infra already exists)
[[ $IMAGES_ONLY -eq 1 ]] || for ns in Microsoft.App Microsoft.OperationalInsights Microsoft.ContainerRegistry Microsoft.Web Microsoft.Consumption; do
  state="$(az provider show --namespace "$ns" --query registrationState -o tsv 2>/dev/null || echo NotRegistered)"
  if [[ "$state" != "Registered" ]]; then
    log "Registering provider $ns (takes a minute)"
    az provider register --namespace "$ns" --wait
  fi
done

# 4. Bicep CLI
if [[ $IMAGES_ONLY -eq 0 ]] && ! az bicep version >/dev/null 2>&1; then
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

# All deployment outputs come from one az call (each az call costs seconds).
OUTPUTS_JSON=""
out() {
  [[ -n "$OUTPUTS_JSON" ]] || OUTPUTS_JSON="$(az deployment group show -g "$RG" -n "${PREFIX}-main" --query properties.outputs -o json 2>/dev/null || true)"
  printf '%s' "$OUTPUTS_JSON" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get(sys.argv[1],{}).get("value",""))
except Exception: print("")' "$1"
}

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

OUTPUTS_JSON=""   # re-read: the deployment above just changed them
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
NEW_API_IMAGE=""; NEW_ML_IMAGE=""

# backend-ts and ml-service exit at start-up without Supabase credentials, so rolling real images
# before secrets exist would only crash-loop. Keep the placeholder until they are filled in.
if [[ $IMAGES_ONLY -eq 0 && $DO_API$DO_ML != 00 && ( -z "$(secret_value SUPABASE_URL)" || -z "$(secret_value SUPABASE_SERVICE_ROLE_KEY)" ) ]]; then
  warn "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in infra/secrets.env: skipping the api and ml images."
  warn "Fill infra/secrets.env, then run ./infra/deploy.sh again (or with --skip-web)."
  DO_API=0; DO_ML=0
fi

# Build for linux/amd64 (Container Apps), even from Apple Silicon. On GitHub Actions one buildx call
# builds and pushes, reusing layers from the Actions cache (one scope per app); locally it is a plain
# build followed by a push.
build_image() { # app-key (api|ml), image, context dir
  log "Building $2"
  if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
    docker buildx build --platform linux/amd64 --push -t "$2" \
      --cache-from "type=gha,scope=$1" --cache-to "type=gha,mode=max,scope=$1" "$3"
  else
    docker build --platform linux/amd64 -t "$2" "$3"
    docker push "$2"
  fi
}

if [[ $DO_API -eq 1 || $DO_ML -eq 1 ]]; then
  command -v docker >/dev/null || die "docker is required to build the images"
  az acr login --name "$ACR_NAME"   # before the build: buildx pushes as it goes
  [[ $DO_API -eq 1 ]] && { NEW_API_IMAGE="$ACR_SERVER/${PREFIX}-api:$TAG"; build_image api "$NEW_API_IMAGE" "$ROOT_DIR/backend-ts"; }
  [[ $DO_ML -eq 1 ]] && { NEW_ML_IMAGE="$ACR_SERVER/${PREFIX}-ml:$TAG"; build_image ml "$NEW_ML_IMAGE" "$ROOT_DIR/ml-service"; }

  # 8. roll the apps
  if [[ $IMAGES_ONLY -eq 1 ]]; then
    # Only the image changes; secrets, env vars, ingress and probes stay as Bicep last set them.
    if [[ -n "$NEW_API_IMAGE" ]]; then
      log "Swapping in $NEW_API_IMAGE"
      az containerapp update -g "$RG" -n "$API_APP" --image "$NEW_API_IMAGE" --only-show-errors -o none &
      API_PID=$!
    fi
    if [[ -n "$NEW_ML_IMAGE" ]]; then
      log "Swapping in $NEW_ML_IMAGE"
      az containerapp update -g "$RG" -n "$ML_APP" --image "$NEW_ML_IMAGE" --only-show-errors -o none &
      ML_PID=$!
    fi
    [[ -z "${API_PID:-}" ]] || wait "$API_PID" || die "rolling $API_APP failed"
    [[ -z "${ML_PID:-}" ]] || wait "$ML_PID" || die "rolling $ML_APP failed"
  else
    # re-run Bicep with the real images (also fixes the ingress port and adds probes);
    # a part that was not rebuilt keeps the image it already runs
    deploy_bicep "${NEW_API_IMAGE:-$API_IMAGE}" "${NEW_ML_IMAGE:-$ML_IMAGE}"
  fi
fi

# 9. frontend
if [[ $DO_WEB -eq 1 ]]; then
  API_URL="https://${API_DOMAIN:-$API_FQDN}"
  log "Building frontend against $API_URL"
  ( cd "$ROOT_DIR/frontend"
    npm ci
    VITE_API_URL="$API_URL" npm run build )
  log "Deploying frontend to Static Web App $WEB_APP"
  # The token is fetched now and handed over through the environment: never written to disk.
  SWA_CLI_DEPLOYMENT_TOKEN="$(az staticwebapp secrets list --name "$WEB_APP" --resource-group "$RG" --query properties.apiKey -o tsv)"
  export SWA_CLI_DEPLOYMENT_TOKEN
  # npm reads the PREFIX environment variable as its install prefix, and azure.env exports PREFIX=margix,
  # so on GitHub's runners npx tried to install into ./margix (ENOENT). Hide it from npm for this call.
  ( cd "$TMP_DIR" && env -u PREFIX npx --yes @azure/static-web-apps-cli@2.0.10 deploy "$ROOT_DIR/frontend/dist" --env production )
  unset SWA_CLI_DEPLOYMENT_TOKEN
fi

# 10. wait for health, and (when we rolled images) for the running revision to carry the new tag.
# Poll every 3s: a revision is normally ready by the time `az containerapp update` returns.
wait_revision() { # app, image
  local rev img=""
  while [[ $SECONDS -lt $deadline ]]; do
    rev="$(az containerapp show -g "$RG" -n "$1" --query properties.latestReadyRevisionName -o tsv 2>/dev/null || true)"
    if [[ -n "$rev" ]]; then
      img="$(az containerapp revision show -g "$RG" -n "$1" --revision "$rev" --query 'properties.template.containers[0].image' -o tsv 2>/dev/null || true)"
      [[ "$img" == "$2" ]] && return 0
    fi
    sleep 3
  done
  die "latest ready revision of $1 runs '${img:-none}', expected '$2'"
}

deadline=$((SECONDS + 300))
# A web-only (or ml-only) run has no reason to wait on the api.
if [[ $SELECTED -eq 0 || $DO_API -eq 1 ]]; then
  RUNNING_IMAGE="$(current_image "$API_APP")"
  if [[ "$RUNNING_IMAGE" == "$PLACEHOLDER_IMAGE" ]]; then
    log "Done (infra only: the api still runs the placeholder image, so there is no /health to check yet)."
    echo "  API:  https://$API_FQDN"
    echo "  Web:  https://$WEB_HOST"
    exit 0
  fi
  log "Waiting for https://$API_FQDN/health"
  healthy=0
  while [[ $SECONDS -lt $deadline ]]; do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "https://$API_FQDN/health" || true)"
    if [[ "$code" == "200" ]]; then healthy=1; break; fi
    sleep 3
  done
  [[ $healthy -eq 1 ]] || die "API did not return 200 on /health within 5 minutes (last status: ${code:-none}). Check: az containerapp logs show -g $RG -n $API_APP --follow"
fi

if [[ -n "$NEW_API_IMAGE" ]]; then
  log "Checking the running revision uses $NEW_API_IMAGE"
  wait_revision "$API_APP" "$NEW_API_IMAGE"
fi
if [[ -n "$NEW_ML_IMAGE" ]]; then
  log "Checking the running revision uses $NEW_ML_IMAGE"
  wait_revision "$ML_APP" "$NEW_ML_IMAGE"
fi

# 11. summary
log "Done."
echo "  API:  https://$API_FQDN   (health: /health)"
echo "  ML:   internal only"
echo "  Web:  https://$WEB_HOST"
[[ -f "$SECRETS_FILE" ]] || echo "  Next: cp infra/secrets.env.example infra/secrets.env, fill it in, run ./infra/set-secrets.sh"
