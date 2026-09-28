# Remediation Plan

Audit date: 2026-09-28. Working branch: `chore/audit-remediation` (nothing lands on `main` without review).

Live system: `frontend` (Vercel) + `driver-app` + `customer-app` → `backend-ts` (Railway) → Supabase, plus `ml-service`.
The Python backend, `telemetry-service`, Supabase edge functions, docker-compose/k8s and the old CI were retired in the cleanup commits on this branch.

Severity: **C** critical · **H** high · **M** medium. Effort: S / M / L.
Items marked **(you)** need access only the project owner has (Railway, Supabase dashboard/CLI, app stores).

---

## Phase 0 — Owner actions before any deploy (you)

| # | Action | Why |
|---|---|---|
| 0.1 | On Railway (backend-ts) confirm, by name only, that `SUPABASE_URL`, `SUPABASE_JWT_SECRET` and `SECRET_KEY` are set, `SECRET_KEY` is not `temporary_secret_key_for_setup`, and whether `APP_ENV=production` is set | Phase 1 fails fast in production on a default secret |
| 0.2 | Take a full Supabase backup (dashboard backup or `pg_dump`) | Required before any migration |
| 0.3 | Run `select id, email, role, created_at from users where role in ('superadmin','admin','manager');` and confirm every row is legitimate | Anyone could self-register as superadmin until Phase 2.2 ships |
| 0.4 | Run `supabase functions list`; delete the deployed `cargo` function (`supabase functions delete cargo`) | It runs with `verify_jwt=false` and accepts master POD OTPs `2026`/`1234` |
| 0.5 | Check whether Roadcast/SparkGPS pushes to `POST /api/v1/spark-gps` (vs. only being polled) | Decides whether that route gets a shared secret or is removed |
| 0.6 | If an auth user `nexus.auth@prudata.io` exists, change its password (the old seed script hardcoded `password123` for this superadmin) or delete it. Seed scripts now read credentials from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | A committed superadmin password is effectively public |
| 0.7 | Apply `supabase/migrations/20260928000000_secure_user_roles.sql` in the SQL editor **before** the Phase 1 backend deploys | Closes self-registration as superadmin at the database level |

---

## Phase 1 — Authentication and authorization (backend-ts) — C

The Supabase project signs user tokens with **ES256** (verified via its public JWKS). `decodeToken` only verifies HS256, so every web-app request in production currently authenticates through the **unsigned `jwt.decode()` fallback** (`backend-ts/src/core/auth.ts:126-133`). Anyone can forge a superadmin token. Removing the fallback without adding ES256 verification would lock every web user out, so the order below matters.

