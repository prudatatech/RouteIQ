# Area 6: platform and tenancy (the SaaS core)

Walked on the TEST stage (`staging-api.margixindia.com`) with `e2e/staging/tenancy.mjs` (sections in
`tenancy-isolation.mjs`, `tenancy-settings.mjs`, `tenancy-console.mjs`). Fresh accounts and companies every run;
nothing real was touched. Branch `uat/tenancy`.

**How to read the results.** The walk runs against what is deployed on the test stage today. The fixes below are made
in code and covered by new tests (`backend-ts/test/p6-*`), but nothing was deployed (ground rules), so the live
re-run still shows the old behaviour for the items marked "fixed in code, not deployed". Those rows are left as FAIL
on purpose: they are the evidence, and the same script turns them green once the branch and migration
`20261010060000_tenancy_rls_gaps.sql` are deployed.

## Summary

| | |
|---|---|
| Steps walked | 461 (registration 36, members 42, isolation 342 including 86 list endpoints x 7 actors, 120 by-id calls and 74 database tables, settings 20, console 21) |
| What works | registration and the approve / reject / suspend / re-approve cycle (audited, owner told, a pending, rejected or suspended company is shut out at once with 403); members (invite by email or phone, role changes take effect immediately, removal and restore, last owner protected, X-Org-Id switching, a foreign X-Org-Id is 403); 120 by-id reads and writes of another company's rows answer exactly like an id nobody has (404); lists of vehicles, trips, shipments, people, money, depots, cases, claims, transfers, driver pay, settings, search, audit are scoped; settings are per company; live updates (WebSocket) are scoped; staff notifications stay in the company |
| Leaks and wrong answers found | **4 high** (cargo board, driver theft, case injected into another company, direct database reads), **3 medium**, 2 low; 3 product decisions left open |
| Fixed in code | all except the 3 decisions; one database migration |
| Needs deploy | API (branch `uat/tenancy`) and migration `20261010060000_tenancy_rls_gaps.sql` |

## Issues

