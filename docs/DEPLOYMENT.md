# Deploying MargixIndia

Start here. This page says where each part of MargixIndia runs, how to ship each kind of change, and which detailed guide to follow. When you change how something is deployed, update this page too.

- **Last verified:** 30 Sep 2026.
- **Detailed guides:**
  - [`infra/README.md`](../infra/README.md): the Azure runbook.
  - [`supabase/README.md`](../supabase/README.md): database changes.
  - [`e2e/README.md`](../e2e/README.md): the local end-to-end test.

---

## 1. Where everything runs

| Part | Code | Runs on | Address |
|---|---|---|---|
| Web app (staff, vendor, 3PL, public tracking) | `frontend/` | **Azure Static Web Apps** `margix-web`, and still Vercel (see §2) | https://gentle-plant-0cd625000.5.azurestaticapps.net |
| Backend API + WebSocket + scheduler | `backend-ts/` | **Azure Container Apps** `margix-api`, and still Railway (see §2) | https://margix-api.graywave-14c2046e.centralindia.azurecontainerapps.io |
| Route optimizer | `ml-service/` | **Azure Container Apps** `margix-ml` (internal only, scales to zero) | reachable from the backend only |
| Database, sign-in, file storage, realtime | `supabase/` | **Supabase** project `plutdajzefwtpgofpqlk` (not on Azure) | Supabase dashboard |
| Driver app | `driver-app/` | **Expo EAS** (over-the-air updates) + APK | EAS project `routeiq`, channel `preview` |
| Customer app | `customer-app/` | **Expo EAS** (needs its own native build, see §6) | n/a |
| Source code and CI | all | **GitHub** `prudatatech/RouteIQ` | CI runs on every push |

The Azure resources are:
- **Subscription:** "Azure subscription 1" (`1c904442-…902c`), account `kushagratiwari252@gmail.com`.
- **Resource group:** `margix-rg`, in region **Central India**. The web app's record sits in East Asia, because Static Web Apps can't be created in Central India; its content is served worldwide from a CDN.
- **Budget:** `margix-budget`, $200, with alerts at $50, $100 and $150.

**Why the database is not on Azure.** Supabase also provides sign-in, row-level security (about 62 policies using `auth.uid()`), file storage and realtime. Azure Database for PostgreSQL provides only the database, so moving would mean rebuilding all of those. Keeping Supabase also means moving to a new Azure account never touches data.

**Why the backend runs as exactly one copy.** The scheduler, rate limits, map tile cache and customer login codes live in the server's memory. Two copies would run scheduled jobs twice, and a customer's login code could land on the wrong copy. Don't raise `maxReplicas` until that state moves to Upstash Redis or Supabase.

---

## 2. Current state: two setups running side by side

| | Old (still serving margixindia.com) | New (Azure, verified, not yet on the domain) |
|---|---|---|
| Web | Vercel project `prudatas-projects/margixindia` | Static Web App `margix-web` |
| Backend | Railway `routeiq-production-7034.up.railway.app` | Container App `margix-api` |
| Deploys | Automatically on push to `main` | Automatically on push to `main` (§4.4) |

Until the domain is switched (§4.5), **a push to `main` updates both**: Vercel and Railway (which serve margixindia.com), and Azure.

Both setups use the **same Supabase database**, so they share all data.

---

## 3. Which process do I follow?

| I changed… | Do this |
|---|---|
| Web or backend code | §4.1: test, push, deploy |
| The database schema | §5: migration first, then code |
| Driver app screens or text | §6.1: over-the-air update |
| A native module in the driver app | §6.2: new APK |
| The customer app | §6.3: new EAS build |
| A secret or API key | §4.3 |
| Something user-visible that needs a full check | §7: local end-to-end run |
| Moving to a new Azure account | §4.6 |

---

## 4. Web and backend

### 4.1 Normal release

Work happens on the `ui/redesign` branch in the `.claude/worktrees/integration` worktree, and `main` is fast-forwarded to it.