| # | Change | Files | Sev | Effort |
|---|---|---|---|---|
| 1.1 | Shared helpers: `core/errors.ts` (`HttpError`, `sendError`, final error + 404 middleware), `core/ownership.ts` (`STAFF_ROLES`, `canAccessVehicle/Route/Shipment/Confirmation`, `requireVehicleAccess`) replacing 8 inline ownership copies, atomic `cacheIncr` in `core/redis.ts`, `app.set('trust proxy', 1)`, production startup assertions (no default/short secret, `SUPABASE_URL` set) | `core/*`, `index.ts` | C | M |
| 1.2 | `verifyToken`: branch on header `alg`; ES256/RS256 → verify against `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` (cached, issuer + audience checked); HS256 → verify backend-issued tokens only. Delete the legacy `SECRET_KEY` retry and the unsigned decode. Require `type==='access'` in `requireAuth`, `type==='refresh'` in `/auth/refresh`; refresh looks up `customers` for customer tokens. Add `iss` to new backend tokens | `core/auth.ts`, `routes/auth.routes.ts` | C | M |
| 1.3 | Role from the database, not `user_metadata`: `resolveSupabaseRole(uid)` mirrors the frontend (`users.role`, vendor if `vendor_profiles`/`tpl_partners` row), 60 s cache, `is_active=false` → 403, invalidated from `PATCH /users/:id`. All server `createUser` calls set `app_metadata.role` (driver, customer, invite-vendor, tpl, vehicles, `seed_admin`) | `core/auth.ts`, `auth.routes.ts`, `users.routes.ts`, `tpl.service.ts`, `vehicles.routes.ts`, `scripts/seed_admin.ts` | C | M |
| 1.4 | **Frontend changes that must deploy before 1.5–1.6**: invite-vendor via the shared `api` client (currently raw `fetch` with no token), telemetry WebSocket sends `?token=`, 3PL track/edit flow stops reading `pan_number` from the public response and sends `verify_pan`, `shipmentsAPI.updateStatus` sends `status` in the body (today it is a query param the server ignores → every status change returns 400) | `frontend/src/services/api.ts`, `SuperadminPage.tsx`, `TplTrackApplicationPage.tsx`, `TplOnboardingPage.tsx` | C | M |
| 1.5 | Lock down unauthenticated endpoints: `/tpl/*` (superadmin for queue/approve/pause/resume/delete; owner or PAN-gated for `/:id`; hardened public onboard/OTP; **never reset an existing user's password**), `POST /auth/invite-vendor` (superadmin), `POST /optimize` (staff), delete `GET /auth/driver/earnings-test`, `POST /spark-gps` (shared secret, per 0.5), WebSocket upgrade requires a staff token, `GET /shipments/:id/verify` and `/capacity/windows/:id/bid-count` require auth, mobile-session tokens expire and stop returning the phone number | `routes/tpl.routes.ts`, `services/tpl.service.ts`, `auth.routes.ts`, `optimization.routes.ts`, `spark-gps.routes.ts`, `index.ts`, `shipments.routes.ts`, `capacity.routes.ts`, `telemetry.routes.ts` | C | L |
| 1.6 | Role and ownership checks on every requireAuth-only route (one commit per router): shipments, routes, telemetry (driver actions only on own vehicle/route/stop; `complete-stop` checks ownership **before** updating), capacity (vendor bids as themselves; no fallback to "first vendor"), analytics (drop driver access to fleet-wide data), cargo, gps, vehicles, dashboard, depots, marketplace | `routes/*` | H | L |
| 1.7 | OTP hardening: `crypto.randomInt`, 6 digits for 3PL, send limit 3/10 min per phone + per-IP limit enforced **before** storing a new code, failure counter that resends don't reset, `timingSafeEqual`, 503 in production when Twilio/Resend is not configured (no OTPs in logs) | `auth.routes.ts`, `tpl.service.ts` | H | M |
| 1.8 | Vehicles: cache key per role/user and invalidated on writes; stop returning a temporary password; fix double-escaped phone regex (`/\\D/g`) via one shared `normalizeIndianPhone()` | `vehicles.routes.ts` | H | S |
| 1.9 | CORS: exact origin matching (`margixindia.com` and its subdomains, `ALLOWED_ORIGINS`, optional `CORS_ORIGIN_PATTERNS` for Vercel previews), `credentials: false`, disallowed origins no longer 500 | `index.ts` | H | S |
| 1.10 | Replace the 137 raw `e.message` responses with `sendError`; delete the `pings_debug.log` write on every driver ping | `routes/*`, `telemetry.routes.ts` | M | M |
| 1.11 | Remove the master POD OTP (`'2026'` / id-prefix) from `/cargo/verify-pod` and the UI copy that tells users to enter it (see decision D4) | `cargo.routes.ts`, `CargoNetworkPage.tsx` | C | S–M |

**Status: implemented on this branch** (1.1–1.11). Verified with typecheck/build and local end-to-end checks against a mock Supabase: forged/unsigned/wrong-issuer tokens rejected, ES256 tokens verified via JWKS with roles from the database, every locked endpoint returns 401/403 for anonymous or wrong-role callers, WebSocket requires a staff token, OTP limits and lockout behave as specified.

### Deploy checklist for Phase 1

Deploy the **frontend and backend together** (the frontend now sends tokens on calls the backend newly requires them for). Before deploying backend-ts, on Railway (names only — do not paste values anywhere):

| Variable | Required | Notes |
|---|---|---|
| `SUPABASE_URL` | yes | JWKS for ES256 verification is fetched from it; startup fails in production without it |
| `SUPABASE_JWT_SECRET` or `SECRET_KEY` | yes | ≥ 32 characters; signs driver/customer OTP tokens. Keep the current value so existing driver sessions stay valid; startup fails in production if missing/weak |
| `ALLOWED_ORIGINS` | yes | Must include `https://margixindia.vercel.app` (and any custom frontend domain). `*.vercel.app` is no longer allowed implicitly |
| `CORS_ORIGIN_PATTERNS` | optional | Regex for this project's Vercel preview URLs |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` | yes | In production, OTP requests now return 503 instead of silently logging the code when these are missing |
| `RESEND_API_KEY` | yes (3PL) | 3PL password-setup emails return 503 in production without it |
| `SPARK_GPS_PUSH_SECRET` | if push is used (0.5) | Give the same value to Roadcast; `/spark-gps` returns 503 in production without it |

Production mode is detected from `APP_ENV=production`, `NODE_ENV=production` or Railway's `RAILWAY_ENVIRONMENT_NAME=production`.

Behaviour changes users may notice: 3PL applicants enter their PAN to edit an application and receive a 6-digit code; the password minimum is 10 characters; drivers/vendors lose access to fleet-wide screens they were never meant to see; the control tower's POD panel is now a plain "confirm delivery" form. In the current driver app build, the backhaul bid counter shows 0 (it calls an endpoint that now requires a token without sending one) until the Phase 3 release.

## Phase 2 — Database: reproducible schema and row-level security — C

Production was edited by hand: `tpl_partners`, `tpl_corridors`, `tpl_documents` and `customers` exist in no SQL file; `cargo_manifest`, `sos_alerts`, `kyc_profiles`, `system_settings` exist only in loose scripts; migrations start at `002`, reuse version numbers (014, 015, 022, 20260907), include a UTF-16 file and an empty file.

| # | Change | Sev | Effort |
|---|---|---|---|
| 2.1 | **(you)** `supabase link` + `supabase db dump --schema public,storage --linked` into `supabase/migrations/<ts>_baseline.sql`; then I archive the old migrations and loose SQL (`scripts/supabase_init.sql`, `backend-ts/kyc_migration.sql`, `backend-ts/scripts/*.sql`) under `supabase/migrations/_archive/`; **(you)** `supabase migration repair --status applied <ts>` | H | M |
| 2.2 | Secure `handle_new_user`: role only from `raw_app_meta_data` (service-role only), self-signup allowlisted to `vendor`, customers skipped; `REVOKE UPDATE (role, is_active) ON users FROM anon, authenticated`; add `public.current_app_role()` (SECURITY DEFINER, reads `users`) | C | S |
| 2.3 | RLS hardening: replace `USING (true)` on `capacity_windows`, `capacity_bids`, `driver_confirmations`, `cargo_manifest`, `gps_points`, `ai_agent_logs`, `invoices`, `payments` with owner/role policies; drop `GRANT ALL … TO anon` on vendor tables; `vehicles` readable only by owner driver + staff (vendors get a view without driver PII); `sos_alerts` insert only for own driver; fix the superadmin policies that compare the JWT `role` claim and the 3PL policies that compare `partner_id` to `sub`; revoke anon execute on `calculate_distance` / `match_vendors_to_route`; add `driver_confirmations` to the realtime publication (driver app subscribes to it) | C | L |
| 2.4 | KYC: move `vendor_profiles.dummy2` (JSON in a text column, 8 read/write sites) to `kyc_data jsonb` + admin-only `kyc_status`; close the `kyc_profiles` self-approve hole; **(you)** set the `kyc_documents` bucket back to private, and switch the 3 `getPublicUrl` call sites to signed URLs | C | M |
| 2.5 | Align enums with code, per case: shipment `assigned`/`exception`, vehicle `active` (code should use existing values), `vendor_shipment_requests` `fulfilled` vs `assigned`, `user_role` has no `customer`; `routes.depot_id` NOT NULL vs 4 inserts without it | M | M |

---

**Status: migrations and code on this branch; applying them is yours** (runbook: `supabase/README.md`).
- `20260928000000` (roles from app_metadata), `…0100` (KYC columns, one-time backfill), `…0200` (deny-by-default RLS, field guards, private KYC bucket), `…0300` (status alignment).
- Verified in a local Postgres 15/16 built from the repo's schema history plus the prod-only tables: all four apply cleanly and re-apply idempotently; 141 role-by-role checks pass (anon, drivers, vendor, 3PL partner, admin/manager/superadmin, inactive admin, service role, signup trigger, KYC backfill, no policy recursion).
- Frontend reads KYC from the new columns and opens documents through signed URLs; superadmins can now open 3PL applicants' documents.
- Known follow-ups: vendors see full vehicle rows (incl. driver phone, live position) for open windows — replace with a column-limited view; a verified vendor can edit company name/GST without re-verification; managers can approve KYC (matches backend staff roles — confirm intended); anonymous 3PL applicants can upload any file under `tpl-applications/` (move to backend-issued signed upload URLs).

## Phase 3 — Driver app release, then key rotation — C

The driver app ships the Supabase **service_role** key (bypasses all RLS). It cannot be rotated until a release stops using it.

| # | Change | Effort |
|---|---|---|
| 3.1 | Backend-issued tokens: top-level `role: 'authenticated'`, app role in `user_metadata`, so Supabase accepts them for the driver's own direct calls under RLS | S |
| 3.2 | Driver app uses the anon key + `supabase.auth.setSession()` after OTP login; its direct reads/writes (`vehicles`, `telemetry`, `driver_confirmations`, `users.push_token`, realtime channels) work under the Phase 2.3 policies | M |
| 3.3 | Config from `EXPO_PUBLIC_*` env (API URL, Supabase URL/anon key, Maps key) instead of source; tokens in `expo-secure-store` | M |
| 3.4 | Fixes: push `projectId` from `Constants.expoConfig.extra.eas.projectId` (currently a different project → pushes silently fail); remove earnings-test fallback (shows another driver's earnings); bid-count via the authenticated client; language sync storage key; dedupe `sos_*` locale keys; `expo-crypto` UUIDs; `confirmCapacity` calls a non-existent endpoint; POD "signature" (decision D5); add iOS `bundleIdentifier` | M |
| 3.5 | **(you)** Publish the release, wait for adoption, then rotate the service_role key and the backend signing secret; update Railway / ml-service env | — |

---

**Approach (implemented on this branch):** instead of making backend-issued tokens acceptable to Supabase (which depends on the legacy HS256 secret the project is moving away from), `POST /auth/driver/verify-otp` also returns a real Supabase session (`supabase_session`) created server-side. The new driver app signs in to Supabase with it, uses the anon/publishable key under the Phase 2 policies, and sends the same token to the API. Existing builds keep receiving backend tokens until they update.

### Release and key rotation (you)

1. Apply the Phase 2 migrations and deploy backend-ts (the session is issued by the backend).
2. Build the new driver app with EAS (native modules changed, so this is a store/internal build, not an OTA update). Set these as EAS environment variables: `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (publishable/anon key — never the service role), `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`. Restrict the Maps key to the app's package name and signing certificate in Google Cloud.
3. Existing drivers log in once more after updating (their old tokens are cleared).
4. When drivers are on the new build, retire the leaked key:
   - Supabase Dashboard → Settings → API Keys: create a **publishable** key and a **secret** key.
   - Railway: set backend-ts and ml-service `SUPABASE_SERVICE_ROLE_KEY` to the new secret key and `SUPABASE_ANON_KEY` to the publishable key; update the frontend's `VITE_SUPABASE_ANON_KEY`, the driver app's `EXPO_PUBLIC_SUPABASE_ANON_KEY` and the customer app's local `.env` to the publishable key.
   - Then **disable the legacy JWT-based API keys**. This invalidates the service-role key shipped in old driver builds and in git history. It does not change the JWT signing keys, so web and driver sessions stay valid.
   - Old driver builds stop working at this point (their direct Supabase writes used the legacy key) — only do this once drivers have updated.
5. Replace `SECRET_KEY` on Railway with a new random value (the old one is in git history); it is only a fallback when `SUPABASE_JWT_SECRET` is set.

## Phase 4 — Correctness bugs (backend-ts) — H/M

| # | Bug | Fix | Effort |
|---|---|---|---|
| 4.1 | `approveBid` has no status guard: a double click duplicates shipments, manifests and stops | Claim with `update … eq('status','pending')`, then a single Postgres RPC for the cascade | M |
| 4.2 | Bidding windows never auto-resolve: `resolveWindow` / `checkConfirmationsTimeout` are never called | Schedule them (interval job like the fleet monitor) | S |
| 4.3 | `injectCapacityStop` returns a random UUID → `driver_confirmations` rows point at non-existent stops | Create the real `route_stops` row (logic already exists in `approveBid`) | M |
| 4.4 | Fleet health: 10 s offline threshold checked every 5 s vs 10–60 s ping cadence → vehicles flap offline with critical alerts; `select('*')` every 5 s | ~100 s threshold, 20 s interval, explicit columns | S |
| 4.5 | Supabase errors ignored (supabase-js does not throw); invalid enum writes fail silently | `assertNoError` helper on mutations; values per 2.5 | M |
| 4.6 | `matching.service` selects non-existent columns and writes `shipment_logs` without hash fields (runs on every shipment create); `reoptimize` reads non-existent `vehicle_telemetry` → always Delhi; `trigger-alert` uses a random vehicle id | Correct columns/table; use the shared hash-chain writer; require a real vehicle | S–M |
| 4.7 | GETs with side effects: `my-route` deletes routes, `upcoming-stops` inserts hubs and appends a `mock-123` stop | Read-only GETs; mutations to explicit endpoints; delete the mock stop | S–M |
| 4.8 | `listUsers()` only sees the first 50 users (driver/customer/3PL lookups); `getPublicTracking` loads every manifest; ML calls have no timeout; driver profile always saves `vehicle_type='truck'`; `geofence_alert` always `null` | Targeted lookups; indexed short id; `AbortController` 10 s; use submitted value; implement or remove the field | S each |

---

## Phase 5 — Replace fabricated data and fix the web app — M

- **Backend mock/random data** (decision D2): `cargo.routes.ts` (static `SCENARIOS`, random scores and coordinates, `profitability_index: 92.5`), `analytics.service.ts` (random on-time rate, invented deltas, "all-time mock" overview), `dashboard.routes.ts` (95 % fallback, invented fuel/reroute figures), `traffic.routes.ts` (random minutes saved), `marketplace.routes.ts` (mock `price_usd`), `spark-gps.service.ts` (hardcoded plates, `mockSyncForDemo` writing fake telemetry), `telemetry.routes.ts` (mock SOS config), earnings invoices all marked `paid`.
- **Frontend**: `AdvancedAnalyticsTab` charts come from a seeded PRNG → wire to existing `/analytics/driver-performance` and `/analytics/vendor-performance`; `TplNetworkPage` renders a mock `queueData` escalation queue; 13 hardcoded `margixindia.vercel.app` URLs → shared `api` client and relative `/map-style.json` etc.; AI Hub buttons call `/agents/*`, which no longer exists anywhere (decision D1).
- **Routing/auth**: guard `/vendor/*`, remove duplicate `/vendor/login`, move `/live-map` inside the layout, wait for session hydration before `PrivateRoute` redirects, single token store (Supabase only), `Badge` `green` renders yellow.
- **Type errors** (CI fails until fixed): `CargoNetworkPage` calls non-existent `vehiclesAPI.getAll` (runtime crash), plus 4 others in `CargoNetworkPage`, `AddShipmentModal`, `RoutesPage`.

## Phase 6 — Customer app (decision D3)

Only login talks to the backend. Remove fabricated content (default name "Maya", static rewards, static notifications, dead "Continue to Pricing" button, dead Bookings/Rewards/Profile tabs) or show honest empty states; read `EXPO_PUBLIC_API_URL`; remove the unused Supabase client; add `eas.json`. The booking/pricing/tracking flow is a feature that needs new backend endpoints — scoped separately.

## Phase 7 — Tests and CI

- Split `backend-ts/src/app.ts` (`createApp()`) from `index.ts` (listen/ws/jobs); add `vitest` + `supertest`; cover the auth matrix (forged/unsigned token, ES256 user, backend HS256, refresh-as-access, forbidden role per router).
- Add an ESLint config for `frontend` (the `lint` script has none); add tests to CI.

---

## Rollout order

1. Phase 0 (you) → 2. Phase 2.2 (trigger + revoke) → 3. Phase 1.4 frontend → 4. Phase 1.1–1.3 backend, with temporary auth-path logging → 5. Phase 1.5–1.11 → 6. Phase 2.1, 2.3–2.5 → 7. Phase 3, then key rotation → 8. Phases 4–7.

Each step is a small commit on this branch; every commit keeps `backend-ts` typecheck/build and `frontend` build green.

## Decisions (2026-09-28)

- **D1** AI Hub risk-analysis / cargo-monitoring: **remove** the buttons and the two `optimizationAPI` methods.
- **D2** Metrics with no real data source: **remove** the tiles/fields; show only metrics computed from real data.
- **D3** Customer app: **strip fabricated content** now; the booking flow is a separate feature.
- **D4** Proof of delivery: **restrict `/cargo/verify-pod` to staff and remove the demo/master codes**.
- **D5** Driver POD "signature": open — defaults to relabelling as "Receiver name" unless real signature capture is requested.