| # | Severity | What was wrong | Root cause | Fix | Status |
|---|---|---|---|---|---|
| 1 | **High** | The cargo board listed every company's shipments (`GET /cargo/shipments`, `/cargo/open-loads`) and open alarms with plates (`/cargo/security-alerts`). A company could also pool another company's loads onto its vehicle (`POST /cargo/optimize-pooling`), mark another company's shipment delivered (`POST /cargo/verify-pod`, answered 409 "never picked up" instead of 404, so it reached the delivery step) and resolve another company's alarm (`POST /cargo/resolve-alert/:id`) | `cargo.routes.ts` was the one staff router with no organisation scoping at all (0 uses of `scopeQuery` or a guard) | `scopeQuery(OWNED.carrier)` on the three lists and the reference depot, `assertVehicleVisible`, `assertShipmentVisible` and `guardOwned` on the actions | Fixed in code (`p6-cargo-board-scoping.test.ts`); not deployed |
| 2 | **High** | Company B could put company A's **driver** on its own vehicle, by the driver's phone number (`POST /vehicles`, `PATCH /vehicles/:id` with `driver_phone`) or by id (`driver_id`), and rename them through the vehicle. B's vehicle then carried A's driver id, which also lets A's driver read B's vehicle. A driver created from a vehicle form joined the default company instead of the company that added them | `resolveDriverUser` looked a driver up by phone across all companies; `driver_id` was accepted unchecked | Only an active member of the acting company can be linked (409 for a number held by another company's driver, 404 for an id); a new driver joins the company that added them (same helper `people.service` uses) | Fixed in code (`p6-vehicle-driver-company.test.ts`); not deployed |
| 3 | **High** | `POST /cargo/exceptions` with another company's `vehicle_id` **wrote a case into that company's data** (stamped to the vehicle's owner, created by the foreign admin) and then answered 404 because the read-back was scoped. The 404 hid the write | `createManualException` never checked the vehicle | 404 before anything is written for a vehicle the company does not run, and for an id that is not a uuid | Fixed in code (`p6-cargo-board-scoping.test.ts`); not deployed |
| 4 | **High** | Direct database reads (the web reads some tables itself with the signed-in staff token): any company's admin could read **every company's** people (`users`: names, phones, emails), messages, fuel logs, service logs, odometer history, trip stops, delivery points, custody events, case items, telemetry and more | Row-level security was tightened to the organisation only on tables that carry an owner column. Tables that hang off a vehicle, trip, shipment or person kept the old "any staff reads everything" policy | Migration `20261010060000_tenancy_rls_gaps.sql`: `users_select` and `messages_select` limited to the caller's organisations; a RESTRICTIVE `tenant_scope` policy on 31 child tables (staff only see rows whose vehicle, trip, shipment or person they can already see) and on depots and alarms | Migration written, **not applied** |
| 5 | Medium | The second company to set a driver-pay rate for the same vehicle type and start date got a 500 | One live rate per type and date was a platform-wide unique index | Unique per company (migration section 3) | Fixed in migration; not applied |
| 6 | Medium | People checks crossed companies: an employee code another company used was a clash and the 409 **named that company's person** (id, name, role); a phone number held by another company's person was refused with their name and id, and a number of someone who left more than 90 days ago was **taken off the other company's record**; a base depot or reporting manager of another company was accepted | Lookups ran over all people; the employee code was unique platform-wide in the database | Clash checks run inside the company; another company's holder is "already registered to another account" with no name or id and is never released; depot and manager must belong to the company; the unique constraint becomes an index (migration section 4) | Fixed in code (`p6-people-company-scope.test.ts`) and migration; not deployed |
| 7 | Medium | `GET /routes/delivery-points` answered 500 for every company-scoped caller | The embedded `shipments(...)` is ambiguous (two foreign keys) | Named the key (`shipments!delivery_points_shipment_id_fkey`) | Fixed in code; not deployed |
| 8 | Low | A malformed id in `/fleet/alerts/:id/...`, `/fleet/fuel-logs/:id` (put, delete, bill-url), `/fleet/vehicles/:id/...`, `/cargo/resolve-alert/:id` answered 500 | The guards sent the text to the database as a uuid | `guardOwned`, `guardOfVehicle`, `guardVehicle` and the fuel loader answer 404 for an id that cannot exist | Fixed in code; not deployed |
| 9 | Low | `GET /fleet/fuel-logs/:id/bill-url` told a driver of another vehicle (or another company) 403 for an existing entry and 404 for a missing one | The access check ran after the lookup | Anyone without access gets the 404 of a missing entry (`fuel-logs.test.ts` expectation updated) | Fixed in code; not deployed |
| D1 | **Decision** | **Vendor KYC and the 3PL partner approval are open to every company admin.** An admin of any company can read every vendor's profile and KYC data directly (`vendor_profiles`, 42+ rows with PAN, GSTIN and bank details), **reject another vendor's KYC** (`PUT /vendor/kyc/:id/reject` answered 200 for an unrelated vendor) and list the 3PL approval queue (`GET /tpl/queue` 200) | KYC review was built before organisations and sits in the company menu ("People > KYC review"); the platform model says approvals belong to the platform | **Not changed.** The audit script `makeVendor` (shared by every area) and the web menu rely on a company admin approving KYC. Recommended: KYC and 3PL approval become platform-only (acting as the platform), the web page moves into the Platform section, `vendor_profiles` and `tpl_partners` reads are limited to the platform and to companies the vendor works with, and `makeVendor` approves through `makePlatformAdmin` | Open, needs a product decision (effort: about a day with web changes) |
| D2 | Decision | Platform powers follow the membership, not the organisation being acted for: a person who is a platform owner and also a company admin, acting as the company, still passes `/admin/orgs` and sees every load | `isPlatformAdmin` is true if any membership is platform control (a deliberate, tested choice: "works whichever organisation the admin is acting as") | Not changed. Lists, by-id calls and the live feed are scoped by the organisation acted for (checked, 3.4, 5.10); only the console and load visibility are wider | Open, by design |
| D3 | Decision | The member invite adds any registered account at once (no acceptance) and returns their name, email and phone; "no account with that email" tells whether an account exists. The `invited` status exists in the table and is never used | Invite is "add an existing user" | Not changed. Recommended: invite pending until the person accepts, and answer neutrally | Open |
| N1 | Note | The `finance`, `dispatcher`, `ops` and `member` organisation roles all become the same app role (`manager`): a `finance` member gets 403 on invoices, expenses and driver pay, so the role does nothing different from `ops` (see 2.8 access map) | `appRoleFor` has no finance or dispatcher app role | Not changed (a new app role is a product decision) | Open |
| N2 | Note | Membership changes clear the cache of the API instance that handled them; another instance keeps its 60 s copy. On a single replica removal is immediate (2.22) | In-process cache | Not changed; with more than one replica, removal can take up to 60 s | Note |
| N3 | Note | Every vendor sees every open spare-space window of every company (type, free kilos, floor price, no plate or driver). The 3PL auto-offer switch is platform-wide and only the platform can change it | Marketplace and platform settings by design | None | By design |
| N4 | Note | Walked at the same time as other audits, the stage returned 500 / 503 and was unreachable for about two minutes once. Not caused by this walk | | | Note |

## 1. Company registration and decisions

| Step | Expected | Result | |
|---|---|---|---|
| 1.1 | register logistic_company -> 201 pending | as expected | PASS |
| 1.2 | cannot register kind platform | as expected | PASS |
| 1.3 | cannot self-set status active on register (strict schema) | as expected | PASS |
| 1.4 | /orgs/mine shows the pending company, owner role, app_role not staff | as expected | PASS |
| 1.5 | pending owner can read its own organisation (waiting screen) | as expected | PASS |
| 1.6 | pending company: operational endpoints answer 403 (no data) | as expected | PASS |
| 1.7 | pending company cannot create a vehicle | as expected | PASS |
| 1.8 | owner cannot approve itself (platform admins only) | as expected | PASS |
| 1.9 | owner cannot PATCH status | as expected | PASS |
| 1.10 | platform lists pending logistic companies incl. the new one | as expected | PASS |
| 1.11 | filter only returns the asked status/kind | as expected | PASS |
| 1.12 | reject without a reason -> 422 | as expected | PASS |
| 1.13 | reject with reason -> rejected | as expected | PASS |
| 1.14 | owner notified of the rejection with the reason | as expected | PASS |
| 1.15 | rejection audited (actor, org, reason) | as expected | PASS |
| 1.16 | a rejected company cannot be approved straight away (409) | as expected | PASS |
| 1.17 | rejected company: operational endpoint 403 with a clear message | as expected | PASS |
| 1.18 | rejected company can still read /org (to show the reason) | as expected | PASS |
| 1.19 | approve -> active, approved_by and approved_at set | as expected | PASS |
| 1.20 | approving an active company again -> 409 | as expected | PASS |
| 1.21 | owner notified of the approval | as expected | PASS |
| 1.22 | approved company: effective app role admin | as expected | PASS |
| 1.23 | approved company operates (GET /vehicles 200, empty) | as expected | PASS |
| 1.24 | suspend -> suspended with reason | as expected | PASS |
| 1.25 | suspended company: every operational endpoint 403 immediately | as expected | PASS |
| 1.26 | suspended company cannot write | as expected | PASS |
| 1.27 | owner notified of the suspension | as expected | PASS |
| 1.28 | re-approve a suspended company -> active | as expected | PASS |
| 1.29 | re-approved company works again at once | as expected | PASS |
| 1.30 | the platform organisation cannot be suspended | as expected | PASS |
| 1.31 | created/approve/suspend all audited for the company | as expected | PASS |
| 1.32 | approving an unknown organisation -> 404 | as expected | PASS |
| 1.33 | a company admin cannot suspend (own or other) organisation | as expected | PASS |
| 1.34 | a company admin cannot list organisations | as expected | PASS |
| 1.35 | a user may register a further company (201) and it starts pending | as expected | PASS |
| 1.37 | anonymous cannot register (401) | as expected | PASS |

## 2. Members, roles, switching

Access of each organisation role (status per call, `X-Org-Id` of the company):

| Org role | App role | `/vehicles` | `/finance/invoices` | `/org/members` | `/users` | `/driver-pay/entries` | `/dashboard/kpis` |
|---|---|---|---|---|---|---|---|
| owner / admin | admin | 200 | 200 | 200 | 200 | 200 | 200 |
| ops | manager | 200 | 403 | 403 | 403 | 403 | 200 |
| finance | manager | 200 | 403 | 403 | 403 | 403 | 200 |
| dispatcher | manager | 200 | 403 | 403 | 403 | 403 | 200 |
| member | manager | 200 | 403 | 403 | 403 | 403 | 200 |
| driver | driver | 200 (own vehicle) | 403 | 403 | 403 | 403 | 200 |

| Step | Expected | Result | |
|---|---|---|---|
| 2.2 | invite admin by email -> 201 active | as expected | PASS |
| 2.2 | invite ops by email -> 201 active | as expected | PASS |
| 2.2 | invite finance by email -> 201 active | as expected | PASS |
| 2.2 | invite dispatcher by email -> 201 active | as expected | PASS |
| 2.2 | invite driver by email -> 201 active | as expected | PASS |
| 2.1 | invite by an unknown phone -> 422 | as expected | PASS |
| 2.1b | invite member by email -> 201 active | as expected | PASS |
| 2.3 | invite by phone finds the user | as expected | PASS |
| 2.4 | inviting an existing active member -> 409 | as expected | PASS |
| 2.5 | email and phone together -> 422 | as expected | PASS |
| 2.6 | role superadmin is not an organisation role -> 422 | as expected | PASS |
| 2.7 | org role -> app role (appRoleFor): admin=admin, ops/finance/dispatcher/member=manager, driver=driver | as expected | PASS |
| 2.8 | only owner/admin can read /org/members | as expected | PASS |
| 2.9 | every staff role reads /vehicles; a driver role is not given staff finance | as expected | PASS |
| 2.10 | /users (all users) is not open to non-admin org roles | as expected | PASS |
| 2.11 | change role ops -> finance | as expected | PASS |
| 2.12 | member list shows the new role and names | as expected | PASS |
| 2.13 | an admin cannot remove an owner (403) | as expected | PASS |
| 2.14 | an admin cannot promote to owner (403) | as expected | PASS |
| 2.15 | an admin cannot invite an owner (403) | as expected | PASS |
| 2.16 | the last owner cannot remove themselves (409) | as expected | PASS |
| 2.17 | the last owner cannot demote themselves (409) | as expected | PASS |
| 2.18 | an owner can promote another owner | as expected | PASS |
| 2.19 | a member of another company cannot be touched (404) | as expected | PASS |
| 2.20 | member list contains only this company's people | as expected | PASS |
| 2.21 | remove a member | as expected | PASS |
| 2.22 | removed member loses access at once (invalidated cache): X-Org-Id of the company -> 403 | as expected | PASS |
| 2.23 | removed member with no header: no company data (403, not 200) | as expected | PASS |
| 2.24 | removed member is not in the list | as expected | PASS |
| 2.25 | restore by inviting again (status active, new role) | as expected | PASS |
| 2.26 | restored member works again at once | as expected | PASS |
| 2.27 | restore by PATCH status active | as expected | PASS |
| 2.28 | role change takes effect at once (admin demoted to ops loses /org/members) | as expected | PASS |
| 2.29 | a user in two companies lists both | as expected | PASS |
| 2.30 | X-Org-Id switches the active organisation | as expected | PASS |
| 2.31 | an X-Org-Id of a company the user is not in -> 403 | as expected | PASS |
| 2.32 | an X-Org-Id of the platform org without membership -> 403 | as expected | PASS |
| 2.33 | malformed X-Org-Id -> 400 | as expected | PASS |
| 2.34 | two companies, no header -> still resolves to one company (200) | as expected | PASS |
| 2.35 | a vehicle created acting as A is in A, not B | as expected | PASS |
| 2.36 | platform /org/members shows the platform's own members only | as expected | PASS |
| 2.37 | member changes audited | as expected | PASS |

## 3. The isolation matrix

Actors: **A** and **B** are admins of two logistic companies, each with 2 vehicles, a driver, a manager, a trip,
a shipment, an invoice, an expense, driver pay, a depot, a case, an SOS alert, a claim, a transfer, a maintenance
job, a fuel entry, a spare-space window, an alarm, a notification, a document, a message, service and odometer
history, custody event, stops and delivery points, plus a vendor load awarded to them (**VA** and **VB** are the two
vendors); **P** is the platform admin acting as the platform; **DA** and **DB** are the companies' drivers. Every
row of company A carries a marker text and id; a cell reads `LEAK` when the answer to B (or a vendor or driver of B)
contains any of A's markers or ids, and the other way round. `own` means the answer contained the caller's rows,
`empty` that it held none of either company's, `both` (platform) that it held both.

### 3.1 Every list and read the web app uses, by actor

| Endpoint (GET) | company A | company B | platform (as platform) | vendor of A | vendor of B | driver of A | driver of B |
|---|---|---|---|---|---|---|---|
| `/vehicles` | 200 own | 200 own | 200 both | 403 | 403 | 200 | 200 |
| `/vehicles/summary` | 200 empty | 200 empty | 200 none | 403 | 403 | 403 | 403 |
| `/vehicles/sos-counts` | 200 own | 200 own | 200 both | 403 | 403 | 403 | 403 |
| `/vehicles/requests` | 200 empty | 200 empty | 200 none | 403 | 403 | 403 | 403 |
| `/vehicles/requests/count` | 200 empty | 200 empty | 200 none | 403 | 403 | 403 | 403 |
| `/fleet/analytics` | 200 empty | 200 empty | 200 none | 403 | 403 | 403 | 403 |
| `/fleet/health` | 200 own | 200 own | 200 both | 403 | 403 | 403 | 403 |
| `/fleet/service-due` | 200 empty | 200 empty | 200 none | 403 | 403 | 403 | 403 |
| `/fleet/alerts` | 200 own | 200 own | 200 both | 403 | 403 | 403 | 403 |
| `/fleet/alerts/summary` | 200 empty | 200 empty | 200 none | 403 | 403 | 403 | 403 |
| `/fleet/alert-settings` | 200 empty | 200 empty | 200 none | 403 | 403 | 403 | 403 |
| `/fleet/maintenance/jobs` | 200 own | 200 own | 200 both | 403 | 403 | 403 | 403 |
| `/fleet/fuel-summary` | 200 own | 200 own | 200 both | 403 | 403 | 403 | 403 |
| `/fleet/fuel-anomalies` | 200 empty | 200 empty | 200 none | 403 | 403 | 403 | 403 |
| `/fleet/vehicles/{vehicle}/fuel-logs` | 200 own | 200 own | 200 A-only | 403 | 403 | 403 | 403 |
| `/fleet/vehicles/{vehicle}/service-log` | 200 own | 200 own | 200 A-only | 403 | 403 | 403 | 403 |
| `/fleet/vehicles/{vehicle}/service-plans` | 200 empty | 200 empty | 200 none | 403 | 403 | 403 | 403 |
| `/shipments` | 200 own | 200 own | 200 both | 403 | 403 | 403 | 403 |
| `/routes` | 200 own | 200 own | 200 both | 403 | 403 | 200 | 200 |
| `/routes/delivery-points` | 200 own | 200 own | 200 both | 403 | 403 | 403 | 403 |
| `/dashboard/kpis` | 200 empty | 200 empty | 200 none | 403 | 403 | 200 | 200 |
| `/dashboard/people-attention` | 200 own | 200 own | 200 none | 403 | 403 | 403 | 403 |
| `/dashboard/shipment-counts` | 200 empty | 200 empty | 200 none | 403 | 403 | 403 | 403 |
| `/ops/today` | 200 empty | 200 empty | 200 none | 403 | 403 | 403 | 403 |
| `/analytics/insights` | 200 empty | 200 empty | 200 none | 403 | 403 | 403 | 403 |
| `/analytics/demand` | 200 empty | 200 empty | 200 none | 403 | 403 | 403 | 403 |
| `/analytics/metrics` | 200 empty | 200 empty | 200 none | 403 | 403 | 403 | 403 |
| `/analytics/fleet-overview` | 200 empty | 200 empty | 200 none | 403 | 403 | 403 | 403 |
| `/analytics/daily-activity` | 200 empty | 200 empty | 200 none | 403 | 403 | 403 | 403 |
| `/analytics/active-missions` | 200 own | 200 own | 200 both | 403 | 403 | 403 | 403 |
| `/analytics/audit-logs` | 200 own | 200 own | 200 both | 403 | 403 | 403 | 403 |
| `/analytics/driver-performance` | 200 own | 200 own | 200 both | 403 | 403 | 403 | 403 |
| `/analytics/vendor-performance` | 200 empty | 200 empty | 200 none | 403 | 403 | 403 | 403 |
| `/search?q={M}` | 200 own | 200 own | 200 A-only | 403 | 403 | 403 | 403 |
| `/search?q=SH` | 200 own | 200 own | 200 both | 403 | 403 | 403 | 403 |
| `/search?q=Depot` | 200 empty | 200 empty | 200 none | 403 | 403 | 403 | 403 |
| `/finance/summary` | 200 own | 200 own | 200 both | 403 | 403 | 403 | 403 |
| `/finance/unpriced` | 200 empty | 200 empty | 200 none | 403 | 403 | 403 | 403 |
| `/finance/invoices` | 200 own | 200 own | 200 both | 403 | 403 | 403 | 403 |
| `/finance/invoices/summary` | 200 empty | 200 empty | 200 none | 403 | 403 | 403 | 403 |
| `/finance/invoice-reports` | 200 empty | 200 empty | 200 none | 403 | 403 | 403 | 403 |
| `/finance/company` | 200 empty | 200 empty | 200 none | 403 | 403 | 403 | 403 |
| `/finance/expenses` | 200 own | 200 own | 200 both | 403 | 403 | 403 | 403 |
| `/finance/settings` | 200 empty | 200 empty | 200 none | 403 | 403 | 403 | 403 |
| `/driver-pay/rates` | 200 own | 200 own | 200 both | 403 | 403 | 403 | 403 |
| `/driver-pay/entries` | 200 own | 200 own | 200 both | 403 | 403 | 403 | 403 |
| `/driver-pay/payouts` | 200 empty | 200 empty | 200 none | 403 | 403 | 403 | 403 |
| `/people` | 200 own | 200 own | 200 both | 403 | 403 | 403 | 403 |
| `/people/settings` | 200 empty | 200 empty | 200 none | 403 | 403 | 403 | 403 |
| `/people/duplicates` | 200 empty | 200 empty | 200 none | 403 | 403 | 403 | 403 |
| `/people/export.csv` | 200 own | 200 own | 200 both | 403 | 403 | 403 | 403 |
| `/people/documents/expiring.csv` | 200 empty | 200 empty | 200 none | 403 | 403 | 403 | 403 |
| `/depots` | 200 own | 200 own | 200 both | 403 | 403 | 200 | 200 |
| `/cargo/shipments` | 200 LEAK own | 200 LEAK own | 200 both | 403 | 403 | 403 | 403 |
| `/cargo/open-loads` | 200 empty | 200 empty | 200 none | 403 | 403 | 403 | 403 |
| `/cargo/security-alerts` | 200 LEAK own | 200 LEAK own | 200 both | 403 | 403 | 403 | 403 |
| `/cargo/exceptions` | 200 own | 200 own | 200 both | 403 | 403 | 403 | 403 |
| `/cargo/transfers` | 200 own | 200 own | 200 both | 403 | 403 | 200 | 200 |
| `/cargo/hubs` | 200 own | 200 own | 200 both | 403 | 403 | 403 | 403 |
| `/cargo/claims` | 200 own | 200 own | 200 both | 200 | 200 | 403 | 403 |
| `/notifications` | 200 own | 200 own | 200 none | 200 | 200 | 200 | 200 |
| `/messages` | 400 | 400 | 400 | 403 | 403 | 400 | 400 |
| `/messages/unread` | 200 empty | 200 empty | 200 none | 403 | 403 | 200 | 200 |
| `/capacity/windows` | 200 own | 200 own | 200 both | 403 | 403 | 403 | 403 |
| `/capacity/windows/open` | 200 own | 200 own | 200 both | 200 LEAK | 200 LEAK | 403 | 403 |
| `/capacity/bids/mine` | 200 empty | 200 empty | 200 none | 200 | 200 | 403 | 403 |
| `/capacity/bids/pending` | 200 empty | 200 empty | 200 none | 403 | 403 | 403 | 403 |
| `/capacity/nearby-vendors` | 400 | 400 | 400 | 403 | 403 | 403 | 403 |
| `/users` | 200 own | 200 own | 200 both | 403 | 403 | 403 | 403 |
| `/users/me` | 200 own | 200 own | 200 none | 200 | 200 | 200 | 200 |
| `/company/loads/market` | 200 empty | 200 empty | 403 | 403 | 403 | 403 | 403 |
| `/marketplace/open-loads` | 200 empty | 200 empty | 200 none | 403 | 403 | 200 | 200 |
| `/routing/open-loads` | 200 own | 200 own | 200 both | 403 | 403 | 403 | 403 |
| `/pricing/settings` | 200 empty | 200 empty | 200 none | 403 | 403 | 403 | 403 |
| `/tpl-network/settings` | 200 empty | 200 empty | 200 none | 403 | 403 | 403 | 403 |
| `/tpl-network/orders` | 200 empty | 200 empty | 200 none | 403 | 403 | 403 | 403 |
| `/tpl-network/partners/stats` | 200 empty | 200 empty | 200 none | 403 | 403 | 403 | 403 |
| `/tpl-network/escalations` | 400 | 400 | 400 | 403 | 403 | 403 | 403 |
| `/org` | 200 empty | 200 empty | 200 none | 200 | 200 | 403 | 403 |
| `/org/members` | 200 own | 200 own | 200 none | 200 | 200 | 403 | 403 |
| `/orgs/mine` | 200 empty | 200 empty | 200 none | 200 | 200 | 200 | 200 |
| `/bookings` | 200 empty | 200 empty | 200 none | 403 | 403 | 403 | 403 |
| `/traffic/incidents` | 200 empty | 200 empty | 200 none | 403 | 403 | 403 | 403 |
| `/vendor/loads` | 403 | 403 | 200 none | 200 | 200 | 403 | 403 |
| `/vendor/requests` | 404 | 404 | 404 | 404 | 404 | 404 | 404 |
| `/vendor/profile` | 200 own | 200 own | 200 none | 200 | 200 | 200 | 200 |

`/cargo/shipments`, `/cargo/security-alerts` show the leak of issue 1 (deployed behaviour); `/capacity/windows/open`
shows another company's open windows to a vendor, which is the marketplace by design (N3);
`/vendor/loads` for a vendor shows its own plate on its own load (own data).

### 3.2 By-id reads and writes of A's rows by others

Each call is made with A's real id as company B, vendor B and driver B, and with an id nobody has as company B (the
control). The business rule: B's answer must equal the control (404, or the same 400 where the body is checked before
the row is looked up) and never a 2xx, a 403 that proves the row exists, or a 5xx.

