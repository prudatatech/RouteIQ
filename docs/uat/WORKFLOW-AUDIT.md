# Workflow audit on the hosted test stage

Goal: every workflow the platform offers works the way the business intends, on **Azure** (not only on the GitHub
runner's throw-away stack). Today's rehearsal of vendor → load → quote → vehicle → delivery → invoice → payment found
bugs that CI could never see (missing grants, an object store that rejected every upload, a stale cache, a NOT NULL
column). This audit walks the rest, area by area.

## Ground rules

- **Target: the TEST stage only** — `https://staging-api.margixindia.com/api/v1`, data `https://staging-data.margixindia.com`,
  web `https://staging.margixindia.com`. **Never** touch live (`portal/api/data.margixindia.com`).
- **Secrets**: `infra/platform.test.env` (gitignored) holds the stage's keys. `e2e/staging/actors.mjs` reads it and never
  prints it. Do not echo, log, commit or paste any key, token or password into a file or report.
- **Actors**: use `e2e/staging/actors.mjs` (`makeVendor`, `makeCompany`, `makeCompanyAdmin`, `makePlatformAdmin`, `makeDriver`,
  `api`, `db`, `putSigned`, `readObject`, `check`). Write your walk as a small `node` ES-module script under
  `e2e/staging/<area>.mjs` using it; scripts must be re-runnable (fresh accounts each run) and print PASS/FAIL per step.
  Accounts are `@margix.test` throw-aways. Give your own area its own company (`makeCompany`) so you do not change another
  area's company-wide settings; the default company is shared by every audit running at the same time.
- **Real behaviour, not shape**: for each step check the *outcome the business needs* — the right state in the database
  (read it back with `db`), the right amount (paise/rupees), the right person notified, the right access (another company
  or another vendor gets 404/403, never data), idempotent repeats, and that anything the screens show is actually served.
- **Azure pitfalls found so far** — treat any 5xx or "permission denied" as a bug: tables created by the admin login lack
  grants for the API's `service_role`; `jsonb` `.contains` needs JSON text; `vendor_profiles.latitude` was NOT NULL; the
  API remembers a person's organisations for 60 s (changes must call `invalidateOrgContext`); signed upload links are
  valid 15 minutes; membership/role changes made by seeding take a minute to be seen unless the user is new.
- **The Mac must stay idle**: only light node/curl scripts. No docker, no dev servers, no builds, no full test suites.
  Fixes are verified with `nice -n 19 npx tsc --noEmit` and targeted `nice -n 19 npx vitest run <files>` (backend-ts), and
  for the web `npx tsc --noEmit -p .` plus targeted vitest/eslint in `frontend`. Symlink `node_modules` from
  `/Users/deepstacker/WorkSpace/dupcq/RouteIQ/.claude/worktrees/integration/{backend-ts,frontend}/node_modules` if missing
  (never commit it).
- **Fixing**: when you find a bug, find the root cause in the code, fix it with a regression test (mocked-supabase vitest,
  like `backend-ts/test/routing-api.test.ts` / `support/org-world.ts`), run `npm run -s check:queries` (backend-ts) and
  `node scripts/check-vocabulary.mjs` (repo root). A bug that needs a database change gets a new idempotent migration
  `supabase/migrations/<14-digit-timestamp>_<name>.sql` (use `20261010<area-number>0000`+ so numbers never collide; follow the
  `app_owner` pattern in `20261004010000_order_routing.sql`; update `backend-ts/test/support/db-schema.json`). Do not
  deploy anything; infrastructure fixes are made in `infra/` and described, never applied.
- **Commits** end exactly with `Co-Authored-By: Deepstacker <dev.deepstacker@gmail.com>` (never a Claude co-author).
- **Reporting**: write `docs/uat/findings/<AREA>.md`: a table of every step (step · expected · result · PASS/FAIL), then the
  issues found (severity, root cause, fix, status). Commit it with your fixes and push your branch.
- **Vocabulary**: user-visible text never says route (except a road path on a map), consignment, exception, manifest,
  vendor request, shipment request (see `docs/vocabulary.md`).

## Areas

| # | Area | Branch | Findings |
|---|---|---|---|
| 1 | Fleet and people | `uat/fleet` | `FLEET.md` |
| 2 | Trips and the driver | `uat/trips` | `TRIPS.md` |
| 3 | Cargo problems, custody and shipments | `uat/cargo` | `CARGO.md` |
| 4 | Money (invoices, driver pay, expenses, reports) | `uat/money` | `MONEY.md` |
| 5 | 3PL lifecycle | `uat/tpl` | `TPL.md` |
| 6 | Platform and tenancy | `uat/tenancy` | `TENANCY.md` |
| 7 | Vendor extras and the public pages | `uat/vendor` | `VENDOR.md` |
| 8 | Azure parity (every endpoint and table as every role) | `uat/parity` | `PARITY.md` |
