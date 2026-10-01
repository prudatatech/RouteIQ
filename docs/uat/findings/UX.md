# UX review findings

A UI/UX pass over every role, from the screenshots of two UAT runs on a throwaway stack (seeded by `node e2e/run.mjs --reset`).
Run 1 (`36830538115`, `e2e/scenarios/UX.sh`): about 220 screenshots, superadmin at 1440 px and 390 px, manager, vendor, drivers, customer and anonymous.
Run 2 (`36832245352`, `e2e/scenarios/UX2.sh`): modals, confirmations, tabs, the search palette. Shot names below are in `e2e/shots/` of the run's `uat` artifact (R1 = run 1, R2 = run 2). A `-m` suffix means 390 px.

Anything already in `docs/uat/ISSUES.md` (UAT-001 to UAT-023) is left out.

## Summary

The screens are consistent in layout and the empty states are good (each says what is missing and offers one step; confirmations exist for resolve SOS, cancel trip, void and mark-paid). The problems are mostly about **truthfulness and words**: a few screens say "nothing wrong" while the data says otherwise, the public tracking page misreports a split booking, and one concept appears under several names and id formats. Raw system text (enum values, audit keys, UUIDs, server-key instructions) leaks to dispatchers. At 390 px only one page overflows. Managers are cleanly confined (no Money, Reports, Settings in the menu, no Bank tab), but a blocked URL gives no message.

Coverage gaps: nothing was waiting to be accepted, priced or assigned in the seeded data, so the Accept, Set price and Assign vehicle modals, the create-shipment steps after step 1, and the rate-the-driver form were not captured. The shipment action buttons (Hold, Cancel shipment, Take off vehicle, Delete) were also not captured in run 2 (the lookup of the assigned shipment failed). Focus order was not tested. Icon-only buttons all surfaced with names in the page text, and no unnamed control was found.

| # | Sev | Page | Title |
| --- | --- | --- | --- |
| UX-01 | Major | Public tracking `/track/:id` | A split booking shows "Booked", "Not yet assigned" and a failed-delivery history though 2 of 3 lots are delivered |
| UX-02 | Major | Vehicle page | "Nothing is expired" next to five missing documents; fuel tank 100% next to "no fuel level" |
| UX-03 | Major | Shipment page (master and lot) | Contradictory lines and a wall of repeated history |
| UX-04 | Minor | Several | Raw system text shown to users (enums, audit keys, UUIDs) |
| UX-05 | Minor | Several | Vocabulary slips: consignment, route, Cargo, Finance, Transship, Raise problem |
| UX-06 | Minor | Plan a trip, Insights, trip page, Optimize | Server-setup instructions and solver jargon shown to dispatchers |
| UX-07 | Minor | Trip page | A normal trip page logs a 503 and says "No driving route was found" |
| UX-08 | Minor | Today, Fleet, Trips | Counts disagree: active trips, vehicles on the road, on trip |
| UX-09 | Minor | Several | One trip, one lot, several ids and spellings |
| UX-10 | Minor | Several | Pieces, items, pcs, "1 pcs", "1 vehicles" |
| UX-11 | Minor | Manifest, Analytics | ISO dates and unformatted numbers beside "1 Oct 2026" |
| UX-12 | Minor | All lists | Status column moves around; Vehicle column shows different things |
| UX-13 | Minor | Lists | CSV export on some lists only |
| UX-14 | Minor | Requests, Money, KYC, Dispatch | Pages open on an empty tab while the work sits in another |
| UX-15 | Minor | Create shipment | The form opens already showing red errors |
| UX-16 | Minor | Manager, customer | Blocked pages redirect silently |
| UX-17 | Minor | Trip detail at 390 px | Page scrolls sideways (402 px wide) |
| UX-18 | Minor | Menu and tabs | Same thing in two places; names that do not match the target |
| UX-19 | Minor | Problems, transfers, lots | "Part B due", "Add" and "Count mismatch" without explanation |
| UX-20 | Minor | Return trips | "Combine loads" inside "Combine loads"; auto-accept after 2 minutes; ineligible options |
| UX-21 | Minor | Money, Driver pay | A cancelled trip paid in full; "Straight line"; Reports labels |
| UX-22 | Minor | Vendor portal | Verified company with no PAN, bank or documents; onboarding reopens |
| UX-23 | Minor | Driver `/driver` | Origin and next stop identical; Complete delivery with no trip |
| UX-24 | Minor | SOS page, vehicle page | Eight equal buttons; Raise SOS is the loudest button on a healthy vehicle |
| UX-25 | Polish | Several | Smaller layout and copy items |

