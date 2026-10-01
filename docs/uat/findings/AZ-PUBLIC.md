# AZ-PUBLIC: unauthenticated test of the hosted Azure deployment

Date 2026-10-01. Targets: API `https://margix-api.graywave-14c2046e.centralindia.azurecontainerapps.io`, web `https://gentle-plant-0cd625000.5.azurestaticapps.net`.
Method: curl only (`-4`), no sign-in, at most about 4 requests per second, no flooding.

## Summary

No blocker. Authentication holds: of 366 API routes probed with no token, 344 refused with 401 and the other 22 are the intended public ones (listed below). Bad, empty, expired, `alg:none` and wrongly signed JWTs all get a clean 401. Public tracking returns a clean 404 for a random UUID, a malformed id, SQL-looking input and a 3000-character id, with no stack trace. CORS reflects only the Azure web origin and margixindia.com; `https://evil.example`, `null` and `margixindia.com.evil.example` get no CORS headers. The web bundle has no secrets (only the Supabase publishable key, which is meant to be public) and calls the Azure API. All 72 web routes in App.tsx return 200 with the SPA.

One 500 found (any param route with a bad percent-escape). The rest are rough edges and gaps.

| # | Sev | Title |
|---|-----|-------|
| AZP-01 | Major | A bad percent-escape in a URL (`%ZZ`) gives a 500 on every route with a path parameter, including public tracking |
| AZP-02 | Minor | Source maps are served publicly with the full source of the web app |
| AZP-03 | Minor | The web app sends no clickjacking or CSP headers (no X-Frame-Options, no frame-ancestors) |
| AZP-04 | Minor | Public tracking returns internal ids, the vehicle plate and the live position |
| AZP-05 | Minor | `/ready` reports `database: ok` without checking the database |
| AZP-06 | Minor | The client's `X-Request-ID` is echoed unchecked |
| AZP-07 | Minor | Unknown web paths return 200 (soft 404) |
| AZP-08 | Gap | No rate limit on `/auth/refresh`; logout does not revoke; limits fall back to per-process memory |
| AZP-09 | Gap | No `robots.txt` on the web app; the API has no CSP, no Permissions-Policy |

## Results by check

### 1. API routes without a token (all methods, every route in `backend-ts/src/routes`, mounted per `routes/index.ts`, ids replaced with a UUID, body `{}`)

| Status | Count | What |
|---|---|---|
| 401 | 344 | `{"detail":"Missing or invalid Authorization header"}` (includes the 16 `fleet-maintenance` routes, re-run with correct paths) |
| 200 | 2 | `POST /auth/logout` (stateless), `GET /public/stats` (counts only: `{"vehicles":2,"deliveries_completed":9,"active_partners":0,"cities_served":8}`) |
| 400 | 11 | OTP send/verify (4), `/auth/refresh`, `/tpl/onboard`, `/tpl/applications/upload-url`, `/tpl/auth/send-otp`, `/tpl/auth/setup-password`, `/bank/ifsc/:code` (all validation messages, no leak) |
| 404 | 7 | `/shipments/track/:id` and `/route`, `/telemetry/mobile-push|mobile-session/:token`, `/tpl/:id` GET and PATCH, `/public/vehicle-share/:token` |
| 503 | 2 | `/spark-gps` ("GPS push is not configured"), `/telematics/webhook` ("not configured"): secret-guarded, refused without the secret |
| 200 | 1 | `POST /gstin/verify` with `{"gstin":"x"}` gives a format check, no data leak (rate limited 30/10 min) |

No non-public route answered 200, and none returned data. Not exercised blind: nothing was sent that would trigger an SMS (OTP requests were sent with an empty body, which fails validation first).
Vendor sign-up and onboarding are not public API routes on this build (every `/vendor/*` route gave 401); only 3PL onboarding is public (`/tpl/onboard`, `/tpl/auth/*`, `/tpl/applications/upload-url`, `/tpl/:id` with the PAN as proof).