| Call on company A's row | as company B | same call on an id nobody has | as vendor B | as driver B |
|---|---|---|---|---|
| `GET /vehicles/{vehicle}` | 404 | 404 | 403 | 403 |
| `GET /vehicles/{vehicle}/sos` | 404 | 404 | 403 | 403 |
| `GET /vehicles/{vehicle}/photos` | 404 | 404 | 403 | 403 |
| `PATCH /vehicles/{vehicle}` | 404 | 404 | 403 | 403 |
| `POST /vehicles/{vehicle}/status` | 404 | 404 | 403 | 403 |
| `DELETE /vehicles/{vehicle}` | 404 | 404 | 403 | 403 |
| `POST /vehicles/{vehicle}/approve` | 404 | 404 | 403 | 403 |
| `POST /vehicles/{vehicle}/reject` | 400 | 400 | 403 | 403 |
| `POST /vehicles/{vehicle}/sos` | 404 | 404 | 403 | 403 |
| `GET /fleet/vehicles/{vehicle}/health` | 404 | 404 | 403 | 403 |
| `GET /fleet/vehicles/{vehicle}/location` | 404 | 404 | 403 | 403 |
| `GET /fleet/vehicles/{vehicle}/activity` | 404 | 404 | 403 | 403 |
| `GET /fleet/vehicles/{vehicle}/share-links` | 404 | 404 | 403 | 403 |
| `POST /fleet/vehicles/{vehicle}/share-links` | 404 | 404 | 403 | 403 |
| `GET /fleet/vehicles/{vehicle}/service-plans` | 404 | 404 | 403 | 403 |
| `GET /fleet/vehicles/{vehicle}/service-log` | 404 | 404 | 403 | 403 |
| `GET /fleet/vehicles/{vehicle}/fuel-logs` | 404 | 404 | 403 | 403 |
| `GET /fleet/vehicles/{vehicle}/fuel-stats` | 404 | 404 | 403 | 403 |
| `PUT /fleet/vehicles/{vehicle}/odometer` | 404 | 404 | 403 | 403 |
| `GET /fleet/vehicles/{vehicle}/maintenance/preview` | 404 | 404 | 403 | 403 |
| `POST /fleet/vehicles/{vehicle}/maintenance` | 404 | 404 | 403 | 403 |
| `PUT /fleet/fuel-logs/{fuel}` | 404 | 404 | 403 | 403 |
| `DELETE /fleet/fuel-logs/{fuel}` | 404 | 404 | 403 | 403 |
| `GET /fleet/fuel-logs/{fuel}/bill-url` | 404 | 404 | 403 | 403 |
| `PATCH /fleet/maintenance/jobs/{job}` | 404 | 404 | 403 | 403 |
| `POST /fleet/maintenance/jobs/{job}/close` | 404 | 404 | 403 | 403 |
| `POST /fleet/alerts/{alert}/acknowledge` | 404 | 404 | 403 | 403 |
| `POST /fleet/alerts/{alert}/resolve` | 404 | 404 | 403 | 403 |
| `GET /cargo/vehicles/{vehicle}/on-board` | 404 | 404 | 403 | 403 |
| `GET /telemetry/{vehicle}/history` | 404 | 404 | 403 | 403 |
| `GET /telemetry/{vehicle}/live` | 404 | 404 | 403 | 403 |
| `GET /gps/vehicle/{vehicle}` | 404 | 404 | 403 | 403 |
| `GET /gps/vehicle/{vehicle}/track` | 404 | 404 | 403 | 403 |
| `GET /shipments/{shipment}` | 404 | 404 | 403 | 403 |
| `GET /shipments/{shipment}/overview` | 404 | 404 | 403 | 403 |
| `GET /shipments/{shipment}/history` | 404 | 404 | 403 | 403 |
| `GET /shipments/{shipment}/proof` | 404 | 404 | 403 | 403 |
| `GET /shipments/{shipment}/verify` | 404 | 404 | 403 | 403 |
| `GET /shipments/{shipment}/assign-options` | 404 | 404 | 403 | 403 |
| `PATCH /shipments/{shipment}` | 404 | 404 | 403 | 403 |
| `PATCH /shipments/{shipment}/edit` | 404 | 404 | 403 | 403 |
| `PUT /shipments/{shipment}/metadata` | 404 | 404 | 403 | 403 |
| `POST /shipments/{shipment}/rating` | 404 | 404 | 403 | 403 |
| `POST /shipments/{shipment}/assign` | 404 | 404 | 403 | 403 |
| `DELETE /shipments/{shipment}` | 404 | 404 | 403 | 403 |
| `GET /routes/{route}` | 404 | 404 | 403 | 403 |
| `PATCH /routes/{route}` | 404 | 404 | 403 | 403 |
| `PATCH /routes/{route}/status` | 404 | 404 | 403 | 403 |
| `POST /routes/{route}/reroute` | 400 | 400 | 403 | 403 |
| `DELETE /routes/{route}` | 404 | 404 | 403 | 403 |
| `GET /weather/route/{route}` | 404 | 404 | 403 | 403 |
| `GET /invoices/{invoice}` | 404 | 404 | 403 | 403 |
| `GET /invoices/{invoice}/pdf` | 404 | 404 | 404 | 403 |
| `PUT /finance/invoices/{invoice}/pay` | 404 | 404 | 403 | 403 |
| `PUT /finance/invoices/{invoice}/void` | 404 | 404 | 403 | 403 |
| `PUT /finance/expenses/{expense}` | 404 | 404 | 403 | 403 |
| `DELETE /finance/expenses/{expense}` | 404 | 404 | 403 | 403 |
| `GET /finance/expenses/{expense}/receipt-url` | 404 | 404 | 403 | 403 |
| `PATCH /driver-pay/rates/{rate}` | 404 | 404 | 403 | 403 |
| `DELETE /driver-pay/rates/{rate}` | 404 | 404 | 403 | 403 |
| `POST /driver-pay/entries/{pay}/adjust` | 400 | 400 | 403 | 403 |
| `POST /driver-pay/entries/{pay}/void` | 400 | 400 | 403 | 403 |
| `GET /people/{driver}` | 404 | 404 | 403 | 403 |
| `PATCH /people/{driver}` | 404 | 404 | 403 | 403 |
| `POST /people/{driver}/status` | 404 | 404 | 403 | 403 |
| `POST /people/{driver}/invite` | 404 | 404 | 403 | 403 |
| `GET /people/{driver}/documents` | 404 | 404 | 403 | 403 |
| `GET /people/{driver}/emergency-contacts` | 404 | 404 | 403 | 403 |
| `GET /people/{driver}/bank-accounts` | 404 | 404 | 403 | 403 |
| `GET /people/{driver}/notes` | 404 | 404 | 403 | 403 |
| `POST /people/{driver}/notes` | 404 | 404 | 403 | 403 |
| `GET /people/{driver}/documents/{document}/file` | 404 | 404 | 403 | 403 |
| `PATCH /people/{driver}/documents/{document}` | 404 | 404 | 403 | 403 |
| `DELETE /people/{driver}/documents/{document}` | 404 | 404 | 403 | 403 |
| `PATCH /users/{driver}` | 404 | 404 | 403 | 403 |
| `GET /cargo/exceptions/{problem}` | 404 | 404 | 403 | 403 |
| `POST /cargo/exceptions/{problem}/actions` | 400 | 400 | 403 | 403 |
| `GET /cargo/exceptions/{problem}/relief-vehicles` | 404 | 404 | 403 | 403 |
| `GET /cargo/transfers/{transfer}` | 404 | 404 | 403 | 404 |
| `POST /cargo/transfers/{transfer}/cancel` | 404 | 404 | 403 | 403 |
| `POST /cargo/transfers/{transfer}/handover-out` | 400 | 400 | 403 | 400 |
| `POST /cargo/transfers/{transfer}/eway` | 400 | 400 | 403 | 403 |
| `GET /cargo/claims/{claim}` | 404 | 404 | 404 | 403 |
| `PATCH /cargo/claims/{claim}` | 404 | 404 | 403 | 403 |
| `GET /cargo/lots/{shipment}` | 404 | 404 | 404 | 403 |
| `GET /cargo/where/{shipment}` | 404 | 404 | 404 | 403 |
| `GET /cargo/timeline/{shipment}` | 404 | 404 | 404 | 403 |
| `GET /cargo/hubs/{depot}/inventory` | 404 | 404 | 403 | 403 |
| `POST /cargo/resolve-alert/{sos}` | 404 | 404 | 403 | 403 |
| `POST /capacity/windows/{window}/close` | 404 | 404 | 403 | 403 |
| `GET /capacity/windows/{window}/bid-count` | 404 | 404 | 200 | 403 |
| `GET /company/loads/{request}` | 404 | 404 | 403 | 403 |
| `POST /company/loads/{request}/quotes` | 400 | 400 | 403 | 403 |
| `POST /company/loads/{request}/accept` | 404 | 404 | 403 | 403 |
| `GET /loads/{manifest}/documents` | 404 | 404 | 404 | 403 |
| `GET /loads/{manifest}/timeline` | 404 | 404 | 404 | 403 |
| `GET /loads/{manifest}/settlement` | 404 | 404 | 404 | 403 |
| `GET /loads/{manifest}/dispatch-check` | 404 | 404 | 404 | 403 |
| `POST /notifications/{note}/read` | 404 | 404 | 404 | 404 |
| `PUT /telemetry/sos/{sos}/acknowledge` | 404 | 404 | 403 | 403 |
| `PUT /telemetry/sos/{sos}/resolve` | 404 | 404 | 403 | 403 |
| `POST /telemetry/sos/{sos}/cancel` | 404 | 404 | 403 | 404 |
| `POST /telemetry` | 404 | 404 | 403 | 403 |
| `POST /telemetry/call-driver/{vehicle}` | 404 | 404 | 403 | 403 |
| `POST /telemetry/mobile-session` | 404 | 404 | 403 | 403 |
| `POST /telemetry/stoppages` | 404 | 404 | 403 | 403 |
| `POST /fleet/vehicles/{vehicle}/service-log` | 404 | 404 | 403 | 403 |
| `GET /org/tpl-affiliations/{vehicle}` | 404 | 404 | 403 | 403 |
| `PUT /vendor/shipment-request/{request}/approve` | 404 | 404 | 403 | 403 |
| `PUT /vendor/shipment-request/{request}/reject` | 404 | 404 | 403 | 403 |
| `PUT /vendor/shipment-request/{request}/cancel` | 403 | 403 | 404 | 403 |
| `PUT /vendor/shipment-request/{request}/assign-vehicle` | 404 | 404 | 403 | 403 |
| `GET /vendor/loads/{request}` | 404 | 404 | 404 | 403 |
| `GET /vendor/loads/{request}/quotes` | 403 | 403 | 404 | 403 |
| `POST /optimize/incubate/{vehicle}` | 404 | 404 | 403 | 403 |
| `POST /optimize/reoptimize/{route}` | 404 | 404 | 403 | 403 |
| `POST /cargo/verify-pod` | 409 | 404 | 403 | 403 |
| `POST /cargo/optimize-pooling` | 409 | 404 | 403 | 403 |
| `POST /bookings/{request}/assign` | 404 | 404 | 403 | 403 |
| `POST /bookings/{request}/cancel` | 400 | 400 | 403 | 403 |