---

### UX-01 · Major · Public tracking `/track/:id` · A split booking shows "Booked", "Not yet assigned" and a failed-delivery history though 2 of 3 lots are delivered
- **Screenshot:** R1 `customer-track_RTX_A765FEE3-m.png`, `anon-track_RTX_A765FEE3_A-m.png`
- **What's wrong:** For RTX-A765FEE3 (Partly delivered, 97 of 100 pieces delivered) the progress bar sits on "Booked", Destination is "—", "Time to arrival —  Shown once a vehicle is on its way", Carrier is "Not yet assigned". Status history lists "Created" twice, then "In transit", "On hold", "Delivery failed / Delivery attempt failed", "Partly delivered". Lot RTX-A765FEE3-A says "With 3PL partners" (it never went to one), "Vehicle assigned" twice, "On hold" twice, and the carrier "MH04E2E0002 · truck · Available" (an internal vehicle status). The step circles show a tick on step 1 and numbers 2 to 5 on the rest.
- **Why it confuses:** A customer whose goods are mostly delivered is told nothing has started, and reads "Delivery failed".
- **Fix:** For a master, show a lot-by-lot summary ("Lot A delivered, Lot B 23 of 25 delivered, Lot C delivered") instead of one vehicle-less timeline; drop duplicate consecutive events and internal ones (custody "With 3PL partners", "On hold") from the public history; map Partly delivered to the "Delivered" step with a note; do not print the vehicle's staff status ("Available"). Likely `frontend/src/pages/CustomerTrackingPage.tsx` and the public tracking route in `backend-ts/src/routes/public.routes.ts`.

### UX-02 · Major · Vehicle page · "Nothing is expired" next to five missing documents; fuel tank 100% next to "no fuel level"
- **Screenshot:** R1 `superadmin-fleet_f798d977_..._.png` (Overview), `..._tab_documents.png`, `..._tab_maintenance.png`, `..._tab_fuel.png`
- **What's wrong:** Overview card "Documents needing attention: Nothing is expired or expiring within 30 days." The Documents tab lists RC, Insurance, Fitness, Permit, PUC all "No expiry on file / Not uploaded"; Maintenance shows every one as "Unknown". The Fuel tab says "Tank level 60 of 60 L 100%" for a vehicle with "Last seen Never", while Maintenance says "No fuel level from a device in the last 48 hours". "No GPS data" (header and fleet list), "Offline, has never sent a position" and "Last seen Never" are three wordings for one fact. The Documents tab and the Maintenance tab both list the same five documents.
- **Why it confuses:** A false all-clear on a truck with no insurance or fitness papers on file leads to dispatching it.
- **Fix:** Count "missing" as needing attention ("5 documents not uploaded"); show "Not reported" instead of 100% when there is no device reading; use one phrase for no position ("Never reported a position"); keep the document list in one tab and link to it from Maintenance. Files: `frontend/src/pages/fleet/VehicleDetailPage.tsx`, `pages/fleet/tabSlots.tsx`, `components/fleet/VehicleHealthPanel.tsx`, `components/fleet/fuel/VehicleFuelTab.tsx`.

### UX-03 · Major · Shipment page (master and lot) · Contradictory lines and a wall of repeated history
- **Screenshot:** R1 `superadmin-shipments_90a26a19_..._.png` (master), `..._cbed3362_....png` (lot A), `...-m.png` (6,400 px tall at 390 px)
- **What's wrong:** The master shows "Price ₹10,000" and "Freight share ₹0" and "Invoice: No price, so no invoice". "Vehicle Not assigned / Driver Not assigned / Trip No trip yet" are covered by UAT-006. The lots are listed twice (Related and Lots panels), each lot repeats the consignee name twice ("Sharma Traders Sharma Traders"). Every lot says "No e-way bill" and "Part B due"; an unlabelled "Add" link sits beside it. The delivered lot A shows "Delivery OTP Required at delivery", "Delivery attempts 0 of 3" and an open "Shortage" case with "3 h 59 min left". Custody history is about 40 entries on one page; each Split entry repeats its sentence ("Lot A: 50 of the 100 pieces ... Lot A: 50 of the 100 pieces ..."), "Driver accepted the job" appears twice per trip with "Accepted route 874fa20d-8c18-47d6-ab70-a272f200e7ea" (a raw id).
- **Why it confuses:** The page says both "priced" and "no price", and the one fact you need (what is left to do on which lot) is lost in the log.
- **Fix:** Invoice line for a master: "Invoiced per lot" with the lot invoices; hide Delivery OTP and attempts once delivered; show one Lots panel and drop it from Related; collapse the custody history to the last 5 with "Show all"; strip the repeated sentence and the raw trip id (link "Trip 7FFB4AC7" instead); label the link "Add e-way bill". Files: `components/shipments/ShipmentSections.tsx`, `components/cargo/LotsPanel.tsx`, `CustodyTimeline.tsx`, `backend-ts/src/services/cargo/consignment.ts` (event text).

