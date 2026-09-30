#!/usr/bin/env bash
# One-time setup so GitHub Actions can deploy without stored passwords (OIDC federation).
# The account owner runs this once: it creates an app registration, a federated credential (no password)
# and a Contributor role assignment on the resource group, then stores the three ids in GitHub.
# Needs: az login as the subscription owner, and gh signed in to GitHub.
set -euo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

REPO="${GITHUB_REPO:-prudatatech/RouteIQ}"
BRANCH="${GITHUB_BRANCH:-main}"

load_azure_env
require_az_login
APP_NAME="${PREFIX}-github-deploy"
TENANT="$(az account show --query tenantId -o tsv)"

APP_ID="$(az ad app list --display-name "$APP_NAME" --query '[0].appId' -o tsv)"
if [[ -z "$APP_ID" ]]; then
  log "Creating app registration $APP_NAME"
  APP_ID="$(az ad app create --display-name "$APP_NAME" --query appId -o tsv)"
fi
if [[ -z "$(az ad sp list --filter "appId eq '$APP_ID'" --query '[0].id' -o tsv)" ]]; then
  az ad sp create --id "$APP_ID" -o none
fi

# Federated credential for pushes to the branch (and one for manual runs from the same branch).
CRED_NAME="github-${BRANCH}"
if [[ -z "$(az ad app federated-credential list --id "$APP_ID" --query "[?name=='$CRED_NAME'].name" -o tsv)" ]]; then
  log "Adding federated credential for repo:$REPO:ref:refs/heads/$BRANCH"
  az ad app federated-credential create --id "$APP_ID" --parameters "{
    \"name\": \"$CRED_NAME\",
    \"issuer\": \"https://token.actions.githubusercontent.com\",
    \"subject\": \"repo:$REPO:ref:refs/heads/$BRANCH\",
    \"audiences\": [\"api://AzureADTokenExchange\"]
  }" -o none
fi

# Pushes only swap images and upload the web app (deploy.sh --images-only), so Contributor on the
# resource group is enough: no access to the rest of the subscription, and no secrets in GitHub.
SCOPE="/subscriptions/$SUB/resourceGroups/$RG"
if [[ -z "$(az role assignment list --assignee "$APP_ID" --scope "$SCOPE" --role Contributor --query '[0].id' -o tsv)" ]]; then
  log "Granting Contributor on $SCOPE"
  az role assignment create --assignee "$APP_ID" --role Contributor --scope "$SCOPE" -o none
fi

# The three ids are not secrets: store them as repository variables. The workflow runs only once they exist.
if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  gh variable set AZURE_CLIENT_ID --repo "$REPO" --body "$APP_ID"
  gh variable set AZURE_TENANT_ID --repo "$REPO" --body "$TENANT"
  gh variable set AZURE_SUBSCRIPTION_ID --repo "$REPO" --body "$SUB"
  log "Stored AZURE_CLIENT_ID, AZURE_TENANT_ID and AZURE_SUBSCRIPTION_ID as variables on $REPO."
  log "Every push to $BRANCH that touches backend-ts, ml-service, frontend or infra now deploys to Azure."
else
  echo
  echo "gh is not signed in. Add these as repository VARIABLES ($REPO > Settings > Secrets and variables > Actions > Variables):"
  echo "  AZURE_CLIENT_ID       = $APP_ID"
  echo "  AZURE_TENANT_ID       = $TENANT"
  echo "  AZURE_SUBSCRIPTION_ID = $SUB"
fi
echo "Optional: add the public Mapbox token (pk.) as the variable VITE_MAPBOX_TOKEN so web maps draw roads."