Failing rows: `POST /cargo/verify-pod` and `POST /cargo/optimize-pooling` (issue 1, deployed behaviour: B reached the
delivery step on A's goods, 409 instead of 404) and `GET /capacity/windows/:id/bid-count` for a vendor (the
marketplace window, by design). Other by-id calls are 404 for B.

### 3.3 Writes that name another company's row in the body

| B names A's row in the body | answer (A's id) | answer with B's own ids (control) |
|---|---|---|
| `POST /finance/expenses` | 400 | 201 |
| `POST /capacity/windows` | 404 | 400 |
| `POST /cargo/exceptions` | 404 | 201 |
| `POST /cargo/transfers` | 400 | 400 |
| `POST /cargo/claims` | 400 | 400 |
| `POST /messages` | 404 | 201 |
| `POST /driver-pay/payouts` | 404 | 409 |
| `POST /driver-pay/entries/approve` | 200 | 200 |
| `POST /finance/invoices` | 404 | 409 |
| `POST /finance/unpriced/price` | 404 | 409 |
| `POST /cargo/lots/split` | 400 | 400 |
| `POST /cargo/custody` | 404 | 201 |
| `POST /vehicles` | 201 | 201 |
| `PATCH OWN:/vehicles/{vehicle}` | 409 | 409 |
| `POST /optimize` | 400 | 400 |
| `POST /shipments` | 400 | 400 |