### UX-04 · Minor · Several · Raw system text shown to users
- **Screenshot:** R2 `superadmin-today-p_rtx.png`; R1 `superadmin-admin_audit.png`, `superadmin-shipments_90a26a19_....png`
- **What's wrong:** The ⌘K palette lists results as "partially_delivered · Bhiwandi warehouse" and "assigned · Acme Logistics" (the enum value). The Audit log "What happened" column shows `driver_pay.paid`, `driver_pay.approved`, `invoice_paid`, `company_profile_changed`, `driver_pay.rate_set`. The Audit page subtitle says "Actions the system has taken automatically" yet every row's Source is "Staff console". Custody entries show "Accepted route 874fa20d-8c18-...". The 404 for a bad case id (`/cargo/exceptions/not-an-id`) is an empty page headed "Cargo" with no message.
- **Why it confuses:** Dispatchers read codes, not sentences; the Audit description contradicts its rows.
- **Fix:** Use `StatusPill`/`statusToLabel` in the palette rows (`components/ui/CommandPalette.tsx`); map audit actions to sentences ("Driver pay paid: Ravi Driver, ₹3,393") in `pages/admin/AuditLogPage.tsx` and change the subtitle to "Everything staff and the system changed, newest first"; give the case page an error state like the shipment page ("We could not find that case").

### UX-05 · Minor · Several · Vocabulary slips that `check-vocabulary` does not catch
- **Screenshot:** R1 `superadmin-cargo_exceptions_519333a0_...png`, `superadmin-money_invoices_bf8cb65e_...png`, `superadmin-analytics_tab_finance.png`; R2 `superadmin-cargo_exceptions_96930a31_...-m.png`
- **What's wrong:**
  - Case page: "75 pieces, 750 kg in 2 consignments", "1 pieces, 10 kg in 1 consignment" (`ExceptionCasePage.tsx:254`, a template string the check skips).
  - Invoice line: "Freight (road transport of goods), consignment RTX-A765FEE3-A" (printed on the invoice and PDF).
  - The module is "Problems" but the case page and its back link say "Cargo" (`back={{ to: '/cargo', label: 'Cargo' }}`), and the shipment page says "Record the pickup ... under Cargo".
  - Analytics Finance: "Add an expense in Finance" (the page is Money; Finance is gone).
  - Case page: "Transship to vehicle", "Transship or Move to hub plans one"; the modal and docs say "Plan a transfer".
  - "Raise problem" (shipment page) against "Raise a problem" (Problems page, modal title).
  - Menu "Return trips & 3PL" against section title "Return trips"; "Close & bill" and "Invoices & proofs" use "&" where the rest says "and".
- **Why it confuses:** Staff learn "Problem", "Shipment", "Transfer" and then meet the old words at the exact moment they are handling an incident or an invoice.
- **Fix:** Replace in `pages/cargo/ExceptionCasePage.tsx`, `TransferPage.tsx`, `backend-ts` invoice line builder ("Freight (road transport of goods), shipment RTX-…"), `components/analytics/*` and `components/shipments/ShipmentSections.tsx`. Extend `scripts/check-vocabulary.mjs` to scan template literals.