Bad tokens (on `/api/v1/users` and `/api/v1/shipments`), all clean 401:
- `Bearer abc`, `Bearer a.b.c`, `Bearer null`: `{"detail":"Invalid or expired token"}`
- `Bearer ` (empty) and `Basic abc`: `{"detail":"Missing or invalid Authorization header"}`
- an expired-looking JWT (`exp:1600000000`, junk signature): 401
- an unsigned `alg:none` token claiming `superadmin`: 401
- an HS256 token signed with the key `secret`, claiming `superadmin`: 401
- WebSocket `/api/v1/telemetry/ws` over HTTP/1.1 with no token and with `?token=abc`: `HTTP/1.1 401 Unauthorized` (code: app.ts upgrade handler)

### 2. Public tracking
- Random UUID: `GET /api/v1/shipments/track/b53f1ce5-5f9a-40e0-994c-0de3c021c3d0` -> 404 `{"detail":"Shipment with this tracking ID not found"}`; `/route` the same.
- `abc`, `CM-ZZZZZZZZ`, `CM-abcdef12`, `RTX-%27%22;--`, a 3000-character id: all the same clean 404. `%00`: 400 with an empty body (from the ingress).
- `%ZZ`: **500**, see AZP-01.
- Fields exposed (`ShipmentService.getPublicTracking`, `backend-ts/src/services/shipment.service.ts:1633-1790`): id, tracking_id, status, priority, total_items, total_weight_kg, origin name/address/lat/lng, destination name/address/lat/lng, vehicle {id, plate_number, type, status, lat, lng}, eta_minutes, history [{status, at}]. No customer phone or email, no prices, no driver name or phone, no vendor. Matches the comment on the route. See AZP-04 for the rest.
- A live shipment was not available to read, so the field list is from code, not from a real response.

### 3. Error hygiene, headers, CORS
- Error bodies seen (about 400 requests): only `{"detail": ...}` or `{"error": ...}` with short messages; the 500 body is `{"detail":"Internal server error","request_id":"..."}`. No stack, SQL or hostname anywhere. Malformed JSON gives `400 {"detail":"Malformed JSON body"}`.
- API headers (`curl -D - /health`): `strict-transport-security: max-age=31536000; includeSubDomains`, `x-content-type-options: nosniff`, `x-frame-options: SAMEORIGIN`, `referrer-policy: no-referrer`, `cross-origin-opener-policy/resource-policy: same-origin`. Good. (CSP is off in app.ts:84, fine for a JSON API.)
- Web headers (`curl -D - /login`): `strict-transport-security: max-age=10886400; includeSubDomains; preload`, `x-content-type-options: nosniff`, `referrer-policy: same-origin`. Missing: frame protection, see AZP-03.
- CORS, simple and preflight (`OPTIONS /api/v1/users`):
  - `Origin: https://gentle-plant-0cd625000.5.azurestaticapps.net` -> `access-control-allow-origin` echoes it (204 preflight, methods GET,POST,PUT,PATCH,DELETE,OPTIONS). Allowed.
  - `https://margixindia.com` -> allowed.
  - `https://evil.example`, `https://margixindia.com.evil.example`, `null` -> no `access-control-allow-origin` header. Not reflected.
  - `access-control-allow-credentials` is not sent (Bearer-only, as designed).

