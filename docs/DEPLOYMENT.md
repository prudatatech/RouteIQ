# Deploying MargixIndia

Start here. This page says where each part of MargixIndia runs, how to ship each kind of change, and which detailed guide to follow. When you change how something is deployed, update this page too.

- **Last verified:** 1 Oct 2026 (test and live split).
- **Detailed guides:**
  - [`infra/README.md`](../infra/README.md): the Azure runbook.
  - [`supabase/README.md`](../supabase/README.md): database changes.
  - [`e2e/README.md`](../e2e/README.md): the local end-to-end test.

---

## 1. Two environments: test and live

Every part runs twice. **Test** is where all work lands and is checked; **live** is what users use. They
share nothing: separate databases, servers, keys and schedulers.

| Part | **Test** (branch `test`) | **Live** (branch `main`) |
|---|---|---|
| Web app (`frontend/`) | Azure Static Web App `margix-test-web` (Vercel is being retired, see "Retiring Vercel and Railway" below) | Azure Static Web App `margix-web`: https://gentle-plant-0cd625000.5.azurestaticapps.net |
| Backend, WebSocket, scheduler (`backend-ts/`) | Azure Container App `margix-test-api` (scales 0 to 1; Railway is being retired) | Azure Container App `margix-api`: https://margix-api.graywave-14c2046e.centralindia.azurecontainerapps.io |
| Route optimizer (`ml-service/`) | Azure Container App `margix-test-ml` (internal) | Azure Container App `margix-ml` (internal, scales to zero) |
| Database, sign-in, storage, realtime | Supabase project `plutdajzefwtpgofpqlk` | its own Supabase project (`margix-live`), set up from `supabase/bootstrap/` |
| Driver and customer apps (Expo EAS) | channel `preview` | channel `production` |
| Deploys when | a push to `test` | a push to `main` (only through a pull request from `test`) |
| Database changes applied by | the first job (`migrate`, environment `test`) of `.github/workflows/deploy-azure.yml` | the same job on `main` (environment `production`) |
| Backups | Supabase's own | Supabase's own **plus** a nightly encrypted dump (`backup-live.yml`, 30 days) |

Both stages are one Azure deployment: the same resource group, container registry, log workspace, pull
identity and Container Apps environment, with separate apps (`margix-test-*` and `margix-*`). Deploy a stage
with `./infra/deploy.sh --stage test` (default `live`); see [`infra/README.md`](../infra/README.md).
The test URLs are printed by `./infra/deploy.sh --stage test` (the table shows names, since the addresses
exist only after its first run).

Azure details: subscription `1c904442-…902c` (account `kushagratiwari252@gmail.com`), resource group
`margix-rg` in Central India (the Static Web App record sits in East Asia), budget `margix-budget` ($200,
alerts at $50, $100 and $150).

**Why Supabase for both databases.** The app uses Supabase for sign-in, row-level security (about 62
policies on `auth.uid()`), file storage and realtime, not only Postgres. A Supabase project is plain
Postgres underneath and is not tied to Azure: the live servers can move to AWS, GCP or another Azure
account without touching the data, and a dump restores into any Postgres or self-hosted Supabase (§2.5).

**Why the backend runs as exactly one copy per environment.** The scheduler, rate limits, map tile cache
and login codes live in the server's memory. Don't raise `maxReplicas` until that state moves to Redis.

### Retiring Vercel and Railway

Once the test stage runs on Azure and has been checked (web loads, sign-in works, `/health` of
`margix-test-api` answers, a migration reached the test database), stop the old test hosts. These are your
steps, not automatic:

1. In Vercel, open the project `margixindia` → Settings → Git → Disconnect the repository (or delete the project).
2. In Railway, open the project → Settings → disconnect the GitHub repo from each service, then remove the services.
3. Remove the Vercel pattern from CORS (`extraCorsPatterns` in `infra/main.bicep`) and update anything that still points at the old test URLs (Supabase Auth redirect URLs, the UAT runner, EAS `preview` API address).

The old live-era `margixindia.com` site is a separate matter (§4.5).

---

