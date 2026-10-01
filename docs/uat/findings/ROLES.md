# UAT findings: customer, driver and vendor / 3PL roles

Pass 1, 1 Oct 2026, on the throwaway stack that `.github/workflows/uat.yml` builds on a GitHub runner (the
75-step story passed 75/75 before each scenario). Branch `uat/roles-scenarios`; no app code was changed.

| Area | Script | Final run | Checks (pass / fail) |
| --- | --- | --- | --- |
| Customer | `e2e/scenarios/CUST.sh` | 36831959729 | 211 / 13 |
| Driver | `e2e/scenarios/DRV.sh` | 36831969393 | 268 / 8 |
| Vendor and 3PL | `e2e/scenarios/VND.sh` | 36833202567 | 312 / 9 |

Evidence is in each run's artifact (`out/scenario.txt`, `shots/`): `gh run download <id> --repo prudatatech/RouteIQ -n uat`.
Every check prints `CHECK <id> PASS|FAIL <what> | <evidence>`; the ids below (CD02, DS34 ...) are those check ids.
Earlier runs of the same scripts (CUST 36830989866, DRV 36830998099, VND 36831005745, 36831979335, 36832695210) hit
mistakes in the scripts themselves, which were fixed; their results are not used here.

## Summary

About 790 checks. Permissions held everywhere they were tried: customer2 could not read, rate, cancel, claim on or
download anything of customer's (more than 30 reads and writes); driverB could not touch driverA's trip, stops, goods, chat,
fuel log, SOS, truck or pay (33); vendor2 and vendor3 could not read or change vendor's loads, invoices, claims, bids
or documents, and no role could read staff data. Nothing exposed another account's data and no money figure was wrong:
invoices add up (amount + GST = total, lots add to the booking price), the PDF is owner-only, driver pay agrees with
its entries. The delivery code locks after 5 wrong tries on both delivery routes and the right code is refused during
the lock. Counts above and below what is held are refused (409) with the number on board. Replays with the same
Idempotency-Key return the first answer for custody, complete-stop, accept, SOS, fuel logs and receipts.

So there is no Blocker. The Majors are: a booking that books twice on a retry, a rating form that comes back after the
customer has rated, ratings of multi-drop bookings that reach no driver, an unsent trip that the driver already sees,
a cancelled SOS that leaves the truck out of service, and one odometer typo that stops fuel logging for a truck.

Not findings, but limits of the test stack:
- Quotes answer `available:false` ("We cannot show an instant price right now"): the stack has no price rates, so
  quote and price-minimum checks could not be exercised (CQ01/CQ02 fail for that reason only).