1. **Run the checks.** Every one of these must pass:
   ```bash
   (cd backend-ts && npx tsc --noEmit && npm run check:queries && npm run check:vocabulary && npm test -- --maxWorkers=1)
   (cd frontend && npx tsc --noEmit && npm run lint && npm run check:vocabulary && npx vitest run && npm run build)
   ```
   If a few backend tests fail with `EADDRNOTAVAIL`, the Mac has run out of network ports. It isn't a code failure: re-run those files on their own. A fix for this is in progress.
2. **If the change includes a database migration, apply it before pushing** (§5).
3. **Commit.** Every commit ends with `Co-Authored-By: Deepstacker <dev.deepstacker@gmail.com>`, merge commits included. Never add Claude as co-author.
4. **Push:** `git push origin HEAD:ui/redesign && git push origin HEAD:main`.
5. **Deploy to Azure:** `./infra/deploy.sh`. Use `--skip-web` for a backend-only change and `--skip-api` for a web-only change. The script only finishes when `/health` answers and the running version uses the new image.
6. **Confirm the old setup deployed** (while it still serves the domain). Check GitHub's deployment statuses for the commit. Railway shows as `modest-courage / production`, and Vercel as `Production`, which is not `Preview`.

### 4.2 Azure deploy script

`infra/deploy.sh` is idempotent: safe to run again at any time. It:
1. registers Azure providers and applies `infra/main.bicep` (skipped with `--images-only`);
2. builds `linux/amd64` images on this Mac (on GitHub: `docker buildx --push` with the Actions layer cache);
3. pushes them to the registry and rolls the container apps;
4. builds the web app against the Azure backend and uploads it;
5. waits for health (polls every 3 s, gives up after 5 minutes) and checks the running version.

Choose parts with `--api-only`, `--ml-only` and `--web-only` (combinable, for example `--images-only --api-only --web-only`). With none of them everything is deployed. `--skip-api`, `--skip-web`, `--only-infra` and `--images-only` work as before.

Settings:
- `infra/azure.env` (committed): shared defaults: prefix, region.
- `infra/azure.local.env` (not committed): this account's subscription ID and budget email.

### 4.3 Secrets and API keys

- **Location:** secrets live **only** in `infra/secrets.env`. It isn't committed and is readable only by its owner; `infra/secrets.env.example` lists every key and where to get it.
- **Six keys are required for the backend to start:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `SECRET_KEY` and `PEOPLE_HASH_SALT`. The others switch features on, such as road routes on the maps (`MAPBOX_ACCESS_TOKEN`, with `TOMTOM_API_KEY` as the fallback), email (`RESEND_API_KEY`) and Mappls, ULIP, e-way bill and SparkGPS.
- **Filling it from files you already have:** `./infra/import-secrets.sh backend/.env [other.env]` prints key names only, never values.
- **Applying a change:** after editing, run `./infra/set-secrets.sh` (secrets only, quick) or `./infra/deploy.sh` (also rebuilds).
- **`PEOPLE_HASH_SALT` must never change** once documents have been uploaded. It hashes document numbers, and a new salt stops old documents matching new uploads. It was generated on 30 Sep 2026, before any documents existed. If the old Railway backend is still in use when documents are uploaded, set the same value there.
- **Rotating a key:** change it at the provider, update `secrets.env`, then run `./infra/set-secrets.sh`.

### 4.4 Automatic deploys from GitHub

`.github/workflows/deploy-azure.yml` runs on every push to `main` that touches `backend-ts/`, `ml-service/`, `frontend/` or `infra/`. You can also run it by hand from the Actions tab, where you can untick the parts you don't want. It works out what changed since the last successful deploy (or deploys everything when it can't tell, such as on a force push) and runs only the needed jobs, at the same time:

| Changed | Job | What it does |
|---|---|---|
| `backend-ts/**` | `api` | builds and pushes the image, swaps it into `margix-api`, waits for `/health` and the new revision |
| `ml-service/**` | `ml` | the same for `margix-ml` |
| `frontend/**` | `web` | builds the web app and uploads it |
| `infra/**` or the workflow file | all three | |

Each job type has its own concurrency group, so two pushes never race on the same app, and a running deploy is never cancelled. Image builds reuse Docker layers from the GitHub Actions cache (one cache per app; the Dockerfiles install dependencies before copying source), and the web job caches npm packages.

Expected times: web only about 1.5 to 2 minutes (a warm local run measured 76 s; the Static Web Apps upload is about 50 s of that), backend only about 2 to 3 minutes with a warm cache, and the first run after a dependency change or an evicted cache takes longer. Each job runs `./infra/deploy.sh --images-only` with `--api-only`, `--ml-only` or `--web-only`, which also:
- finishes only when the running version uses the new image.

**Secrets never go to GitHub.** They stay in Azure. The GitHub login can only change `margix-rg`, as Contributor. Template changes (`main.bicep`) and secret changes are applied from a signed-in machine with `./infra/deploy.sh` or `./infra/set-secrets.sh`.

**One-time switch-on.** The job is skipped until this step is done. The subscription owner runs:
```bash
./infra/github-oidc.sh
```
It creates a passwordless login for GitHub (a federated credential) and gives it Contributor on `margix-rg`. It then stores `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` and `AZURE_SUBSCRIPTION_ID` as repository **variables** (not secrets) using the `gh` CLI.

The web build needs no map token: `VITE_MAPBOX_TOKEN` is no longer used. Maps get road routes from the API (`POST /api/v1/routing/directions`), which uses `MAPBOX_ACCESS_TOKEN` and falls back to `TOMTOM_API_KEY`.

**Status:** switched on 30 Sep 2026. The GitHub login `margix-github-deploy` has Contributor on `margix-rg` only, and signs in with either GitHub subject format. The first automatic deploy (run 36742994688, commit 89d8d19) succeeded end to end.

### 4.5 Moving margixindia.com to Azure

Follow "Custom domains and DNS" and "Cutover from Railway / Vercel" in `infra/README.md`. In short:
1. Add `margixindia.com` to the Static Web App and `api.margixindia.com` to `margix-api`.
2. Create the DNS records Azure shows you, at the domain provider.
3. Set `CUSTOM_DOMAIN` and `API_DOMAIN` in `infra/azure.env`, then run `./infra/deploy.sh` so the web app is rebuilt against the new API address.
4. Keep Vercel and Railway running for a few days, then turn them off.

### 4.6 Moving to a new Azure account (for example after the trial)

1. Sign in: `az login` (the account owner signs in; nobody else types the password).
2. Create `infra/azure.local.env` from `infra/azure.local.env.example` with the new `SUBSCRIPTION_ID` and `BUDGET_EMAIL`.
3. Bring `infra/secrets.env` over from the old machine, or refill it (§4.3).
4. Deploy: `./infra/deploy.sh`.
5. Point DNS at the new addresses (§4.5).
6. Delete the old account's resources: `az group delete -n margix-rg --subscription <old-id>`.

No data export is needed: all data is in Supabase.

### 4.7 Rolling back

- **Backend:** `az containerapp revision list -g margix-rg -n margix-api -o table`, then activate the previous revision, or check out the previous commit and run `./infra/deploy.sh --skip-web`.
- **Web:** check out the previous commit and run `./infra/deploy.sh --skip-api`.
- **Database:** migrations are forward-only. Write a new migration that reverses the change.

---

## 5. Database changes (Supabase)

Full rules are in `supabase/README.md`. The order matters.

