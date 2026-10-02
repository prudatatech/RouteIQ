# Area 8: Azure parity

Sweep: `node e2e/staging/parity.mjs [tables embeds routes rpc storage ws perf]` (re-runnable, fresh `@margix.test` accounts and a
fresh company each run, test stage only; `PARITY_OUT=<dir>` also writes `crawl.md` and `raw.json`). Route list: `e2e/staging/parity-routes.mjs`.
Run on 2026-10-02 against the test stage as deployed **before** this branch's fixes; the "after" column says what the fix changes
(nothing here is applied or deployed).

## Steps

| # | Step | Expected | Result | |
|---|---|---|---|---|
| 1 | Crawl: 451 routes (198 GET) parsed from `routes/*.ts` + mounts in `routes/index.ts`; every route called as platform, admin, manager, driver, vendor, customer and guest (3 222 calls: every GET, every POST/PUT/PATCH and parameterised DELETE with an empty body; real ids from a seeded world) | no 5xx, no database text, no stack trace | 51 problem records, all explained below: empty vehicle edit (3 actors), delivery-points embed (2), null vendor id (3), malformed ids (29, step 2), not-configured integrations answering 503 (14: 2 routes x 7 actors) | FAIL |
| 2 | Crawl: a malformed id (`not-a-uuid`) on every `GET /x/:id` route | 400/404 | 29 routes answered 500 ("invalid input syntax for type uuid") | FAIL |
| 3 | Crawl: guests get 401 on every protected route, other roles 403 where the role is wrong | 401/403 | 414 of 449 guest calls were 401; the other 35 are the public routes (`/public/*`, `/customer/quote`, tracking, OTP, `/health`) answering 200/400/404 by design | PASS |
| 4 | Tables: all 88 tables (schema snapshot + migrations) as service role through the data gateway | 200 | 88/88 | PASS |
| 5 | Tables: the 25 tables the web reads or subscribes to, as a company-admin JWT | 200 (RLS-filtered), never 42501 | 25/25 (vendor and driver JWTs also 200; the 9 service-only tables `driver_vehicle_assignments`, `invoice_counters`, `load_counters`, `lr_counters`, `user_*` answer 403 to every user JWT, as designed, the API reads them as service role) | PASS |
| 6 | Tables: anon through the gateway | rows only from public reference data | anon holds SELECT on 70 tables but receives rows from 5 only: `goods_categories`, `hsn_codes`, `pincode_prefixes`, `vehicle_classes`, `system_settings` (15 keys: tariff rates, retention days, the two platform org ids; by design in `20260928000200`). No grant added for anon | PASS |
| 7 | Embeds: the 44 distinct `select('a, b(c)')` strings with relationships that the API issues, each run through PostgREST | resolves | 43 resolve, 1 does not: `delivery_points` -> `shipments` is ambiguous (PGRST201, two foreign keys) | FAIL (fixed) |
| 8 | RPC: `next_lr_number`, `next_invoice_number`, `match_vendors_to_route`, `create_vendor_load` callable by service role with the API's argument names; `award_load` through the API; `next_lr_number` advances | callable | all pass | PASS |
| 9 | RPC through the API paths: post a load, quote, direct accept (`award_load`), invoices list, load documents, opportunities | no 5xx | all pass | PASS |
| 10 | RLS helpers: `public.is_staff` executable by authenticated; policies that call `app.user_org_ids` / `app.is_platform_admin` / `app.can_see_load` evaluate for a staff JWT on 9 tables (the `app` schema is not exposed, so a policy answering 200 is the proof) | 200 | all pass | PASS |
| 11 | Sequences/triggers: background sweeps, read from the API container log | no errors | `Alarm sweep failed: null value in column "id" of relation "maintenance_alerts"` on every run | FAIL (fixed) |
| 12 | Storage: signed upload link, PUT a 1x1 PNG, read back (service role) for 9 routes: vendor KYC, vehicle photo, service attachment, custody, expense receipt, fuel bill, load document (people documents and the guest partner application answer 409 consent / 429 rate limit and are skipped) | link, upload, identical bytes | 7/7 | PASS |
| 13 | Storage: the owner reads the object with their own session (vendor KYC folder, load document by its vendor) | 200 | 403 from the storage gateway for every user-JWT call (get, list, info, sign) | FAIL (fixed) |
| 14 | Storage: another company's user and anon cannot read it | refused | refused (but vacuously: nobody with a user JWT can read anything yet, see issue 1) | PASS |
| 15 | WebSocket feed `/api/v1/telemetry/ws`: staff token connects; no token, a driver, and staff naming another company are refused | | all as expected | PASS |
| 16 | WebSocket feed scoping: a position posted through `POST /telemetry` reaches the company feed and the platform feed, not another company's | | company 1, platform 1, other company 0 | PASS |
| 17 | Realtime gateway `/realtime/v1`: authenticated JWT connects, joins `postgres_changes` on `notifications`, an inserted notification is delivered | subscription ok, event delivered | join refused: `UnableToConnectToProject`; no event. Every one of the 25 tables the web listens to fails the same way | FAIL (fixed in infra) |
| 18 | Performance: warm median of the 30 most used GET endpoints (5 samples, as the role that uses each) | under 500 ms | all 30 between 72 and 196 ms warm; spikes (max 641 ms) only on first hits. `GET /ops/today` runs 21 queries (684 ms summed, 196 ms wall). The test world is small: re-measure with production-size data | PASS |

## Issues

