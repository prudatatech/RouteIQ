# Cargo management: custody, exceptions, transfers, partial delivery, returns

## Context

The user asked for real-world cargo handling. Today cargo is tracked only per shipment, and a shipment has no direct vehicle. Its truck is inferred through a chain: `delivery_points` → `route_stops` → `routes.vehicle_id`.

The backend cannot move, split, return or damage-report cargo once it is on a truck. The worst gap: when a truck has an accident or breakdown and staff "release its work" (`maintenance.service.ts`), cargo already on board is **stranded**.
- Shipments stay `picked_up` or `in_transit` on a *cancelled* route.
- `assignDriver` refuses to move them.
- Vendor loads (`cargo_manifest`) become `cancelled` while the goods are still on the truck.

Other real-world events that have no flow at all:
- damage or shortage at pickup or delivery;
- a delivery where the receiver accepts some goods and refuses the rest;
- a failed delivery that needs a re-attempt;
- return to origin (RTO);
- transferring goods to a relief truck;
- a hub stop;
- a theft or loss claim;
- the e-way bill vehicle change;
- telling the customer.

Goal: one consistent **cargo custody model** that answers, at every moment, where each item is, who holds it, and in what condition. Exceptions become first-class cases, with a guided workflow in the web, driver and customer apps.

## Real-world practice this follows (Indian road freight, FTL/PTL)

- **Custody chain.** Every handover is recorded with who, when, where, count, weight, condition, photos and a signature or OTP: shipper → driver → (hub) → relief driver → consignee. This is how TCI, Delhivery, Rivigo and Blue Dart run operations. Disputes and insurance claims depend on it.
- **Piece count and weight at each handover.** A shortage or excess found at a handover is raised on the spot, not later.
- **Condition codes:** good, damaged-packaging, damaged-goods, wet, tampered-seal, shortage, excess.
- **Seal numbers** on sealed or containerised FTL, checked at pickup and delivery.
- **Accident or breakdown with cargo:**
  1. secure the site and the people (SOS);
  2. take stock on site (count, damage photos);
  3. decide: wait for the repair, transship to a relief vehicle, or move the goods to the nearest hub;
  4. if the vehicle changes, update e-way bill Part B;
  5. inform the consignor and consignee with a revised ETA;
  6. open an insurance or claim case for damaged or lost goods;
  7. do the FIR and surveyor steps when needed.
- **Delivery outcomes:**
  - delivered in full;
  - delivered with remarks (damage noted on the POD);
  - partial (some pieces accepted, some refused or short);
  - refused;
  - not delivered (consignee unavailable or premises closed), then re-attempt, up to N attempts, then RTO.
- **Proof of delivery:** a delivery OTP sent to the consignee is common for high-value goods, alongside the photo, signature and receiver name.
- **Returns and RTO:** goods travel back to origin or a hub, with their own custody and a charge.

## Design

### 1. Data model (one migration, idempotent)

- **`shipments`:** add `current_vehicle_id`, `current_holder` (`vehicle` | `hub` | `consignee` | `consignor`), `current_depot_id`, `pieces_total`, `pieces_delivered`, `pieces_damaged`, `pieces_short`, `seal_number`, `delivery_attempts`, `delivery_otp_hash`, and `rto` (boolean).
  - Add shipment statuses (enum `ADD VALUE`): `at_hub`, `out_for_delivery`, `partially_delivered`, `returning`, `returned`, `lost`, `on_hold`.
  - Maintain `current_vehicle_id` in `markAssigned` and in every custody event, so staff and the apps stop walking the stop chain.
- **`cargo_custody_events`** (new, append-only). Columns:
  - `shipment_id` or `manifest_id`, and `kind`: `pickup`, `handover_out`, `handover_in`, `hub_in`, `hub_out`, `delivery`, `partial_delivery`, `refused`, `return_pickup`, `return_delivery`, `inspection`;
  - the from and to holders (`vehicle`, `depot`, `consignee`, `consignor`, with their ids), the `driver_id`, and the `pieces` and `weight_kg`;
  - `condition` (the codes above), `seal_number`, `photos[]`, `signature_path`, `otp_verified`, `lat`/`lng`, `notes`, `recorded_by`, `recorded_at`, and `exception_id`;
  - a hash link into the existing `shipment_logs` chain, via `ShipmentService.recordShipmentLog`.
- **`cargo_exceptions`** (new: the case file). Columns:
  - `type`: `vehicle_accident`, `vehicle_breakdown`, `damage`, `shortage`, `excess`, `theft`, `refused`, `undeliverable`, `delay`, `seal_tamper`, `weather`, `other`;
  - `severity`, `status` (`open` → `investigating` → `action_planned` → `resolved` | `closed`), and the linked `sos_alert_id`, `maintenance_job_id`, `vehicle_id` and `route_id`;
  - the affected shipments and manifests (`cargo_exception_items` with pieces and weight affected), the `resolution` (`transshipped`, `repaired_continue`, `moved_to_hub`, `returned`, `delivered_with_remarks`, `written_off`, `claim_settled`), and the owner, SLA due time and timeline.
