# Audit 2: Trips and the driver (test stage)

Walk: `node e2e/staging/trips.mjs` (own company, 4 drivers, 2 staff, fresh accounts every run). Last full run before the
fixes: 159 of 175 steps PASS. Every FAIL left in that run is either an issue below that is **fixed in this branch and
waits for the next deploy of the test stage** (the stage still runs the old code), or the TomTom item (infra).

## Steps

| Step | Expected | Result | |
|---|---|---|---|
| 1.1 | 3 shipments created with RTX ids | as expected | PASS |
| 1.2-1.4 | planner status, plan (distance, time) | plan works (falls back to Mapbox); optimize-order 502 | PASS / FAIL 1.3 (I-7) |
| 1.5 | planner trip saved pending, ordered stops, own company, 24.5 km / 55 min stored | as expected | PASS |
| 1.6-1.9 | assign 3 shipments to one vehicle: one pending trip, 3 stops in order | as expected | PASS |
| 1.10, 1.26 | trip shows a distance and a time | 0 km / 0 min | FAIL (I-2, fixed) |
| 1.11 | vehicle load 1100 kg, free 3900 | free 3900 right, load stayed 0 | FAIL (I-1, fixed) |
| 1.12-1.18 | driver does not see, list, open, accept or start an unsent trip | 404 / 409 as expected | PASS |
| 1.16 | Today queue "trips to send" = 1 | as expected | PASS |
| 1.19-1.22 | send trip (twice at once): active, vehicle on_route, started_at once; second is 409 or a harmless repeat | as expected | PASS |
| 1.23 | planned arrival on every stop when sent | none stamped | FAIL (I-2, fixed) |
| 1.24-1.25 | driver told once "New trip" with the stop count; sees 3 ordered stops | as expected | PASS |
| 2.1-2.5 | pickup scan (repeat harmless), accept, start, goods in_transit | as expected | PASS |
| 2.6-2.9 | delivery needs receiver + photo/signature; foreign photo path and other driver's upload link refused | 400 / 403 as expected | PASS |
| 2.10-2.11 | signed upload works, bytes land in the store | as expected | PASS |
| 2.12-2.17 | complete stop with photo + signature; same idempotency key replays the stored answer; replay without key adds nothing; one custody event; stop and shipment rows right | as expected | PASS |
| 2.18, 2.27 | load follows each delivery (1100 to 700, failed goods stay) | free space jumped back to the full 5000 kg while 700 kg were on board | FAIL (I-1, fixed) |
| 2.19 | staff open the proof of delivery through signed links | as expected | PASS |
| 2.20-2.26 | failed stop: bad reason 400; failed, attempts 1, shipment exception and still on the truck, problem opened ("attempt 1 of"), staff told; cannot flip to delivered; repeat adds no attempt | as expected | PASS |
| 2.28-2.30 | last stop completes the trip; vehicle not freed while failed goods are aboard | as expected | PASS |
| 2.31-2.36 | one pay entry for the driver, none doubled; earnings, history, pay endpoints; my-route after completion | as expected | PASS |
| 2.37-2.39 | public tracking: delivered, history, no ids, phones, driver, price; failed shipment leaks no reason; unknown id 404 | as expected | PASS |
| 3.1-3.7 | staff cannot raise SOS; driver SOS with idempotency key (one alert); serious severity; staff see it on the vehicle, in Today and in the bell | as expected | PASS |
| 3.8-3.10 | serious accident: vehicle to maintenance, cargo on board goes on_hold and stays on the vehicle, accident case opened and linked to the SOS | as expected (3.10 checked through the case items table) | PASS |
| 3.11-3.14 | acknowledge twice harmless; other company cannot resolve or read it (404) | as expected | PASS |
| 3.15-3.17 | driver cancels a false alarm: vehicle back in service, cargo off hold; resolving a cancelled alert is 409 | as expected | PASS |
| 3.18-3.20 | minor breakdown leaves the vehicle in service; staff resolve; driver cannot resolve | as expected | PASS |
| 3.21-3.22 | serious breakdown with nothing picked up holds the vehicle, assigned cargo is not put on hold | as expected | PASS |
| 3.23 | stale SOS (20 min) is reminded by the scheduler | reminder arrived within 90 s | PASS |
| 3.24 | cancel a trip with nothing on board: shipment back to created | as expected | PASS |
| 4.1-4.10, 4.12-4.14 | messages both ways, notice to the driver, unread counts, read, other driver / other company refused, empty and oversize refused | as expected | PASS |
| 4.11 | another company's staff see none of this company's driver messages | their unread count included our driver's thread | FAIL (I-3, fixed) |
| 4.15-4.20 | driver fuel fill with bill: upload, 201 with total, idempotent resend, shows as a company expense with the receipt, other driver / other company refused | as expected | PASS |
| 4.21-4.25 | driver documents: list, consent, upload link, add (needs number and expiry), others cannot read | as expected after script fixes | PASS |
| 5.1-5.9 | the other driver of the company: 403/404 on trip, status, accept, start, stop, upload; /routes lists only own; driver cannot create, assign, cancel or delete | as expected | PASS |
| 6.1 | pending trip, vehicle loaded 800 kg | free space right, load 0 | FAIL (I-1, fixed) |
| 6.2 | move a pending trip to another vehicle: shipments and both vehicles' load follow | shipments and loads stayed on the old vehicle | FAIL (I-5, fixed) |
| 6.2c | sending a trip whose vehicle has no driver is refused | trip went active to nobody | FAIL (I-4, fixed) |
| 6.3-6.9 | cancel pending trip: shipments back to created, stops cancelled, load released, cancel twice harmless, cancelled cannot reopen (409), can be deleted | as expected (6.4/6.5 only failed because 6.2c left the trip active) | PASS |
| 6.10-6.15, 6.17-6.19 | active trip: second assign with dispatch sends it, assigning again makes no duplicate stops; cancelling with goods on board holds them (never released as created), not-picked-up goes back to created, driver told, delete of active is 409 | as expected | PASS |
| 6.16 | vehicle not freed while held goods are on it | vehicle became available with 5000 kg free | FAIL (I-1, fixed) |
| 7 | other company: trip get/status/edit/delete/reroute, shipment get/overview/history/proof/assign/edit/delete, vehicle, telemetry, messages, planner on our vehicle all 404; lists show none of ours | as expected | PASS |
| 7 | other company's delivery points list | 500 on every call, for every company | FAIL (I-6, fixed) |