### 4. Web app
- All 72 paths from App.tsx (params replaced by `abc`) -> 200 `text/html`, 1389 bytes, the SPA shell. Includes `/shipments/abc`, `/fleet/xyz`, `/track/abc`, `/m/tok`, `/share/tok`, `/3pl-portal/activate`, `/vendor/login`.
- Missing assets: `/assets/nope.js`, `/nope.png`, `/geo/nope.json`, `/robots.txt` -> 404 (the `staticwebapp.config.json` exclusions work; the 404 body is an HTML error page of 2400 bytes, which does not break anything).
- Bundle: 153 JS chunks (index, vendor, 151 lazy chunks) downloaded and searched. `service_role`: none in the shipped JS. `sk_live`/`sk_test`/private keys/AKIA/Twilio: none. `eyJ...` JWTs: none. The only credential-shaped string is `sb_publishable_HqsWylfok2BD7EOtiEpV1g_lKhSlFLL` for `https://plutdajzefwtpgofpqlk.supabase.co` (a publishable key, role anon by design, not a JWT). The `localhost:9999` string is the supabase-js library default, not config.
- API URL in the bundle: `let vt="https://margix-api.graywave-14c2046e.centralindia.azurecontainerapps.io"`. No Railway or localhost API URL. The only other external hosts: Google, ArcGIS, CARTO, wa.me, Supabase.

### 5. Latency (5 calls each, seconds, from this machine)
| Endpoint | p50 | max |
|---|---|---|
| `/health` | 0.107 | 0.162 |
| `/ready` | 0.126 | 0.156 |
| `/api/v1/public/stats` (cached) | 0.113 | 0.211 |
| `/api/v1/shipments/track/RTX-NOPE0000` (DB lookup, 404) | 0.388 | 0.498 |
| `/api/v1/public/vehicle-share/abc` (DB lookup, 404) | 0.387 | 0.440 |

All warm. The first request after idle was not measured (the container may scale to zero).

### 6. Rate limiting (read from code only)
`core/rate-limit.ts` (fixed window in Redis through `cacheIncr`, per IP or per user), `routes/auth.routes.ts`:
- `driver|customer/send-otp`: 10 per hour per IP, plus 3 codes per phone per 10 min (`OTP_SENDS_PER_WINDOW`, line 99). Limits are checked before a new code is stored.
- `driver|customer/verify-otp`: 30 per hour per IP, 5 wrong guesses per code, 10 wrong guesses per phone per hour (`OTP_FAILURES_PER_HOUR`); codes are compared with `safeEqual`. 
- `tpl/onboard` 5/h/IP, `tpl/auth/send-otp` 10/h, `tpl/auth/setup-password` 20/h, `tpl/:id` 60/min plus 10 PAN tries per 15 min per partner and IP.
- Public: track 60/min, track route 30/min, vehicle-share 120/min, stats 60/min, gstin 30/10 min, ifsc 60/10 min, mobile-push 300/min.
- Staff login goes through Supabase Auth (its own limits), not this API.
Limits exist. Not confirmed live by design. See AZP-08 for the weak spots.

## Findings

### AZP-01 · Major · A bad percent-escape in a URL gives a 500 on every route with a path parameter
- **Where:** Express param decoding, error path in `backend-ts/src/core/errors.ts:60-65` (`errorHandler` treats a `URIError` as a generic 500). Affects all `:param` routes, including the public `GET /api/v1/shipments/track/:tracking_id` (`routes/shipments.routes.ts:55`).
- **Steps:**
  `curl -4 -s -w ' [%{http_code}]\n' 'https://margix-api.graywave-14c2046e.centralindia.azurecontainerapps.io/api/v1/shipments/track/%ZZ'`
  `curl -4 -s -w ' [%{http_code}]\n' 'https://margix-api.graywave-14c2046e.centralindia.azurecontainerapps.io/api/v1/users/%ZZ'`
- **Expected / Actual:** Expected 400 (or 404). Actual 500 `{"detail":"Internal server error","request_id":"f0f7a8dc-aad5-4b68-a4e2-1e146c4f0be0"}`. Routes with no param (`/api/v1/nope/%ZZ`) give a clean 404. The 500 is reachable without a token on the public tracking route, so it shows up in error monitoring and error-rate alerts and can be used to fill the logs.
- **Fix idea:** In `errorHandler`, map `err instanceof URIError` (or `err.status === 400` / `err.type === 'entity.parse.failed'` style `statusCode`) to `400 {"detail":"Malformed URL"}`; Express sets `err.status = 400` on a decode failure, so `sendError` can honour `err.status < 500` for non-`HttpError` errors.