- **`cargo_transfers`** (new). Columns: `exception_id` (nullable), `from_vehicle_id`, `to_vehicle_id` or `to_depot_id`, `status` (`planned` → `in_progress` → `completed` | `cancelled`), a meeting point, the items with pieces, `eway_part_b_updated_at`, and the new vehicle's `route_id`.
- **`cargo_claims`** (new). Columns: `exception_id`, the `shipment_id` or `manifest_id`, `claim_type` (damage, shortage, loss, theft), `declared_value` (from `shipment_hsn`), `claimed_amount`, and the `status` (`draft` → `filed` → `surveyed` → `approved` | `rejected` → `settled`). It also records the insurer, policy number, FIR number, surveyor, documents[] and settlement.
- **`depots`** (exists): used as hubs for `hub_in`/`hub_out`, with a hub inventory view.
- Every new table gets RLS: staff can do everything. Drivers can insert custody events only for cargo on their current vehicle. Customers and vendors can read only their own shipments' custody timeline and exception summary.

### 2. Backend: one cargo service, shared by every path

New `backend-ts/src/services/cargo/`:
- **`custody.service.ts`**
  - `recordCustody(event)` validates the holder and the piece counts, never going beyond what is held. It updates the shipment's current holder, pieces and status through `assertTransition`, with CAS writes. It writes the hash log and fires notifications.
  - Every existing path calls it so there is one truth: the pickup scan (`parcel.service.ts`), complete-stop (`telemetry.routes.ts`), `/cargo/verify-pod` and the manifest pickup/drop.
- **`exception.service.ts`**
  - It opens a case automatically from:
    - a serious SOS accident or breakdown (from `holdVehicleAfterSos`) where the vehicle holds cargo;
    - a failed stop (complete-stop `failed`);
    - a damage or shortage condition on any custody event;
    - a seal mismatch;
    - an ETA delay beyond a threshold (from the live-ETA work);
    - a maintenance move with cargo on board.
  - It runs an SLA timer with escalation through the existing `notifyStaff` and `escalateStaleSos` pattern.
- **`transfer.service.ts`**
  - `planTransfer`, `startTransfer` and `completeTransfer`.
  - Handover out is scanned by the from-driver, and handover in by the to-driver, with piece counts; any mismatch opens a shortage exception.
  - On completion, it re-attaches the shipments' remaining stops to a route on the new vehicle, reusing `route.service.createPlannedRoute` and the optimizer. It moves `current_vehicle_id` and the load kg (`releaseVehicleLoad` / `markAssigned`), and flags e-way bill Part B as "update required" with a task.
- **Fix the stranding bug.** `releaseShipmentsFromRoute`, `maintenance.releaseWork` and `cancelManifest` must never orphan on-board cargo. When goods are physically on the truck, they refuse and require a transfer or hold plan, or they automatically open a `vehicle_breakdown` exception and put the items `on_hold` with `current_vehicle_id` kept.
- **Delivery outcomes** (extend complete-stop, backwards compatible):
  - **full:** as today;
  - **with remarks:** a condition code plus photos, which opens a damage exception;
  - **partial:** pieces delivered, refused and short. The remaining pieces stay on the truck for a return or re-attempt;
  - **refused / not delivered:** `delivery_attempts++`, a re-attempt window, and automatic RTO after the configurable maximum;
  - **delivery OTP:** optional per shipment (high value or customer choice). The OTP is generated at out-for-delivery and sent to the consignee through the existing notifications and SMS if configured, and is checked by hash.
- **Returns (RTO):** create a return leg (a stop back to origin or a hub) on the same or another vehicle, with its own custody. The status runs `returning` → `returned`.
- **Hubs:** `hub_in` / `hub_out` custody events, a hub inventory endpoint, and ageing, to show goods sitting too long.
- **Claims:** create from an exception, prefilled with the declared value from `shipment_hsn`, and attach documents with signed uploads (reuse the `pod.service` helpers).
- **Endpoints:**
  - `/api/v1/cargo/custody` (POST event, GET timeline)
  - `/cargo/exceptions` (CRUD plus actions)
  - `/cargo/transfers`
  - `/cargo/claims`
  - `/cargo/hubs/:id/inventory`
  - `/cargo/shipments/:id/where` (current holder, location, pieces and condition)
- **Tests:** vitest for each state machine, the piece arithmetic (never negative, never above total), the stranding fix, a transfer end to end, partial delivery, re-attempt then RTO, OTP, and the RLS-like permission checks in the routes.

### 3. Web (staff): a Cargo control tower

- A new **Cargo** section in the sidebar with four tabs:
  - **Exceptions:** a queue with SLA, severity, owner, type filters and a map.
  - **Transfers.**
  - **Hubs:** inventory and ageing.
  - **Claims.**