- CF17 failed on a false positive (the customer's own consignee phone in their own cargo view).
- Already in `ISSUES.md` and seen again, not repeated here: UAT-007 (DE01: a lot delivered with no pickup recorded),
  UAT-013 (the repeated "Created" in the public history), UAT-020 (what public tracking exposes), UAT-008.

| # | Sev | Title |
| --- | --- | --- |
| ROL-01 | Major | A booking ignores its Idempotency-Key: a retry books twice |
| ROL-02 | Major | The cargo view never shows the rating given, so the app asks the customer to rate again |
| ROL-03 | Major | A rating on a multi-drop booking is stored with no driver or truck: the driver is never told |
| ROL-04 | Major | A trip assigned but not sent is already shown to the driver, who can accept and start it |
| ROL-05 | Major | Cancelling a serious SOS leaves the truck in maintenance and the goods on hold |
| ROL-06 | Major | One mistyped odometer reading makes every later fuel log for that truck fail with 500 |
| ROL-07 | Major | The tracking link of a multi-drop booking shows no destination and "Carrier: Not yet assigned" after delivery |
| ROL-08 | Minor | Malformed ids give 500 on several routes instead of 404 |
| ROL-09 | Minor | A pickup date that does not exist (2026-11-31) gives 500 |
| ROL-10 | Minor | Same pickup and drop, or 0,0, is accepted for a quote and for a vendor load |
| ROL-11 | Minor | A claim has no ceiling: 99,999,999 rupees on a 2,000-rupee lot was filed |
| ROL-12 | Minor | A cancelled booking's public history reads "With 3PL partners" |
| ROL-13 | Minor | `PATCH /tpl/:id` replaces instead of patching: the partner ID, MSME status and tax treatment are wiped |
| ROL-14 | Minor | 3PL onboarding accepts a malformed email address |
| ROL-15 | Minor | Switching return-trip matching off closes the open window and switching it on does not reopen it |
| ROL-16 | Minor | The web driver page shows the first drop as the trip's "Origin" |
| ROL-17 | Minor | A 1-rupee bid was accepted on a driver-opened return trip (no price from the engine) |
| ROL-18 | Gap | A customer has no name, company or account page: every customer is "Customer 7701" |
| ROL-19 | Gap | A customer can read and download invoices but cannot report a payment or question one |

### ROL-01 · Major · A booking ignores its Idempotency-Key: a retry books twice
- **Where:** `POST /customer/bookings`, `backend-ts/src/routes/customer.routes.ts:78` (no `idempotent(...)` on the route, unlike `confirm-receipt` at line 120 and `/cargo/claims`). The app sends no key either: `customer-app/src/services/api.ts:253`, `QuoteScreen.tsx:72`.
- **Steps:** CUST.sh section C: `POST /customer/bookings` twice with `Idempotency-Key: uat-dup-<t>` and the same body. Then two different keys.
- **Expected / Actual:** the same key returns the first booking. Actual: two bookings, HTTP 201 both. `CD02 FAIL first=5c1d27ff-... second=34d6a3bb-...`, `CD03 FAIL rows=2`. Two different keys give two bookings (correct, CD06).
- **Why it matters:** the app has a request timeout and a "network error" message; a customer who retries after a lost reply books the trip twice, and staff see two requests for one load.
- **Fix idea:** add `idempotent('customer-booking')` to the route and send `newIdempotencyKey()` from `book()` in `QuoteScreen.tsx` (the claim screen already does this).

### ROL-02 · Major · The cargo view never shows the rating given, so the app asks the customer to rate again
- **Where:** `GET /customer/bookings/:id/cargo`, `backend-ts/src/services/cargo/customer.service.ts:57` reads `c.row.driver_rating`, but `SHIPMENT_CUSTODY_COLUMNS` (`services/cargo/consignment.ts:84-88`) does not select `driver_rating`, so it is always undefined. The app builds `receipt` from `rating` (`customer-app/src/services/api.ts:904`) and shows the rating form when `receipt` is null (`ConfirmReceiptCard.tsx:47`).
- **Steps:** CUST.sh section H: rate a delivered booking 4 (200), then read its cargo view and the bookings list.
- **Expected / Actual:** the cargo view carries `rating:{rating:4}`. Actual: `CR10 FAIL rating=null`, while `CR07` shows `driver_rating=4|...` in the database and `CR11` shows the list says `rated:true`. Only the list knows.
- **Fix idea:** add `driver_rating` and `driver_rating_note` to the select, or read them in `customerCargo`.

### ROL-03 · Major · A rating on a multi-drop booking is stored with no driver or truck: the driver is never told
- **Where:** `confirmReceipt`, `backend-ts/src/services/cargo/customer.service.ts:86-91`. A multi-drop booking points at the master shipment; the delivery events sit on the lots, so the lookup of the delivering vehicle finds nothing.
- **Steps:** CUST.sh sections F and H: book 3 + 2 pieces, deliver both lots with driverA, then rate the booking.
- **Expected / Actual:** the rating is linked to the driver and the truck, and the driver gets a notification. Actual: `CR10b FAIL rated_driver_id=NULL rated_vehicle_id=NULL`, `CR12 FAIL driverA notifications: New trip | Cargo transfer planned | Trip cancelled | New trip | Payment sent | Delivery cancelled` (no rating).
- **Impact:** ratings of every multi-drop booking are lost to driver performance and to the driver.
- **Fix idea:** for a master, take the vehicle from the lots' delivery events (or rate per lot).

### ROL-04 · Major · A trip assigned but not sent is already shown to the driver, who can accept and start it
- **Where:** `GET /telemetry/driver-ping/my-route` selects routes `in('status', ['active','pending'])` (`backend-ts/src/routes/telemetry.routes.ts:1203`) and answers `active:true`; the driver app treats a pending route as an offer to accept (`driver-app/src/hooks/useDriverRoute.ts:124`). A driver may set their own trip active (`routes.routes.ts:149-153`).
- **Steps:** DRV.sh section B: assign three lots to truck 1 with `dispatch:false` (dispatch's "assign without sending"), then call my-route as driverA before dispatch sends.
- **Expected / Actual:** no trip until dispatch sends it ("trips stay pending, no driver told", `e2e/README.md` section B). Actual: `DB02 FAIL`, `my-route ... {"active":true,"route":{"id":"73119fab-...","status":"pending","stops":[...]`; `GET /routes/:id` also answers 200. The "send" step stops nothing: it only adds the notification.
- **Fix idea:** return pending trips only when the route has been sent (`sent_at` or a status that means sent), and refuse a driver's `active` on a trip not yet sent.

### ROL-05 · Major · Cancelling a serious SOS leaves the truck in maintenance and the goods on hold
- **Where:** `POST /telemetry/sos/:id/cancel`, `telemetry.routes.ts:116-141` and `services/sos.service.ts:54-84` only change the alert's status. `holdVehicleAfterSos` (`services/route.service.ts:41`, called from `PATCH /sos/:id/details`) put the truck in maintenance and the lots on hold; nothing reverses it.
- **Steps:** DRV.sh section J: with two lots in transit, driverA raises an accident SOS, marks it serious, then cancels it ("raised by mistake").
- **Expected / Actual:** the truck returns to service and the goods are released, or the driver is told dispatch must do it. Actual: `DS32 PASS truck=maintenance P=on_hold Q=on_hold`, then after the cancel `DS34 FAIL truck=maintenance P=on_hold case=resolved,open`. Staff get "SOS cancelled", but the vehicle accident case stays open and the driver sees a cancelled SOS and an unusable truck.
- **Fix idea:** on a driver cancel of a serious alert, close its case and restore the truck and lots (or make the cancel button say that dispatch will release them).

### ROL-06 · Major · One mistyped odometer reading makes every later fuel log for that truck fail with 500
- **Where:** `POST /fleet/vehicles/:id/fuel-logs`, `backend-ts/src/routes/fuel.routes.ts:163`, then `recomputeVehicle` (`services/fuel.service.ts:151`). `vehicle_fuel_logs.mileage_kmpl` is `numeric(6,2)` (`e2e/schema.sql:1968`), so a computed 25,697 km/l overflows.
- **Steps:** DRV.sh section K: a valid fill at odometer 10000, then one at 910000 (a typo for 10100), then a normal fill at 10700.
- **Expected / Actual:** the typo is flagged (as the backwards reading is: `DK41 flags=["odometer_backwards"]`) or refused. Actual: `DK43 FAIL HTTP 500`; backend log `22003 numeric field overflow ... precision 6, scale 2`; the bad row stays, and `DK47 FAIL HTTP 500` for the next normal fill. Every later fill of that truck fails the same way until staff delete the row; the stats show `rolling_avg_kmpl:15000`, `last_kmpl:25697.14`.
- **Fix idea:** check distance and km/l against a limit before saving (refuse above, say, 100 km/l or 3,000 km between fills), and cap what is written to `mileage_kmpl`.

### ROL-07 · Major · The tracking link of a multi-drop booking shows no destination and "Carrier: Not yet assigned" after delivery
- **Where:** the tracking id a booking gets (`bookingTrackingId`) is the master's. `ShipmentService.getPublicTracking` (`backend-ts/src/services/shipment.service.ts:1706-1740`) builds the destination from the master's own delivery point and finds the vehicle through the master's own route stops, both empty for a master (its lots carry them); `frontend/src/components/tracking/ShipmentTracker.tsx:267` then prints "Not yet assigned".
- **Steps:** CUST.sh section G/L: open `/track/RTX-<master>` at 390 px for a delivered two-drop booking (`shots/anon-track_RTX_2A8B99A1-m.png`).
- **Expected / Actual:** where it went and which truck carried it. Actual: status Delivered, Destination "—", Carrier "Not yet assigned", Items 5. The lot ids (`RTX-...-A`, `-B`) show their own destination (`CT` info lines) but the customer is given the master id.
- **Fix idea:** for a master, show the drops (or the first and last) and the vehicles of its lots; show no Carrier box when none is meant to be shown.

### ROL-08 · Minor · Malformed ids give 500 on several routes instead of 404
- **Where and Steps (each a one-line call, ids like `not-a-uuid`):** `GET /invoices/:id/pdf` (`invoices.routes.ts:38`, `loadInvoiceFor` at `invoice-detail.service.ts:188`; CUST `CI15`); `POST /telemetry/sos/:id/cancel` (DRV `DS18`); `PUT /vendor/shipment-request/:id/cancel` (VND `VB25`); `PUT /vendor/shipment-request/:id/assign-vehicle` with `vehicle_id:"not-a-uuid"` (`VB50`); `PATCH /tpl/uat_tpl_a1` with the partner's own ID (`VH32`, backend log `invalid input syntax for type uuid: "uat_tpl_a1"` from `tpl.service.ts:286`); `POST /tpl/approve|reject/:id` with a non-uuid. Customer bookings and `/vendor/loads/:id` already guard with a UUID test and answer 404.
- **Expected / Actual:** 404 (or 400). Actual: `HTTP 500 {"detail":"Internal server error","request_id":"..."}`. Different from UAT-008 (the %-escape): this is a plain non-uuid.
- **Fix idea:** a shared `uuidParam` guard like `bookingId()` in `customer.routes.ts:71`.

### ROL-09 · Minor · A pickup date that does not exist gives 500
- **Where:** `POST /customer/bookings` and `/customer/quote`: `DATE` in `customer.routes.ts:20-23` accepts `2026-11-31` (V8's `Date.parse` is lenient), `isTodayOrLater` compares strings (`customer-booking.service.ts:91`), and the insert fails in Postgres.
- **Steps:** CUST.sh `CB18`: a booking with the 31st of a 30-day month.
- **Expected / Actual:** 400 "Choose a valid pickup date". Actual: `HTTP 500`. (The date picker in the app makes this unlikely; the API should still answer 400.)
- **Fix idea:** check the date round-trips (`new Date(d).toISOString().slice(0,10) === d`).

### ROL-10 · Minor · Same pickup and drop, or 0,0, is accepted for a quote and for a vendor load
- **Where:** `QuoteSchema` (`customer.routes.ts:25-34`) and `Place` in `backend-ts/src/schemas/vendor.ts` (`lat/lng` only range-checked).
- **Steps:** CUST `CQ22` (quote with drop = pickup); VND `VA22` (a load from a place to itself) and `VA23` (a load from 0,0 to 0,0, address "a" to "b").
- **Expected / Actual:** 400. Actual: 200 for all three; the junk loads appear on the vendor's board (`REQ-1768FA17  a -> b  10 kg`) and in staff's "needs a vehicle" list. The return-trip bid and the vendor location already refuse 0,0.
- **Fix idea:** refuse identical points and (0,0) in both schemas.

### ROL-11 · Minor · A claim has no ceiling
- **Where:** `CreateClaimSchema`, `services/cargo/claim.service.ts:50-56` (`amount` max 1,000,000,000; the declared value is stored but not compared).
- **Steps:** CUST.sh `CM08`: a delay claim of 99,999,999 on a lot whose freight share is 2,000 and whose declared value is null.
- **Expected / Actual:** refused, or flagged for staff. Actual: `HTTP 201 claimed=99999999`, status `filed`.
- **Fix idea:** flag (not refuse) a claim above the declared value or freight, so the survey step sees it.

### ROL-12 · Minor · A cancelled booking's public history reads "With 3PL partners"
- **Where:** a confirmed single-drop booking gets a shipment log `escalated` straight away (`INFO B1 shipment log statuses: created,escalated,cancelled`); `frontend/src/components/ui/status.ts:57` words it "With 3PL partners". The public history is `toPublicHistory` (`shipment.service.ts:1626`).
- **Steps:** CUST.sh `CX10`-`CX13`: confirm, then cancel, then open `/track/RTX-<id>` (`shots/anon-track_RTX_A5063730-m.png`): history "Created, With 3PL partners, Cancelled".
- **Expected / Actual:** the customer sees booked, cancelled. Actual: an internal step (a partner offer) appears on the customer's page.
- **Fix idea:** leave `escalated` out of the public history.

### ROL-13 · Minor · `PATCH /tpl/:id` replaces instead of patching
- **Where:** `tplService.updateApplication`, `services/tpl.service.ts:297-313`: `custom_id || null`, `msme_status || 'Not Registered'`, `tax_treatment || null`, `bank_account_no || null`. The web form sends every field, so it does not show.
- **Steps:** VND.sh section H: an applicant edits company name, PAN and SLA through the internal id.
- **Expected / Actual:** only those fields change. Actual: `VH32d FAIL HTTP 404 custom_id=NULL msme_status=Not Registered (it was Small) tax_treatment=NULL`. The partner ID, which is also the tracking ID and the document folder name, is gone and the application can no longer be found by it.
- **Fix idea:** build the update from the fields that were sent.

### ROL-14 · Minor · 3PL onboarding accepts a malformed email address
- **Where:** `tplService.onboard`, `services/tpl.service.ts:108-114` checks only that an email exists (`EMAIL_PATTERN` lives in `tpl.routes.ts` for the set-up code only).
- **Steps:** VND.sh `VH15`: `POST /tpl/onboard` with `email:"not-an-email"`.
- **Expected / Actual:** 400. Actual: `HTTP 200 {"data":{"id":"e2b4be70-...","custom_id":"uat_tpl_m1","status":"pending"}}`. The applicant can never receive the set-up code after approval.
- **Fix idea:** validate the email in `onboard` and `updateApplication`.

### ROL-15 · Minor · Switching return-trip matching off closes the open window and switching it on does not reopen it
- **Where:** `POST /capacity/driver/toggle-matching`, `routes/capacity.routes.ts:229` and `capacityService.toggleMatching`.
- **Steps:** DRV.sh section N: driver B opens a return trip (`status open`), toggles matching off (`INFO window after matching off: closed`), then on (200).
- **Expected / Actual:** on restores what off paused. Actual: `DR11b FAIL window=closed`; the driver sees success and has no open return trip.
- **Fix idea:** make "on" reopen a window that "off" closed within its time, or say in the app that off ends the trip's window.

### ROL-16 · Minor · The web driver page shows the first drop as the trip's "Origin"
- **Where:** `frontend/src/pages/DriverPage.tsx:291-293`: without a depot, `routeOrigin` is `pointOf(stops[0])`, which is the first drop.
- **Steps:** `ui driverA /driver` with an active trip (`shots/driverA-driver.png`): "Drop 1 / Origin", then "Drop 1 / Next stop".
- **Expected / Actual:** the pickup place. Actual: the first drop under "Origin".
- **Fix idea:** use the shipment's origin (or hide the row).

### ROL-17 · Minor · A 1-rupee bid was accepted on a driver-opened return trip (caveat: no price rates on the test stack)
- **Where:** `capacityService.submitBid`, `services/capacity.service.ts:259-268`: with no staff floor the minimum is `pricingService.minimumFor(...)`; when that gives nothing, there is no minimum.
- **Steps:** DRV `DR15` and VND `VE61`: driver B opens a return trip (floor null), vendor bids 1 rupee for 500 kg.
- **Expected / Actual:** refused as below the engine's minimum. Actual: `HTTP 200`, bid `pending` at 1. Staff still approve each bid, so it is a nuisance rather than a loss; with price rates loaded the engine may refuse it. Not verifiable here.
- **Fix idea:** when the engine has no price, fall back to a configured per-km floor or ask staff to set one when approving.

### ROL-18 · Gap · A customer has no name, company or account page
- **Where:** `POST /auth/customer/verify-otp` stores `Customer ${last 4 digits}` (`auth.routes.ts:332,361`); there is no customer profile route (`PATCH /customer/profile` is a 404) and the app's Account screen only signs out (`AccountScreen.tsx`).
- **Steps:** CUST.sh section K: sign up with a new phone and a one-time code.
- **Expected / Actual:** a customer can give a name and company (the `customers` table has `company_name`) and delete their account. Actual: `CA08 FAIL full_name=Customer 7701`; staff see "Customer 7701" on the booking, and consignees and claims carry no sender name.
- **Fix idea:** `GET/PATCH /customer/profile` with name, company and GSTIN (invoices need a buyer), and an account-delete request.

### ROL-19 · Gap · A customer can read and download invoices but cannot report a payment or question one
- **Where:** customer routes: `GET /customer/invoices`, `/invoices/:id/pdf`, `/invoices/payment-details` (bank details, "Payments are made offline"); payment is marked by staff (`PUT /finance/invoices/:id/pay`).
- **Steps:** CUST.sh section J: list, PDF (`INV-202610-0006.pdf`, 2.8 KB, owner only), payment details (200), then a customer call to mark paid (403, correct).
- **Expected / Actual:** the customer can tell the office "I paid, reference X" with a proof, or query an amount. Actual: no such call; the only step is to pay offline and wait for staff.
- **Fix idea:** a `POST /customer/invoices/:id/payment-note` (reference, optional proof file) that raises a task for finance, and a "question this invoice" note.

## What was run

- **CUST** (section A to L): quotes with 20 bad inputs, single and multi-drop bookings with Hindi text, a 5000-character name, hostile extra fields (status, price, customer_id), double submit, cancel at requested / confirmed / assigned / in transit / delivered, a full two-drop trip to delivery, public tracking as anyone (fields, unknown and hostile ids, rate limit), receipt and rating, claims (duplicate, other customer's, 7-day window), invoices (list, PDF, pay refused), notifications (limit, read, others'), sign-up by one-time code (5 wrong tries lock), the web tracking pages at 390 px and desktop.
- **DRV** (A to O): trip list and status, driverB acting on driverA's trip (33 refused calls), accept twice and replay, pickup rules and counts, partial counts above and below, the delivery code and its lock, dispatch cancelling a trip, SOS (null position, bad input, replay, cancel, rate limit), fuel log with 20 bad inputs, backwards odometer and a typo, pay, trip chat, return trip opened by a driver, `/driver` on the web at 390 px.
- **VND** (A to I): loads (22 bad inputs, Hindi), assign before accept, accept, cancel at each stage, reject, truck assigned, pickup and delivery, invoice and its PDF, payment, claims, return-trip bids (below minimum, second bid, after the award, closed window), KYC and documents (upload to a signed URL, rejected paths, review, approve, reject), another vendor's data (28 calls), 3PL onboarding (public), tracking by partner ID, PAN guessing limit, staff approve and reject, set-up password, the partner's portal and its refusals, the vendor portal and 3PL pages at desktop and 390 px.