1. **Write** a new file, `supabase/migrations/<timestamp>_<name>.sql`. It must be idempotent (`IF NOT EXISTS`, and `ADD VALUE IF NOT EXISTS` for enums).
2. **Update** `backend-ts/test/support/db-schema.json`, `db-enums.json` and `db-ambiguous-relations.json` to match, then run `npm run check:queries`.
3. **Dry-run** against the live database inside a transaction that is rolled back (`BEGIN; … ROLLBACK;`).
4. **Apply** with `SET lock_timeout='5s';` and stop on the first error. If it times out on a lock, retry; don't force it.
5. **Record** the file as applied in `supabase/README.md`.
6. **Only then** push the code that uses the new columns.

The live database connection string is kept in `~/.routeiq/db_url`. Never print it or copy it anywhere.

---

## 6. Mobile apps

### 6.1 Driver app: over-the-air update

Use this when only screens or text changed and no native module was added.

```bash
cd driver-app && npx tsc --noEmit && npm run check:locales && npm test
npx eas-cli update --channel preview --message "<what changed>"
```

Drivers on runtime `1.1.0` get it the next time they open the app. Every text must exist in all six languages (en, hi, mr, te, kn, bn). Keep terms consistent with `docs/vocabulary-translations.md`.

### 6.2 Driver app: new APK

Use this when a native module or package was added, or the runtime version changes.

```bash
cd driver-app/android && ANDROID_HOME=~/Library/Android/sdk ./gradlew assembleRelease
```

The APK is at `android/app/build/outputs/apk/release/app-release.apk`. Before sharing it, check that it contains no `service_role` key.

**Never ship a new native module over the air.** Installed apps would crash.

### 6.3 Customer app

It has native modules (push notifications, file sharing, image picker), so it needs its own EAS build. Before the first build:
1. Create an Expo project for it and set `EAS_PROJECT_ID`.
2. Add Firebase's `google-services.json` for Android push notifications.
3. Run an EAS development or production build. Push notifications don't work in Expo Go.

---

## 7. Testing before a release

- **Unit and API tests:** the checks in §4.1.
- **Full business flow:** `e2e/README.md`. It runs a 75-step scenario on a **local** copy of the stack (a local Supabase with the live schema and no data, plus a local backend), from booking through problem handling, transfers, delivery, invoices, driver pay, vendor loads, return trips and permissions. It refuses to run against anything that isn't localhost. The last result was 75/75 on 30 Sep 2026.
- **Wording:** `npm run check:vocabulary` blocks old terms such as consignment, backhaul and exception. See `docs/vocabulary.md`.

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `az` or Azure commands fail with `No route to host` | This network's IPv6 route to Azure is broken; IPv4 works | Re-run the command. It's safe, because the scripts are idempotent. |
| Backend tests fail with `EADDRNOTAVAIL` | The Mac ran out of ephemeral ports | Re-run the failing files alone; a fix is in progress |
| Push succeeded but Railway didn't deploy | Railway's GitHub trigger sometimes stops firing | Railway dashboard → Deploy latest commit (only while Railway still serves the domain) |
| Local web app signs in to the **live** Supabase | `frontend/.env.local` sets `VITE_SUPABASE_DIRECT_URL`, which overrides `VITE_SUPABASE_URL` | For local runs, set both to the local Supabase |
| Web maps draw straight lines | The API has neither `MAPBOX_ACCESS_TOKEN` nor `TOMTOM_API_KEY` (the directions endpoint answers 503), or both providers failed | Add a key to `infra/secrets.env`, then `./infra/set-secrets.sh`. No web rebuild is needed; `VITE_MAPBOX_TOKEN` is no longer used |
| Files in the session scratchpad disappeared | The scratchpad is wiped when a session restarts | Keep anything reusable in the repo (`infra/`, `e2e/`) |

---

## 9. Costs

The Azure trial has $200 of credit. Expected spend after it is about **$40–60 a month**:

| Item | Monthly cost |
|---|---|
| backend, 0.5 vCPU / 1 GB, always on | ~$30–40 |
| ML service | a few dollars (scales to zero) |
| container registry | ~$5 |
| logs | a few dollars |
| web app | $0 (free tier) |

Supabase and Expo are billed separately. Budget emails go to `kushagratiwari252@gmail.com`.