### AZP-02 · Minor · Source maps are served publicly with the full source of the web app
- **Where:** `frontend/vite.config.ts:79` (`sourcemap: true`); `//# sourceMappingURL=index-B_DBzQnb.js.map` at the end of the main bundle.
- **Steps:** `curl -4 -s -o m.map -w '%{http_code} %{size_download}\n' https://gentle-plant-0cd625000.5.azurestaticapps.net/assets/index-B_DBzQnb.js.map`
- **Expected / Actual:** Expected no public maps (or a 404). Actual 200, 2,208,150 bytes, valid source map v3 with `sourcesContent` for 228 files (`../../src/store/authStore.ts`, `../../src/services/api.ts`, ...). No secret is in it (checked for service_role, sk_live, private keys), but it hands out every client route, role check and API call, and makes the bundle easy to read.
- **Fix idea:** Set `sourcemap: false` for the production build, or `'hidden'` and upload the maps to the error tracker only; delete `*.map` from the deploy.

### AZP-03 · Minor · The web app sends no clickjacking or CSP headers
- **Where:** `frontend/public/staticwebapp.config.json` (`globalHeaders` only has `X-Content-Type-Options`).
- **Steps:** `curl -4 -s -D - -o /dev/null https://gentle-plant-0cd625000.5.azurestaticapps.net/login`
- **Expected / Actual:** Expected `x-frame-options` or `content-security-policy: frame-ancestors`. Actual headers: `strict-transport-security`, `referrer-policy: same-origin`, `x-content-type-options: nosniff`, `x-xss-protection: 1; mode=block`, `x-dns-prefetch-control: off`. The login, driver delivery-code and finance pages can be framed by any site.
- **Fix idea:** Add to `globalHeaders`: `"X-Frame-Options": "DENY"`, `"Content-Security-Policy": "frame-ancestors 'none'"` (then a fuller CSP once the Supabase, map tile and Google hosts are listed), `"Permissions-Policy": "geolocation=(self), camera=(self)"`.

### AZP-04 · Minor · Public tracking returns internal ids, the vehicle plate and the live position
- **Where:** `backend-ts/src/services/shipment.service.ts:1653-1690` (loads) and `:1708-1752` (shipments).
- **Steps:** `curl -4 -s https://margix-api.graywave-14c2046e.centralindia.azurecontainerapps.io/api/v1/shipments/track/<real tracking id>` (code read only; no live id was available to test).
- **Expected / Actual:** No customer phone, email, price or driver details are exposed, as intended. But the body also carries `id` (the internal shipment UUID), `vehicle.id`, `vehicle.plate_number`, and `vehicle.lat/lng` for the whole trip. The `CM-` load ids are only `CM-` plus 8 hex characters (32 bits) of the UUID (`:1640`), which is a short secret for something that shows a live truck position; the 60 per minute per IP limit slows guessing from one address only.
- **Fix idea:** Drop `id` and `vehicle.id` from the public body (the page uses `tracking_id`); decide whether the plate should show (courier sites usually do not); consider a longer random id for `CM-` links, or a share token like vehicle-share.

### AZP-05 · Minor · `/ready` reports `database: ok` without checking the database
- **Where:** `backend-ts/src/app.ts:121-130`.
- **Steps:** `curl -4 -s https://margix-api.graywave-14c2046e.centralindia.azurecontainerapps.io/ready`
- **Expected / Actual:** Expected the database to be checked. Actual `{"status":"ready","redis":"ok","database":"ok"}`; the handler only runs `redis.ping()` and the string `database: ok` is hardcoded. When Supabase is down, the platform probe still says ready (and when Redis is not configured it also says `redis: ok`).
- **Fix idea:** Run a cheap query (`supabase.from('users').select('id').limit(1)`) and report the real state per dependency; return 503 when the database fails.