### UX-06 · Minor · Plan a trip, Insights, trip page, Optimize · Server-setup instructions and solver jargon shown to dispatchers
- **Screenshot:** R1 `superadmin-dispatch_tab_plan.png`, `superadmin-route_planner.png`, `superadmin-insights.png`, `superadmin-routes_f42c788d_....png`, `superadmin-optimize.png`
- **What's wrong:** "Trip planning is not set up. Ask an administrator to add a TomTom or Mapbox key to the server." (and the whole form still shows below it); "Weather is not set up. Add an OpenWeather key to turn it on."; "Traffic incidents are off. Add a TomTom key to check active trips." (on every trip page); "Traffic data not configured. Add a TomTom key on the server"; Optimize offers "OR-Tools / Constraint programming solver" and "Genetic algorithm / Evolutionary search", "Evaluating 1 vehicles and 0 shipments", and lists the only vehicle as "MH04E2E0002 · Driver licence missing".
- **Why it confuses:** A dispatcher cannot act on a key name; the page offers a form that cannot work.
- **Fix:** One short line ("Live traffic is not available. Your administrator can switch it on in Settings") shown only to admins; hide the cards for others; disable or hide the Plan form when unset; name algorithms by outcome ("Fastest result", "Best result, slower") with the technical name as a hint; fix "1 vehicle". Files: `RoutePlannerPage.tsx`, `InsightsPage.tsx`, `RouteDetailsPage.tsx`, `components/optimize/*`.

### UX-07 · Minor · Trip page · A normal trip page logs a 503 and says "No driving route was found"
- **Screenshot:** R1 `superadmin-routes_f42c788d_....png`, `superadmin-routes_874fa20d_...-m.png`; R2 `superadmin-routes_ccf670c9_...-cancel.png`
- **What's wrong:** Every trip page calls `POST /routing/directions` and gets 503 (console error). The page then shows "LIVE ETA WITH TRAFFIC: No driving route was found to the remaining stops." Other normal pages also log failed requests: a plain shipment page calls `GET /cargo/lots/<id>` and gets 404 (R1 `RTX-8262DCA`, R2 `CM-2AD81DBA`); Money logged "Failed to load the account role ... Failed to fetch".
- **Why it confuses:** "No route found" tells the dispatcher the stops are unreachable, when the service is simply unavailable.
- **Fix:** Map 503 to "Live ETA is not available right now" and keep "No route found" for a real empty result; do not request lot data for a shipment that is not a lot (`components/shipments/ShipmentSections.tsx`, the lots hook), so a console 404 is not part of a healthy page.

### UX-08 · Minor · Today, Fleet, Trips · Counts disagree
- **Screenshot:** R1 `superadmin-today.png`, `superadmin-fleet.png`, `superadmin-routes.png`
- **What's wrong:** Today: "Active trips 1" but "Vehicles on the road 0" and "On-time rate 33% (Trips completed today)". Fleet: "On trip · 0" while the truck has an In progress trip and is shown "Available". The card headed "Fleet needs attention 1" says "4 people are missing required documents" (people, not fleet). The block "Nothing waiting. These queues are empty." is followed by nine rows of 0.
- **Why it confuses:** Three pages give three answers to "how many trucks are working".
- **Fix:** Define "on the road" once (a vehicle with an in-progress trip) and use it on Today, Fleet and the vehicle badge; put the people card under "People"; show only non-zero queues, with one line "Nothing else waiting". Files: `components/today/*`, `pages/FleetPage.tsx`.

### UX-09 · Minor · Several · One trip, one lot, several ids and spellings
- **Screenshot:** R1 `superadmin-money_driver_pay.png`, `superadmin-money_invoices_bf8cb65e_...png`, `superadmin-routes_874fa20d_....png`, `vendor-vendor_loads.png`
- **What's wrong:** The same trip is "Trip 874FA20D" (title), "TR-874FA20D" (Driver pay), "Trip 7FFB4AC7" (invoice, shipment) and "Trip C7778EDD" for shipment CM-C7778EDD. Shipments come as `RTX-…` and `CM-…` (vendors and staff see both, side by side: RTX-8262DCA and CM-C7778EDD). Lots are `RTX-…-A`, cases `EXC-…`, transfers `TRF-…`, claims `CLM-…`, but trips have no stable number (UAT-010 covers the list).
- **Why it confuses:** A dispatcher cannot quote a trip over the phone or match a pay row to a trip.
- **Fix:** One helper `tripCode(id)` returning `TR-XXXXXXXX` everywhere (`utils/display.ts`) and show it in the Trips list; explain the CM/RTX split in a hint or unify it.

