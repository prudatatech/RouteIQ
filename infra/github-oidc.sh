#!/usr/bin/env bash
# One-time setup so GitHub Actions can deploy without stored passwords (OIDC federation).
# The account owner runs this once: it creates an app registration, a federated credential (no password)
# and a Contributor role assignment on the resource group, then stores the three ids in GitHub.
# Needs: az login as the subscription owner, and gh signed in to GitHub.
set -euo pipefail
# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

REPO="${GITHUB_REPO:-prudatatech/RouteIQ}"
# One federated credential per deployable branch: main deploys the live stage, test deploys the test stage.
# Credentials are bound to the branch ref (the workflow's Azure login jobs use no GitHub environment).
BRANCHES="${GITHUB_BRANCHES:-main test}"

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

# Federated credentials for pushes and manual runs on each branch. GitHub sends the subject in one of
# two forms, depending on the organisation's settings: "repo:owner/repo:ref:..." or, with immutable
# ids, "repo:owner@<id>/repo@<id>:ref:...". Register both so either works.
add_credential() {
  local name="$1" subject="$2"
  if [[ -z "$(az ad app federated-credential list --id "$APP_ID" --query "[?name=='$name'].name" -o tsv)" ]]; then
    log "Adding federated credential $name for $subject"
    az ad app federated-credential create --id "$APP_ID" --parameters "{
      \"name\": \"$name\",
      \"issuer\": \"https://token.actions.githubusercontent.com\",
      \"subject\": \"$subject\",
      \"audiences\": [\"api://AzureADTokenExchange\"]
    }" -o none
  fi
}
HAVE_GH=0
if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  HAVE_GH=1
  OWNER_ID="$(gh api "repos/$REPO" --jq .owner.id)"; REPO_ID="$(gh api "repos/$REPO" --jq .id)"
fi
for BRANCH in $BRANCHES; do
  add_credential "github-${BRANCH}" "repo:$REPO:ref:refs/heads/$BRANCH"
  if [[ $HAVE_GH -eq 1 ]]; then
    add_credential "github-${BRANCH}-ids" "repo:${REPO%%/*}@${OWNER_ID}/${REPO##*/}@${REPO_ID}:ref:refs/heads/$BRANCH"
  fi
done

# Pushes only swap images and upload the web app (deploy.sh --images-only), so Contributor on the
# resource group is enough: no access to the rest of the subscription, and no secrets in GitHub.
# Both stages live in this one resource group, so one role assignment covers live and test.
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
  log "Every push to $BRANCHES that touches backend-ts, ml-service, frontend or infra now deploys to Azure (main = live, test = test)."
else
  echo
  echo "gh is not signed in. Add these as repository VARIABLES ($REPO > Settings > Secrets and variables > Actions > Variables):"
  echo "  AZURE_CLIENT_ID       = $APP_ID"
  echo "  AZURE_TENANT_ID       = $TENANT"
  echo "  AZURE_SUBSCRIPTION_ID = $SUB"
fi
