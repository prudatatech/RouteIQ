#!/usr/bin/env bash
# One-time setup so GitHub Actions can deploy without stored passwords (OIDC federation).
# YOU run this: it creates an app registration, a service principal and a role assignment.
# Needs: az login as a user who can create app registrations and assign roles (Owner is enough).
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

# Owner is needed on the subscription: deploy.sh creates the resource group, the ACR role assignment
# and the subscription-level budget. Narrow it if you pre-create those.
SCOPE="/subscriptions/$SUB"
if [[ -z "$(az role assignment list --assignee "$APP_ID" --scope "$SCOPE" --role Owner --query '[0].id' -o tsv)" ]]; then
  log "Granting Owner on $SCOPE"
  az role assignment create --assignee "$APP_ID" --role Owner --scope "$SCOPE" -o none
fi

echo
echo "Add these as GitHub repository secrets ($REPO > Settings > Secrets and variables > Actions):"
echo "  AZURE_CLIENT_ID       = $APP_ID"
echo "  AZURE_TENANT_ID       = $TENANT"
echo "  AZURE_SUBSCRIPTION_ID = $SUB"
echo
echo "Also add the contents of infra/secrets.env as a secret named SECRETS_ENV (the workflow writes it to a file at run time)."
echo "Then enable the push trigger in .github/workflows/deploy-azure.yml."
