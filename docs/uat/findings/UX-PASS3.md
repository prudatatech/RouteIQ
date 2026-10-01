# UX review, pass 3

Pass 2 is in [UX-PASS2.md](UX-PASS2.md) (UX-26 to UX-39, and the reopened UX-04, 06, 07, 10, 13). Round 4 fixed them; this pass checks each fix on a fresh throwaway stack, sweeps every role again and looks for problems the fixes may have caused.

Runs (branch `uat/ux-pass3`; shot names are in `e2e/shots/` of each run's `uat` artifact; `-m` is 390 px):
- R1 `36854541152`, `e2e/scenarios/UX4.sh` (about 11 min). Story 75 of 75. Part V creates its own data (a waiting booking and five accepted ones) and verifies the fixes; part S sweeps; part C greps everything printed for failed requests, sideways scroll and wording slips.
- R2 `36856370153`, `e2e/scenarios/UX4b.sh`: the transfer page, which R1's id lookup missed.

Coverage: 255 page loads. Superadmin at 1440 px on every staff page and tab, and at 390 px on 40 pages with the sideways-scroll check; manager on the main pages (1440 and 390); vendor portal (1440 and 390); `/driver` as two drivers at 390; public tracking (a whole booking, a lot, a fresh shipment, a bad id) at 390 and 1440. New steps: `p3-*.json` in `e2e/scenarios/ux/`.

Test-harness note, not an app bug: the "Take off vehicle" probe for goods already picked up sets `current_holder='vehicle'` on an assigned shipment in the database, because the story has no live in-transit shipment left to use.

## Verification of round 4

16 verified, 3 reopened (UX-26, UX-35, UX-38). Regression sweep: no new console error or failed request on any page that should load; the only failed requests are the ones a page asks for on purpose (a bad id, a 422 shown in a form, the 409 for goods already picked up) and the two cases in UX-38 and UX-40. 61 pages shot at 390 px, none wider than the viewport.

| UX id | verified/reopened | evidence |
| --- | --- | --- |
| UX-04 | verified | R1 `superadmin-cargo_exceptions_not_an_id-end.png`, `..._cargo_transfers_not_an_id-end.png`, `..._money_invoices_not_an_id-end.png`, `..._shipments_not_an_id-end.png`, `..._fleet_not_an_id-end.png`: each says "We could not find this case / transfer / invoice / vehicle" or "that shipment", and People says "No person profile here". Residue: trip page, see UX-41. |
| UX-06 | verified | R1 `superadmin-optimize-end.png`: "Best route (exact)" and "Best route (fast search)", no solver names; superadmin map cards read "Live traffic isn't set up. Open Settings"; manager `manager-route_planner-end.png` reads "Your administrator can switch it on in Settings". Residue: Plan a trip for a superadmin, see UX-45. |
| UX-07 | verified | R1 `superadmin-routes_4b3d027d_..-end.png`, `..._44c758ad_..-end.png`, `superadmin-shipments-full-w3_vehicle.png`: trip pages and the wizard load with no `/routing/directions` request, no console error. |
| UX-10 | verified | R1 `superadmin-dispatch-off-end.png`: "300 kg, 1 piece" on every row; no "items" or "pcs" anywhere in the 255 pages (part C grep). |
| UX-13 | verified | R1 `superadmin-cargo_tab_transfers-end.png`, `superadmin-cargo_tab_hubs-end.png`: Export CSV on Transfers and Hubs, beside Claims, Driver pay, Bids and Partners. |
| UX-26 | reopened | Server side fixed, display not. After "Take RTX-D7F18C2E off its vehicle?": DB has status created, no vehicle, trip cancelled with 0 live stops, vehicle available; toast "Taken off its vehicle. It needs a vehicle again."; banner "Needs a vehicle"; Related says Trip "No trip yet", Vehicle and Driver "Not assigned"; Dispatch lists it under "Needs a vehicle" (R1 `superadmin-shipments_93a298f7_..-off-taken_off.png`, `superadmin-dispatch-off-end.png`). But "Cargo and vehicle" on the same page, also after a reload (`..-hold-end.png`), and the Vehicle column of the Shipments list (`superadmin-shipments_q_RTX_D7F18C2E-off-end.png`) still show MH04E2E0001, see below. Picked-up goods: API `PATCH` gives 409 "These goods were already picked up, so they cannot be taken off the vehicle here. Plan a transfer to move them." and the toast shows that text (`superadmin-shipments_55e7c8fc_..-pickedup-end.png`): verified. |
| UX-27 | verified | R1 `superadmin-shipments_d69be506_..-new-end.png`: history is only "Created"; `anon-track_RTX_934D7E02-new-end-m.png`: only "Created". The one "3PL partners" hit is the section heading, not a history entry. |
| UX-28 | verified | R1 `superadmin-shipments_93a298f7_..-hold-hold_done.png`: progress stays on Dispatch, banner "On hold: Consignee gate closed until Monday", action "Release hold"; no "On the road", no "not accounted for". |
| UX-29 | verified | R1 `superadmin-dispatch-assign-assign_form.png`: amber "Licence not on file" beside "2 of 2 vehicles can take this", Assign enabled. `superadmin-optimize-end.png`, `superadmin-dispatch_tab_optimize-end.png`, `manager-optimize-end.png`: "MH04E2E0001 · Licence not on file". "Driver licence missing" appears nowhere (part C grep). |
| UX-30 | verified | R1 text of `ux superadmin /dispatch --steps p3-assign.json` and `...wizard-full.json`, shots `superadmin-dispatch-assign-tab8.png`, `superadmin-dispatch-tabs-t18.png`, `superadmin-live_map-tabs-t30.png`: the five identical marker names are gone from the Assign modal and the wizard (wizard step 1 has 2 stops in the map, was 11); at 390 px the order is Close, Send to driver now, Search vehicles, Assign. Live map markers are named "RTX-9E0A940D, open load from Bhiwandi warehouse to ...". Dispatch page order is search, select-all, then Select row, Assign vehicle per row. Residue: UX-46. |
| UX-31 | verified | R1 `superadmin-requests-accept-accept_form.png`: Price field focused first; `superadmin-cargo_exceptions_c5cde76e_..-claim-claim_form.png`: "Claim for" focused first; hint now "With none on record, the office sets a limit"; after editing to -5 only "Enter an amount above ₹0." remains (`..-claim-claim_negative.png`). |
| UX-32 | verified | R1 `superadmin-fleet_9ab83550_..._tab_fuel-fuel-fuel_low_odometer.png`: the red message sits under the Odometer field, which keeps focus, "50,000 km" grouped. |
| UX-33 | verified | R1 `superadmin-cargo_exceptions_c5cde76e_..-claim-end.png`: "46 h 11 min away"; each Split entry says its sentence once. Residue: UX-43. |
| UX-34 | verified | R1 `superadmin-today-bell-bell.png`: "Bhiwandi warehouse to Das Paper, 300 kg, pickup 1 Oct 2026". |
| UX-35 | reopened | Money now lights Invoices on its own tab (R1 `superadmin-money-nav-nav.png`, `aria-current` is "Invoices"; same on `?tab=invoices`): verified. The count lag is not gone: right after Assign at 1440 px the page said "Needs a vehicle 3" and "Trips to send 0" while the sidebar said 4 and the trip existed (`superadmin-dispatch-assign-assign_done.png`). The same step at 390 px was right (3 and 1). Intermittent, so the refetch is still racing the assign. |
| UX-36 | verified | R1 `superadmin-shipments_7e43fd68_..-cancel-end.png`: a cancelled shipment has no 3PL offer and Delete is a ghost button; `superadmin-routes_276820ff_..-cancelled-end.png`: a cancelled trip has no "Run optimizer". Residue: UX-44. |
| UX-37 | verified | R1 `superadmin-requests-m-end-m.png`: "Bhiwandi warehouse → Mehta Stores" wraps, "Accept and price"; Price "Not priced" on one line; Trips to send "Planned by" reads "Picked by hand"; Today reads "2 tracked, 0 sending a position now". Residue: the person page still has "Employee code: Not set" in Employment (3 hits in part C), the People list no longer has the column. |
| UX-38 | reopened | R1 `superadmin-shipments_0f909663_..-delete-delete_done.png` and the part V6 problem list: after Delete the app returns to the list with the toast, but `GET /shipments/<id>/overview` still returns 404 with a console error. |
| UX-39 | verified | R1 pill summary (`scenario.txt`, V6): Cancelled `rgb(254,226,226)` on `rgb(185,28,28)` (red), Created `rgb(244,244,245)` on `rgb(82,82,91)` (grey); no label has two colours. `superadmin-shipments-pills-end.png`. |

### UX-26 and UX-38, why they are open

- **UX-26.** `plateOf` in `frontend/src/components/shipments/format.ts` reads the plate from the first `route_stops` entry that has a vehicle, without checking that the stop or its trip is cancelled. The server fix (`shipment.service.ts`, `shipment-overview.service.ts`) already skips released stops for `vehicle_id` and `driver_name`; the page and the list still use `plateOf`. Fix: skip stops with `status === 'cancelled'` or `routes.status === 'cancelled'` in `plateOf`, and show "Not assigned" when `vehicle_id` is empty.
- **UX-38.** The 404 comes from the shipment page's own query refetching before the navigation. Cancel it (`queryClient.cancelQueries`) and `removeQueries(['shipment', id])` before `navigate`, in `components/shipments/useDeleteShipment.ts`.
- **UX-35.** Await the `invalidateQueries` for the queue counts and the Dispatch tab counts in the assign `onSuccess` (both are read from the same query keys), rather than firing them without waiting.

## New findings

| # | Sev | Page | Title |
| --- | --- | --- | --- |
| UX-40 | Minor | Shipment page, 3PL partners | "Something went wrong: This shipment is already on a trip" on a shipment just taken off its vehicle |
| UX-41 | Minor | Trip page | A trip id that does not exist says "Check your connection" |
| UX-42 | Minor | Public tracking | A part-delivered booking ticks every step and says "Time to arrival: Partly delivered" |
| UX-43 | Polish | Problem case page, transfer | Timeline repeats each handover once per lot; "Part B due" on a completed transfer |
| UX-44 | Polish | Cancelled shipment, cancelled trip | Prompts that no longer apply; red Delete on a trip |
| UX-45 | Polish | Plan a trip | A superadmin is told to "ask an administrator to add a TomTom or Mapbox key to the server" |
| UX-46 | Polish | Assign modal, wizard step 3 | Map canvas, attribution, Layers and place search still come before the vehicle list |
| UX-47 | Polish | Shipment page | History after a take-off says "Created" again; a solid red Delete is the strongest button on every ordinary shipment |

### UX-40 · Minor · Shipment page, 3PL partners · "Something went wrong: This shipment is already on a trip" on a shipment just taken off its vehicle
- **Screenshot:** R1 `superadmin-shipments_93a298f7_24..._-off-taken_off.png` (the 3PL block at the bottom), `..-hold-end.png`
- **What's wrong:** After Take off vehicle (and again after Hold, on a fresh page load) the 3PL partners block shows a red "Something went wrong / This shipment is already on a trip / Try again", and the console logs `409 GET /tpl-network/escalations/preview?shipment_id=...`. The page itself says "No trip yet" and the DB has no live stop.
- **Why it confuses:** It reads as a failure of the page, and "already on a trip" contradicts the banner and the Related card. A plain created shipment (`..._d69be506_..-new-end.png`) shows "No partner covers this trip" instead.
- **Fix:** In the escalation preview (`backend-ts`, `tpl-network` routes), ignore route stops whose status is `cancelled` and trips that are cancelled, the same filter UX-26 added elsewhere. In the UI, show a 409 there as a short muted line, not the error card.

### UX-41 · Minor · Trip page · A trip id that does not exist says "Check your connection"
- **Screenshot:** R1 `superadmin-routes_not_an_id-end.png`
- **What's wrong:** `/routes/not-an-id` shows "Something went wrong. We could not load this trip. Check your connection and try again." with a Try again button, after four failed lines in the console (the 404 is retried). UX-04 gave cases, transfers, invoices, shipments, vehicles and people a "could not find" state; trips were left out.
- **Fix:** Use `isNotFoundError` from `utils/display.ts` in `RouteDetailsPage.tsx`: no retry, "We could not find this trip" with a link back to Trips.

### UX-42 · Minor · Public tracking · A part-delivered booking ticks every step and says "Time to arrival: Partly delivered"
- **Screenshot:** R1 `anon-track_RTX_AAFC8F7D-ov-end-m.png`
- **What's wrong:** For a booking where lots A and C are delivered and lot B has 23 of 25 pieces delivered, all five circles (Booked to Delivered) are ticked, and the "Time to arrival" card has the value "Partly delivered" under a clock icon. The text above and the Lots card are right ("Part of your shipment is delivered. The rest is still on its way."). Noted in pass 2 under UX-01 as a residue and not filed.
- **Why it confuses:** A customer who sees "Delivered" ticked will not expect more.
- **Fix:** Tick Delivered only when every lot is delivered (show Partly delivered as the current step); replace the arrival card with "Delivery in progress" or hide it.

### UX-43 · Polish · Problem case page, transfer · Timeline repeats each handover once per lot; "Part B due" on a completed transfer
- **Screenshot:** R1 `superadmin-cargo_exceptions_c5cde76e_..-claim-end.png`
- **What's wrong:** On a case with two lots, "Driver accepted the job", "Picked up" (50 pieces, then 25), "Left pickup", "Put on hold" and "Handed over" each appear twice, the repeats with identical text and no lot name. The Transfers card on the same page reads "To MH04E2E0002 · Part B due" next to "Completed" (R2 transfer page: "E-way bill Part B update required" on a completed transfer).
- **Fix:** Name the lot in each entry ("Lot A: Picked up, 50 pieces") or group entries with the same time and text into one ("both lots"). Show "Part B due" only while the transfer is open or the reference is missing.

### UX-44 · Polish · Cancelled shipment, cancelled trip · Prompts that no longer apply; red Delete on a trip
- **Screenshot:** R1 `superadmin-shipments_7e43fd68_..-cancel-end.png`, `superadmin-routes_276820ff_..-cancelled-end.png`
- **What's wrong:** A cancelled shipment still says "Assign a vehicle to message its driver about this shipment" and "Assign a vehicle to see where this shipment is", and the progress bar shows all six steps as "still to come" although the booking was confirmed. A cancelled trip still has a "Cancel trip" button (faded) and the "Message to the driver" box, and Delete is a solid red button.
- **Fix:** Hide the messages and live-location hints for a cancelled shipment; for a cancelled trip hide Cancel trip and the composer and make Delete a ghost button, as UX-36 did on the shipment.

### UX-45 · Polish · Plan a trip · A superadmin is told to "ask an administrator to add a TomTom or Mapbox key to the server"
- **Screenshot:** R1 `superadmin-route_planner-end.png`, `superadmin-dispatch_tab_plan.png`
- **What's wrong:** Everywhere else a superadmin reads "Live traffic isn't set up. Open Settings" (UX-06). Plan a trip still says "Trip planning is not set up. Ask an administrator to add a TomTom or Mapbox key to the server.", which is server setup text and sends the administrator to an administrator. The manager's wording ("Your administrator can switch it on in Settings") is right.
- **Fix:** For a superadmin: "Trip planning isn't set up. Open Settings" with the same link as on the map cards.

### UX-46 · Polish · Assign modal, wizard step 3 · Map canvas, attribution, Layers and place search still come before the vehicle list
- **Screenshot:** R1 `superadmin-dispatch-assign-tab8.png`, text of `ux superadmin /shipments --steps wizard-full.json`
- **What's wrong:** UX-30 removed the markers, but at 1440 px the Assign modal still needs eight Tab presses to reach "Search vehicles": Close, Map, attribution toggle, Layers, "Search for a place", Open Settings, Send to driver now. In wizard step 3 the map, attribution, Layers and place search come after "Show vehicles farther away". At 390 px (no map) the order is good.
- **Fix:** `tabIndex={-1}` on the map canvas, attribution toggle and the Layers and place-search controls when the map sits beside a list, or move the map after the list in DOM order.

### UX-47 · Polish · Shipment page · History after a take-off says "Created" again; a solid red Delete is the strongest button on every ordinary shipment
- **Screenshot:** R1 `superadmin-shipments_93a298f7_..-off-taken_off.png`
- **What's wrong:** History now reads Created, Vehicle assigned, Created: the third entry is the take-off but it has no name. On the same page, the solid red Delete in the top right is louder than the yellow Assign vehicle that is the actual next step. UX-36 made it a ghost button only for a cancelled shipment.
- **Fix:** Label the entry "Taken off its vehicle". Make Delete a ghost or outline button on every shipment that is not closed, with the confirm doing the warning.