`POST /vehicles` with A's driver phone is issue 2; step 3.2d (below) found the case written by `POST /cargo/exceptions`
(issue 3), which answered 404 after writing.

### 3.4 Lists filtered by another company's id or text

| B lists with A's id or text as the filter | answer |
|---|---|
| `/fleet/alerts?status=all&vehicle_id={vehicle}` | 200 |
| `/driver-pay/entries?driver_id={driver}` | 200 |
| `/driver-pay/payouts?driver_id={driver}` | 200 |
| `/analytics/driver-performance?driver_id={driver}` | 200 |
| `/analytics/vendor-performance?vendor_id={driver}` | 200 |
| `/messages?route_id={route}` | 404 |
| `/messages?shipment_id={shipment}` | 404 |
| `/cargo/claims?ref={shipment}` | 200 |
| `/cargo/exceptions?vehicle_id={vehicle}` | 200 |
| `/people?search={M}` | 200 |
| `/people?q={M}` | 200 |
| `/search?q={M}` | 200 |
| `/search?q={plate}` | 200 |
| `/shipments?search={M}` | 200 |
| `/finance/invoices?search={M}` | 200 |
| `/finance/expenses?vehicle_id={vehicle}` | 200 |
| `/vehicles?search={plate}` | 200 |
| `/routes?vehicle_id={vehicle}` | 200 |
| `/fleet/maintenance/jobs?vehicle_id={vehicle}` | 200 |
| `/fleet/fuel-anomalies?vehicle_id={vehicle}` | 200 |
| `/cargo/transfers?vehicle_id={vehicle}` | 200 |

