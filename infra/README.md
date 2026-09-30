# MargixIndia on Azure: runbook

Everything is code. Nothing is hand-clicked, nothing in this repo belongs to one Azure account, and
secrets never enter git (they live in `infra/secrets.env`, which is gitignored). Supabase holds all
the data, so the Azure side is stateless and can be rebuilt at any time.

```
Browser --> Static Web App  <prefix>-web   (frontend/, Vite build, Free)
        --> Container App   <prefix>-api   (backend-ts, external HTTPS + WebSockets, exactly 1 replica)
                              |--> <prefix>-ml     (ml-service, internal only, scales to zero)
                              '--> Supabase (database, auth, storage)
Shared: <prefix>-rg, <prefix>-logs (Log Analytics, 30 days), <prefix>-env (Container Apps, Consumption),
        Azure Container Registry (Basic, admin off, pulled with a managed identity that has AcrPull)
Subscription: <prefix>-budget with alerts at 50 / 100 / 150
```

Files: `main.bicep` (resources), `budget.bicep` (subscription budget), `azure.env` (settings, committed),
`secrets.env.example` (every key, with where to get it), `deploy.sh`, `set-secrets.sh`, `github-oidc.sh`.

## Prerequisites

- Azure CLI (`az`), Docker, Node 20, python3. macOS bash 3.2 works.
- Your user needs **Owner** (or **User Access Administrator** plus Contributor) on the subscription:
  the Bicep grants `AcrPull` to the apps' managed identity, and the budget is subscription scope.

## First deploy

```bash
az login
$EDITOR infra/azure.env                       # PREFIX, LOCATION, BUDGET_EMAIL (SUBSCRIPTION_ID optional)
cp infra/secrets.env.example infra/secrets.env
$EDITOR infra/secrets.env                     # at minimum the Supabase keys, SECRET_KEY, PEOPLE_HASH_SALT
./infra/deploy.sh
```

If you run `deploy.sh` before `secrets.env` has the Supabase keys, it creates all the infrastructure
with placeholder images and deploys the frontend, but does not roll the api/ml images (the backend
exits at start-up without Supabase credentials). Fill the file and run `./infra/deploy.sh` again.

`deploy.sh` is idempotent. It: checks login, sets the subscription, registers resource providers,
installs Bicep, creates the resource group and deploys `main.bicep` (secrets from `secrets.env` are passed as
a secure parameter through a private temp file that is deleted on exit), creates the budget once, builds the
`backend-ts` and `ml-service` images for `linux/amd64` tagged with the git short sha, pushes them to ACR, redeploys
the apps with those images, builds the frontend against the API URL and deploys it with the SWA CLI
(the deployment token is fetched at run time and only lives in an environment variable), then waits for
`/health` to return 200 **and** for the running revision to use the new image tag.

Flags: `--only-infra`, `--skip-api` (no image build/roll for api and ml), `--skip-web`.

Changing one secret later without a full deploy: edit `secrets.env`, run `./infra/set-secrets.sh`. It sets
Container App secrets and `secretref` env vars, never prints values, skips blank keys with a warning and restarts the
revision. Keep `secrets.env` as the source of truth: `deploy.sh` re-applies the same file.

Verify:

```bash
API=$(az containerapp show -g margix-rg -n margix-api --query properties.configuration.ingress.fqdn -o tsv)
curl -i https://$API/health
az containerapp logs show -g margix-rg -n margix-api --follow
```

## Moving to a new Azure account

Export nothing from the old account: Supabase holds all the data.

1. `az logout && az login` with the new account (`az account list -o table` to check the subscription).
2. Adjust `infra/azure.env` (new `SUBSCRIPTION_ID` if needed; budget email).
3. Keep your `infra/secrets.env` (it is not tied to the Azure account) or refill it from `secrets.env.example`.
4. `./infra/deploy.sh`
5. New URLs are printed. Re-point DNS (below), and update anything that stored the old API URL
   (telematics vendor webhooks, GPS push URL, Supabase auth redirect URLs).
6. Delete the old resource group when you are satisfied (`az group delete -n margix-rg`).

## Custom domains and DNS

**Web (margixindia.com on the Static Web App).** Set `CUSTOM_DOMAIN=margixindia.com` in `azure.env` (CORS and
`WEB_APP_URL`), deploy, then:

```bash
az staticwebapp hostname set -n margix-web -g margix-rg --hostname www.margixindia.com   # after the CNAME below exists
```

