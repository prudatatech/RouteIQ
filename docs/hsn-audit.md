# HSN search and OTP: production audit

**Date:** 24–25 November 2026
**Environment:** live (`https://portal.margixindia.com`, API `https://api.margixindia.com/api/v1`, Supabase `https://data.margixindia.com`)
**Status:** core fixes deployed and verified live; remaining work is listed at the end.

## Summary

- **HSN search:** on a 59-query production smoke set, the correct code ranked first for **41/59** queries before
  the fix and **55/59** after the API deploy. The last `putty` and `fertilizer` misses were fixed by data
  corrections and cache expiry; they now return `3214` and `3105`, so the effective result is **57/59**. The
  remaining two (`glass`, `steel`) are ambiguous generic words that return a plausible heading, not a different
  product.
- **Root causes:** substring matching without word boundaries, cross-contaminated curated keywords, no bonus for
  an exact whole-query keyword, HSN/GST fields hidden behind a manual-entry toggle, a low per-IP limit, a
  sequential 22k-row index load, no client cache, and a 10-minute public response cache.
- **OTP:** the live API was missing `RESEND_API_KEY` and `EMAIL_FROM`, so every send failed. Both are now set in
  the live secrets, and `POST /auth/vendor/send-otp` returns HTTP 200.
- **Deployed:** API image `margix-api:e799f3c0` (revision `margix-api--0000005`) and web bundle
  `index-Dc-obEzl.js`. The live page serves the new HSN UI and the API returns the corrected rankings.
- **Still open:** GitHub Actions still points at a disabled Azure subscription, three generic terms need a product
  decision, the 10-minute cache delays data fixes, and the curated keyword set needs a repeatable QA check.

## 1. What users saw

1. Typing a goods name (for example `atta`, `biscuit`, `shoes`, `tiles`) often ranked a broad or unrelated heading
   first, so the right code was hard to find.
2. Generic words matched inside other words. `air` matched `hair`, which made shampoo rank for
   `air conditioner`.
3. The HSN code and GST rate fields were only visible after pressing **Enter HSN manually**, so most people never
   saw them and could not correct a wrong suggestion.
4. Fast typing or retrying produced rate-limit failures, and the first search after a restart was slow.
5. The same search could keep returning an old result for up to 10 minutes after the data was corrected.
6. Separately, the vendor OTP screen always showed *"We could not send the code. Try again in a moment."*

## 2. Root causes

### 2.1 Search ranking

- Keyword and description matching used `string.includes()`, so a search term could match inside a longer word
  (`air` in `hair`, `oil` in `boiler`, and so on).
- A term that matched a whole curated keyword did not outrank a partial match. With the same generic keyword on
  two headings, the lower HSN code won.
- The index was built by loading page after page sequentially, so the first search after a cold start paid for the
  whole 22k-row load.
- The public rate limit was 120 requests/minute per IP, which is low for a type-ahead box.

### 2.2 Contaminated keyword data

The seeded keyword arrays overlapped across headings. Examples:

| Everyday word | Wrong code that also had it | Correct code |
| --- | --- | --- |
| `biscuit` | `1901` (food preparations) | `1905` (bread, pastry, biscuits) |
| `chocolate` | `1704` (sugar confectionery) | `1806` (chocolate) |
| `mustard oil` | `1510` (other oils) | `1514` (mustard oil) |
| `shoes` | `6401` (waterproof footwear) | `6403` (footwear) |
| `tiles` | `6810` (cement articles) | `6907` (ceramic tiles) |
| `plastic chair` | `3926` (other plastic articles) | `9401` (seats) |
| `putty` | `3209` (paints and varnishes) | `3214` (glaziers' putty) |

Because the search gave an exact keyword the strongest weight, the wrong lower code always won.

### 2.3 UI and caching

- `HsnSearch.tsx` hid the code and GST fields until the user chose **Enter HSN manually**. The fields are now
  always visible, and the manual toggle was removed.
- HSN search responses are sent with `Cache-Control: public, max-age=600`. A corrected row can therefore take up
  to 10 minutes to appear at the edge even after the database and API are updated. The `putty` fix looked broken
  for exactly this reason.
- The browser had no cache, so every keystroke that reached the API repeated the same request.

### 2.4 OTP

The live container had no Resend credentials. The mail provider call failed before an email was sent, and the
route returned the generic failure message. The Resend domain (`margixindia.com`) was already verified, so only
the secrets were missing.

## 3. Changes made

| Area | File | Change |
| --- | --- | --- |
| Ranking | `backend-ts/src/services/goods/hsn-index.ts` | Added whole-word `hasWords()` matching; added a whole-query keyword bonus; loaded index pages in parallel. |
| Limits | `backend-ts/src/routes/public.routes.ts` | HSN search raised to **600/min** per IP; code lookup to **300/min** (separate buckets). |
| Client cache | `frontend/src/services/api.ts` | Added a bounded 5-minute in-memory cache for `hsnSearch`. |
| UI | `frontend/src/components/load-post/HsnSearch.tsx` | HSN code and GST rate are always visible; removed the **Enter HSN manually** button. |
| Data | `supabase/migrations/20261124090000_hsn_keyword_fixes.sql` | Corrected 18 curated keyword sets (table below). |
| Data | `supabase/migrations/20261125090000_hsn_keyword_cleanup.sql` | Second-pass cleanup of 15 duplicated keyword sets (table below). |
| Tests | `backend-ts/test/goods-search.test.ts`, `backend-ts/test/support/goods-world.ts` | Ranking and fixture coverage for both correction passes. |
| Tests | `frontend/src/components/load-post/loadPost.test.tsx`, `loadPostUx.test.tsx` | Expect the HSN/GST fields to be visible without a toggle. |
| OTP | `backend-ts/src/routes/auth.routes.ts` | Email logo now points at `https://portal.margixindia.com/logo.png`. |
| OTP config | `infra/secrets.live.env` (gitignored) | Added `RESEND_API_KEY` and `EMAIL_FROM`; applied with `./infra/set-secrets.sh --stage live`. |

## 4. Keyword corrections

The migration keeps each everyday word on the heading that actually covers the goods:

| Code | Correct scope | What was corrected |
| --- | --- | --- |
| `1001` | Wheat and meslin | Removed flour/atta terms that belong to `1101`. |
| `1101` | Wheat or meslin flour | Added `atta`, `maida`, `chakki atta`. |
| `1901` | Malt extract / food preparations | Removed biscuit, bread and pasta terms. |
| `1902` | Pasta and noodles | Added `maggi`, `ramen`, `vermicelli`, `instant noodles`. |
| `1905` | Bread, pastry, biscuits | Added biscuit, cookie and brand terms. |
| `1704` | Sugar confectionery | Kept candy/toffee/sweet; removed chocolate. |
| `1806` | Chocolate | Added chocolate, cocoa, Cadbury and bar terms. |
| `0401` | Milk and cream | Kept milk/dairy; removed ghee/butter. |
| `0405` | Butter and ghee | Added ghee, makhan, clarified butter. |
| `1510` | Other oils | Kept sesame/til; removed mustard oil. |
| `1514` | Mustard oil | Added `sarso`, rapeseed and colza. |
| `6401` | Waterproof footwear | Kept gumboots/rain boots; removed general shoes. |
| `6403` | Footwear | Added shoes, sandals, sneakers, slippers, chappal. |
| `6810` | Cement/concrete articles | Kept concrete block/paver; removed tiles. |
| `6907` | Ceramic tiles | Added tile, floor/wall/vitrified tile, Kajaria, Somany. |
| `9401` | Seats and furniture | Added chair, sofa, plastic chair, office chair. |
| `4407` | Sawn wood and timber | Added timber, lumber, teak, hardwood. |
| `3209` | Paints and varnishes | Removed `putty`; it belongs to `3214`. |

The live database was patched through the Supabase REST API and the migration was recorded in `app_migrations`.
A fresh database runs the same SQL from the seed state.

### 4.1 Second-pass duplicate audit (25 Nov 2026)

A live scan of 21,808 curated codes found 974 distinct keywords; 42 appeared on more than one code. Most are
legitimate parent/child pairs (chapter `61` and `6109`, chapter `62` and `6203`) where the specific code already
ranks first. A second migration, `20261125090000_hsn_keyword_cleanup.sql`, moves the remaining cross-category
words to the right heading:

| Word | Wrong code | Correct code |
| --- | --- | --- |
| `groundnut`, `peanut` | `0802` other nuts | `1202` groundnuts |
| `fertilizer`, `dap`, `npk` | `3102` nitrogenous | `3105` NPK |
| `urea` | `3105` NPK | `3102` nitrogenous |
| `pvc pipe` | `3904` polymer | `3917` plastic pipes |
| `plywood`, `laminate`, `block board` | `4410` particle board | `4412` plywood |
| `mdf` | `4410` / `4412` | `4411` fibre board |
| `raw cotton`, `cotton bale`, `ginned cotton` | `5601` wadding | `5201` cotton |
| `bedsheet` | `6301` blankets | `6302` bed linen |
| `copper wire` | `7403` refined copper | `7408` bare / `8544` insulated |
| `cr coil` | `7208` / `7210` | `7209` cold-rolled |
| `tractor` | `8432` farm machinery | `8701` tractors |

The remaining duplicates are ambiguous but valid on both headings: `bottle`, `cream`, `tablet`, `motor`,
`washer`, `plate`, `lamp`, `spice`, `acid`, `napkin`, `cabinet`, `cooking oil` and `steel sheet`. They need a
product decision, not a data move.

The staging API was also rolled to the same fixed image (`margix-test-api` now runs `margix-api:e799f3c0`) so
this pass could be verified on the new ranking code before it was applied to live.

## 5. Verification

### Automated

- Backend `npm run typecheck` passes.
- Backend `npm test` passes: **2542 tests** (first release); the targeted
  `vitest run test/goods-search.test.ts` passes **25 tests** after the second pass.
- Frontend `npm run build` passes.
- Frontend `npx vitest run` passes: **1046 tests**.

### Live API (after deploy)

```bash
curl 'https://api.margixindia.com/api/v1/public/hsn/search?q=atta'
curl 'https://api.margixindia.com/api/v1/public/hsn/search?q=biscuit'
curl 'https://api.margixindia.com/api/v1/public/hsn/search?q=putty&_='"$(date +%s)"
```

Verified first hits:

| Query | First code |
| --- | --- |
| `atta`, `flour` | `1101` |
| `biscuit` | `1905` |
| `noodles`, `pasta` | `1902` |
| `chocolate` | `1806` |
| `mustard oil` | `1514` |
| `ghee` | `0405` |
| `tiles` | `6907` |
| `shoes` | `6403` |
| `air conditioner` | `8415` |
| `steel pipe` | `7304` |
| `plastic chair` | `9401` |
| `timber` | `4407` |
| `putty` | `3214` |
| `pvc pipe` | `3917` |
| `plywood`, `laminate` | `4412` |
| `mdf` | `4411` |
| `raw cotton`, `cotton bale` | `5201` |
| `bedsheet` | `6302` |
| `groundnut`, `peanut` | `1202` |
| `fertilizer`, `dap`, `npk` | `3105` |
| `urea` | `3102` |
| `cr coil` | `7209` |
| `tractor` | `8701` |
| `copper wire` | `8544` (insulated) or `7408` (bare) |

The remaining two known generic misses are `glass` (`7013` instead of `7005`) and `steel` (`7306` instead of
`7214`). Each returns a valid product family; they are not the same kind of failure as the old wrong-product
hits.

### Live web

- `https://portal.margixindia.com` serves bundle `index-Dc-obEzl.js`.
- The bundle uses `https://data.margixindia.com` (live Supabase) and `https://api.margixindia.com` (live API).
- `VendorShipmentRequestPage-CM9Mi60d.js` contains the `HSN code` and `GST rate` labels and no
  `Enter HSN manually` text.

### OTP

A live `POST /auth/vendor/send-otp` for a test phone and email returned HTTP 200 with
`{"status":"otp_sent", ...}`. The test used `+917209683699` / `svm.singh.01@gmail.com`.

## 6. Deployment record

- Commit: `e799f3c0` (`fix(hsn): rank exact goods, keep HSN fields visible, and fix live OTP email`), plus a
  follow-up data-only `3209` edit in the migration file.
- API image built remotely with `az acr build` (Docker Desktop was unresponsive) and pushed as
  `margixacrtw23bcqkuyb4m.azurecr.io/margix-api:e799f3c0`.
- `margix-api` rolled to revision `margix-api--0000005`; `/health` returns HTTP 200.
- Web built with the live Supabase URL/key and `VITE_API_URL=https://api.margixindia.com`, then uploaded to
  `margix-web` with the Static Web Apps CLI. The CLI's `StaticSitesClient` binary is x86_64, so Rosetta 2 was
  installed on the Apple Silicon machine to run it.
- **Manual deploys are currently the source of truth.** GitHub Actions still cannot deploy (see below).

## 7. Remaining gaps and next work

### P0 — fix the deploy pipeline

GitHub Actions fails because the repository's Azure OIDC variables point at the disabled subscription
`1c904442-a955-4519-b623-ab64bc6c902c`. The run on 25 Nov 2026 failed with:

```text
ERROR: (ReadOnlyDisabledSubscription) The subscription '1c904442-a955-4519-b623-ab64bc6c902c' is disabled
and therefore marked as read only. You cannot perform any write actions on this subscription until it is
re-enabled.
```

The live resources are on `f26e3afa-0e86-4953-a563-bf1ed56271ab`. The API and ML jobs also tried to push to
`margixacr7m52h4t5it6og.azurecr.io`, an old registry from the disabled subscription's last deployment, not the
live `margixacrtw23bcqkuyb4m.azurecr.io`. The web job built successfully with the live Supabase variables but
failed when it asked Azure for the Static Web App token. Until this is fixed, every push to `main` produces a
red deploy and production can drift from the repository.

- Re-run `infra/github-oidc.sh` (or update the federated credential and `AZURE_*` repository variables) against
  the active subscription.
- Re-run the infra deploy so the deployment outputs name the live ACR again, then confirm the API/ML jobs stop
  looking at `margixacr7m52h4t5it6og.azurecr.io`.
- Confirm the `web` job can fetch the Static Web App token again.
- Remove the manual-deploy workaround from the release process once green.

### P1 — decide the generic terms

`glass` and `steel` are broad words with several valid headings. Pick the intended behaviour:

- prefer the most specific heading; or
- show a small disambiguation list (`glass: float / safety / glassware`); or
- document the current choice as intentional.

The duplicate audit also leaves `bottle`, `cream`, `tablet`, `motor`, `washer`, `plate`, `lamp`, `spice`, `acid`,
`napkin`, `cabinet`, `cooking oil` and `steel sheet` on two valid headings. Do not add the same generic keyword to
more than one curated heading without a disambiguation plan; that recreates the original tie.

### P1 — make keyword QA repeatable

Only 18 rows were corrected. The seed has other curated rows, and the same failure mode (a generic word on two
codes) can return.

- Add a test/check that each curated keyword maps to exactly one intended code, or at least flags duplicates.
- Audit the remaining curated rows and everyday synonyms (regional words, brand names, plurals).
- Keep `supabase/seed/hsn_master.csv` and the migration in sync.

### P2 — cache and cold start

- HSN search is cached publicly for 10 minutes. Consider lowering `GOODS_CACHE` to 60 seconds, or add a data
  version/ETag so a correction appears immediately.
- The first search after a revision restart still builds the ~22k-row index. Consider a warm-up request after
  deploy, a persisted compact snapshot, or a readiness probe that warms the index.
- Measure p95 first-search and normal-search latency; the current `server-timing` header is a useful start.

### P2 — rate limits and observability

- The new limits are per IP. Users behind one NAT can still collide; consider per-session keys or edge caching.
- Add a counter/alert for HSN 429s, 5xxs, and empty result sets.
- Add a browser E2E test for the load-post HSN flow (fields visible, search, select, GST rate).

### P3 — OTP operations

- Monitor Resend delivery, bounces and complaints; the domain is verified but delivery is still external.
- Keep `RESEND_API_KEY` in the secret store, not in git. Rotate it if it has been shared outside the store.
- The live email logo now uses `https://portal.margixindia.com/logo.png`; confirm it renders in the common mail
  clients.

### P3 — HSN data coverage

- The master has about 21,935 codes. Confirm the live table is complete and every row has a GST rate.
- Some codes have more than one applicable rate; the UI already handles the "choose the rate" case, but it should
  be exercised in the E2E test.

## 8. Operating notes

### Bypass the response cache while testing

```bash
curl --get 'https://api.margixindia.com/api/v1/public/hsn/search' \
  --data-urlencode 'q=putty' \
  --data-urlencode "_=$(date +%s)"
```

The `_` parameter changes the URL, so the edge cache misses and the current API answer is returned.

### Database access from this machine

Direct Postgres connections to `margix-pg-south.postgres.database.azure.com` time out even with a temporary
firewall rule, so data fixes were applied through the Supabase REST API with the service-role key. Prefer one of:

- run migrations from GitHub Actions or Azure Cloud Shell, or
- add a firewall rule for the runner's egress IP and run `scripts/db-migrate.sh`, or
- keep using the REST API for data-only updates and record the migration name in `app_migrations`.

### Manual deploy (until CI is fixed)

```bash
# API image (no local Docker needed)
az acr build --registry margixacrtw23bcqkuyb4m \
  --image margix-api:<tag> --platform linux/amd64 \
  --file backend-ts/Dockerfile backend-ts
az containerapp update -g margix-rg -n margix-api \
  --image margixacrtw23bcqkuyb4m.azurecr.io/margix-api:<tag>

# Web: build with live values, then upload
cd frontend
VITE_API_URL=https://api.margixindia.com \
VITE_SUPABASE_URL=https://data.margixindia.com \
VITE_SUPABASE_DIRECT_URL=https://data.margixindia.com \
VITE_SUPABASE_PUBLISHABLE_KEY="<live anon key>" \
npm run build
SWA_CLI_DEPLOYMENT_TOKEN="$(az staticwebapp secrets list --name margix-web \
  --resource-group margix-rg --query properties.apiKey -o tsv)" \
  npx --yes @azure/static-web-apps-cli@2.0.10 deploy dist --env production
```

On Apple Silicon, the Static Web Apps CLI needs Rosetta 2 for its x86_64 helper:
`softwareupdate --install-rosetta --agree-to-license`.

## 9. Files touched

- `backend-ts/src/services/goods/hsn-index.ts`
- `backend-ts/src/routes/public.routes.ts`
- `backend-ts/src/routes/auth.routes.ts`
- `backend-ts/test/goods-search.test.ts`
- `backend-ts/test/support/goods-world.ts`
- `frontend/src/components/load-post/HsnSearch.tsx`
- `frontend/src/components/load-post/loadPost.test.tsx`
- `frontend/src/components/load-post/loadPostUx.test.tsx`
- `frontend/src/services/api.ts`
- `supabase/migrations/20261124090000_hsn_keyword_fixes.sql`
- `infra/secrets.live.env` (gitignored; live Resend key and `EMAIL_FROM`)