- **Exception case page:**
  - a timeline that merges custody events, SOS, maintenance and notifications;
  - the affected items with pieces;
  - the vehicle on the map with the nearest relief vehicles, ranked by distance, free capacity and cargo type, using `vehicles` plus live positions and the route planner's ETA;
  - guided actions: "Transship to vehicle X", "Move to hub Y", "Wait for repair (ETA)", "Return to origin", "Deliver with remarks", "Write off and claim".
- **Shipment detail:**
  - a "Where is it now" card (holder, vehicle or hub, pieces, condition) and a full custody timeline with photos and signatures;
  - actions depend on the state: raise an exception, reassign (now allowed for on-board cargo through a transfer), schedule a re-attempt, start an RTO, record a hub in or out.
- **Vehicle page:** a "Cargo on board" card (pieces, weight, shipments), and the SOS/maintenance flows now show the on-board cargo and require a plan for it.
- Everything uses the shared UI (`components/ui` Field, Modal, DataTable, StatusPill with the new statuses added to `status.ts`) and MapView.

### 4. Driver app

- **Pickup:** piece count and weight (prefilled, editable), a condition per shipment, seal number, photos, and the consignor's signature. The existing scan stays.
- **Delivery sheet:** Full / With remarks / Partial / Refused / Not delivered, with pieces, condition, photos, the OTP entry when required, the receiver and a signature.
- **Accident or breakdown (after SOS):** a "Cargo on board" checklist: count, damage photos, seal intact? It feeds the exception case.
- **Handover out / in screens** for transfers: scan or count, and the other driver's confirmation.
- **Hub drop-off** and **return pickup** screens.
- Offline first: everything goes through the existing `actionQueue`, strings are in all 6 languages, and the new screens follow the shared components.

### 5. Customer app and customer notifications

- The tracking screen shows the custody timeline in plain words: "Picked up, 12 pieces", "Moved to a relief truck after a breakdown", "At the Patna hub", "Out for delivery".
- It shows exception notices with the revised ETA, and the delivery OTP.
- The customer can confirm a partial delivery, raise a dispute or claim within N days of delivery, and see the claim status.
- Notifications go to the consignor, consignee and vendor at each exception or custody milestone, through the existing `notificationService`, `customer-bookings.onShipmentStatus` and `vendorService.notifyVendorLoadEvent`.

### 6. Other gaps found in the current flows (fixed in the same round)

- **Vendor loads (`cargo_manifest`):**
  - Add `exception`, `returning` and `returned` states.
  - A failed drop opens a case and **notifies the vendor**. Today it only pings staff, and the load sits in limbo.
  - `cancelManifest` from `in_transit` is only allowed once the goods are off the truck.
- **3PL orders:** add an `exception` state, and let a partner raise an exception on an order.
- **Trip milestones:**
  - Accepting a job becomes a server record (`driver_confirmations` or a custody `accept` event). Today it is AsyncStorage only.
  - Leaving pickup sets `in_transit`, and reaching a stop records `arrived` from the geofence. A geofence override is logged with its distance.
- **Staff:**
  - Can raise an exception by hand on any shipment or load.
  - Stuck `picked_up` / `in_transit` cargo gets staff paths out: transfer, hold, RTO, or write-off with a claim, replacing the dead end.
  - `verify-pod` needs photo or OTP evidence, or a written reason that is logged.
- **Driver offline queue:** an action the server refuses (e.g. a 409 because dispatch changed the stop) is sent to dispatch as a `driver_action_rejected` note, not just shown to the driver.
- **Customer:** can view the POD (photo, signature, receiver), confirm receipt, rate the delivery (the shipment rating columns exist), and see reasons and revised ETAs.

### 7. Out of scope for this round (noted as the roadmap)

- Live e-way bill GSP integration: only a "Part B update required" task plus the reference field.
- Weighbridge device integration.
- Per-parcel barcodes. Piece counts per shipment now; the per-parcel `parcel_scans` table is ready for later.

## Build order (parallel agents, merged into the integration branch)

1. **Agent A (backend core):**
   - the migration;
   - custody, exception and transfer services;
   - the stranding fix;
   - the delivery outcomes, OTP, RTO, hubs and claims APIs;
   - the tests.
2. **Agent B (web control tower):** starts from the Agent A API contract (written first into `docs/cargo-plan.md`), and builds the pages and cards.
3. **Agent C (driver app plus customer app):** the screens against the same contract.

Then merge, run all checks, dry-run the migration, apply it before pushing, then push and deploy with a new APK and OTA update.

## Verification

- **Backend:** tsc, `npm test` (new suites listed above), `check:queries` (including the new enum values and the ambiguous-FK guard).
- **Web:** tsc, lint, vitest, build, plus Playwright screenshots of the exception case, transfer and shipment timeline at 1440 and 390 px.
- **Driver app:** tsc, `check:locales`, APK build and install on the emulator.
- **Migration:** dry-run in a rolled-back transaction, then apply with `lock_timeout`, then record it in `supabase/README.md`.
- **End-to-end scenario on the live DB after deploy** (staff UI): shipment picked up → SOS accident → exception auto-opens → transfer to another vehicle → partial delivery (2 short) → shortage claim filed. Check that the custody timeline and the customer tracking both show every step.
