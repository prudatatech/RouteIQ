# VENDOR: vendor extras and the public pages (audit area 7)

Walk: `e2e/staging/vendor.mjs` (re-runnable, fresh `@margix.test` accounts and companies each run; `SECTIONS=3,6 node e2e/staging/vendor.mjs` runs
parts). Target: the test stage only, running `m1/parity` at the time (KYC approval by a company admin was already refused, 403). About 420 checks
in 7 sections. Last full runs: sections 1,2,4,5,6,7 = 316 passed / 7 failed; sections 3 and 6 = 100 passed / 0 failed; section 4 = 56/56 (twice).
Every one of the 7 failures is accounted for below: 5 are bugs fixed on this branch and **not yet deployed to the stage** (they will pass after the
next deploy), 2 were mistakes in the walk (fixed in the script).

## Steps

Numbers are the walk's step numbers. Ranges are grouped when they check one behaviour.

| Step | Expected | Result | |
|---|---|---|---|
| 1.01-1.07 | Business profile: readable, GSTIN required for business partners, malformed or wrong-check-character GSTIN, 4-digit pin, unknown account type, bad email refused (400) | as expected | PASS |
| 1.08-1.09 | A customer with no GSTIN saves; the pin code alone sets the state (110001 is Delhi, 07) | saves, but state stays empty | **FAIL** (VND-03, fixed, not deployed) |
| 1.10-1.11 | GSTIN 27... gives Maharashtra; stored on the vendor organisation (gstin, pin, account type) | as expected | PASS |
| 1.12-1.15 | KYC documents (PAN scan, cancelled cheque, GST certificate, logo) through signed upload links, bytes read back from storage equal what was sent; .exe 415, 50 MB 413, path tricks 400 | as expected | PASS |
| 1.16-1.21 | Another vendor's files, bad PAN, wrong GSTIN refused; submit stores the four paths; the platform owner is told | as expected | PASS |
| 1.22-1.23 | Load posted before approval is held ("verification pending"), no quote clock | as expected | PASS |
| 1.24-1.31 | Reject needs a reason, stores it, tells the vendor, vendor sees it; second decision 409; vendor edits and resubmits, reason cleared | as expected | PASS |
| 1.32-1.35 | Approve (platform admin), second approve 409, held load released, organisation active | as expected | PASS |
| 1.36a | A company admin cannot approve a vendor's KYC | 403 | PASS |
| 1.36 | Approved vendor's new load is not held | as expected | PASS |
| 1.37 | Renaming an approved business through `PUT /vendor/business-profile` saves | **500**: `null value in column "city" of vendor_profiles` | **FAIL** (VND-01, fixed, not deployed) |
| 1.38, 1.40 | The rename sends the profile back to review and the platform owner is told | review yes (checked through the older save the walk falls back to), owner told | PASS |
| 1.41-1.42 | A load posted right after the edit is held and no company can see it (404) | not held, visible to companies (200) | **FAIL** (VND-02, fixed, not deployed) |
| 1.43-1.45 | Re-approval releases held loads; a path outside the vendor's own folder is refused | as expected | PASS |
| 2.01-2.02 | Guest/validation: no sign-in 401; no products, bad HSN, zero/negative/over-60 t weight, negative value, GST 99, 51 products, bad pins, past date, impossible date, delivery before pickup, no coordinates, place 0,0, perishable without temperature, bad phone, chosen with none / pending company / vendor org / made-up / 11 companies, bad request id: all 400 | as expected (24 checks) | PASS |
| 2.03-2.08 | Valid load: 201, `MRX-YYYY-NNNNN`, totals recomputed by the server (client totals ignored), Mumbai to Delhi is IGST and needs an e-way bill, 27,000 IGST on 1,50,000, items stored | as expected | PASS |
| 2.09-2.11 | Same `client_request_id` twice: 200 `duplicate:true`, one row; two at the same instant make one row | as expected (second request waits about 10 s on a loaded stage, see VND-05) | PASS |
| 2.12-2.14 | Repost: draft with dates cleared and the same goods, creates nothing, another vendor 404 | as expected | PASS |
| 2.15 | The served repost draft posts as it is (with a new date) | 400 `Expected string, received null` (`client_request_id: null`) | **FAIL** (VND-04, fixed, not deployed) |
| 2.16-2.19 | `loads/mine` paged and counted, page 0 is 400, other vendor 404, detail has load and items | as expected | PASS |
| 2.20-2.29 | Bulk CSV: template downloads as `text/csv` attachment; 3 rows with one bad: 2 loads, 1 error naming the field; batch row recorded (3/2/1, done); source bulk; 51 rows, wrong header, empty, header only all 400; one summary notification | as expected | PASS |
| 2.30-2.38 | Chosen load visible to the chosen company only (200 / B 404 / pending company 404); open load to every active company, not the pending one; market lists follow | as expected | PASS |
| 2.39-2.46 | Held load: no company sees, quotes or accepts it (404); only matching companies are told; the pending company and held load notify nobody | as expected | PASS |
| 2.47-2.62 | Quote deadline is 2 h ahead; direct accept refused when quotes were asked (409); 6 bad quote bodies 400; two companies quote; replace keeps one live quote; vendor sees both, cheapest first, no GSTIN/phone; another company sees only its own quote; withdraw, withdraw again 404, quote again | as expected | PASS |
| 2.63 | A quote past its validity cannot be accepted (409) | as expected | PASS |
| 2.64-2.75 | Vendor accepts: others declined, award fresh (carrier, cost, awarded_at), second accept and same quote twice 409, winner and loser told, Won/Lost tabs, loser can no longer read the load | as expected | PASS |
| 2.76-2.84 | Direct accept at the budget, no budget 400, second company 404/409, two at once: exactly one wins and no 500; withdrawn load disappears | as expected | PASS |
| 3.01-3.10 | Return trips: window needs a price and 5+ minutes; another company cannot open on my vehicle (404); duplicate window 409; vendor sees near trucks of any company, not the Delhi one, with no plate/coordinates/driver; near vendors told once, far vendor not | as expected | PASS |
| 3.11-3.22 | Bid rules: no KYC 403; below floor, over free space, bad e-way number, no drop-off, negative weight 400; geofence (Chennai vs Mumbai) 400; unknown window 404; valid bid; second pending bid 409; refused bids leave no stray drop-off points | as expected | PASS |
| 3.23-3.29 | "My bids" only mine and no plate while pending; bid count; company A sees both pending bids, B none; B cannot approve (404); vendor cannot (403); company told | as expected | PASS |
| 3.30-3.40 | Approve builds shipment (company A, vendor org), manifest, route with pickup and drop stops, vehicle free space 8000 to 5000, window closed with winner, other bid lost; approve again 409; both vendors told; winner sees the plate, loser not; closed window takes no bid | as expected | PASS |
| 3.41-3.49 | Reject needs a reason, stores it, tells the vendor; twice 409; vendor can bid again; window past `closes_at` 409; another company cannot close; cancelled window 409 | as expected | PASS |
| 4.01-4.18 | Documents: vendor uploads invoice through the signed flow (bytes read back, served by signed link); HTML 415, 50 MB 413, foreign path 400; challan needs a number; vendor cannot create or generate an LR (403); other vendor / other company 404; platform owner reads, cannot write | as expected | PASS |
| 4.19-4.27 | E-way bill: 5 digits and no validity 400; recorded expired reads `expired`; checklist flags it; extending makes version 2 and live; history shows the change; vendor cannot change it (403); setting `expired` by hand 400 | as expected | PASS |
| 4.28-4.37 | LR generated (number), PDF is `%PDF` for the company and the vendor, 404 for another company; regenerate keeps number, new version; freight sheet PDF `%PDF`; POD before any delivery 409 with a clear message; trip closure before settlement 409; unknown kind 404 | as expected | PASS |
| 4.38-4.47 | Settlement opens at 88,000; close without final POD 409; with POD the trip closes and the trip closure PDF is `%PDF`; POD PDF `%PDF`; timeline; corrected invoice supersedes the old one, superseded cannot be edited | as expected | PASS |
| 4.48-4.56 | Checklist flags missing invoice/e-way/LR/vehicle papers and a wrong-vehicle e-way bill; default is warn; with `dispatch_block_on_missing_docs` the driver's and staff's pickup are refused 409 listing what is wrong and the manifest stays scheduled; with it off the same pickup is 201 | as expected | PASS |
| 5.01-5.06 | Loads board has the load with a stage, the stage and price change after acceptance, no GSTIN/phone, other vendor's board is separate, invoices page data is a list | as expected | PASS |
| 5.07-5.12 | Claims page data 200; claim on unknown load 404; other vendor 404; unknown type 400; vendor cannot decide a claim (403) | as expected | PASS |
| 5.09 | A claim on a load not yet delivered is refused with a reason | walk error (it used a load with no manifest); fixed in the script | n/a |
| 5.13-5.18 | Notifications: list with unread count, mark one read, another user 404, absurd paging clamped, read-all | as expected | PASS |
| 5.19-5.25 | A colleague (second user in the vendor organisation) sees, opens and quotes-reads the organisation's loads, documents and business profile, posts a load the first user then sees; outsider 404 | as expected | PASS |
| 6.01-6.09 | Public: stats (4 counts, cached 10 min), HSN search "cement" (2523 at 18%), under 3 characters 400, 8-digit HSN and the parent fallback, bad and unknown code | as expected | PASS |
| 6.10-6.15 | Pin 400093 is 27, 110001 is 07, 5 digits 400, 000000 not 500; vehicle classes (9) and goods categories cached 10 min | as expected | PASS |
| 6.16-6.25 | Companies: no plate/phone/GSTIN/email, fields exactly `id,name,city,vehicle_types,trips_completed`, pending test company absent, cached 60 s; cities; spare space shows the open window with no plate, vehicle id or coordinates; bad date and `min_kg` 400 | as expected (see VND-07 for the 50-row cap) | PASS |
| 6.26-6.29 | `/public/quote` Mumbai to Delhi: low <= suggested <= high, 1,492 km, not cached, no rate card; 0 kg, latitude 99, broken JSON all 400 | as expected | PASS |
| 6.30-6.37 | `/public/loads/assist` with the PRD 8.3 example: 20,900 kg and Rs 7,62,500; IGST; GST equals the master's rates (2523 and 7214) summed per line; e-way bill required; vehicle suggestion; empty, bad type, half-filled drafts never 500 | as expected | PASS |
| 6.38-6.42 | Public tracking of a real shipment: no driver, vendor, phone, GSTIN, email, price, internal ids; unknown id 404; `%ZZ` 400/404 | as expected (plate and live position are shown by design, VND-08) | PASS |
| 6.43-6.47 | Vehicle share link: opens with no sign-in, no-store, no driver/phone/vehicle id/load/customer; closed link 404; bad token 404 | as expected | PASS |
| 6.48-6.51 | 24 quick `/public/quote` calls turn to 429 with no 5xx; unknown public path 404; vendor routes without a token 401 | as expected | PASS |
| 6.17 | (first run) companies list contains the walk's own company | walk error: the endpoint lists 50 by name; script fixed | n/a |
| 7.01-7.07 | Vendor OTP: bad or missing phone 400; a valid number answers 502 "Failed to send OTP" (no SMS provider on the stage), never 500; wrong code 401, no session; an existing driver's role, phone and name are unchanged and no vendor is created for their number | as expected | PASS |
| 7.08-7.09 | Password reset request answers the same (status and body) for a known and an unknown email, not 5xx | as expected | PASS |
| 7.10-7.19 | Vendor token on staff routes 403/404 (6 routes); cannot approve KYC or open a window; company admin and manager on 6 vendor routes 403; staff posting a load gets a clear 403; driver 403; garbage token 401; malformed id 400/404 | as expected | PASS |
| 7.20-7.24 | Scheduler: the load with no quote after its deadline is escalated once (platform admin told once, vendor told "Companies need a little longer"); the quote past its validity is marked expired and its company told | as expected (within 15 minutes) | PASS |