### 3.5 Direct database reads with a staff token (PostgREST + row-level security)

| Table (PostgREST, staff JWT) | rows A sees | rows B sees | verdict |
|---|---|---|---|
| `vendor_profiles` | 105 | 105 | ok |
| `notifications` | 5 | 4 | ok |
| `vehicles` | 2 | 4 (sees the other company) | LEAK (migration 20261010060000) |
| `tpl_partners` | 16 | 16 | ok |
| `kyc_documents` | 404 | 404 | ok |
| `users` | 770 (sees the other company) | 770 (sees the other company) | LEAK (migration 20261010060000) |
| `sos_alerts` | 2 | 1 | ok |
| `cargo_manifest` | 1 | 1 | ok |
| `vendor_shipment_requests` | 30 | 30 | ok |
| `shipments` | 1 | 1 | ok |
| `routes` | 1 | 1 | ok |
| `route_stops` | 63 (sees the other company) | 63 (sees the other company) | LEAK (migration 20261010060000) |
| `driver_confirmations` | 0 | 0 | ok |
| `capacity_windows` | 1 | 1 | ok |
| `capacity_bids` | 0 | 0 | ok |
| `invoices` | 1 | 1 | ok |
| `expenses` | 1 | 2 | ok |
| `driver_pay_entries` | 1 | 1 | ok |
| `driver_pay_rates` | 1 | 1 | ok |
| `driver_payouts` | 0 | 0 | ok |
| `depots` | 0 | 0 | ok |
| `cargo_exceptions` | 3 (sees the other company) | 3 | LEAK (migration 20261010060000) |
| `cargo_exception_items` | 36 (sees the other company) | 36 | LEAK (migration 20261010060000) |
| `cargo_claims` | 1 | 1 | ok |
| `cargo_transfers` | 1 | 1 | ok |
| `cargo_transfer_items` | 3 | 3 | ok |
| `cargo_custody_events` | 166 (sees the other company) | 166 (sees the other company) | LEAK (migration 20261010060000) |
| `maintenance_alerts` | 0 | 0 | ok |
| `vehicle_maintenance_jobs` | 1 | 1 | ok |
| `vehicle_fuel_logs` | 21 (sees the other company) | 21 (sees the other company) | LEAK (migration 20261010060000) |
| `vehicle_service_log` | 13 (sees the other company) | 13 (sees the other company) | LEAK (migration 20261010060000) |
| `vehicle_service_plans` | 43 | 43 | ok |
| `vehicle_share_links` | 0 | 0 | ok |
| `user_documents` | 0 | 0 | ok |
| `user_bank_accounts` | 403 | 403 | ok |
| `user_notes` | 403 | 403 | ok |
| `user_emergency_contacts` | 0 | 0 | ok |
| `user_profiles` | 0 | 0 | ok |
| `messages` | 26 (sees the other company) | 26 (sees the other company) | LEAK (migration 20261010060000) |
| `load_documents` | 0 | 0 | ok |
| `load_document_events` | 0 | 0 | ok |
| `payments` | 0 | 0 | ok |
| `organizations` | 1 | 1 | ok |
| `org_members` | 4 | 3 | ok |
| `tpl_affiliations` | 0 | 0 | ok |
| `tpl_documents` | 6 | 6 | ok |
| `tpl_offers` | 0 | 0 | ok |
| `tpl_orders` | 0 | 0 | ok |
| `tpl_partner_statements` | 0 | 0 | ok |
| `customers` | 0 | 0 | ok |
| `customer_bookings` | 0 | 0 | ok |
| `kyc_profiles` | 0 | 0 | ok |
| `gps_points` | 0 | 0 | ok |
| `telemetry` | 1000 | 1000 | ok |
| `ai_agent_logs` | 0 | 0 | ok |
| `system_settings` | 26 | 26 | ok |
| `driver_vehicle_assignments` | 403 | 403 | ok |
| `parcels` | 0 | 0 | ok |
| `parcel_scans` | 24 | 24 | ok |
| `shipment_logs` | 0 | 0 | ok |
| `shipment_hsn` | 0 | 0 | ok |
| `trip_settlements` | 0 | 0 | ok |
| `price_quotes` | 9 | 9 | ok |
| `load_quotes` | 0 | 0 | ok |
| `load_items` | 28 | 28 | ok |
| `invoice_payment_reports` | 0 | 0 | ok |
| `idempotency_keys` | 0 | 0 | ok |
| `traffic_incidents` | 0 | 0 | ok |
| `vehicle_photos` | 0 | 0 | ok |
| `vehicle_stoppages` | 0 | 0 | ok |
| `vehicle_odometer_events` | 23 (sees the other company) | 23 (sees the other company) | LEAK (migration 20261010060000) |
| `vendor_route_opportunities` | 0 | 0 | ok |
| `delivery_points` | 87 (sees the other company) | 87 (sees the other company) | LEAK (migration 20261010060000) |
| `tpl_corridors` | 12 | 12 | ok |