## 2. How a change reaches users

1. **Work on `test`** (directly, or on a short branch merged into `test` by a pull request). Each push:
   CI runs, and `deploy-azure.yml` migrates the test database and rolls `margix-test-*` on Azure.
2. **Check it on the test servers** (and with the UAT runner, §7).
3. **Release:** open a pull request **`test` → `main`**. CI must pass before it can merge (branch
   protection). Merging deploys live: the live database is migrated first, then the backend, optimizer
   and web app roll out on Azure.
4. **Hotfix:** branch from `main`, pull request into `main`, then merge `main` back into `test` so the two
   don't drift.

Never push straight to `main`; never point a test server at the live database or the other way round.

### 2.1 Database changes in both environments

A schema change is a new file in `supabase/migrations/` (`YYYYMMDDHHMMSS_name.sql`, idempotent where it
can be). `scripts/db-migrate.sh` applies the files a database doesn't have yet, oldest first, each in its
own transaction with a 5 s lock timeout, and records them in `public.app_migrations`. It dry-runs
(`--dry-run`) before applying in both workflows, so a bad file stops the release and changes nothing.

Write migrations so the code before and after both work (add columns before using them, drop only after
the code stops using them): the database is migrated a minute before the new backend starts.

### 2.2 Setting up the live database (once)

1. Create a Supabase project named `margix-live` in region **Mumbai (ap-south-1)**.
2. Run the setup kit against it: `DATABASE_URL='<its connection string>' scripts/db-bootstrap.sh`. It
   loads `supabase/bootstrap/` (extensions, the schema without rows, the sign-up trigger, the storage bucket
   and policy, the realtime tables, the settings defaults) and records every migration as applied. It
   refuses a database that already has tables. The UAT runner builds its database with the same kit, so
   every UAT run proves it still works.
3. In the project's Auth settings set the Site URL to the live web address and add it to the redirect URLs.
4. Invite the first staff member from Auth → Users, then give them the role:
   `update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"superadmin"}' where email = '…';`
5. In live Settings, enter the company profile (name, GSTIN, state), prices and the fuel price: the kit
   carries policy defaults only, not prices.

Refresh the kit when the schema has moved on a lot: dump `public` schema-only from the test database into
`supabase/bootstrap/01_schema.sql` (drop `CREATE SCHEMA public;` and the `supabase_admin` default
privileges, see the file header) and keep `02_platform.sql` in step with realtime tables and buckets.

### 2.3 Settings and secrets per environment

| Where | Test | Live |
|---|---|---|
| Backend keys | `infra/secrets.test.env` → `./infra/set-secrets.sh --stage test` (Azure `margix-test-*`) | `infra/secrets.live.env` → `./infra/set-secrets.sh` (Azure `margix-*`) |
| Web app Supabase address | `frontend/.env.production` (the test stage always builds with it) | GitHub variables `LIVE_SUPABASE_URL`, `LIVE_SUPABASE_PUBLISHABLE_KEY` |
| Database URL for migrations | GitHub environment `test`, secret `DATABASE_URL` | GitHub environment `production`, secret `DATABASE_URL` |
| Backup passphrase | | GitHub environment `production`, secret `BACKUP_PASSPHRASE` |
| Driver and customer apps | EAS environment `preview` | EAS environment `production` |

Both secrets files are gitignored. A stage without its own file falls back to the shared `infra/secrets.env`
with a warning (loud for live, which must not run on test keys); create `secrets.live.env` and `secrets.test.env`
and retire `secrets.env`.

Each environment has its own `SECRET_KEY`, `PEOPLE_HASH_SALT` and Supabase keys. Use separate Redis
databases, and SMS test credentials on test where the provider offers them, so test never messages real
people.

### 2.4 GitHub settings (repository admin)

- **Branch protection on `main`:** require a pull request, require the CI checks `backend-ts`, `frontend`,
  `ml-service`, `mobile-apps (driver-app)` and `mobile-apps (customer-app)`, block force pushes and deletion.
- **Environments** `test` and `production`, with the secrets in §2.3. Optionally add yourself as a required
  reviewer on `production` to approve each live database migration.