### UX-10 · Minor · Several · Pieces, items, pcs, "1 pcs", "1 vehicles"
- **Screenshot:** R1 `superadmin-shipments.png`, `superadmin-cargo.png`, `superadmin-cargo_tab_transfers.png`, `superadmin-optimize.png`
- **What's wrong:** Shipments list: "100 items", "1 item"; shipment page: "Items 100", "100 pieces: 97 delivered"; cases list: "RTX-A765FEE3-A · 1 pcs"; transfers: "2 · 75 pcs"; case page "1 pieces, 10 kg"; "Evaluating 1 vehicles". Vendors see "10 pieces", "1 piece". Weight is always "kg" with Indian grouping, which is fine.
- **Why it confuses:** "Items" can be read as line items; "1 pieces" looks careless.
- **Fix:** Use "pieces" (the vocabulary on the driver and manifest side), add `formatPieces(n)` with correct singular next to `formatKg` in `utils/display.ts`, and replace "pcs".

### UX-11 · Minor · Manifest, Analytics · ISO dates and unformatted numbers beside "1 Oct 2026"
- **Screenshot:** R1 `superadmin-shipments_cbed3362_..._manifest.png`, `superadmin-analytics_tab_finance.png`
- **What's wrong:** Manifest: "Dispatch date 2026-10-01", "Estimated arrival 2026-10-02 (Est.)", "Distance (km) 1424.8". Analytics "Net profit by day" axis shows "2026-09-06 ... 2026-10-01" beside "3 Sep, 5 Sep" on the chart above. The native date field on "Mark as paid" follows the browser locale (10/01/2026 in the test browser).
- **Why it confuses:** "10/01/2026" is 10 January or 1 October depending on the reader.
- **Fix:** Use `formatDate` and `formatKm` (`1,425 km`) on `ShipmentManifestPage.tsx` and the chart axis formatter in `components/analytics/FinanceTab.tsx`; show the typed date back as "1 Oct 2026" under date inputs.

### UX-12 · Minor · All lists · Status column moves around; Vehicle column shows different things
- **Screenshot:** R1 `superadmin-shipments.png`, `superadmin-routes.png`, `superadmin-money_tab_invoices.png`, `superadmin-cargo.png`, `superadmin-cargo_tab_claims.png`
- **What's wrong:** Status is column 2 on Shipments, Trips, Cases and Transfers; column 3 on Fleet; the last column on Invoices; column 4 on Claims. The Shipments "Vehicle" column shows the plate and driver for RTX rows but only "Sunil Driver" for CM rows (and for a "Created" shipment). On Trips the vehicle is the first column, on Shipments the fifth. Row click opens a full page on Trips, People, Problems, Fleet and Invoices, but a side drawer on Claims.
- **Why it confuses:** Eyes cannot learn where to look; a driver name where a plate is expected.
- **Fix:** Agree an order (identifier, status, from/to, vehicle, amount, date, actions) and apply in each page's `columns`; always show plate over driver in a shared `VehicleCell`; pick page or drawer per type and say so in `docs/ui-guide.md`.

### UX-13 · Minor · Lists · CSV export on some lists only
- **Screenshot:** R1 `superadmin-requests.png`, `superadmin-cargo.png`, `superadmin-cargo_tab_claims.png`, `superadmin-money_driver_pay.png`, `superadmin-return_trips_tab_partners.png`
- **What's wrong:** "Export CSV" exists on Requests, Shipments, Trips, Fleet, Invoices, Expenses, Audit log ("Export people" on People). It is missing on Problems (cases, transfers, claims), Money > Claims, Driver pay trips (the list accountants use most), Return trips (bids), 3PL partners, and Analytics tables. Claims has no "Raise claim" button on either tab (it exists only inside a case).
- **Why it confuses:** The user searches for the button, then copies rows by hand.
- **Fix:** Add the existing CSV helper to `CasesTab`, `ClaimsTab`, `DriverPayTab`, `BidsTab`, `PartnersTab`; keep the button in the same place (right of the page actions).

### UX-14 · Minor · Requests, Money, KYC, Dispatch · Pages open on an empty tab while the work sits in another
- **Screenshot:** R1 `superadmin-requests.png`, `superadmin-requests_source_vendor.png`, `superadmin-money.png`, `superadmin-admin_kyc.png`
- **What's wrong:** Requests opens on "To accept 0" ("Nothing waiting to be accepted") with "Done 2" beside it; `?source=vendor` still lands on the empty To accept tab while the counter says "Done 1". Money opens on "To price 0" while Invoices holds "Outstanding ₹28,600, 3 unpaid". KYC opens on "Waiting for review 0" with "Approved 1". Dispatch opens on "Needs a vehicle 0".
- **Why it confuses:** The first impression is "no data".
- **Fix:** When the default tab is empty and another has rows, open the first non-empty tab (or show a one-line "2 in Done" link in the empty state). `useTabParam` accepts a fallback; compute it from counts in `RequestsPage.tsx`, `MoneyPage.tsx`, `KycReviewPage.tsx`.

