# UAT plan

User acceptance testing of the whole platform, by role, on the **local stack**, with every finding logged
in [`ISSUES.md`](ISSUES.md) and fixed in rounds until the log has no open blocker or major.

## Why local, and the rules

- Testing writes data: bookings, trips, payments, claims. It runs on the local Supabase and Redis
  (`e2e/`), never on the live project. Test accounts exist only there.
- No real keys, passwords or phone numbers. The seeded accounts use `@example.test` addresses.
- No mock data in app code to make a test pass. When a screen is empty because no data exists, create
  the data through the app or the API.

## Cost

The testing is done by **Sonnet** agents, one per area, which read the code, drive the API and the web
app, and write their findings. Opus only plans, triages, reviews the fixes and merges. Agents run in
small batches (at most 5 at once). Each agent's prompt is self-contained, so it does not reread the whole
repo.

## Setup (once per session)

```bash
docker start $(docker ps -aq --filter name=margix-e2e)   # local Supabase + Redis
bash e2e/setup-local.sh                                   # writes e2e/.env.local
bash e2e/start-backend.sh                                 # API on :8011 (leave running)
bash e2e/start-web.sh                                     # web on :5174 (leave running)
node e2e/run.mjs --reset                                  # seed + the 75-step story; must be 75/75
```

The tools for testing:

| Tool | Use |
| --- | --- |
| `node e2e/uat.mjs <who> <METHOD> <path> [json]` | call the API as `superadmin`, `manager`, `driverA`, `driverB`, `vendor`, `customer`, `customer2` or `anon` |
| `node e2e/uat.mjs sql "<query>"` | read or change the local database |
| `node e2e/ui.mjs <who> <path> … [--width 390] [--steps s.json]` | open web pages as a role: saves screenshots to `e2e/shots/`, prints the page text, console errors and failed requests; `--steps` clicks and fills |
| http://localhost:5174 | the web app; sign in with an account from `e2e/accounts.json` (password `E2e-Local-Pass-1`) |
| `npm test`, `npx tsc --noEmit` in each app | unit tests and types |

Agents never run `--reset` while other agents are testing; they add their own records, named with
their area prefix (for example `UAT-CUST …`), so areas don't disturb each other.

## Areas

| ID | Area | Covers |
| --- | --- | --- |
| CUST | Customer | Web customer pages and the customer app: sign-up, quote, booking (single and multi-drop), tracking page and public link, notices and revised ETAs, delivery code, receipt and rating, claims, invoices and payment, notifications, account |
| OPS | Staff operations | Requests → accept with price → Today → assign and send → trips and stops → live map and routes → problems, SOS and emergencies → cargo cases, transfers, hubs, lots, returns → the route planner and optimiser |
| DRV | Driver | Driver app and driver API: sign-in, vehicle gate and approval, accept a trip, pickup with count and condition, geofence, stops, delivery outcomes (full, remarks, partial, refused, not delivered), delivery code, SOS, handover for transfers, fuel log, return trips, pay, notifications, offline queue, 6 languages |
| VND | Vendor and 3PL | Vendor onboarding, documents, loads, shipment requests, invoices and payment details, claims, corridors, return-trip bids; 3PL onboarding, credentials, partner dashboard |
| FLT | Fleet, money, admin | Fleet list and vehicle page (the 17 items), approvals, maintenance and service log, fuel, odometer, sharing; Money: invoices, payments, driver pay; admin users and roles; analytics and insights; permissions for every role |

Each area tests these, in order:

1. **Happy path.** Every screen and action the role needs, start to finish, with real data.
2. **Real-world cases.** Wrong input, empty states, duplicates, double clicks, going back,
   cancellations, partial quantities, two people acting at once, a slow or absent network (driver),
   a large list, long names, Hindi text.
3. **Permissions.** What another role, or another customer or vendor, can see and do (it must be refused).
4. **Consistency.** The same fact shown the same way everywhere: status words follow
   `docs/vocabulary.md`, totals match between screens, the web and the apps agree.
5. **Incomplete.** Buttons that do nothing, placeholders, "coming soon", dead links, TODOs in a flow
   the role uses. These are roadmap items to build, not to delete.

## Severity

| Level | Meaning |
| --- | --- |
| **Blocker** | A role cannot finish its job, data is lost or wrong, money is wrong, or another account's data is exposed |
| **Major** | The job is possible only with a workaround, or a screen shows wrong or misleading information |
| **Minor** | Works, but confusing, inconsistent or rough |
| **Gap** | A feature the flow needs that is missing or a placeholder (roadmap) |

## Rounds

1. **Test.** The five area agents test and write `docs/uat/findings/<AREA>.md`. They change no app code.
2. **Triage.** Findings are merged into `ISSUES.md` with IDs, duplicates removed, and severities checked
   against the code.
3. **Fix.** Blockers first, then majors. Fix agents work on separate parts of the code (backend, web,
   driver app, customer app) so their changes don't collide. Each fix comes with a test where one
   fits.
4. **Verify.** `tsc`, the unit tests, `check:vocabulary`, the web build and `node e2e/run.mjs --reset`
   (it must stay 75/75). Then the area agent re-tests the issues it raised, and each is marked
   `verified` or reopened.
5. **Ship.** Migrations follow the usual path (dry-run, apply, record in `supabase/README.md`); the push
   to `ui/redesign` and `main` deploys Vercel, Railway and Azure.

Repeat until no blocker or major is open. Minors and gaps stay in the log as the backlog.

## Done when

- `ISSUES.md` has no open blocker or major.
- Every area has a finished pass with its date in the table in `ISSUES.md`.
- The 75-step story passes, and every fix has its test or a stated reason it has none.