Every table the web reads itself (`vendor_profiles`, `notifications`, `vehicles`, `tpl_partners`, `users`,
`sos_alerts`, `cargo_manifest`, `vendor_shipment_requests`, `shipments`, `routes`, `route_stops`,
`driver_confirmations`, `capacity_windows`, `capacity_bids`) was read as company A and company B. Tables with an owner
column were already isolated; `users`, `route_stops` and the child tables leaked (issue 4); `vendor_profiles` and
`tpl_partners` show every company everything (decision D1). Writes: B's token cannot patch A's vehicle, delete A's
depot, insert a depot owned by A, rename A's person, make itself superadmin through `users.role`, add itself to the
platform organisation or change its own organisation's status or name (3.9 to 3.15, all PASS).

### 3.6 Single steps (seeds, platform, superadmin, live updates, notifications)

| Step | Expected | Result | |
|---|---|---|---|
| 3.s.A.vehicle | created via API and stamped | as expected | PASS |
| 3.s.A.expense | created via API | as expected | PASS |
| 3.s.B.vehicle | created via API and stamped | as expected | PASS |
| 3.s.B.expense | created via API | as expected | PASS |
| 3.2d | nothing B's admin created (even through a refused call) points at, or is owned by, company A | rows: cargo_exceptions:1fe8d4e2-62c0-4440-918f-69fd6693f995 | FAIL |
| 3.2e | company A's driver is on no vehicle of company B | [{"id":"ad01b9bc-d314-4b4b-af72-fce617ddb88b","carrier_org_id":"6272be25-14f7-458e-bf5e-c74d1e716c75"}] | FAIL |
| 3.20 | a case/SOS raised in A (case 201, SOS 201) notifies A's admin and manager | as expected | PASS |
| 3.21 | ... and notifies nobody in company B (admin, manager, driver) | as expected | PASS |
| 3.3 | after the foreign calls, A's vehicle, shipment, invoice, expense and person are untouched | as expected | PASS |
| 3.4 | a user whose account role is superadmin but who acts inside company A is that company's admin only (no B rows, no platform routes) | as expected | PASS |
| 3.5 | the platform admin acting as the platform sees vehicles of both companies | as expected | PASS |
| 3.6 | platform reads a company vehicle by id (support) | as expected | PASS |
| 3.7 | the platform admin cannot act as a company they are not a member of (X-Org-Id of A -> 403) | as expected | PASS |
| 3.9 | PostgREST: B's staff JWT cannot PATCH A's vehicle | as expected | PASS |
| 3.10 | PostgREST: B's staff JWT cannot DELETE A's depot | as expected | PASS |
| 3.11 | PostgREST: B cannot insert a depot owned by A | as expected | PASS |
| 3.12 | PostgREST: B cannot rename A's person | as expected | PASS |
| 3.13 | PostgREST: a company admin cannot make themselves superadmin through users.role | as expected | PASS |
| 3.14 | PostgREST: a company admin cannot add themselves to the platform organisation | as expected | PASS |
| 3.15 | PostgREST: a company admin cannot edit its own organisation row (status/name) directly | as expected | PASS |
| 3.16 | websocket: a staff member can open the feed for their own company; a foreign ?org= is refused | as expected | PASS |
| 3.17 | websocket: A's location ping (status 201) reaches A's connection | as expected | PASS |
| 3.18 | websocket: ... and does NOT reach B's connection | as expected | PASS |
| 3.19 | websocket: ... and reaches the platform admin's feed (acting as platform) | as expected | PASS |

Foreign-reference and filter steps (one line each; the tables above carry the detail):