## Issues

| # | Severity | Issue | Root cause | Fix | Status |
|---|---|---|---|---|---|
| I-1 | High | After any delivery the vehicle looked emptier than it was (free space back to full while 700 kg were aboard); a cancelled trip or breakdown left held goods on a vehicle that then showed empty and "available"; `current_load_kg` stayed 0 for shipments | two books of the vehicle's load: assigning wrote only `available_capacity_kg`, delivering subtracted from the never-written `current_load_kg`; the load sum ignored goods held on the vehicle and vendor loads | `recalculateVehicleCapacity` is the one source: it counts shipments planned or aboard (a partial delivery only its remaining share) plus open vendor loads, writes both columns, and complete-stop calls it instead of subtracting | Fixed, tests updated (`cargo-*` expectations were the old wrong numbers), `trips-audit.test.ts` |
| I-2 | Medium | A trip made by assigning shipments has 0 km and 0 min, so no planned arrivals and no on-time rating | `assignDriver` created the route with zeros | straight-line estimate (40 km/h, 15 min a stop) added per assigned shipment; a planner trip keeps the planner's figures | Fixed |
| I-3 | High (tenancy) | Staff unread-message count and threads included every company's drivers | `/messages/unread` read all driver messages with no company filter | messages are filtered to routes, loads and shipments of the active company | Fixed, test |
| I-4 | Medium | A trip could be sent to a vehicle with no driver: nobody notified, visible in no app | dispatch only checked the vehicle's status; the planner and trip reassign allow a driverless vehicle | `changeStatus` refuses to send (409 "no driver") | Fixed, test |
| I-5 | Medium | Moving a pending trip to another vehicle left its shipments and the load on the old vehicle | PATCH only rewrote `routes.vehicle_id` | shipments follow, both vehicles recalculated (`moveTripToVehicle`) | Fixed |
| I-6 | High | `GET /routes/delivery-points` was a 500 for every company | embed `shipments(...)` is ambiguous (two foreign keys since lots) | explicit `shipments!delivery_points_shipment_id_fkey` | Fixed (existing scoping test covers it; mock does not model ambiguity) |
| I-7 | Medium (infra) | `optimize-order` is a 502 "TomTom could not be reached"; plans quietly use Mapbox (no truck rules) | the test API's TomTom key or egress; the key is not in the repo | none in code. Owner: check `TOMTOM_API_KEY` on the test API app and the stage's outbound access | Open |

## Not covered or by design

- No geofence exists on the server, so there is no geofence override to log. The driver app cannot skip or reorder stops; staff reorder with `POST /routes/:id/reroute` (not walked).
- Messages limit: staff unread reads the newest 500 driver messages platform-wide before filtering to the company; fine at test scale, should move to a database filter (`messages` has no company column).
- Escalation of a stale SOS runs in the scheduler tick (60 s) and needs no extra setup.