## Issues

| ID | Severity | Issue | Root cause | Fix | Status |
|---|---|---|---|---|---|
| VND-01 | **Critical** | Any vendor who already had a company profile got **500** when saving the business profile (`PUT /vendor/business-profile`): `null value in column "city" of relation "vendor_profiles"`. The very case in the brief (renaming or re-addressing an approved profile) failed, and so did every second save. | `mirrorToVendorProfile` wrote the profile with an **upsert** that had no `city`; an upsert's insert half has no city and the column is NOT NULL (the code only added `city` when the existing one was empty). | An existing row is **updated** (no insert half); a missing row is inserted with an empty city. `business-profile.service.ts`. | Fixed, tested (`loads-business-profile.test.ts`); needs deploy |
| VND-02 | **Major** | After an approved vendor changes its name, GSTIN or address (profile goes back to review), loads it posts are **not held** and reach companies at once. The brief says they must wait for re-approval. | A new load is held only when the vendor **organisation** is not active, but the organisation stays active when the profile goes back to review (the sync trigger never reverses an activation, by design). The API also remembers organisations for 60 s. | `vendorVerified` also reads `vendor_profiles.kyc_status` live: held unless the organisation is active **and** the KYC is approved. Re-approval already releases held loads. `loads.service.ts`. | Fixed, tested (`loads-create.test.ts`); needs deploy |
| VND-03 | Minor | A vendor without a GSTIN (customer account) saved with an empty state although the pin code names it (the design says the pin sets the state). | `saveBusinessProfile` took the state only from the GSTIN or the form. | Falls back to the pin code lookup when there is no GSTIN or form state. `business-profile.service.ts`. | Fixed, tested; needs deploy |
| VND-04 | Minor | The draft that `POST /vendor/loads/:id/repost` serves cannot be posted unchanged: 400 `Expected string, received null` for `client_request_id: null`. (The web screen replaces the null itself, so only API users and other clients hit it.) | The schema allowed `client_request_id` to be missing but not null. | `.optional().nullable()`; null means a new request id is made. `schemas/loads.ts`. | Fixed, tested; needs deploy |
| VND-05 | **Major** (scales with companies) | Posting an open load took 10 to 11 s on the stage (about 790 database queries per post) and a repeat request waited as long. One post notified each matching company's people one after another before answering the vendor. With hundreds of companies it would take minutes. | `notifyCompanies` sent its notifications in a plain `for` loop with `await`. | Sent 20 at a time (`NOTIFY_CONCURRENCY`). Still one insert per person: a single batched insert (and a limit on how many companies one open load goes to) is the next step. `order-routing.ts`. | Fixed, tested (45 extra companies each told exactly once); needs deploy |
| VND-06 | Minor (decision) | `GET /capacity/nearby-vendors` lets any company's staff list **every** vendor on the platform with company name, city and pickup coordinates. | It reads all of `vendor_profiles`. | Not changed: it may be intended (companies find vendors near a truck), but the coordinates are the vendors' pickup addresses. Owner to decide whether it should be limited to vendors who bid or posted a load to that company. | Open |
| VND-07 | Minor | `/public/companies` reads the first 200 active companies by name and then filters by city and vehicle type, and shows 50. With more than 200 companies the rest never appear, and a city filter can miss companies. | Filtering is done after a capped read. | Not changed: push the city filter into the query (and page) when the platform grows past 200 companies. | Open |
| VND-08 | Info | Public tracking shows the vehicle's plate and live position, and the pickup and delivery coordinates (no vendor, driver, phone, GSTIN, price or internal ids any more). The vehicle share link shows the plate and trail by design. | Contract of the tracking page. | None. | Accepted |
| VND-09 | Info | Vendor sign-in by phone code answers 502 "Failed to send OTP. Please try again." on the stage (no SMS provider configured there), a clean error, never 500, and never touches an existing account. | No Twilio on the stage. | None; configure an SMS provider to test the happy path. | Accepted |

Other things checked and found right: approving a bid keeps the capacity maths and undoes everything on failure; a refused bid leaves no stray
drop-off point; the e-way bill expiry, version history and `superseded` rules; the dispatch block refuses both the driver and staff pickups with the
list of what is wrong; rate limits answer 429; malformed ids and `%ZZ` never answer 500.

Not covered: a real claim on a delivered load and the vendor invoice after delivery (area 3 and the rehearsed money flow); the happy path of phone
sign-in (no SMS provider on the stage); a rate-limit answer for the vendor-load and bulk limits (60 and 10 per hour per vendor).