| Step | Expected | Result | |
|---|---|---|---|
| 3.2c | filter as B naming A's value: GET /fleet/alerts?status=all&vehicle_id={vehicle} -> 200 | as expected | PASS |
| 3.2c | filter as B naming A's value: GET /driver-pay/entries?driver_id={driver} -> 200 | as expected | PASS |
| 3.2c | filter as B naming A's value: GET /driver-pay/payouts?driver_id={driver} -> 200 | as expected | PASS |
| 3.2c | filter as B naming A's value: GET /analytics/driver-performance?driver_id={driver} -> 200 | as expected | PASS |
| 3.2c | filter as B naming A's value: GET /analytics/vendor-performance?vendor_id={driver} -> 200 | as expected | PASS |
| 3.2c | filter as B naming A's value: GET /messages?route_id={route} -> 404 | as expected | PASS |
| 3.2c | filter as B naming A's value: GET /messages?shipment_id={shipment} -> 404 | as expected | PASS |
| 3.2c | filter as B naming A's value: GET /cargo/claims?ref={shipment} -> 200 | as expected | PASS |
| 3.2c | filter as B naming A's value: GET /cargo/exceptions?vehicle_id={vehicle} -> 200 | as expected | PASS |
| 3.2c | filter as B naming A's value: GET /people?search={M} -> 200 | as expected | PASS |
| 3.2c | filter as B naming A's value: GET /people?q={M} -> 200 | as expected | PASS |
| 3.2c | filter as B naming A's value: GET /search?q={M} -> 200 | as expected | PASS |
| 3.2c | filter as B naming A's value: GET /search?q={plate} -> 200 | as expected | PASS |
| 3.2c | filter as B naming A's value: GET /shipments?search={M} -> 200 | as expected | PASS |
| 3.2c | filter as B naming A's value: GET /finance/invoices?search={M} -> 200 | as expected | PASS |
| 3.2c | filter as B naming A's value: GET /finance/expenses?vehicle_id={vehicle} -> 200 | as expected | PASS |
| 3.2c | filter as B naming A's value: GET /vehicles?search={plate} -> 200 | as expected | PASS |
| 3.2c | filter as B naming A's value: GET /routes?vehicle_id={vehicle} -> 200 | as expected | PASS |
| 3.2c | filter as B naming A's value: GET /fleet/maintenance/jobs?vehicle_id={vehicle} -> 200 | as expected | PASS |
| 3.2c | filter as B naming A's value: GET /fleet/fuel-anomalies?vehicle_id={vehicle} -> 200 | as expected | PASS |
| 3.2c | filter as B naming A's value: GET /cargo/transfers?vehicle_id={vehicle} -> 200 | as expected | PASS |
| 3.2b | foreign reference POST /finance/expenses | as expected | PASS |
| 3.2b | foreign reference POST /capacity/windows | as expected | PASS |
| 3.2b | foreign reference POST /cargo/exceptions | as expected | PASS |
| 3.2b | foreign reference POST /cargo/transfers | as expected | PASS |
| 3.2b | foreign reference POST /cargo/claims | as expected | PASS |
| 3.2b | foreign reference POST /messages | as expected | PASS |
| 3.2b | foreign reference POST /driver-pay/payouts | as expected | PASS |
| 3.2b | foreign reference POST /driver-pay/entries/approve | as expected | PASS |
| 3.2b | foreign reference POST /finance/invoices | as expected | PASS |
| 3.2b | foreign reference POST /finance/unpriced/price | as expected | PASS |
| 3.2b | foreign reference POST /cargo/lots/split | as expected | PASS |
| 3.2b | foreign reference POST /cargo/custody | as expected | PASS |
| 3.2b | foreign reference POST /vehicles | foreign:201 control:201  201 {"id":"ad01b9bc-d314-4b4b-af72-fce617ddb88b","plate_number":"MH20871738","vehicle_type":"truck","capacity_kg":1000,"fuel_type":"diesel","fuel | FAIL |
| 3.2b | foreign reference PATCH OWN:/vehicles/{vehicle} | as expected | PASS |
| 3.2b | foreign reference POST /optimize | as expected | PASS |
| 3.2b | foreign reference POST /shipments | as expected | PASS |

## 4. Settings are per company

| Step | Expected | Result | |
|---|---|---|---|
| 4.1 | fuel price: A=111.11, B=99.5, each reads its own | as expected | PASS |
| 4.2 | fuel price: the platform default is untouched by either company | as expected | PASS |
| 4.3 | a manager cannot change finance settings | as expected | PASS |
| 4.4 | alert threshold overspeed_kmph: A=21, B=23, each reads its own | as expected | PASS |
| 4.5 | alert threshold: the platform default is unchanged | as expected | PASS |
| 4.6 | a manager cannot change alert thresholds | as expected | PASS |
| 4.7 | company profile saves for A and B | as expected | PASS |
| 4.8 | prefix, GTA option, payment terms, bank are each company's own | as expected | PASS |
| 4.9 | the same invoice prefix cannot be taken by two companies (409/400/422, never 500) | as expected | PASS |
| 4.10 | B's prefix survives the refused change | as expected | PASS |
| 4.11 | a manager cannot change the company profile | as expected | PASS |
| 4.12 | stored in each company's own organisation row | as expected | PASS |
| 4.13 | document grace days / enforcement are per company | as expected | PASS |
| 4.14 | pricing rate_per_km: A's change is not in B | as expected | PASS |
| 4.15 | dispatcher phone is per company | as expected | PASS |
| 4.16 | two companies can set a driver-pay rate for the same type and day (201 both) | A 201 {"rate":{"id":"17962e5a-a2be-481b-b1be-f9e0898bdb8d","vehicle_type":"van","per_trip_amount":100,"per B 500 {"detail":"Internal server error","request_id":"4ee2fa51- | FAIL |
| 4.17 | each company sees only its own rate card | [[{"id":"17962e5a-a2be-481b-b1be-f9e0898bdb8d","vehicle_type":"van","per_trip_amount":100,"per_km_amount":2,"effective_from":"2027-08-27","active":true,"created_by":"7b30 | FAIL |
| 4.18 | renaming A does not change B | as expected | PASS |
| 4.19 | a platform change of the default does not overwrite a company's own value | as expected | PASS |
| 4.20 | the platform-wide 3PL auto-offer switch is not a company admin's to flip (403) | as expected | PASS |

Step 4.16 / 4.17 are issue 5: the second company's rate answers 500 until the migration is applied. Everything else
(fuel price, alert thresholds, invoice prefix with uniqueness, GTA option, payment terms, bank, licence grace days
and enforcement, pricing, dispatcher phone, organisation name) is stored per company in the company's own row
(`organizations.profile`, alert thresholds as `<key>@<company>`), and a platform change of a default does not
overwrite a company's own value.

## 5. Platform-admin console

| Step | Expected | Result | |
|---|---|---|---|
| 5.1 | platform lists organisations with total and paging | as expected | PASS |
| 5.2 | filter kind=platform returns the platform organisation only | as expected | PASS |
| 5.3 | filter status=active + kind=logistic_company | as expected | PASS |
| 5.4 | invalid filters are refused (422/400), not a 500 | as expected | PASS |
| 5.5 | paging: limit=1 offset=1 gives one row | as expected | PASS |
| 5.6 | company admin and manager get 403 on every /admin/orgs route | as expected | PASS |
| 5.7 | and the other company is still active | as expected | PASS |
| 5.8 | a company admin naming the platform org in X-Org-Id is refused (403) | as expected | PASS |
| 5.9 | a platform owner without X-Org-Id still resolves to the platform (only org) and reaches the console | as expected | PASS |
| 5.10 | platform owner who is also a company admin: reaches the console (platform privileges follow membership by design) and, acting as the company, lists that company's vehicles only | as expected | PASS |
| 5.11 | acting inside a company, a superadmin account cannot grant superadmin | as expected | PASS |
| 5.12 | a company admin's /users lists its own people and none of the other company's | as expected | PASS |
| 5.13 | the platform admin's /users lists people of both companies | as expected | PASS |
| 5.14 | a company admin cannot make themselves superadmin (refused, role unchanged) | as expected | PASS |
| 5.15 | a company admin cannot change the other company's user (404) | as expected | PASS |
| 5.16 | the platform admin can deactivate and reactivate a company user | as expected | PASS |
| 5.17 | the audit log: a company sees its own entries and none of the other company's | as expected | PASS |
| 5.18 | the platform audit log includes platform decisions | as expected | PASS |
| 5.19 | a manager cannot read the audit log | as expected | PASS |
| 5.20 | KYC review is platform-level: a company admin of an unrelated company cannot read or decide a vendor's KYC | read=1 reject=200 | FAIL |
| 5.21 | the 3PL partner approval queue (a platform decision) is not a company admin's | 200 | FAIL |

5.20 and 5.21 are decision D1 (a company admin reads and decides platform-level approvals).

## Files

- `e2e/staging/tenancy.mjs` (+ `tenancy-isolation.mjs`, `tenancy-settings.mjs`, `tenancy-console.mjs`): the walk. `node e2e/staging/tenancy.mjs [registration|members|isolation|settings|console]`; `TENANCY_MATRIX=<file>` also writes the matrix as JSON.
- Fixes: `backend-ts/src/routes/cargo.routes.ts`, `routes/vehicles.routes.ts`, `routes/routes.routes.ts`, `routes/fuel.routes.ts`, `core/org-guards.ts`, `services/cargo/exception.service.ts`, `services/people-profile.service.ts`, `services/people.service.ts` (one export), `supabase/migrations/20261010060000_tenancy_rls_gaps.sql`.
- Tests: `backend-ts/test/p6-cargo-board-scoping.test.ts` (16), `p6-vehicle-driver-company.test.ts` (5), `p6-people-company-scope.test.ts` (6); `fleet-alarm-rules.test.ts` and `fuel-logs.test.ts` adjusted to uuid ids and the 404 rule.