### AZP-06 · Minor · The client's `X-Request-ID` is echoed unchecked
- **Where:** `backend-ts/src/app.ts:71-76`.
- **Steps:** `curl -4 -s -D - -o /dev/null -H 'X-Request-ID: <script>alert(1)</script>' https://margix-api.graywave-14c2046e.centralindia.azurecontainerapps.io/health` (also a 5000-character value).
- **Expected / Actual:** Expected a generated UUID when the value is not a plain id. Actual `x-request-id: <script>alert(1)</script>` (and the 5000 characters, and a non-ASCII value) is returned and used in logs and 500 bodies (`request_id`). Allows log forging and makes support lookups by id unreliable. Not exploitable as XSS (JSON, nosniff).
- **Fix idea:** Accept the header only when it matches `/^[A-Za-z0-9._-]{8,64}$/`, otherwise use `uuidv4()`.

### AZP-07 · Minor · Unknown web paths return 200 (soft 404)
- **Where:** `frontend/public/staticwebapp.config.json` `navigationFallback` (plus `path="*"` in `frontend/src/App.tsx`).
- **Steps:** `curl -4 -s -o /dev/null -w '%{http_code}\n' https://gentle-plant-0cd625000.5.azurestaticapps.net/nonexistent/deep/path`
- **Expected / Actual:** Expected the app to show its not-found page; a 404 status is not possible with a plain SPA fallback. Actual 200 with the SPA shell for any path, so search engines and uptime checks see "OK". Deep links like `/shipments/abc` correctly load (required), so this is only cosmetic.
- **Fix idea:** Accept as is, or list the known top-level prefixes in `routes` with a 404 for the rest; add `<meta name="robots" content="noindex">` to the logged-in pages.

### AZP-08 · Gap · No rate limit on `/auth/refresh`; logout does not revoke; limits fall back to per-process memory
- **Where:** `backend-ts/src/routes/auth.routes.ts:417` (`/refresh`, no `rateLimitByIp`), `:462` (`/logout` only returns a message), `backend-ts/src/core/redis.ts:154-172` (`cacheIncr` falls back to an in-memory map when Redis errors).
- **Steps:** `curl -4 -s -X POST -H 'Content-Type: application/json' -d '{"refresh_token":"abc"}' https://margix-api.graywave-14c2046e.centralindia.azurecontainerapps.io/api/v1/auth/refresh` (one call only; not flooded).
- **Expected / Actual:** Expected every unauthenticated token endpoint to have a limit, and a stolen refresh token to be revocable. Actual: `/refresh` verifies a signature and reads the database for any caller with no limit (cheap to abuse), a logged-out refresh token stays valid until expiry, and if Redis has a hiccup each replica of the container app counts on its own, so OTP and PAN limits become per replica.
- **Fix idea:** Add `rateLimitByIp('refresh', 60, 600)`; keep a revoked-token list (or token version on the user) checked in `/refresh` and `authenticateToken`; log a warning (and optionally fail closed for OTP) when the Redis fallback is used.

### AZP-09 · Gap · No `robots.txt`; no `Permissions-Policy`
- **Where:** `frontend/public/` (no `robots.txt`).
- **Steps:** `curl -4 -s -o /dev/null -w '%{http_code}\n' https://gentle-plant-0cd625000.5.azurestaticapps.net/robots.txt`
- **Expected / Actual:** Expected a `robots.txt` that keeps `/track/*`, `/m/*` and `/share/*` out of search results. Actual 404.
- **Fix idea:** Add `frontend/public/robots.txt` with `Disallow: /track/`, `/m/`, `/share/`, `/vendor`, `/driver`, and add `robots.txt` to nothing in the fallback exclude list (it is already there).
