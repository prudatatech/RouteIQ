# UX review, pass 2

Pass 1 is in [UX.md](UX.md) (UX-01 to UX-25, all marked fixed). This pass re-shot the same pages and states on a fresh throwaway stack, filled the pass 1 coverage gaps and looked for problems the fixes may have caused.

Runs (branch `uat/ux-pass2`, shot names are in `e2e/shots/` of each run's `uat` artifact; `-m` is 390 px):
- R1 `36837101186`, `e2e/scenarios/UX3.sh`: part A re-shoots UX.sh and UX2.sh (about 14 min), part B fills the gaps. Story 75 of 75.
- R2 `36840715442`, `e2e/scenarios/UX3b.sh` (part B again, with the wizard labels and mobile selectors fixed).
- R3 `36842051333`, `e2e/scenarios/UX3c.sh` (the rate-the-driver form; the lookup in UX3.sh used a column that does not exist).

New tooling: `e2e/ux.mjs` (like `ui.mjs`, plus focus order, status pill colours, localStorage, sideways-scroll check) and the steps in `e2e/scenarios/ux/gap-*.json`, `wizard-full.json`, `wizard-multi.json`, `focus-*.json`, `pills.json`, `overflow.json`. The Create shipment draft is injected through `localStorage` (address search is not available on the runner), so every wizard step could be shot.

Test-harness notes, not app bugs: full-page screenshots draw a modal's overlay over the first viewport only, so a modal can look offset in `...-hold_empty.png` and similar; at 390 px a table and its stacked card are both in the page, so a plain `button:has-text()` finds the hidden one (use `:visible`).

## Verification of pass 1

19 verified, 6 reopened (UX-04, UX-06, UX-07, UX-10, UX-13, UX-18). Every page that was shot loaded without a layout break at 390 px (R1 `fits` list: 40 pages, none wider than 390 px, trip detail included).

| UX id | verified/reopened | evidence |
| --- | --- | --- |
| UX-01 | verified | R1 `customer-track_RTX_74130BD8-m.png`: "Lots · 2 of 3 delivered", one line per lot, history is Created, Vehicle assigned, In transit, Partly delivered; no "Delivery failed", no "Not yet assigned". Residue: all five step circles are ticked and "Time to arrival" reads "Partly delivered". |
| UX-02 | verified | R1 `superadmin-fleet_93e69624_..._tab_maintenance.png`, `..._tab_fuel.png`: "5 documents not uploaded", Documents tab badge 5, "Not reported. The vehicle has not sent a reading yet", one wording "Never reported a position", Maintenance links to the Documents tab. |
| UX-03 | verified | R1 `superadmin-shipments_7c873f6c_...png`: "Invoiced per lot", one Lots panel, custody history collapsed ("Show 17 earlier entries"), "Add e-way bill" labelled. The repeated split sentence is still on the case page (see UX-33). |
| UX-04 | reopened | Palette and Audit are fixed (no enum values, subtitle "Everything staff and the system changed"). But `/cargo/exceptions/not-an-id` (R1 `superadmin-cargo_exceptions_not_an_id.png`) is still a blank grey skeleton under a "Problems" back link, with a 400 in the console and no "We could not find that case". |
| UX-05 | verified | Case page "75 pieces, 750 kg in 2 shipments"; invoice line "shipment RTX-74130BD8-A"; Analytics says "Add an expense in Money"; modal title "Raise a problem". Residue: "Resolved: transshipped. Transfer TRF-HAGS2E completed" (case outcome text). |
| UX-06 | reopened | Manager no longer sees any key text. A superadmin still reads "Add a TomTom key in the server settings" on every map card (Today, Assign modal, wizard step 3, trip page) and "Add an OpenWeather key"; Optimize still says "Plans with OR-Tools" and "Plans with a genetic algorithm". Admin-only wording is acceptable; the solver names are not. |
| UX-07 | reopened | Text fixed ("Live ETA is not available right now."). The request still fails: `http 503 POST /api/v1/routing/directions` and a console error on every trip page and on the Create shipment wizard (R1 `superadmin-shipments-full-end.png` problems list). A healthy page should not call a service it knows is off. |
| UX-08 | verified | R1 `superadmin-today.png`: Active trips 1, Vehicles on the road 1; Fleet "On trip · 1"; one "Nothing else waiting: ..." line; the people card is separate. |
| UX-09 | verified | Trips list and trip page use `TR-3D88B32C` style codes; `TR-900BFF1C` in the case timeline; driver pay row uses the same. |
| UX-10 | reopened | Dispatch "Needs a vehicle" still says "1 item" and "20 items" (R1 `superadmin-dispatch_tab_needs_vehicle` / `superadmin-dispatch-assign_done.png`) while Shipments says "1 piece", "20 pieces". |
| UX-11 | verified | Manifest and Analytics dates formatted. Residue: the booking notification says "pickup 2026-10-01" (UX-34). |
| UX-12 | verified | Status is column 2 on Shipments, Trips, Cases, Transfers; Trips lists vehicle plate over driver. |
| UX-13 | reopened | Export CSV now on Cases, Claims (both places), Driver pay, Bids and Partners. Still missing on the Transfers tab (R1 `superadmin-cargo_tab_transfers.png`) and Hubs. |
| UX-14 | verified | R1 `superadmin-money.png` opens on Invoices (To price 0); Requests opened on "To accept 1" when a booking waited. |
| UX-15 | verified | R1/R2 `superadmin-shipments-full-w1_route_filled.png`: no red errors on step 1, muted hint "Type an address and choose it from the suggestions"; "Start over" opens "Clear draft" confirm. |
| UX-16 | verified | Manager on `/money`: "You don't have access to this page (Money). Ask an administrator if you need it." |
| UX-17 | verified | `fits /routes/<id>: page 390px in a 390px viewport`; same for all 40 pages checked (R1 B12). |
| UX-18 | reopened | Trips tab renamed "To send" and People tab fixed, but Claims is still a tab under Problems and under Money (same table). New: on Money, Invoices tab open, the sidebar highlights "To price" (R1 `superadmin-money.png`). |
| UX-19 | verified | Transfers list "Update e-way bill", lots "Update vehicle on e-way bill" plus "Add e-way bill". Residue: "Part B due" still shows on a Completed transfer on the case page. |
| UX-20 | verified | Sub-tab is "Plan"; Driver confirmations shows "Accepted automatically, driver offline". |
| UX-21 | verified | Driver pay: "Part trip: trip cancelled, paid for the leg driven", "Straight line: the distance between the stops as a bird flies, not by road"; Money description is one line. |
| UX-22 | verified | `/vendor/onboarding` redirects to Company; "Not provided · Add" on PAN, Contact, Bank. |
| UX-23 | verified | R1 `driverB-driver-m.png`: next stop first, no duplicate origin; with no trip (driverA) there is no Complete delivery. |
| UX-24 | verified | R1 `superadmin-emergency-resolve.png`: Acknowledge as the one primary, Call driver, More. |
| UX-25 | verified | Cancel-trip copy now says "Its shipments go back to Needs a vehicle" (R1 `superadmin-routes_3d88b32c_..._cancel.png`); claims steps numbered 1 to 5. Residue: "Employee code" still in People (6 hits), see UX-37. |

## Coverage gaps from pass 1: what the new shots show

| Gap | Shots | Result |
| --- | --- | --- |
| Accept form | R1 `superadmin-requests-accept_form.png`, `..._accept_bad_price.png` | Works. Price empty with the hint "No quote was given"; -5 gives "Enter a price of 0 or more, or leave it empty." |
| Set price | R1 `superadmin-money-set_price_form.png`, `..._set_price_bad.png`, `..._set_price_saved.png` | Works ("Enter a price greater than zero"). The modal only exists for a delivered shipment with no price; an accepted booking without a price has no Set price step (the page says "Accepted, no price" for vendor loads only). |
| Assign vehicle | R1 `superadmin-dispatch-assign_form.png`, `..._assign_done.png` | Works, "Send to driver now" can be unticked, toast "Assigned. Send the trip from Dispatch → Trips to send." See UX-29, UX-30, UX-35. |
| Send | R1 `superadmin-dispatch_tab_to_send-send_clicked.png` | Confirm "Send this trip to the driver?" is clear. |
| Create shipment wizard | R2 `superadmin-shipments-full-w1..w5`, `-multi-m1..m5` | All four steps, the bad-pieces error ("Enter a whole number of 1 or more."), the review, creation and the two-drop split (12 + 8) work, also at 390 px. |
| Hold, Cancel shipment, Take off vehicle, Delete | R1 `superadmin-shipments_6971d2bd_...-hold_form/hold_empty/hold_done/cancel_confirm/take_off_confirm/take_off_done.png`, `..._58a41a5a_...-cancel_done.png`, `..._adcc9e9a_...-delete_confirm/delete_done.png` | Every one has a confirmation with a safe default and clear button names. Bugs: UX-26, UX-28. |
| Rate the driver | R3 `superadmin-shipments_a832da07_..._r31-rate_saved.png` | Works ("Rating saved", "Very good"). |
| Fuel log, bad odometer | R1 `superadmin-fleet_93e69624_..._tab_fuel-fuel_low_odometer.png`, `..._fuel_negative_odometer.png` | 422 text "The odometer reads 100 km, but the fill before this one was at 50000 km. Check the reading." See UX-32. |
| Claim above declared value | R1 `superadmin-cargo_exceptions_712a992d_...-claim_over_declared.png` | 422 shown as a red box: "These goods have no declared value, so a claim cannot be more than ₹1,00,000. Ask the office to review a larger claim." See UX-31. |
| Manager: Problems > Claims, Fleet > Analytics | R1 `manager-cargo_tab_claims-end.png`, `manager-fleet_view_analytics-end.png`, `manager-fleet_tab_analytics-end.png` | Both load with no console error or failed request; claim drawer opens. |

### Status colours
Pill colours were read from 38 pages (staff, vendor, customer). No label has two colours (R1 `e2e/out/pills.raw`, summary at the end of `scenario.txt`). Observations: Created and Cancelled share the same grey (and Not started, Customer, Vendor too); Approved and Delivered are green, Accepted needs a vehicle and Issued blue, Open, High, New, On hold and Partly delivered amber, Critical red. Deadline countdown "3 h 40 min left" is green. See UX-39.

### Keyboard focus order (R1 B10, R2)
- Login: Tab goes brand link, Staff tab, Email, Password, Show password, Forgot password, Sign in, Track a shipment. Good.
- Every staff page starts with "Skip to content", then Search, Notifications, then 14 sidebar links, Collapse and Sign out (17 stops) before the page. The skip link exists, so this is acceptable.
- Modals open with the dialog itself focused, Tab stays inside (no leak), and a wrap goes Close, fields, Cancel, primary. Accept and Raise claim: Close first, then the field; Set price and Hold focus their field first. See UX-31.
- Create shipment step 1 has 11 tab stops in the map (markers, recenter, zoom, fullscreen, attribution) between Destination and the footer buttons; step 3 and the Assign modal put the map markers (five with the identical name "Open load from Bhiwandi warehouse, 300 kg") before the vehicle list. See UX-30.
- Driver `/driver` and vendor `/vendor/request`: order follows the visual order.

## New findings

| # | Sev | Page | Title |
| --- | --- | --- | --- |
| UX-26 | Major | Shipment page | "Take off vehicle" says it worked but the shipment keeps its vehicle, driver and trip |
| UX-27 | Major | Shipment history, tracking | Every new shipment's history says "With 3PL partners" |
| UX-28 | Minor | Shipment page | Hold on a shipment with no vehicle shows "On the road" and a "Release or move it" prompt |
| UX-29 | Minor | Assign modal, wizard step 3 | "Driver licence missing" next to "2 of 2 vehicles can take this" and an enabled Assign |
| UX-30 | Minor | Assign modal, wizard | Map markers come before the list in keyboard order, with identical names |
| UX-31 | Minor | Modals | First focus differs: Accept and Raise claim do not focus their field; claim hint contradicts the 422 |
| UX-32 | Minor | Add fuel | The odometer error shows as loose text under the form, not on the Odometer field |
| UX-33 | Polish | Problem case page | "2771 min away", repeated split sentence, "Raised by the driver" twice |
| UX-34 | Polish | Notifications | "pickup 2026-10-01" in a booking notification |
| UX-35 | Minor | Sidebar | Counts lag the page; Money highlights "To price" on Invoices |
| UX-36 | Polish | Cancelled shipment, cancelled trip | Offers that no longer apply |
| UX-37 | Polish | Several | Small copy and layout items |
| UX-38 | Polish | Delete shipment | The deleted page asks for itself once more (404 in console) |
| UX-39 | Polish | Status pills | Created and Cancelled share one grey |

### UX-26 · Major · Shipment page · "Take off vehicle" says it worked but the shipment keeps its vehicle, driver and trip
- **Screenshot:** R1 `superadmin-shipments_6971d2bd_24d9_43ec_8555_bf1181fc496a-take_off_done.png`, `..._hold_done.png`; `superadmin-shipments_adcc9e9a_...-delete_done.png` (list)
- **What's wrong:** After the confirm "Take RTX-241C66E5 off its vehicle?" the toast says "Status changed to created" and the banner says "Needs a vehicle. Accepted, with no trip yet." In the same view Related still lists Trip TR-DB2D374B (Not started, 2 stops), Vehicle MH04E2E0001 and Driver Ravi Driver, and "Cargo and vehicle" still shows both. After a reload the Shipments list still shows the row with MH04E2E0001 and Ravi Driver (status On hold after the next step). The confirm text promised "its stop leaves the trip and the driver is told".
- **Why it confuses:** Staff cannot tell whether the truck is free; the trip still carries a stop for a shipment that is "waiting for a vehicle".
- **Fix:** On the server, clear vehicle, driver and route stop when the status goes back to created (the same path as unassign), and invalidate the shipment, overview and trips queries in `statusMutation.onSuccess` (`components/shipments/ShipmentSections.tsx`). If the vehicle is meant to stay, change the confirm and banner wording.

### UX-27 · Major · Shipment history and public tracking · Every new shipment's history says "With 3PL partners"
- **Screenshot:** R1 `superadmin-shipments_6971d2bd_..._assigned_page.png`, `..._58a41a5a_...-cancel_done.png`, R3 `..._a832da07_..._r31-rate_saved.png`
- **What's wrong:** A shipment accepted from a customer booking and assigned to an own truck reads Created, **With 3PL partners**, Vehicle assigned. Cancelled before assignment: Created, With 3PL partners, Cancelled. The shipment never went to a partner (UX-01 listed the same label on a lot).
- **Why it confuses:** Dispatchers think the load has been handed out, and a 3PL hand-off section (offer this load to partners) appears on the page.
- **Fix:** Do not record the `escalated` status event when a booking is confirmed (or label it "Accepted"); keep "With 3PL partners" for a real escalation. Files: the confirm route in `backend-ts`, `historyEntries` in `components/shipments/format.ts`.

### UX-28 · Minor · Shipment page · Hold on a shipment with no vehicle shows "On the road" and "Release or move it"
- **Screenshot:** R1 `superadmin-shipments_6971d2bd_..._hold_done.png`
- **What's wrong:** A shipment that never left the warehouse and was put on hold has the progress bar on "On the road" and the action "Release or move it". Related still says booking "Confirmed, needs a vehicle". "1 not accounted for" in amber is shown for goods nobody has picked up (also on a cancelled shipment, `..._58a41a5a_...-cancel_done.png`).
- **Why it confuses:** The page claims a movement that did not happen and alarms about missing goods.
- **Fix:** In `nextStep.ts` take the stage from the status before the hold (or "Dispatch" when there is no pickup event); show "not accounted for" only after pickup; label the action "Release hold".

### UX-29 · Minor · Assign modal and wizard step 3 · "Driver licence missing" beside "2 of 2 vehicles can take this"
- **Screenshot:** R1 `superadmin-dispatch-assign_form.png`; R2 `superadmin-shipments-full-w3_vehicle.png`
- **What's wrong:** Both trucks carry an amber "Driver licence missing" badge, the counter says "2 of 2 vehicles can take this", and Assign is enabled and works.
- **Why it confuses:** A warning that does not block is read as noise, and one that should block is missed.
- **Fix:** Decide the rule. If a missing licence blocks driving, disable Assign and count it out; if not, call it "Licence not on file" and keep the count.

### UX-30 · Minor · Assign modal and wizard · Map markers come before the list in keyboard order, with identical names
- **Screenshot:** R1 text of `##### ux superadmin /dispatch --steps gap-assign.json` (TAB 2 to TAB 8), `ux superadmin /shipments --steps wizard-full.json` (TAB 5 to TAB 10)
- **What's wrong:** Tab reaches the map, then five markers all named "Open load from Bhiwandi warehouse, 500 kg" or "300 kg", before the vehicle list, "Send to driver now" and Assign. In wizard step 1 there are 11 stops inside the map. The marker names carry no tracking ID, so they cannot be told apart by a screen reader.
- **Why it confuses:** A keyboard user needs about ten Tab presses to reach the first Assign button.
- **Fix:** Put the map after the list in DOM order (or `tabIndex={-1}` on its markers and controls, with the list as the keyboard route), and name each marker with the tracking ID and drop ("RTX-96E9B943, 300 kg to Patliputra"). Files: `components/map/*`, `AssignVehicleModal.tsx`, `wizard/VehicleStep.tsx`.

### UX-31 · Minor · Modals · First focus differs; claim hint contradicts its error
- **Screenshot:** R1 `superadmin-requests-accept_form.png`, `superadmin-cargo_exceptions_712a992d_...-claim_over_declared.png`
- **What's wrong:** Accept request and Raise claim open with the dialog focused and the first Tab lands on Close (X), then the field; Set price, Hold and the wizard behave differently (field focused, or the wizard focuses the dialog). In the claim form the hint under Amount claimed says "The declared value is filled in from the invoice" while the error says "These goods have no declared value". The red 422 box also stays after the user edits the amount to -5, next to the new field error "Enter an amount above ₹0."
- **Why it confuses:** Inconsistent first focus; a hint that is false for this case; a stale error.
- **Fix:** Give the first field `data-autofocus` in `AcceptBookingModal` and the raise-claim body; show the hint only when a declared value exists, otherwise "No declared value: claims are limited to ₹1,00,000"; clear the server error on change (`ExceptionActionModal.tsx`).

### UX-32 · Minor · Add fuel · The odometer error shows as loose text, not on the Odometer field
- **Screenshot:** R1 `superadmin-fleet_93e69624_..._tab_fuel-fuel_low_odometer.png`
- **What's wrong:** "The odometer reads 100 km, but the fill before this one was at 50000 km. Check the reading." appears in red under the checkboxes, 300 px away from the Odometer field, which keeps its normal border. The numbers have no thousands separator (50000), unlike the table (50,000 km).
- **Fix:** Attach a 422 about the odometer to `errors.odometer` (mark the field red, focus it) and format with `formatKm`. Files: `components/fleet/fuel/VehicleFuelTab.tsx`, `backend-ts/src/services/fuel-engine.ts` (the message text).

### UX-33 · Polish · Problem case page · "2771 min away" and repeated sentences
- **Screenshot:** R1 `superadmin-cargo_exceptions_712a992d_...-claim_over_declared.png`
- **What's wrong:** Relief vehicle "1,421.2 km · 7,700 kg free · 2771 min away" (should read 46 h 11 min); the timeline's Split entry repeats its sentence ("Lot B: 25 of the 100 pieces of RTX-74130BD8 (one lot per drop). Lot B: 25 of ..."), which UX-03 asked to strip.
- **Fix:** Use `formatMinutes` in the relief list; de-duplicate in `backend-ts/src/services/cargo/consignment.ts` (event text).

### UX-34 · Polish · Notifications · ISO date in a booking notification
- **Screenshot:** R1 notifications text in `superadmin-today.png`
- **What's wrong:** "New customer booking: Bhiwandi warehouse to Sharma Traders, 1000 kg, pickup 2026-10-01" (no thousands separator either).
- **Fix:** Format the date as "1 Oct 2026" and weight as "1,000 kg" where the notification is built in `backend-ts`.

### UX-35 · Minor · Sidebar · Counts lag the page; wrong item highlighted
- **Screenshot:** R1 `superadmin-dispatch-assign_done.png`, `superadmin-money.png`
- **What's wrong:** Right after assigning, the tab says "Needs a vehicle 4" while the sidebar sub-item still says 5; Today's "On the road 3 waiting" vs "2" a few seconds later. On Money, with the Invoices tab open, the sidebar highlights "To price".
- **Fix:** Invalidate the queue-count query when a shipment is assigned or a trip is sent; derive the sidebar highlight from the active tab (`useTabParam` default) rather than the first sub-item.

### UX-36 · Polish · Cancelled shipment and cancelled trip · Offers that no longer apply
- **Screenshot:** R1 `superadmin-shipments_58a41a5a_...-cancel_done.png`, `superadmin-routes_900bff1c_...png`
- **What's wrong:** A cancelled shipment still shows the "3PL partners: Offer this load to partners" block and a red Delete button; a cancelled trip still shows "Run optimizer".
- **Fix:** Hide 3PL and optimizer offers for terminal statuses; keep Delete as a ghost button.

### UX-37 · Polish · Several · Small copy and layout items
- **Screenshot:** R1 `superadmin-requests-m-end-m.png`, `superadmin-dispatch_tab_to_send-send_clicked.png`, R1 People page text
- **What's wrong:**
  - Requests at 390 px: "Pickup → drop" value "Bhiwandi warehouse → Mehta Stores" is clipped at the card edge.
  - Requests list: the Price cell "Not priced" wraps to two lines at 1440 px.
  - Trips to send: "Planned by: Trip" (the source label says nothing).
  - People: "Employee code" still a column that is "Not set" for everyone.
  - The row action "Accept & price" uses "&" (UX-05 asked for "and").
  - Today: "0 live · 0 offline of 2 tracked" reads as a contradiction next to "Vehicles on the road 1".
  - Wizard step 1 hint "Type an address and choose it from the suggestions" appears while the address is already chosen.
- **Fix:** Wrap the clipped cell, `whitespace-nowrap` on Price, rename "Trip" to "Dispatcher" or the user name, hide empty columns, "Accept and price".

### UX-38 · Polish · Delete shipment · The deleted page asks for itself once more
- **Screenshot:** R1 `superadmin-shipments_adcc9e9a_...-delete_done.png`
- **What's wrong:** After Delete the app returns to the list (good, toast "Shipment deleted") but `GET /shipments/<id>/overview` returns 404 and logs a console error, because the page's query refetches before the navigation.
- **Fix:** Navigate first or remove the query data (`removeQueries`) in `useDeleteShipment`'s `onSuccess`.

### UX-39 · Polish · Status pills · Created and Cancelled share one grey
- **Screenshot:** R1 `e2e/out/pills.raw`; `superadmin-shipments-full-w5_created.png`
- **What's wrong:** Created, Cancelled, Not started, Customer and Vendor all use `rgb(244,244,245)` on `rgb(82,82,91)`. In the Shipments list a cancelled row is not distinguishable by colour from a fresh one. Nothing else is inconsistent: no label has two colours.
- **Fix:** Give Cancelled the danger tone's muted variant (or a strike-through dot) in `components/ui/status.ts`.