### UX-15 · Minor · Create shipment · The form opens already showing red errors
- **Screenshot:** R1 `superadmin-shipments.png` (after the wizard steps), `superadmin-shipments-m.png`
- **What's wrong:** On step 1, before any typing, Pickup and Destination have red borders and "Choose a pickup address from the suggestions." / "Choose a destination from the suggestions." The dialog's footer has "Minimize", "Start over", "Next: Cargo" with equal weight, and "Start over" opens a confirm that says "Everything entered for this shipment is cleared" (wanted), but the draft banner "Your draft is kept if you close this window" sits under the title next to a Close X, so it is unclear which destroys data.
- **Why it confuses:** Looks like the user already made a mistake.
- **Fix:** Show errors only after a blur or a Next click; show the hint in muted text before that (`components/shipments/wizard/RouteStep.tsx`, `PlaceSearch`). Make Start over a ghost button on the left, as it is, but rename "Clear draft".

### UX-16 · Minor · Manager, customer · Blocked pages redirect silently
- **Screenshot:** R1 `manager-money.png` (all land on `/today`), `customer-today.png`, `vendor-today.png`
- **What's wrong:** A manager opening `/money`, `/analytics`, `/return-trips`, `/admin/settings`, `/admin/audit`, `/admin/kyc` or a person's `?tab=bank` is sent to Today or Overview with no message. A customer who signs in on the web lands on `/login` again with no message ("For operations staff and drivers."); the customer app is the product, but nothing says so. Menu hiding for a manager is clean (no broken links); the bank tab is removed.
- **Why it confuses:** A bookmark or a link from a colleague appears to do nothing.
- **Fix:** On redirect, show a toast "Your role cannot open Money. Ask an administrator" (`PrivateRoute` in `App.tsx`); on the login page add "Customers: use the MargixIndia app, or track a shipment here".

### UX-17 · Minor · Trip detail at 390 px · The page scrolls sideways
- **Screenshot:** R1 `superadmin-routes_874fa20d_..._-m.png` (402 px wide; every other mobile page is 390)
- **What's wrong:** The "Vehicle MH04E2E0001" stat card runs past the right edge because the plate is set in 24 px type. Also at 390 px: the notifications panel and the drawer look right, but the Shipments list expands every row into a stacked card of 8 lines, which makes the list 1,100 px for four shipments.
- **Why it confuses:** Horizontal scroll on a phone cuts the card and the ETA.
- **Fix:** `Stat` value should `truncate` or use `text-lg` for text values (`components/ui/Stat.tsx`, used in `RouteDetailsPage.tsx`).

### UX-18 · Minor · Menu and tabs · Same thing in two places; names that do not match the target
- **Screenshot:** R1 `superadmin-cargo_tab_claims.png`, `superadmin-money_tab_claims.png`, `superadmin-money_driver_pay.png`, `superadmin-routes_status_pending.png`, `superadmin-analytics_tab_vehicles.png`
- **What's wrong:**
  - Claims: a Claims tab under Problems and another under Money, the same table.
  - Driver pay: a Money tab and a full page `/money/driver-pay` with a different title.
  - Fleet has "Analytics / Alerts / Service due" tabs, and Reports > Analytics has "Vehicles / Fleet health" tabs.
  - Sidebar "Trips to send" opens Trips on a tab labelled "Not started"; Dispatch has its own "Trips to send" tab (a different list).
  - People page title says "Drivers and staff" but has a Vendors tab, and "Needs attention 4" equals All 4.
  - Return trips tab strip shows counts on only two of four tabs.
- **Why it confuses:** Two doors to one room, so counts and filters drift apart.
- **Fix:** Keep Claims in Money, link from the case; point the driver-pay menu entry at the tab and redirect `/money/driver-pay`; rename the Trips tab "Not started" to "To send" (or the nav entry to "Not started"); drop the "Needs attention" tab when it equals All.