### 2.5 Restore a backup, or move clouds

- **Restore:** download the `live-db-backup` artifact from the "Live database backup" run, then
  `gpg -d margix-live-….dump.gpg > live.dump` and
  `pg_restore --no-owner --clean --if-exists -d '<target database URL>' live.dump`. It is a standard
  `pg_dump` custom file: any Postgres 15+ or Supabase project takes it.
- **Move the live servers** (Azure to AWS, GCP or a new Azure account): build the same two container
  images (`backend-ts/Dockerfile`, `ml-service/Dockerfile`) and the static web app, give them the same
  settings (§2.3), point the domain at them, and switch GitHub's live deploy workflow. The database does not
  move. For a new Azure account, `./infra/deploy.sh` does all of it (§4.6).
- **Move the database** (another Supabase project or self-hosted Supabase): run the setup kit on the new
  one, restore the latest dump, update the four Supabase settings in §2.3, redeploy.

---

## 3. Which process do I follow?

| I changed… | Do this |
|---|---|
| Web or backend code | Push to `test`, check, then pull request `test` → `main` (§2) |
| The database schema | A migration file (§2.1); it reaches test on push and live on release |
| Driver app screens or text | §6.1: over-the-air update (`preview` for test, `production` for live) |
| A native module in the driver app | §6.2: new APK |
| The customer app | §6.3: new EAS build |
| A secret or API key | §2.3 |
| Something user-visible that needs a full check | §7 |
| Moving the live servers or the database | §2.5 |

---

## 4. Web and backend

> Since 1 Oct 2026 releases follow §2 (`test` → pull request → `main`). This section covers the live
> Azure side in detail: the deploy script, secrets, the domain, rollbacks and cost.

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

`.github/workflows/deploy-azure.yml` runs on every push to `test` (stage test) or `main` (stage live) that touches `backend-ts/`, `ml-service/`, `frontend/`, `infra/` or `supabase/migrations/`. It compares with the last successful run on the same branch, and its Azure login jobs use no GitHub environment because the federated credentials are bound to the branch refs `main` and `test` (`./infra/github-oidc.sh` registers both). You can also run it by hand from the Actions tab, where you can untick the parts you don't want. It works out what changed since the last successful deploy (or deploys everything when it can't tell, such as on a force push) and runs only the needed jobs, at the same time:

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

### 4.8 Sleeping to save cost (current state since 1 Oct 2026)

While margixindia.com is still served by Railway and Vercel, the Azure backend is set to **sleep when idle**: `margix-api` runs with min 0 and max 1 replicas, and `margix-ml` already did. Nothing is deleted, and Azure charges almost nothing while no one uses it.

What changes while it sleeps:
- **Cold start:** the first request after idle takes about 10–30 s while the container starts.
- **No background work:** the scheduler (SOS reminders, odometer sync, problem deadlines) and live GPS WebSockets only run while it is awake. That's fine for testing, **not for real operations**.
- **Deploys still work:** a push still deploys, and the deploy wakes it briefly for the health check.

Wake it for real use. Do this before pointing margixindia.com at Azure:
```bash
az containerapp update -n margix-api -g margix-rg --min-replicas 1 --max-replicas 1
```
A full `./infra/deploy.sh` (not `--images-only`) also sets it back to 1, because `main.bicep` pins min 1.

Put it back to sleep:
```bash
az containerapp update -n margix-api -g margix-rg --min-replicas 0 --max-replicas 1
```

To stop paying for Azure entirely, delete everything with `az group delete -n margix-rg` (after this there's nothing left to wake). Recreate it later with `./infra/deploy.sh` and `./infra/set-secrets.sh` (§4.6). The container registry (~$5/month) and the logs keep a small charge as long as the resource group exists.

---

## 5. Database changes (Supabase)

> Since 1 Oct 2026 migrations are applied by the workflows in §2.1 (`scripts/db-migrate.sh`), test on
> push and live on release. Applying a file by hand is only for emergencies; record it in
> `public.app_migrations` too, or the next run applies it again.

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