DNS: `www` CNAME to the `margix-web` default hostname (printed by deploy.sh). For the apex, use an ALIAS/ANAME
record if your DNS host supports it, or delegate DNS to Azure DNS. SWA issues the certificate itself. Note: margixindia.com is
currently a separate old site; do not touch its records until you are ready to cut over.

**API (e.g. api.margixindia.com on the Container App, managed certificate).**

```bash
az containerapp show -g margix-rg -n margix-api --query "{fqdn:properties.configuration.ingress.fqdn,verify:properties.customDomainVerificationId}"
```

1. DNS: `CNAME api -> <fqdn>` and `TXT asuid.api -> <verify id>`.
2. `az containerapp hostname add -g margix-rg -n margix-api --hostname api.margixindia.com`
3. `az containerapp hostname bind -g margix-rg -n margix-api --hostname api.margixindia.com --environment margix-env --validation-method CNAME`
4. Set `API_DOMAIN=api.margixindia.com` in `azure.env` and re-run `./infra/deploy.sh --skip-api` so the frontend is rebuilt against it.

This step is manual because the certificate cannot be issued until DNS resolves to Azure.

## Cutover from Railway / Vercel with no downtime

1. Deploy to Azure and verify everything on the `*.azurecontainerapps.io` / `*.azurestaticapps.net` URLs. The old
   Vercel origin is allowed by CORS during this period (`extraAllowedOrigins` / `extraCorsPatterns` in `main.bicep`).
2. Lower the TTL on the DNS records you will move to 300 seconds, a day ahead.
3. Add the custom domains above and wait for certificates (both stacks keep serving the old site meanwhile).
4. Move third-party callers: the telematics webhook, SparkGPS push URL, Twilio/Resend settings that reference the API, and Supabase
   Auth site URL / redirect URLs (add the new ones before removing the old ones).
5. Flip DNS. The old Railway/Vercel deployments stay up as a rollback until traffic has drained; watch
   `az containerapp logs show`.
6. After a few days: remove the old services and the extra CORS entries.

Because the API keeps its in-memory state (scheduler, OTP store, rate-limit counters), do the flip in a quiet window: customer
OTPs issued by the old API cannot be verified by the new one.

## Cost (estimates; check the Azure pricing page for Central India)

| Item | Approx. per month |
|---|---|
| api, 0.5 vCPU / 1 GiB always on (after the monthly free grant of 180k vCPU-s and 360k GiB-s) | 12 to 30 USD |
| ml, scales to zero | 0 to 3 USD |
| Container Registry Basic | ~5 USD |
| Log Analytics (5 GB/month free) | 0 to 3 USD |
| Static Web App Free | 0 |
| Total | roughly 25 to 55 USD |

Idle replicas are billed at a much lower rate than active ones, so real cost sits near the low end. The
The budget alerts you at 50, 100 and 150 of a 200 monthly budget (`budget.bicep`; currency is your billing currency, and some
offers, such as certain free trials, may not support budgets: deploy.sh then warns loudly).

## Teardown

```bash
az group delete --name margix-rg --yes --no-wait     # everything except the budget
az consumption budget delete --budget-name margix-budget
```

Supabase data is untouched.

## Why exactly one api replica

`minReplicas` and `maxReplicas` are both 1 in `main.bicep`, on purpose. The API keeps state in process memory: the
scheduler (odometer sync, traffic checks) would run every job once per replica, rate limits would be counted
per replica (so effectively multiplied), and customer OTPs are stored in memory, so an OTP issued by one replica fails
verification on the other. Do not raise the limit or add scale rules until that state lives in Redis or Supabase.
Container Apps restarts and revision swaps cause a brief overlap of two replicas during a deploy; keep deploys out of peak hours.

## GitHub Actions (optional)

`.github/workflows/deploy-azure.yml` runs `infra/deploy.sh` with OIDC login, and is manual (`workflow_dispatch`) only. To enable it:

1. `./infra/github-oidc.sh` (creates the identity, federated credential for `prudatatech/RouteIQ` on `main`, Owner role on the subscription).
2. Add the printed `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` as repository secrets, plus `SECRETS_ENV` with the contents of `infra/secrets.env`.
3. Uncomment the `push:` trigger in the workflow.

## Known limitations

- **Redis:** there is no Redis container. The backend's cache and rate limits use the Upstash REST client (`UPSTASH_REDIS_REST_URL/TOKEN` in `secrets.env`) and fall back to an in-memory cache when those are blank, which is fine with one api replica.
- **ml cold start:** `ml` scales to zero, so the first optimizer call after idle waits for the container to start.
- **Static Web App location:** SWA is not available in Central India, so `WEB_LOCATION` defaults to `eastasia`. It only stores metadata; the site is served from the global edge.