### UX-19 · Minor · Problems, transfers, lots · "Part B due", "Add" and "Count mismatch" without explanation
- **Screenshot:** R1 `superadmin-cargo_tab_transfers.png`; R2 `superadmin-cargo_transfers_f8a9063a_....png`
- **What's wrong:** Transfers list "Check: Count mismatch · Part B due" for a Completed transfer; the transfer page header "E-way bill: Part B, the vehicle number" with an amber box; lots show "Part B due" and a bare "Add". The completed transfer is also headed with a red "Counts do not match" box and "Planned 75 · Out 75 · In 74 pieces".
- **Why it confuses:** Only people who file e-way bills know Part B; a mismatch on a completed transfer reads as "unresolved" though a shortage case already exists.
- **Fix:** "E-way bill: update the vehicle number (Part B)" and a link "Open the e-way bill portal"; "Add" becomes "Add e-way bill"; on a Completed transfer replace the red box with "1 piece short: see case EXC-…" (link). Files: `pages/cargo/TransferPage.tsx`, `components/cargo/TransfersTab.tsx`, `LotsPanel.tsx`.

### UX-20 · Minor · Return trips · Nested "Combine loads", auto-accept after 2 minutes, ineligible options
- **Screenshot:** R1 `superadmin-return_trips_tab_pool.png`, `superadmin-return_trips_tab_bids.png`, `superadmin-return_trips.png`; the open modal in run 1's `open-return` step
- **What's wrong:** The "Combine loads" tab contains a sub-tab also called "Combine loads" (next to "Open loads", "Match a return load", "Price a load", "Confirm delivery"). "Driver confirmations" says an unanswered award "is accepted automatically" after 2 minutes, while the status reads "Not yet seen by driver". Ended rows read "truck · Empty return trip" (lowercase). The "Open a return trip" modal's "Linked shipment" list offers delivered lots (RTX-A765FEE3-B) and shipments already assigned.
- **Why it confuses:** A driver who has not seen a new stop is committed to it; staff pick a shipment that cannot be moved.
- **Fix:** Rename the sub-tab "Plan"; show "Will be accepted for the driver at 1:33 pm" with a countdown, or require a tap; capitalise "Truck"; filter the list to shipments without a vehicle (`components/backhaul/OpenWindowModal.tsx`, `components/returnTrips/*`).

### UX-21 · Minor · Money, Driver pay · A cancelled trip paid in full; "Straight line"; Finance labels
- **Screenshot:** R1 `superadmin-money_tab_driver_pay.png`, `superadmin-analytics_tab_finance.png`, `superadmin-routes_874fa20d_....png`
- **What's wrong:** Driver pay row "TR-874FA20D · 289.3 km Straight line · ₹3,393 · Paid", but that trip's page says "Cancelled" and plans 1,854.5 km. The row does not say it was paid for the leg driven before a transfer. "Straight line" is not explained. Money's description is a three-sentence paragraph ("Price deliveries, follow invoices, ... Payments are offline ... Profit and loss is in Reports."). Analytics Finance lists "MH04E2E0001 · in progress · 0 km · ₹7,500" for that same cancelled trip.
- **Why it confuses:** Paying for a cancelled trip looks like an error; two distances for one trip.
- **Fix:** Add a sub-line on part-trip pay ("Part trip: until handover to MH04E2E0002"); tooltip "Straight line: distance between stops, not by road"; shorten the Money description to one line and move "Payments are offline" next to Mark paid; fix the status shown in Finance (`components/analytics/FinanceTab.tsx`).

### UX-22 · Minor · Vendor portal · Verified company with no PAN, bank or documents; onboarding reopens
- **Screenshot:** R1 `vendor-vendor_company.png`, `vendor-vendor_onboarding.png`, `vendor-vendor_invoices.png`, `vendor-vendor_loads_bell.png`
- **What's wrong:** Company shows "KYC approved: Your company is verified" with "PAN —", "Contact —", "Bank account —", "No documents uploaded yet". `/vendor/onboarding` still opens the empty four-step wizard for an approved vendor, with the message "The last character does not match the rest of the GSTIN" for the GST that was approved. Invoices: "Oldest unpaid: Today" (a date, not a label), "How to pay" appears twice on one page, and the page heading "Invoices & proofs" is a different name from the menu's "Invoices & proofs" vs the card "Invoices". The notification titled just "Approved" has no object. Loads list shows two id styles (RTX-8262DCA, CM-C7778EDD).
- **Why it confuses:** Verified with nothing on file looks like a mistake; "Approved" alone could be a bid, a load or KYC.
- **Fix:** Redirect approved vendors from `/vendor/onboarding` to Company; show "Not provided" and an "Add" link for empty KYC fields; title bid notifications "Bid approved" (`backend-ts` notification text); show the date ("Due 16 Oct") in Oldest unpaid; one How-to-pay block.

