# UX plan, round 2: from consistent to dependable

Status: proposed, 2026-09-29. Follows [ui-plan.md](ui-plan.md), which is complete and live on `main`.

Round 1 made the product look and read the same everywhere. Round 2 is about trust and daily speed:
- every number and label is correct
- a shipment's full story is visible
- common tasks take fewer clicks
- the app loads fast
- nothing is broken that tests can't see

Each item below was found on the live app or in the live database on 2026-09-29.

## A. Safety net first: queries that don't match the database

**Why:** vendors couldn't load or bid on capacity windows because two queries asked for a `vehicles.city` column that doesn't exist. The tests passed because the mock database accepts any column. There may be more.

| Step | What | Done when |
|------|------|-----------|
| A1 | Script `backend-ts/scripts/check-queries.ts` that collects every `.from('table').select('…')` / `.insert`/`.update` column list in `backend-ts/src` and `frontend/src`, and checks each table and column against the live schema (`information_schema`, read-only, via `DATABASE_URL`). | Script lists every mismatch |
| A2 | Fix every mismatch it finds (query, UI field, or a real missing migration). | Script reports zero mismatches |
| A3 | Teach the mock Supabase server the real column list (generated from the schema), so a test fails when a query names an unknown column. | A test with a bad column fails |

## B. Numbers and labels that read wrong

| Step | What | Where | Done when |
|------|------|-------|-----------|
| B1 | **"Active shipments"** is `shipments.length` and falls back to the *vehicle* count. It should count shipments that aren't delivered or cancelled, using the same rule as the Shipments tabs. | `DashboardPage.tsx:103` | All 40 shipments are delivered, so the tile shows 0 |
| B2 | **"Recent shipments – currently in transit"** lists delivered ones. Either filter to in-transit, or rename it "Latest shipments". | `DashboardPage.tsx:224` | The title matches its rows |
| B3 | **Origin shows "Origin pending"/"—"** although 37 of 40 shipments have an origin. The page reads the wrong field names from the list API, the same kind of bug as the earlier `delivery_point` vs `delivery_points` one. | `DashboardPage.tsx:140`, Shipments pickup column, list endpoint | Origins show for every shipment that has one |
| B4 | **Draft vehicles** (TEMP-… plates, status `archived`) are listed as "Vehicle offline" in "Needs attention". Exclude drafts and archived vehicles. | Dashboard attention list | Only live vehicles that stopped reporting appear |
| B5 | A copy check of every page for "—" placeholders where a real value exists, and for labels that don't match their data. | All pages | A reviewed list, all fixed |

## C. The whole story of a shipment

| Step | What | Done when |
|------|------|-----------|
| C1 | **Status history** in the shipment drawer and on public tracking, from the existing `shipment_logs` table: booked, assigned, picked up, in transit, delivered, each with time and who did it. | Each shipment shows a timeline with real times |
| C2 | **Proof of delivery** shows who received it, when, where (map pin), and the signature or photo if one was captured, instead of "Signature: Done". | Delivered shipments show real proof-of-delivery details |
| C3 | **Safe delete:** delivered or in-transit shipments can't be deleted. Offer Cancel (before pickup) or Archive instead, enforced in the backend as well. | The API refuses delete for delivered shipments, and the UI hides the button |

## D. Faster everyday work

| Step | What | Done when |
|------|------|-----------|
| D1 | **Global search** (Ctrl/⌘+K and a search box in the header): tracking IDs, plates, drivers, vendors and 3PL partners, jumping straight to the record. It uses a backend endpoint limited to staff. | Typing a plate or ID opens the record |
| D2 | **Notifications bell** for staff: SOS, new vendor requests, bids waiting for a decision, KYC submitted, 3PL applications. It uses the existing `notifications` table and realtime, with an unread count and mark as read. | New events show up in the bell without a reload |
| D3 | **Export to CSV** on Shipments, Fleet, Routes, Bids, Vendor requests and Audit log. It exports what the current filters show. | The downloaded file matches the table |
| D4 | **Filters and search remembered in the URL** on every list, so back/forward and shared links keep the view. | Reload keeps the tab, search and sort |
| D5 | **Create shipment:** a small map preview of pickup, stops and destination, and recently used addresses. | The route preview matches the chosen places |

## E. Speed

| Step | What | Done when |
|------|------|-----------|
| E1 | **Load pages on demand.** Today about 2 MB of JavaScript loads on the first visit (the app, map and chart bundles) and no page is lazy-loaded. Split by route with `React.lazy` and a page skeleton, so maps and charts load only on pages that use them. | The sign-in and landing pages load under 300 KB of JS |
| E2 | **Prefetch** the next likely page on hover of navigation links. | Navigating feels instant after the first visit |
| E3 | **Maps:** show the base map before markers and directions finish, and cache directions per route. | The map shows within a second on a normal connection |

## F. Mobile apps, seen running

| Step | What | Done when |
|------|------|-----------|
| F1 | Run both apps on the iOS simulator (and Android if the emulator is available). Walk every screen: sign-in, home, route, delivery, SOS, account. Screenshot at small and large phone sizes. | Screens reviewed with screenshots |
| F2 | Fix what that finds: layout, text size, tap targets, safe areas and loading states. | Re-checked in the simulator |
| F3 | A local Android release APK of the driver app for testing on a real phone. The store build still needs the signing key in the Expo account. | APK installs and signs in |

## Order and parallel work

All work is on `ui/redesign`, one commit per step, merged to `main` after checks pass.

| Batch | Runs in parallel | Model |
|-------|------------------|-------|
| 1 | A (schema check and fixes) · B (numbers and labels) | Sonnet |
| 2 | C (shipment story) · D1–D2 (search, notifications) · E (speed) | Sonnet |
| 3 | D3–D5 (export, filters, map preview) · F (mobile) | Sonnet |

Every batch ends with:
- type-check, zero lint warnings, build, and the backend tests
- a browser check of the changed pages at 375, 1280 and 1440 px against the local backend
- a push to `main`