| # | Severity | Issue | Root cause | Fix | Status |
|---|---|---|---|---|---|
| 1 | **High** | On Azure a signed-in user cannot read, list, sign or download any object through the storage gateway: every call answers 403 "new row violates row-level security policy" (storage-api's text for SQLSTATE 42501). The web opens the vendor's own documents, the KYC review page and the partner pages this way (`frontend/src/services/kycDocuments.ts`), so none of them can show a file on Azure | `supabase/bootstrap/azure-roles.sql` gives `authenticated` USAGE on schema `storage` but no privilege on `storage.objects` / `storage.buckets` (Supabase's platform adds them; Azure does not). `20261006020000` fixed only `service_role`, which is why uploads work | `supabase/migrations/20261010080000_storage_authenticated_access.sql`: SELECT on both tables, EXECUTE on the storage functions, a policy to see the two private buckets by name; `azure-roles.sql` gets matching default privileges for tables the storage service creates later. No INSERT/UPDATE/DELETE, nothing for anon | fixed, not applied. After applying: re-run `parity.mjs storage` (steps 13 and 14 become real) |
| 2 | **High** (cross-tenant, latent) | Applying fix 1 switches on `kyc_documents_read`, which lets ANY staff member (of any company) read EVERY object in the bucket: other companies' driver documents, proofs of delivery, vehicle papers | `can_read_kyc_object` uses `public.is_staff()`, written before tenancy | Same migration replaces the function: platform admins; a person's own folder; staff for vendor KYC folders (vendors belong to the platform) and partner folders/applications; a partner for its own. Everything else is served by the API (company checks, service role) as today | fixed, not applied |
| 3 | **High** | Every live update fails on Azure: notifications bell, menu badges, Today page, live map, SOS, messages, return trips. Realtime answers `UnableToConnectToProject` | Container log: `no pg_hba.conf entry for host ..., user "supabase_realtime_admin", database "postgres", no encryption`. The self-hosted tenant is seeded with `ssl_enforced=false` and Azure PostgreSQL refuses unencrypted connections | `infra/platform.sh`: after the services deploy, sets `ssl_enforced=true` on the tenant row in `_realtime.extensions` and restarts the realtime revision (idempotent). For an already running stage run the same `UPDATE` once (see the script) or re-run `./infra/platform.sh --stage test` | fixed in infra, not applied |
| 4 | Medium | 13 tables the web subscribes to are not in the `supabase_realtime` publication (`shipments`, `route_stops`, `cargo_exceptions`, `customer_bookings`, `capacity_windows`, `capacity_bids`, `invoices`, `invoice_payment_reports`, `user_documents`, `vendor_profiles`, `tpl_partners`, `tpl_corridors`, `tpl_documents`): once issue 3 is fixed those screens would still never refresh | The publication was built from a short list (`bootstrap/02_platform.sql`) | `20261010080100_realtime_web_tables.sql` (idempotent, skips what is missing or not permitted); the bootstrap lists updated | fixed, not applied |
| 5 | Medium | The fleet alarm sweep fails on every run (`null value in column "id" of relation "maintenance_alerts"`), so no alarm is ever raised on Azure. `vehicle_stoppages` (driver stoppage report) would fail the same way | The original tables have `id uuid NOT NULL` with no default (the Python models generated ids) and the TS code inserts without an id. The bootstrap schema kept that | `20261010080200_missing_id_defaults.sql`: `gen_random_uuid()` default on `maintenance_alerts`, `vehicle_stoppages`, `traffic_incidents`, `telemetry`, `vehicles`, `depots` where missing. Not touched: tables whose id is the sign-in account's id | fixed, not applied |
| 6 | Medium | `GET /routes/delivery-points` answers 500 for every company admin and manager (platform admins are fine) | `delivery_points` has two foreign keys to `shipments` (`shipment_id`, `lot_shipment_id`); the company-scoped query embeds `shipments(...)` without naming one, PostgREST answers PGRST201. The mocked tests cannot see it | `routes.routes.ts` names `shipments!delivery_points_shipment_id_fkey`; regression test | fixed |
| 7 | Medium | `GET /vendor/shipment-request/pending` answers 500 for staff once a load exists with no vendor user | `.in('id', [null])` on `vendor_profiles` ("invalid input syntax for type uuid: \"null\"") | `vendor.service.ts` drops empty ids and skips the query when none are left; regression test | fixed |
| 8 | Medium | 29 `GET /x/:id` routes answer 500 for a malformed id, a duplicate answers 500 (`driver_pay_rates_type_from_unique` in the log), an empty `PATCH /vehicles/:id` answers 500 and `POST /fleet/vehicles/:id/service-plans/defaults` answers 500 when two staff press it together (unique violation) | Database refusals caused by the request were not mapped | `core/errors.ts` `sendError`: SQLSTATE 22P02/22007/22008/22003 -> 400, 23505 -> 409, 23503 -> 409, with no database text; `PATCH /vehicles/:id` with nothing to change -> 400. Tests in `backend-ts/test/parity-errors.test.ts` | fixed |
| 9 | Low | `POST /spark-gps` and `POST /telematics/webhook` answer 503 "not configured"; the log shows TomTom answering 401 for traffic and the optimizer matrix | The stage has no GPS push secret, telematics webhook secret or valid TomTom key | Configuration, not code: set `SPARK_GPS_PUSH_SECRET`, `TELEMATICS_WEBHOOK_SECRET` and a valid TomTom key on the test API app if those features are to be exercised there | open (owner) |
| 10 | Info | Anon holds SELECT on 70 tables (rows only come back from 5 reference tables because of row-level security) and `system_settings` is readable by anon | Original design (`20260928000200`) | No change: nothing was added for anon. Worth narrowing the anon grants to the reference tables the public pages read in a later hardening pass | noted |

Not issues (checked): the 9 service-only tables refuse user JWTs by design; the API's own `service_role` reads all 88 tables.

## Verification

`npx tsc --noEmit` clean; `npm run -s check:queries` clean; `node scripts/check-vocabulary.mjs` ok; vitest `parity-errors`, `p2-ops-scoping`,
`fleet-gps`, `bids`, `fleet-maintenance`, `malformed-url`, `lockdown`, `vendor-requests`, `handoff-notifications`, `mock-supabase-schema` pass.
Migrations were written, not applied. Expected after applying/deploying: crawl steps 1 and 2 clean (except the two not-configured 503s), steps 13 and
17 pass, the alarm sweep log line disappears.

## Full crawl table

Status each actor received (`-` = not called; DELETE routes with no `:id` are skipped; mutating routes were sent an empty body, GET routes real ids from the seeded
world where one exists, otherwise a random uuid, so 404 on a GET means "no such record", not a missing route). Pre-fix run.

| route | platform | admin | manager | driver | vendor | customer | guest |
|---|---|---|---|---|---|---|---|
| `POST /auth/driver/verify-otp` | 400 | 400 | 400 | 400 | 400 | 400 | 400 |
| `POST /auth/driver/send-otp` | 429 | 429 | 429 | 429 | 429 | 429 | 429 |
| `POST /auth/customer/verify-otp` | 400 | 400 | 429 | 429 | 429 | 429 | 429 |
| `POST /auth/customer/send-otp` | 429 | 429 | 429 | 429 | 429 | 429 | 429 |
| `POST /auth/vendor/send-otp` | 429 | 429 | 429 | 429 | 429 | 429 | 429 |
| `POST /auth/refresh` | 400 | 400 | 400 | 400 | 400 | 400 | 400 |
| `POST /auth/vendor/verify-otp` | 429 | 429 | 429 | 429 | 429 | 429 | 429 |
| `PUT /auth/driver/profile` | 403 | 403 | 403 | 400 | 403 | 400 | 401 |
| `GET /auth/driver/earnings` | 403 | 403 | 403 | 200 | 403 | 200 | 401 |
| `GET /auth/driver/earnings/history` | 403 | 403 | 403 | 200 | 403 | 200 | 401 |
| `POST /auth/invite-vendor` | 400 | 403 | 403 | 403 | 403 | 403 | 401 |
| `GET /users/me` | 200 | 200 | 200 | 200 | 200 | 200 | 401 |
| `PUT /users/language` | 400 | 400 | 400 | 400 | 400 | 400 | 401 |
| `GET /users` | 200 | 200 | 403 | 403 | 403 | 403 | 401 |
| `PATCH /users/:user_id` | 400 | 400 | 403 | 403 | 403 | 403 | 401 |
| `GET /vehicles` | 200 | 200 | 200 | 200 | 403 | 200 | 401 |
| `POST /vehicles` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `GET /vehicles/summary` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /vehicles/sos-counts` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `POST /vehicles/register` | 400 | 403 | 403 | 400 | 403 | 400 | 401 |
| `GET /vehicles/:vehicle_id/sos` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /vehicles/my-registration` | 200 | 403 | 403 | 200 | 403 | 200 | 401 |
| `GET /vehicles/requests` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /vehicles/requests/count` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `POST /vehicles/:vehicle_id/approve` | 409 | 409 | 409 | 403 | 403 | 403 | 401 |
| `POST /vehicles/:vehicle_id/reject` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `GET /vehicles/:vehicle_id/photos` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `POST /vehicles/:vehicle_id/photos/upload-url` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `PUT /vehicles/:vehicle_id/photos/:slot` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `DELETE /vehicles/:vehicle_id/photos/:slot` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `GET /vehicles/:vehicle_id` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `PATCH /vehicles/:vehicle_id` | 500 | 500 | 500 | 403 | 403 | 403 | 401 |
| `POST /vehicles/:vehicle_id/status` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `POST /vehicles/:vehicle_id/${action}` | 409 | 409 | 409 | 403 | 403 | 403 | 401 |
| `POST /vehicles/:vehicle_id/sos` | 201 | 201 | 201 | 403 | 403 | 403 | 401 |
| `POST /vehicles/:vehicle_id/return-trip` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `DELETE /vehicles/:vehicle_id` | 204 | 204 | 204 | 403 | 403 | 403 | 401 |
| `POST /shipments` | 201 | 201 | 201 | 403 | 403 | 403 | 401 |
| `GET /shipments` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /shipments/track/:tracking_id` | 404 | 404 | 404 | 404 | 404 | 404 | 404 |
| `GET /shipments/track/:tracking_id/route` | 404 | 404 | 404 | 404 | 404 | 404 | 404 |
| `GET /shipments/:ref/overview` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /shipments/:shipment_id` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `PUT /shipments/:shipment_id/metadata` | 200 | 200 | 403 | 403 | 403 | 403 | 401 |
| `PATCH /shipments/:shipment_id` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `POST /shipments/:shipment_id/rating` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `GET /shipments/:shipment_id/history` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /shipments/:shipment_id/proof` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /shipments/:shipment_id/verify` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `DELETE /shipments/:shipment_id` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `PATCH /shipments/:shipment_id/edit` | 200 | 200 | 404 | 403 | 403 | 403 | 401 |
| `GET /shipments/:shipment_id/assign-options` | 404 | 404 | 404 | 403 | 403 | 403 | 401 |
| `POST /shipments/:shipment_id/assign` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `GET /routes` | 200 | 200 | 200 | 200 | 403 | 200 | 401 |
| `GET /routes/delivery-points` | 200 | 500 | 500 | 403 | 403 | 403 | 401 |
| `GET /routes/:route_id` | 200 | 404 | 404 | 403 | 403 | 403 | 401 |
| `PATCH /routes/:route_id/status` | 400 | 404 | 404 | 403 | 403 | 403 | 401 |
| `POST /routes/:route_id/reroute` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `PATCH /routes/:route_id` | 200 | 404 | 404 | 403 | 403 | 403 | 401 |
| `DELETE /routes/:route_id` | 409 | 404 | 404 | 403 | 403 | 403 | 401 |
| `POST /optimize` | 200 | 400 | 400 | 403 | 403 | 403 | 401 |
| `POST /optimize/eta` | 200 | 200 | 200 | 200 | 403 | 200 | 401 |
| `POST /optimize/incubate/:vehicle_id` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `POST /optimize/reoptimize/:route_id` | 400 | 404 | 404 | 403 | 403 | 403 | 401 |
| `POST /telemetry` | 400 | 400 | 400 | 400 | 400 | 400 | 401 |
| `GET /telemetry/:vehicle_id/history` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `PUT /telemetry/sos/:id/acknowledge` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `PUT /telemetry/sos/:id/resolve` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `POST /telemetry/sos/:id/cancel` | 409 | 409 | 409 | 404 | 403 | 404 | 401 |
| `POST /telemetry/sos/trigger` | 403 | 403 | 403 | 404 | 403 | 404 | 401 |
| `PATCH /telemetry/sos/:id/details` | 400 | 400 | 400 | 400 | 400 | 400 | 401 |
| `GET /telemetry/:vehicle_id/live` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `POST /telemetry/stoppages` | 403 | 403 | 403 | 403 | 403 | 403 | 401 |
| `POST /telemetry/mobile-session` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `POST /telemetry/call-driver/:vehicle_id` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `POST /telemetry/mobile-push/:session_token` | 404 | 404 | 404 | 404 | 404 | 404 | 404 |
| `GET /telemetry/mobile-session/:session_token` | 404 | 404 | 404 | 404 | 404 | 404 | 404 |
| `POST /telemetry/driver-ping` | 403 | 403 | 403 | 404 | 403 | 404 | 401 |
| `POST /telemetry/driver-ping/break` | 403 | 403 | 403 | 400 | 403 | 400 | 401 |
| `POST /telemetry/driver-ping/accept-route` | 403 | 403 | 403 | 400 | 403 | 400 | 401 |
| `POST /telemetry/driver-ping/start-route` | 403 | 403 | 403 | 400 | 403 | 400 | 401 |
| `POST /telemetry/driver-ping/complete-stop` | 403 | 403 | 403 | 400 | 403 | 400 | 401 |
| `GET /telemetry/driver-ping/my-status` | 403 | 403 | 403 | 200 | 403 | 200 | 401 |
| `GET /telemetry/driver-ping/my-route` | 403 | 403 | 403 | 404 | 403 | 404 | 401 |
| `GET /dashboard/kpis` | 200 | 200 | 200 | 200 | 403 | 200 | 401 |
| `GET /dashboard/people-attention` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /dashboard/shipment-counts` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /analytics/insights` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /analytics/demand` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /analytics/metrics` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /analytics/fleet-overview` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /analytics/daily-activity` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /analytics/active-missions` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `POST /analytics/sync-sparkgps` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /analytics/audit-logs` | 200 | 200 | 403 | 403 | 403 | 403 | 401 |
| `GET /analytics/driver-performance` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /analytics/vendor-performance` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /depots` | 200 | 200 | 200 | 200 | 403 | 200 | 401 |
| `GET /cargo/shipments` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /cargo/open-loads` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /cargo/security-alerts` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `POST /cargo/resolve-alert/:alert_id` | 404 | 404 | 404 | 403 | 403 | 403 | 401 |
| `POST /cargo/optimize-pooling` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `POST /cargo/backhaul-match` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `POST /cargo/verify-pod` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `GET /cargo/where/:ref` | 404 | 404 | 404 | 404 | 404 | 404 | 401 |
| `GET /cargo/timeline/:ref` | 404 | 404 | 404 | 404 | 404 | 404 | 401 |
| `POST /cargo/custody` | 400 | 400 | 400 | 400 | 403 | 400 | 401 |
| `POST /cargo/custody/upload-url` | 400 | 400 | 400 | 400 | 403 | 400 | 401 |
| `POST /cargo/otp/send` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `GET /cargo/exceptions` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `POST /cargo/exceptions` | 400 | 400 | 400 | 400 | 403 | 400 | 401 |
| `GET /cargo/exceptions/:id` | 200 | 404 | 404 | 403 | 403 | 403 | 401 |
| `POST /cargo/exceptions/:id/actions` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `GET /cargo/exceptions/:id/relief-vehicles` | 200 | 404 | 404 | 403 | 403 | 403 | 401 |
| `POST /cargo/transfers` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `GET /cargo/transfers` | 200 | 200 | 200 | 200 | 403 | 200 | 401 |
| `GET /cargo/transfers/:id` | 200 | 404 | 404 | 404 | 403 | 404 | 401 |
| `POST /cargo/transfers/:id/handover-out` | 400 | 400 | 400 | 400 | 403 | 400 | 401 |
| `POST /cargo/transfers/:id/handover-in` | 400 | 400 | 400 | 400 | 403 | 400 | 401 |
| `POST /cargo/transfers/:id/cancel` | 409 | 404 | 404 | 403 | 403 | 403 | 401 |
| `POST /cargo/transfers/:id/eway` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `POST /cargo/lots/split` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `POST /cargo/lots/merge` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `POST /cargo/lots/eway` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `GET /cargo/lots/:ref` | 404 | 404 | 404 | 404 | 404 | 404 | 401 |
| `GET /cargo/hubs` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /cargo/hubs/:depot_id/inventory` | 404 | 404 | 404 | 403 | 403 | 403 | 401 |
| `POST /cargo/claims` | 400 | 400 | 400 | 403 | 400 | 403 | 401 |
| `GET /cargo/claims` | 200 | 200 | 200 | 403 | 200 | 403 | 401 |
| `GET /cargo/claims/:id` | 200 | 404 | 404 | 403 | 404 | 403 | 401 |
| `POST /cargo/claims/:id/documents-upload-url` | 415 | 415 | 415 | 403 | 404 | 403 | 401 |
| `PATCH /cargo/claims/:id` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `GET /cargo/vehicles/:vehicle_id/on-board` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /cargo/driver/on-board` | 403 | 403 | 403 | 403 | 403 | 403 | 401 |
| `POST /cargo/driver/rejected-action` | 400 | 403 | 403 | 400 | 403 | 400 | 401 |
| `POST /gps` | 400 | 400 | 400 | 400 | 400 | 400 | 401 |
| `GET /gps/vehicle/:vehicle_id` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /gps/vehicle/:vehicle_id/track` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `POST /spark-gps` | 503 | 503 | 503 | 503 | 503 | 503 | 503 |
| `GET /marketplace/open-loads` | 200 | 200 | 200 | 200 | 403 | 200 | 401 |
| `POST /marketplace/bid` | 403 | 403 | 403 | 400 | 403 | 400 | 401 |
| `POST /capacity/bids` | 400 | 400 | 400 | 403 | 400 | 403 | 401 |
| `GET /capacity/windows/open` | 200 | 200 | 200 | 403 | 200 | 403 | 401 |
| `GET /capacity/bids/mine` | 200 | 200 | 200 | 403 | 200 | 403 | 401 |
| `GET /capacity/nearby-vendors` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `POST /capacity/driver/open-backhaul-window` | 400 | 400 | 400 | 400 | 403 | 400 | 401 |
| `GET /capacity/windows/:id/bid-count` | 200 | 404 | 404 | 403 | 200 | 403 | 401 |
| `POST /capacity/driver/toggle-matching` | 400 | 403 | 403 | 400 | 403 | 400 | 401 |
| `POST /capacity/driver/ack-stop` | 403 | 403 | 403 | 403 | 403 | 403 | 401 |
| `POST /capacity/driver/confirm-stop` | 403 | 403 | 403 | 403 | 403 | 403 | 401 |
| `POST /capacity/driver/flag-stop` | 403 | 403 | 403 | 403 | 403 | 403 | 401 |
| `POST /capacity/driver/postpone-route` | 400 | 403 | 403 | 400 | 403 | 400 | 401 |
| `GET /capacity/bids/pending` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `POST /capacity/bids/:id/approve` | 404 | 404 | 404 | 403 | 403 | 403 | 401 |
| `POST /capacity/bids/:id/reject` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `GET /capacity/windows` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `POST /capacity/windows` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `POST /capacity/windows/:id/${action}` | 404 | 404 | 404 | 404 | 404 | 404 | 404 |
| `GET /vendor/profile` | 200 | 200 | 200 | 200 | 200 | 200 | 401 |
| `POST /vendor/profile` | 400 | 403 | 403 | 403 | 400 | 403 | 401 |
| `POST /vendor/kyc/submit` | 400 | 403 | 403 | 403 | 400 | 403 | 401 |
| `POST /vendor/kyc/upload-url` | 400 | 403 | 403 | 403 | 400 | 403 | 401 |
| `PUT /vendor/kyc/documents` | 400 | 403 | 403 | 403 | 400 | 403 | 401 |
| `GET /vendor/invoices` | 200 | 403 | 403 | 403 | 200 | 403 | 401 |
| `GET /vendor/loads` | 200 | 403 | 403 | 403 | 200 | 403 | 401 |
| `POST /vendor/loads` | 400 | 403 | 403 | 403 | 400 | 403 | 401 |
| `GET /vendor/loads/mine` | 200 | 403 | 403 | 403 | 200 | 403 | 401 |
| `GET /vendor/loads/template.csv` | 200 | 403 | 403 | 403 | 200 | 403 | 401 |
| `POST /vendor/loads/bulk` | 400 | 403 | 403 | 403 | 400 | 403 | 401 |
| `POST /vendor/loads/:id/repost` | 200 | 403 | 403 | 403 | 200 | 403 | 401 |
| `GET /vendor/loads/:id/quotes` | 200 | 403 | 403 | 403 | 200 | 403 | 401 |
| `GET /vendor/loads/:id` | 200 | 200 | 200 | 403 | 200 | 403 | 401 |
| `POST /vendor/loads/:id/quotes/:quoteId/accept` | 404 | 403 | 403 | 403 | 404 | 403 | 401 |
| `GET /vendor/business-profile` | 403 | 403 | 403 | 403 | 200 | 403 | 401 |
| `PUT /vendor/business-profile` | 400 | 403 | 403 | 403 | 400 | 403 | 401 |
| `POST /vendor/shipment-request` | 400 | 403 | 403 | 403 | 400 | 403 | 401 |
| `GET /vendor/shipment-request/pending` | 500 | 500 | 500 | 403 | 403 | 403 | 401 |
| `PUT /vendor/shipment-request/:id/cancel` | 404 | 403 | 403 | 403 | 404 | 403 | 401 |
| `PUT /vendor/shipment-request/:id/approve` | 404 | 404 | 404 | 403 | 403 | 403 | 401 |
| `PUT /vendor/shipment-request/:id/reject` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `PUT /vendor/kyc/:id/approve` | 404 | 404 | 403 | 403 | 403 | 403 | 401 |
| `PUT /vendor/kyc/:id/reject` | 400 | 400 | 403 | 403 | 403 | 403 | 401 |
| `PUT /vendor/:id/location` | 400 | 400 | 403 | 403 | 403 | 403 | 401 |
| `PUT /vendor/shipment-request/:id/assign-vehicle` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `GET /vendor/rates` | 200 | 200 | 200 | 200 | 200 | 200 | 401 |
| `GET /vendor/passing-routes` | 200 | 403 | 403 | 403 | 200 | 403 | 401 |
| `POST /tpl/affiliations` | 403 | 403 | 403 | 403 | 403 | 403 | 401 |
| `GET /tpl/affiliations` | 403 | 403 | 403 | 403 | 403 | 403 | 401 |
| `POST /tpl/onboard` | 429 | 429 | 429 | 429 | 429 | 429 | 429 |
| `GET /tpl/queue` | 200 | 200 | 403 | 403 | 403 | 403 | 401 |
| `POST /tpl/applications/upload-url` | 429 | 429 | 429 | 429 | 429 | 429 | 429 |
| `GET /tpl/by-user/:userId` | 200 | 200 | 200 | 200 | 403 | 403 | 401 |
| `GET /tpl/:id` | 404 | 404 | 404 | 404 | 404 | 404 | 404 |
| `POST /tpl/approve/:id` | 404 | 403 | 403 | 403 | 403 | 403 | 401 |
| `POST /tpl/reject/:id` | 400 | 403 | 403 | 403 | 403 | 403 | 401 |
| `PATCH /tpl/:id` | 404 | 404 | 404 | 404 | 404 | 404 | 404 |
| `POST /tpl/:id/documents/:docId/replace` | 404 | 404 | 404 | 404 | 404 | 404 | 401 |
| `POST /tpl/:id/settings` | 404 | 404 | 404 | 404 | 404 | 404 | 401 |
| `POST /tpl/:id/pause` | 404 | 403 | 403 | 403 | 403 | 403 | 401 |
| `POST /tpl/:id/resume` | 404 | 403 | 403 | 403 | 403 | 403 | 401 |
| `DELETE /tpl/:id` | 200 | 403 | 403 | 403 | 403 | 403 | 401 |
| `POST /tpl/auth/setup-password` | 400 | 400 | 400 | 400 | 400 | 400 | 400 |
| `GET /tpl-network/settings` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `PUT /tpl-network/settings` | 400 | 403 | 403 | 403 | 403 | 403 | 401 |
| `GET /tpl-network/escalations` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `GET /tpl-network/escalations/preview` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `POST /tpl-network/escalations` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `PUT /tpl-network/requests/:id/price` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `POST /tpl-network/escalations/withdraw` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `POST /tpl/auth/send-otp` | 429 | 429 | 429 | 429 | 429 | 429 | 429 |
| `GET /tpl-network/orders` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `POST /tpl-network/offers/:id/withdraw` | 409 | 409 | 409 | 403 | 403 | 403 | 401 |
| `POST /tpl-network/orders/:id/paid` | 400 | 400 | 403 | 403 | 403 | 403 | 401 |
| `POST /tpl-network/orders/:id/rate` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `GET /tpl-network/partners/stats` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /tpl-network/partners/:id/stats` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /tpl-network/my/offers` | 403 | 403 | 403 | 403 | 403 | 403 | 401 |
| `POST /tpl-network/my/offers/:id/accept` | 403 | 403 | 403 | 403 | 403 | 403 | 401 |
| `POST /tpl-network/my/offers/:id/decline` | 403 | 403 | 403 | 403 | 403 | 403 | 401 |
| `GET /tpl-network/my/orders` | 403 | 403 | 403 | 403 | 403 | 403 | 401 |
| `POST /tpl-network/my/orders/:id/status` | 403 | 403 | 403 | 403 | 403 | 403 | 401 |
| `GET /tpl-network/my/earnings` | 403 | 403 | 403 | 403 | 403 | 403 | 401 |
| `GET /tpl-network/my/stats` | 403 | 403 | 403 | 403 | 403 | 403 | 401 |
| `GET /tpl-portal/:id/vehicles` | 403 | 403 | 403 | 403 | 403 | 403 | 401 |
| `POST /tpl-portal/:id/vehicles` | 403 | 403 | 403 | 403 | 403 | 403 | 401 |
| `PATCH /tpl-portal/:id/vehicles/:vid` | 403 | 403 | 403 | 403 | 403 | 403 | 401 |
| `GET /tpl-portal/:id/drivers` | 403 | 403 | 403 | 403 | 403 | 403 | 401 |
| `POST /tpl-portal/:id/drivers/invite` | 403 | 403 | 403 | 403 | 403 | 403 | 401 |
| `GET /tpl-portal/:id/statements` | 403 | 403 | 403 | 403 | 403 | 403 | 401 |
| `GET /tpl-portal/:id/statements/:sid` | 403 | 403 | 403 | 403 | 403 | 403 | 401 |
| `GET /tpl-portal/:id/statements/:sid/pdf` | 403 | 403 | 403 | 403 | 403 | 403 | 401 |
| `POST /gstin/verify` | 400 | 400 | 400 | 400 | 400 | 400 | 400 |
| `GET /bank/ifsc/:code` | 400 | 400 | 400 | 400 | 400 | 400 | 400 |
| `GET /search` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /notifications` | 200 | 200 | 200 | 200 | 200 | 200 | 401 |
| `POST /notifications/read-all` | 200 | 200 | 200 | 200 | 200 | 200 | 401 |
| `POST /notifications/:id/read` | 404 | 404 | 404 | 404 | 404 | 404 | 401 |
| `GET /finance/summary` | 200 | 200 | 403 | 403 | 403 | 403 | 401 |
| `GET /finance/unpriced` | 200 | 200 | 403 | 403 | 403 | 403 | 401 |
| `GET /finance/invoices/summary` | 200 | 200 | 403 | 403 | 403 | 403 | 401 |
| `GET /finance/invoices` | 200 | 200 | 403 | 403 | 403 | 403 | 401 |
| `POST /finance/invoices` | 400 | 400 | 403 | 403 | 403 | 403 | 401 |
| `GET /finance/invoice-reports` | 200 | 200 | 403 | 403 | 403 | 403 | 401 |
| `POST /finance/invoice-reports/:id/confirm` | 404 | 404 | 403 | 403 | 403 | 403 | 401 |
| `POST /finance/invoice-reports/:id/reject` | 404 | 404 | 403 | 403 | 403 | 403 | 401 |
| `POST /finance/invoice-reports/:id/answer` | 404 | 404 | 403 | 403 | 403 | 403 | 401 |
| `PUT /finance/invoices/:id/pay` | 400 | 404 | 403 | 403 | 403 | 403 | 401 |
| `PUT /finance/invoices/:id/void` | 400 | 404 | 403 | 403 | 403 | 403 | 401 |
| `POST /finance/unpriced/price` | 400 | 400 | 403 | 403 | 403 | 403 | 401 |
| `GET /finance/company` | 200 | 200 | 403 | 403 | 403 | 403 | 401 |
| `PUT /finance/company` | 200 | 200 | 403 | 403 | 403 | 403 | 401 |
| `GET /finance/expenses` | 200 | 200 | 403 | 403 | 403 | 403 | 401 |
| `POST /finance/expenses` | 400 | 400 | 403 | 403 | 403 | 403 | 401 |
| `POST /finance/expenses/receipt-upload` | 415 | 415 | 403 | 403 | 403 | 403 | 401 |
| `PUT /finance/expenses/:id` | 400 | 404 | 403 | 403 | 403 | 403 | 401 |
| `DELETE /finance/expenses/:id` | 204 | 404 | 403 | 403 | 403 | 403 | 401 |
| `GET /finance/expenses/:id/receipt-url` | 404 | 404 | 403 | 403 | 403 | 403 | 401 |
| `GET /finance/settings` | 200 | 200 | 403 | 403 | 403 | 403 | 401 |
| `PUT /finance/settings` | 400 | 400 | 403 | 403 | 403 | 403 | 401 |
| `GET /invoices/payment-details` | 200 | 200 | 403 | 403 | 200 | 403 | 401 |
| `GET /invoices/:id` | 200 | 404 | 403 | 403 | 403 | 403 | 401 |
| `GET /invoices/:id/pdf` | 200 | 404 | 403 | 403 | 404 | 403 | 401 |
| `GET /driver-pay/rates` | 200 | 200 | 403 | 403 | 403 | 403 | 401 |
| `POST /driver-pay/rates` | 400 | 400 | 403 | 403 | 403 | 403 | 401 |
| `PATCH /driver-pay/rates/:id` | 404 | 404 | 403 | 403 | 403 | 403 | 401 |
| `DELETE /driver-pay/rates/:id` | 404 | 404 | 403 | 403 | 403 | 403 | 401 |
| `GET /driver-pay/entries` | 200 | 200 | 403 | 403 | 403 | 403 | 401 |
| `POST /driver-pay/entries/approve` | 400 | 400 | 403 | 403 | 403 | 403 | 401 |
| `POST /driver-pay/entries/:id/adjust` | 400 | 400 | 403 | 403 | 403 | 403 | 401 |
| `POST /driver-pay/entries/:id/void` | 400 | 400 | 403 | 403 | 403 | 403 | 401 |
| `POST /driver-pay/backfill` | 400 | 403 | 403 | 403 | 403 | 403 | 401 |
| `GET /driver-pay/payouts` | 200 | 200 | 403 | 403 | 403 | 403 | 401 |
| `POST /driver-pay/payouts` | 400 | 400 | 403 | 403 | 403 | 403 | 401 |
| `POST /telematics/webhook` | 503 | 503 | 503 | 503 | 503 | 503 | 503 |
| `POST /telematics/test-alarm` | 400 | 403 | 403 | 403 | 403 | 403 | 401 |
| `GET /fleet/analytics` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /fleet/health` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /fleet/vehicles/:id/health` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /fleet/vehicles/:id/location` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /fleet/vehicles/:id/activity` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `POST /fleet/vehicles/:id/share-links` | 201 | 201 | 201 | 403 | 403 | 403 | 401 |
| `GET /fleet/vehicles/:id/share-links` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `PUT /fleet/vehicles/:id/odometer` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `DELETE /fleet/share-links/:linkId` | 404 | 404 | 404 | 403 | 403 | 403 | 401 |
| `GET /fleet/vehicles/:id/service-plans` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `POST /fleet/vehicles/:id/service-plans` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `GET /fleet/service-due` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `DELETE /fleet/service-plans/:planId` | 200 | 404 | 404 | 403 | 403 | 403 | 401 |
| `GET /fleet/vehicles/:id/service-log` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `POST /fleet/vehicles/:id/service-log` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `GET /fleet/alerts` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /fleet/alerts/summary` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `POST /fleet/alerts/:id/acknowledge` | 404 | 404 | 404 | 403 | 403 | 403 | 401 |
| `POST /fleet/alerts/:id/resolve` | 404 | 404 | 404 | 403 | 403 | 403 | 401 |
| `GET /fleet/alert-settings` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `PUT /fleet/alert-settings` | 200 | 200 | 403 | 403 | 403 | 403 | 401 |
| `GET /fleet/vehicles/:id/fuel-logs` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `POST /fleet/vehicles/:id/fuel-logs` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `POST /fleet/vehicles/:id/fuel-logs/bill-upload` | 415 | 415 | 415 | 403 | 403 | 403 | 401 |
| `GET /fleet/vehicles/:id/fuel-stats` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `PUT /fleet/fuel-logs/:logId` | 400 | 404 | 404 | 403 | 403 | 403 | 401 |
| `DELETE /fleet/fuel-logs/:logId` | 204 | 404 | 404 | 403 | 403 | 403 | 401 |
| `GET /fleet/fuel-logs/:logId/bill-url` | 404 | 404 | 404 | 404 | 404 | 404 | 401 |
| `GET /fleet/fuel-summary` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /fleet/fuel-anomalies` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `POST /pricing/quote` | 400 | 400 | 400 | 403 | 400 | 403 | 401 |
| `GET /pricing/settings` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `PUT /pricing/settings` | 400 | 400 | 403 | 403 | 403 | 403 | 401 |
| `GET /traffic/status` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /traffic/incidents` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /traffic/tile-token` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /traffic/tiles/flow/:z/:x/:y.png` | 404 | 404 | 404 | 404 | 404 | 404 | 404 |
| `POST /traffic/refresh` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /routing/status` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `POST /routing/plan` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `POST /routing/optimize-order` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `POST /routing/directions` | 400 | 400 | 400 | 400 | 400 | 400 | 401 |
| `GET /routing/open-loads` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `POST /routing/create-route` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `GET /weather/route/:route_id` | 200 | 404 | 404 | 403 | 403 | 403 | 401 |
| `POST /customer/quote` | 400 | 403 | 403 | 403 | 403 | 403 | 401 |
| `POST /customer/bookings` | 400 | 403 | 403 | 403 | 403 | 403 | 401 |
| `GET /customer/bookings` | 200 | 403 | 403 | 403 | 403 | 403 | 401 |
| `GET /customer/bookings/:id` | 404 | 403 | 403 | 403 | 403 | 403 | 401 |
| `GET /customer/bookings/:id/cargo` | 404 | 403 | 403 | 403 | 403 | 403 | 401 |
| `POST /customer/bookings/:id/confirm-receipt` | 400 | 403 | 403 | 403 | 403 | 403 | 401 |
| `POST /customer/bookings/:id/cancel` | 404 | 403 | 403 | 403 | 403 | 403 | 401 |
| `GET /customer/invoices` | 200 | 403 | 403 | 403 | 403 | 403 | 401 |
| `GET /customer/profile` | 404 | 403 | 403 | 403 | 403 | 403 | 401 |
| `PATCH /customer/profile` | 400 | 403 | 403 | 403 | 403 | 403 | 401 |
| `GET /customer/invoices/:id/reports` | 404 | 403 | 403 | 403 | 403 | 403 | 401 |
| `POST /customer/invoices/:id/reports` | 422 | 403 | 403 | 403 | 403 | 403 | 401 |
| `PUT /customer/push-token` | 400 | 403 | 403 | 403 | 403 | 403 | 401 |
| `GET /bookings` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /bookings/customers/:id/profile` | 404 | 404 | 404 | 403 | 403 | 403 | 401 |
| `PATCH /bookings/customers/:id/profile` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `POST /bookings/:id/confirm` | 404 | 404 | 404 | 403 | 403 | 403 | 401 |
| `POST /bookings/:id/assign` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `POST /bookings/:id/cancel` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `GET /public/stats` | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| `GET /public/vehicle-share/:token` | 404 | 404 | 404 | 404 | 404 | 404 | 404 |
| `GET /public/spare-space` | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| `GET /public/companies` | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| `POST /public/quote` | 400 | 400 | 400 | 400 | 400 | 400 | 400 |
| `GET /public/hsn/search` | 400 | 400 | 400 | 400 | 400 | 400 | 400 |
| `GET /public/hsn/:code` | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| `GET /public/pincode/:pin` | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| `GET /public/vehicle-classes` | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| `GET /public/goods-categories` | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| `POST /public/loads/assist` | 400 | 400 | 400 | 400 | 400 | 400 | 400 |
| `GET /public/cities` | 200 | 200 | 200 | 200 | 200 | 200 | 200 |
| `POST /driver/scan` | 400 | 403 | 403 | 400 | 403 | 400 | 401 |
| `GET /driver/pay` | 200 | 403 | 403 | 200 | 403 | 200 | 401 |
| `POST /driver/pod-upload-url` | 400 | 403 | 403 | 400 | 403 | 400 | 401 |
| `GET /driver/dispatch-contact` | 200 | 200 | 200 | 200 | 403 | 200 | 401 |
| `PUT /driver/dispatch-contact` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /messages/unread` | 200 | 200 | 200 | 200 | 403 | 200 | 401 |
| `GET /messages` | 400 | 400 | 400 | 400 | 403 | 400 | 401 |
| `POST /messages` | 400 | 400 | 400 | 400 | 403 | 400 | 401 |
| `POST /messages/read` | 400 | 400 | 400 | 400 | 403 | 400 | 401 |
| `GET /people` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `POST /people` | 400 | 400 | 403 | 403 | 403 | 403 | 401 |
| `GET /people/duplicates` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /people/settings` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `PUT /people/settings` | 400 | 400 | 403 | 403 | 403 | 403 | 401 |
| `POST /people/import` | 400 | 400 | 403 | 403 | 403 | 403 | 401 |
| `GET /people/export.csv` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /people/documents/expiring.csv` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /people/:id` | 200 | 200 | 200 | 200 | 403 | 403 | 401 |
| `PATCH /people/:id` | 400 | 400 | 403 | 403 | 403 | 403 | 401 |
| `POST /people/:id/status` | 400 | 400 | 403 | 403 | 403 | 403 | 401 |
| `POST /people/:id/invite` | 200 | 200 | 403 | 403 | 403 | 403 | 401 |
| `POST /people/:id/anonymise` | 409 | 403 | 403 | 403 | 403 | 403 | 401 |
| `POST /people/:id/consent` | 400 | 400 | 400 | 400 | 403 | 403 | 401 |
| `GET /people/:id/documents` | 200 | 200 | 200 | 200 | 403 | 403 | 401 |
| `POST /people/:id/documents/upload-url` | 400 | 400 | 400 | 400 | 403 | 403 | 401 |
| `POST /people/:id/documents` | 409 | 409 | 409 | 409 | 403 | 403 | 401 |
| `PATCH /people/:id/documents/:docId` | 404 | 404 | 404 | 403 | 403 | 403 | 401 |
| `GET /people/:id/documents/:docId/file` | 404 | 404 | 404 | 404 | 403 | 403 | 401 |
| `DELETE /people/:id/documents/:docId` | 404 | 404 | 403 | 403 | 403 | 403 | 401 |
| `GET /people/:id/emergency-contacts` | 200 | 200 | 200 | 200 | 403 | 403 | 401 |
| `POST /people/:id/emergency-contacts` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `PATCH /people/:id/emergency-contacts/:contactId` | 404 | 404 | 404 | 403 | 403 | 403 | 401 |
| `DELETE /people/:id/emergency-contacts/:contactId` | 404 | 404 | 404 | 403 | 403 | 403 | 401 |
| `GET /people/:id/bank-accounts` | 200 | 200 | 403 | 403 | 403 | 403 | 401 |
| `POST /people/:id/bank-accounts` | 400 | 400 | 403 | 403 | 403 | 403 | 401 |
| `PATCH /people/:id/bank-accounts/:accountId` | 404 | 404 | 403 | 403 | 403 | 403 | 401 |
| `DELETE /people/:id/bank-accounts/:accountId` | 404 | 404 | 403 | 403 | 403 | 403 | 401 |
| `POST /people/:id/bank-accounts/:accountId/reveal` | 404 | 403 | 403 | 403 | 403 | 403 | 401 |
| `GET /people/:id/notes` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `POST /people/:id/notes` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `GET /ops/today` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /loads/:id/documents` | 200 | 404 | 404 | 403 | 200 | 403 | 401 |
| `POST /loads/:id/documents/upload-url` | 400 | 404 | 404 | 403 | 400 | 403 | 401 |
| `POST /loads/:id/documents/generate/:kind` | 403 | 404 | 404 | 403 | 403 | 403 | 401 |
| `POST /loads/:id/documents` | 400 | 404 | 404 | 403 | 400 | 403 | 401 |
| `PATCH /loads/:id/documents/:docId` | 400 | 404 | 404 | 403 | 400 | 403 | 401 |
| `GET /loads/:id/documents/:docId/pdf` | 404 | 404 | 404 | 403 | 404 | 403 | 401 |
| `GET /loads/:id/documents/:docId/history` | 404 | 404 | 404 | 403 | 404 | 403 | 401 |
| `GET /loads/:id/dispatch-check` | 200 | 404 | 404 | 403 | 200 | 403 | 401 |
| `GET /loads/:id/settlement` | 404 | 404 | 404 | 403 | 404 | 403 | 401 |
| `POST /loads/:id/settlement` | 403 | 404 | 404 | 403 | 403 | 403 | 401 |
| `POST /loads/:id/settlement/extra-charges` | 403 | 404 | 404 | 403 | 403 | 403 | 401 |
| `POST /loads/:id/settlement/extra-charges/:idx/approve` | 403 | 404 | 404 | 403 | 403 | 403 | 401 |
| `POST /loads/:id/settlement/deductions` | 403 | 404 | 404 | 403 | 403 | 403 | 401 |
| `POST /loads/:id/settlement/close` | 403 | 404 | 404 | 403 | 403 | 403 | 401 |
| `GET /loads/:id/timeline` | 200 | 404 | 404 | 403 | 200 | 403 | 401 |
| `GET /company/loads/market` | 403 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /company/loads/:id` | 403 | 200 | 200 | 403 | 403 | 403 | 401 |
| `POST /company/loads/:id/quotes` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `DELETE /company/loads/:id/quotes/mine` | 403 | 404 | 404 | 403 | 403 | 403 | 401 |
| `POST /company/loads/:id/accept` | 403 | 400 | 400 | 403 | 403 | 403 | 401 |
| `GET /orgs/mine` | 200 | 200 | 200 | 200 | 200 | 200 | 401 |
| `POST /orgs` | 422 | 422 | 422 | 422 | 422 | 422 | 401 |
| `GET /org` | 200 | 200 | 403 | 403 | 200 | 403 | 401 |
| `PATCH /org` | 422 | 422 | 403 | 403 | 422 | 403 | 401 |
| `GET /org/members` | 200 | 200 | 403 | 403 | 200 | 403 | 401 |
| `POST /org/members` | 422 | 422 | 403 | 403 | 422 | 403 | 401 |
| `PATCH /org/members/:userId` | 422 | 422 | 403 | 403 | 422 | 403 | 401 |
| `GET /org/tpl-affiliations` | 403 | 200 | 403 | 403 | 403 | 403 | 401 |
| `PUT /org/tpl-affiliations/:tplId/${action}` | 403 | 404 | 403 | 403 | 403 | 403 | 401 |
| `PATCH /org/tpl-affiliations/:tplId/rules` | 403 | 404 | 403 | 403 | 403 | 403 | 401 |
| `GET /org/tpl-affiliations/:tplId` | 403 | 404 | 403 | 403 | 403 | 403 | 401 |
| `GET /org/tpl-affiliations/:tplId/fleet` | 403 | 404 | 404 | 404 | 403 | 404 | 401 |
| `GET /org/tpl-affiliations/:tplId/statements` | 403 | 404 | 403 | 403 | 403 | 403 | 401 |
| `POST /org/tpl-affiliations/:tplId/statements` | 403 | 404 | 403 | 403 | 403 | 403 | 401 |
| `GET /org/tpl-affiliations/:tplId/statements/:sid` | 403 | 404 | 403 | 403 | 403 | 403 | 401 |
| `PATCH /org/tpl-affiliations/:tplId/statements/:sid` | 403 | 404 | 403 | 403 | 403 | 403 | 401 |
| `POST /org/tpl-affiliations/:tplId/statements/:sid/issue` | 403 | 404 | 403 | 403 | 403 | 403 | 401 |
| `POST /org/tpl-affiliations/:tplId/statements/:sid/mark-paid` | 403 | 404 | 403 | 403 | 403 | 403 | 401 |
| `GET /org/tpl-affiliations/:tplId/statements/:sid/pdf` | 403 | 404 | 403 | 403 | 403 | 403 | 401 |
| `GET /admin/orgs` | 200 | 403 | 403 | 403 | 403 | 403 | 401 |
| `PUT /admin/orgs/:id/${decision}` | 409 | 403 | 403 | 403 | 403 | 403 | 401 |
| `GET /fleet/maintenance/jobs` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `GET /fleet/vehicles/:id/maintenance/preview` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `POST /fleet/vehicles/:id/maintenance` | 400 | 400 | 400 | 403 | 403 | 403 | 401 |
| `PATCH /fleet/maintenance/jobs/:id` | 400 | 404 | 404 | 403 | 403 | 403 | 401 |
| `POST /fleet/maintenance/jobs/:id/close` | 400 | 404 | 404 | 403 | 403 | 403 | 401 |
| `POST /fleet/maintenance/jobs/:id/attachments` | 400 | 404 | 404 | 403 | 403 | 403 | 401 |
| `POST /fleet/vehicles/:id/service-attachments/upload-url` | 415 | 415 | 415 | 403 | 403 | 403 | 401 |
| `POST /fleet/service-log/:id/attachments` | 400 | 404 | 404 | 403 | 403 | 403 | 401 |
| `GET /fleet/service-attachments/:id/url` | 404 | 404 | 404 | 403 | 403 | 403 | 401 |
| `DELETE /fleet/service-attachments/:id` | 404 | 404 | 404 | 403 | 403 | 403 | 401 |
| `POST /fleet/service-log/:id/items` | 400 | 404 | 404 | 403 | 403 | 403 | 401 |
| `GET /fleet/service-plan-templates` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
| `DELETE /fleet/service-items/:id` | 404 | 404 | 404 | 403 | 403 | 403 | 401 |
| `POST /fleet/vehicles/:id/service-plans/defaults` | 201 | 409 | 409 | 403 | 403 | 403 | 401 |
| `POST /fleet/vehicles/:id/odometer/sync` | 200 | 200 | 200 | 403 | 403 | 403 | 401 |