### UX-23 · Minor · Driver `/driver` · Origin and next stop identical; Complete delivery with no trip
- **Screenshot:** R1 `driverB-driver-m.png`, `driverA-driver-m.png`
- **What's wrong:** Sunil's Current trip shows "Pickup: Acme Logistics — Origin" and then "Pickup: Acme Logistics — Next stop" (the same place twice). With no trip ("No active trips assigned"), Ravi still sees "Go online" and "Complete delivery". Tab "Nav" is jargon; the greeting card repeats "MargixIndia driver" under the "MargixIndia Driver" header. The page body is short, so "Cargo details" is below the fold at 390 px while "Live vehicle status" (Speed — GPS Off) is above it.
- **Why it confuses:** The driver's next action should be the biggest thing on the page.
- **Fix:** Put the next action ("Go to pickup: Acme Logistics, 45.2 km") first, hide Complete delivery until a stop is active, rename "Nav" to "Navigate"; move Live vehicle status below Cargo details (`DriverPage.tsx`, `driver-app/src/locales`).

### UX-24 · Minor · SOS page, vehicle page · Eight equal buttons; Raise SOS is the loudest button on a healthy vehicle
- **Screenshot:** R2 `superadmin-emergency-resolve.png`, `superadmin-fleet_0d0c13a2_..._-raise_sos.png`
- **What's wrong:** An active SOS card shows Call driver, Live map, Google Maps, Acknowledge, Resolve, Create maintenance job and Return to service (with False alarm below) as same-size buttons that wrap into four rows. "Return to service" is offered while the SOS is active and the vehicle in maintenance. On the vehicle page the filled red "Raise SOS" sits first among "Live map, Analytics, Move to maintenance, Edit". Resolve and Raise SOS do ask for confirmation (good); the Raise SOS note "The alert is marked as raised by staff" is fine.
- **Why it confuses:** In an emergency the next step (call the driver, acknowledge) is not stronger than the rest; on a normal day the red button invites a misclick.
- **Fix:** One primary per state (Acknowledge, then Resolve), the rest in a "More" menu; show Return to service only after resolve; make Raise SOS a secondary button in a "More actions" menu on the vehicle page (`EmergencyPage.tsx`, `VehicleDetailPage.tsx`).

### UX-25 · Polish · Several · Smaller layout and copy items
- **Screenshot:** as listed
- **What's wrong:**
  - R1 `superadmin-today.png`: the notification panel is cut off mid-sentence ("A vendor bid ₹9,000 for 1,500 kg on MH04E2E0...") and overlaps the sidebar's right edge.
  - R2 `-cancel.png`: "Cancel this trip? The vehicle and driver will no longer see this trip as active." says nothing about the shipments on it (they return to "Needs a vehicle"). A cancelled trip shows a red "Delete" beside a faded "Cancel trip".
  - People: "Employee code" is "Not set" for everyone and "Last sign-in" is "Never" in every row (two wasted columns); five buttons of equal weight in the header (Export people, Expiring documents, Import, Add vendor, Add person).
  - Claims drawer: step list reads "Draft (done) Filed (done) Surveyed (done) 4 Approved (now) 5 Settled" (numbers only on later steps); amount fields show an empty "₹".
  - Case page: "Owner Unassigned / Take it / Assign" on a Resolved case.
  - Requests: Age shows "12 seconds ago" on a Done request (age since creation, not since delivery).
  - Shipments list "Pickup" shows the vendor's name (Acme Logistics) as the pickup on vendor loads and the address on others.
  - Fleet and People tables carry six to eight columns at 1440 px, so the Actions header is unlabeled.
- **Why it confuses:** Small things, but each makes the app feel less finished.
- **Fix:** Wrap the notification text to two lines and anchor the panel under the bell; add the consequence to the cancel copy and show Delete only for a trip with no history; hide columns that are empty for every row; number all steps; hide Owner controls on closed cases.

---

Runs: `36830538115` (UX.sh) and `36832245352` (UX2.sh), both from branch `uat/ux-review`.
