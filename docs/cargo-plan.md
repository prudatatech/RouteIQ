# Cargo management: shared contract

This is the one contract that backend-ts, the web app, the driver app and the customer app build against. The backend owns it. If an implementation has to differ, update this file in the same change.

The goal is that at every moment we know where each consignment is, who holds it, how many pieces there are and what condition they are in. Every handover is recorded, and every problem becomes a case with an owner and a deadline.

## Vocabulary

- **Consignment:** a `shipments` row (tracking `RTX-…`) or a vendor load (`cargo_manifest`, code `CM-…`). Every rule here applies to both, unless it says otherwise.
- **Holder:** who physically has the goods: `consignor` (at pickup, before handover), `vehicle`, `hub` (a `depots` row), or `consignee` (delivered).
- **Pieces:** a count of packages. `pieces_total` is set at booking or pickup. Pieces are counted at every handover.
- **Condition codes:** `good`, `damaged_packaging`, `damaged_goods`, `wet`, `seal_tampered`, `shortage`, `excess`.

## Database (migration `supabase/migrations/20260930013100_cargo_custody.sql`)

### `shipments`: new columns

| Column | Type | Notes |
|---|---|---|
| `current_holder` | text check (`consignor`,`vehicle`,`hub`,`consignee`) | default `consignor` |
| `current_vehicle_id` | uuid → vehicles (the FK is named `shipments_current_vehicle_id_fkey`) | set on assign, pickup and transfer; cleared when delivered or at a hub |
| `current_depot_id` | uuid → depots | set while `at_hub` |
| `pieces_total` | int | from `total_items`, or the count at pickup |
| `pieces_delivered`, `pieces_damaged`, `pieces_short`, `pieces_returned` | int default 0 | |
| `seal_number` | text | set at pickup and checked at delivery |
| `delivery_attempts` | int default 0 | |
| `max_delivery_attempts` | int default 3 | goes to RTO after this |
| `delivery_otp_required` | bool default false | |
| `delivery_otp_hash` | text | sha256; the OTP itself is never stored |
| `delivery_otp_expires_at` | timestamptz | |
| `rto` | bool default false | |
| `on_hold_reason` | text | |

New `shipments.status` values, added with `ALTER TYPE … ADD VALUE IF NOT EXISTS`: `out_for_delivery`, `at_hub`, `partially_delivered`, `on_hold`, `returning`, `returned`, `lost`.

### `cargo_manifest`

The same holder, pieces and seal columns, plus `delivery_attempts`, `max_delivery_attempts`, `rto` and `on_hold_reason` (a vendor load can be refused and returned too). Its status check is extended with `exception`, `on_hold`, `returning` and `returned`. `cargo_manifest.current_vehicle_id` has no foreign key: the table already points at `vehicles` through `vehicle_id`, and a second key would make the existing `vehicles(...)` embeds ambiguous. The backend keeps the two in step.

### New tables

All new tables have RLS on. Staff (`public.is_staff()`) get full access. Reads for drivers, customers and vendors go through the backend.

**`cargo_custody_events`** is append-only: it has no update or delete policy.
- id, shipment_id (nullable), manifest_id (nullable). Exactly one of the two is set (check constraint).
- `kind` is one of: `booked`, `accepted`, `arrived_pickup`, `pickup`, `departed`, `arrived_drop`, `delivery`, `partial_delivery`, `refused`, `undelivered`, `handover_out`, `handover_in`, `hub_in`, `hub_out`, `return_pickup`, `return_delivery`, `inspection`, `hold`, `release_hold`, `lost`.
- from_holder, from_vehicle_id, from_depot_id, to_holder, to_vehicle_id, to_depot_id.
- driver_id, pieces, weight_kg, condition, seal_number, seal_ok (bool).
- photo_paths text[], signature_path, otp_verified bool, receiver_name, lat, lng, notes.
- exception_id, transfer_id, recorded_by, recorded_role, recorded_at default now().
- Index on (shipment_id, recorded_at) and on (manifest_id, recorded_at).

**`cargo_exceptions`** is the case file.
- id, code (`EXC-XXXXXX`, human readable).
- `type` is one of: `vehicle_accident`, `vehicle_breakdown`, `damage`, `shortage`, `excess`, `theft`, `refused`, `undeliverable`, `delay`, `seal_tamper`, `weather`, `other`.
- severity `low|medium|high|critical`.
- `status`: `open` → `investigating` → `action_planned` → `resolved`, or `closed` from any state.
- source (`sos`, `maintenance`, `stop_failed`, `custody`, `eta`, `manual`, `driver`), sos_alert_id, maintenance_job_id, vehicle_id, route_id, lat, lng, description.
- owner_id, sla_due_at, escalation_count, last_escalated_at.
- `resolution`: `transshipped`, `repaired_continue`, `moved_to_hub`, `returned`, `delivered_with_remarks`, `redelivered`, `written_off`, `claim_settled`, `no_action`.
- resolution_note, resolved_by, resolved_at, created_by, created_at, updated_at.
- `notes` jsonb, the case log: `[{at, by, role, kind: 'note'|'action', text}]`, written by `add_note` and by every action.

**`cargo_exception_items`**: exception_id, shipment_id or manifest_id, pieces_affected, weight_affected_kg, condition, note.

**`cargo_transfers`**
- id, code (`TRF-XXXXXX`), exception_id, from_vehicle_id, to_vehicle_id (nullable), to_depot_id (nullable).
- `status` `planned` → `in_progress` → `completed`, or `cancelled`.
- meet_lat, meet_lng, meet_address, planned_at, started_at, completed_at, new_route_id.
- eway_part_b_required bool, eway_part_b_updated_at, eway_part_b_ref, created_by, note.

**`cargo_transfer_items`**: transfer_id, shipment_id or manifest_id, pieces_planned, pieces_out (counted by the handing-over driver), pieces_in (counted by the receiver), condition_in.

**`cargo_claims`**
- id, code (`CLM-XXXXXX`), exception_id, shipment_id or manifest_id.
- claim_type `damage|shortage|loss|theft|delay`, declared_value (from `shipment_hsn`), claimed_amount, approved_amount, settled_amount.
- `status`: `draft` → `filed` → `surveyed` → `approved` or `rejected` → `settled`, or `withdrawn`.
- raised_by_role (`staff|customer|vendor`), raised_by, insurer, policy_number, fir_number, surveyor_name, survey_date.
- document_paths text[], notes, created_at, updated_at, settled_at.

### Relationship names

`check:queries` flags embeds between table pairs that are joined by more than one foreign key.
- The custody and transfer tables have several FKs to `vehicles` and `depots`, so always name the FK when embedding them. For example: `vehicles!cargo_transfers_to_vehicle_id_fkey(...)`.
- After applying the migration, regenerate `backend-ts/test/support/db-ambiguous-relations.json` with `scripts/dump-ambiguous-relations.sql`.

## State machines (`backend-ts/src/core/transitions.ts`)

Shipment:
```
created           → assigned, picked_up, on_hold, exception, cancelled
assigned          → created, picked_up, on_hold, exception, cancelled
picked_up         → in_transit, at_hub, on_hold, exception, out_for_delivery, delivered, partially_delivered, lost
in_transit        → out_for_delivery, at_hub, on_hold, exception, delivered, partially_delivered, lost
out_for_delivery  → delivered, partially_delivered, exception, on_hold, returning, lost
at_hub            → in_transit, out_for_delivery, on_hold, exception, returning, lost
on_hold           → in_transit, at_hub, out_for_delivery, returning, exception, lost, (assigned|created if never picked up)
exception         → assigned, picked_up, in_transit, out_for_delivery, at_hub, on_hold, returning, delivered, partially_delivered, cancelled (only if never picked up), lost
partially_delivered → returning, out_for_delivery (re-attempt for the rest), delivered (rest accepted later), on_hold
returning         → returned, at_hub, exception, lost, on_hold
delivered, returned, lost, cancelled → (terminal)
```

- A driver can set `in_transit`, `out_for_delivery`, `delivered`, `partially_delivered` and `at_hub` (the hub drop) only through the custody endpoints.
- Staff can set any status, but through the custody and exception actions. A raw PATCH to these statuses is refused.
- The cargo_manifest status mirrors this with its smaller set: scheduled, in_transit, delivered, completed, cancelled, exception, on_hold, returning, returned.

Invariants, which the backend enforces and tests:
- `pieces_delivered + pieces_short + pieces_returned ≤ pieces_total`. Damaged pieces are counted within delivered or returned.
- The goods are on a vehicle (`current_holder = 'vehicle'`) exactly when the status is picked_up, in_transit, out_for_delivery, returning, on_hold-on-vehicle, exception-on-vehicle (a failed delivery) or partially_delivered with pieces still on board. `lost` keeps the last known holder and vehicle for the investigation.
- `partially_delivered → on_hold` and `returning → on_hold` are allowed, so goods on a vehicle that breaks down on those legs are held like any other.
- **Never strand cargo.** Cancelling a route, releasing a vehicle's work (maintenance or SOS) or cancelling a manifest must not leave goods that are on the truck without a plan. The goods move to `on_hold` with an open `cargo_exceptions` case (type vehicle_breakdown or vehicle_accident), and `current_vehicle_id` stays set until a transfer, hub drop or repair-continue resolves the case.

## Backend API

All endpoints are under `/api/v1/cargo`, validated with zod and idempotent (`idempotent()`) on POST. Writes use CAS on status. Every event is written to `cargo_custody_events` and to the `shipment_logs` hash chain (`ShipmentService.recordShipmentLog`).

The ref for a consignment is `{ shipment_id }` or `{ manifest_id }`.

### Where is it / timeline
- `GET /cargo/where/:ref` returns `{ ref, code, status, current_holder, vehicle: {id, plate_number, driver_name, lat, lng, last_seen_at} | null, depot: {id,name,address} | null, pieces: {total, delivered, damaged, short, returned, on_board}, seal_number, open_exceptions: [{id, code, type, severity, status, sla_due_at}], delivery_attempts, max_delivery_attempts, delivery_otp_required, rto, on_hold_reason }`. `pieces.on_board` is 0 when the goods are not on a vehicle and null when the count is unknown. `delivery_otp_required` is always false for a vendor load. The `:ref` is a shipment uuid, a tracking id (RTX-…) or a manifest code (CM-…).
- `GET /cargo/timeline/:ref` returns `{ events: CustodyEvent[] }`, newest last, with signed photo and signature URLs. Each event is `{ id, kind, summary, recorded_at, from_holder, to_holder, from_vehicle: {id, plate_number} | null, to_vehicle, from_depot: {id, name} | null, to_depot, pieces, condition, receiver_name, otp_verified, photo_urls: string[], signature_url, lat, lng }`; staff also get `weight_kg, seal_number, seal_ok, notes, exception_id, transfer_id, driver: {id, name} | null, recorded_by: {id, name, role} | null, recorded_role`. The storage paths themselves are never sent.
- Customers (for their own booking), vendors (for their own loads) and drivers (for their current vehicle) get a redacted version: no internal notes, no staff names.

### Custody events: driver and staff
`POST /cargo/custody`, with body `{ ref, kind, pieces?, weight_kg?, condition?, seal_number?, photo_paths?, signature_path?, receiver_name?, otp?, lat?, lng?, notes?, pieces_refused?, pieces_short?, pieces_damaged?, reason?, depot_id?, vehicle_id?, next_status? }`. `depot_id` is for hub_in and hub_out, `vehicle_id` lets staff name the vehicle of a pickup, hub departure or return pickup, and `next_status` (`in_transit` | `out_for_delivery`) is for hub_out. It answers 201 with `{ event, ref, status, current_holder, pieces: {total, delivered, damaged, short, returned, on_board}, exception_ids }`. Photos and signatures are uploaded first with `POST /cargo/custody/upload-url { ref | transfer_id, kind: photo|signature, content_type, size }`, which gives a signed URL into `cargo/<consignment or transfer id>/`. A route stop's own `pod/<stop_id>/` uploads are accepted too. What each kind does:
- **pickup:** needs pieces, and sets pieces_total if it is empty. It sets holder=vehicle and status picked_up. A condition other than good, or pieces below what was booked, opens an exception.
- **departed:** status in_transit. From exception or partially_delivered (goods on the vehicle) it is the re-attempt: status out_for_delivery.
- **arrived_drop:** geofence distance in notes. This is informational and changes no status.
- **delivery:** the full delivery. Needs receiver_name and a photo or signature, plus the OTP if `delivery_otp_required`. Sets status delivered and holder consignee.
- **partial_delivery:** needs pieces (accepted), and pieces_refused and/or pieces_short. It sets status partially_delivered, updates the counters and opens a `shortage` or `refused` exception. The rest stays on the vehicle.
- **refused / undelivered:** needs a reason (the existing complete-stop reasons plus `damaged_refused`). `delivery_attempts++`. At `max_delivery_attempts` it sets `rto=true`, status returning, and creates a return leg. Otherwise it opens an `undeliverable` exception with a re-attempt action.
- **hub_in / hub_out:** needs depot_id (in `to_depot_id` / `from_depot_id`). Status at_hub, then in_transit or out_for_delivery (`next_status`), or returning for goods on a return. hub_out puts the remaining drops on the collecting vehicle's route.
- **handover_out / handover_in:** only through a transfer (see below).
- **inspection:** records a condition, photos and pieces, and opens damage, shortage or seal exceptions.
- **hold / release_hold:** staff only.

Drivers may post only for consignments on their current vehicle (before pickup: the vehicle planned to carry them). `complete-stop` (the driver app today) keeps working: it calls the same service (completed = delivery, failed = undelivered).
- It also accepts the delivery sheet's optional `outcome` (`delivered` | `delivered_with_remarks` | `partial` | `refused` | `not_delivered`), `pieces`, `pieces_refused`, `pieces_short`, `pieces_damaged`, `condition`, `otp` and `photo_paths` (inside the stop's `pod/<stop_id>/` folder). With an outcome, the delivery evidence rules apply. Without one, the older shape keeps its rules (the receiver name and photo stay optional). The OTP is always checked when it is required.
- Completing the return stop of goods being returned records the `return_delivery`.
- complete-stop, verify-pod and 3PL order updates record the pickup first when the goods were never picked up (an implied pickup, noted on the event).
- `POST /cargo/verify-pod { tracking_id, recipient_name, photo_paths?, otp?, reason? }` (staff) needs a photo, the OTP or a reason of at least 3 characters. Its photos must be the shipment's own uploads (`cargo/<shipment id>/`, from `POST /cargo/custody/upload-url` with the shipment's ref).
- Staff may record a delivery with a verified OTP or a logged `reason` instead of a photo or signature.

### Delivery OTP
- `POST /cargo/otp/send { ref }`, for staff or automatically at out_for_delivery when required. It generates a 6-digit code, stores the hash with a 24 h expiry, and notifies the consignee (in-app notification to the customer user, plus SMS if an SMS provider is configured). Rate limited.
- The OTP is checked inside the `delivery` / `partial_delivery` custody events. After 5 wrong tries it is locked for 15 minutes. A wrong try answers 400 with `tries_left`, the lock 429, and an expired or missing code 409.
- `otp/send` answers `{ expires_at, notified: { in_app, sms } }`. The code goes to the customer who booked. At most 5 codes per shipment an hour. Shipments only.

### Exceptions
- `GET /cargo/exceptions?status=&type=&severity=&vehicle_id=&ref=&overdue=` lists cases (a bare array, newest first, at most 300) with items and SLA. `status` takes one status or several separated by commas (`open,investigating,action_planned` is every open case). Each case is the row (without `notes`) plus `plate_number`, `vehicle: {id, plate_number, status, vehicle_type, latitude, longitude, driver_name} | null`, `owner: {id, full_name} | null`, `sla: {due_at, overdue, minutes_left}` and `items: [{id, ref, code, status, current_holder, current_vehicle_id, current_depot_id, pieces_held, pieces_total, pieces_affected, weight_affected_kg, condition, note}]`.
- `GET /cargo/exceptions/:id` returns the case as listed plus `timeline`, `sos_alert`, `maintenance_job`, `transfers` and `claims`. Timeline entries are `{ at, source: 'case' | 'custody' | 'sos' | 'maintenance', kind, text, ref?, by, by_name, role, data? }`, oldest first; `source: 'case'` entries are the case log (`kind` `opened`, `note`, `action` or `resolved`). `transfers` are full transfers as `GET /cargo/transfers/:id` answers them; `claims` are short (`id, code, claim_type, status, claimed_amount, approved_amount, settled_amount, shipment_id, manifest_id, created_at`), and `GET /cargo/claims/:id` gives the whole claim.
- `POST /cargo/exceptions` raises a case by hand: `{ type, severity, description, items: [{ref, pieces_affected, condition}], vehicle_id?, lat?, lng? }` (staff, or a driver for their own vehicle).
- `POST /cargo/exceptions/:id/actions { action, ... }`, where action is one of:
  - `assign_owner {owner_id}`
  - `set_status {status}`
  - `transship {to_vehicle_id, meet_lat, meet_lng, meet_address}`, which creates a transfer
  - `move_to_hub {depot_id}`, which creates a transfer to the depot
  - `wait_for_repair {expected_at}`
  - `continue_after_repair`, which releases the hold and restores the route on the same vehicle
  - `return_to_origin` (it takes no note; add one with `add_note`)
  - `reattempt {scheduled_for}`
  - `deliver_with_remarks`
  - `write_off {pieces, note}`, which marks the pieces lost or damaged
  - `raise_claim {claim_type, claimed_amount}`
  - `resolve {resolution, note}`
  - `add_note {note}`
- `GET /cargo/exceptions/:id/relief-vehicles` returns candidate vehicles ranked by straight-line distance, then free capacity ≥ affected weight, then matching cargo types. Only operating and approved vehicles are included. Each has `{vehicle, distance_km, free_kg, eta_minutes?}`, plus `fits` and `cargo_match`. The answer is `{ affected_kg, origin, vehicles }`, with distances rounded to 0.1 km and at most 25 vehicles.
- Automatic creation happens from:
  - a serious accident or breakdown SOS on a vehicle holding cargo (`holdVehicleAfterSos`);
  - a failed stop;
  - a custody condition that isn't `good`, or a piece mismatch;
  - a maintenance move with cargo on board;
  - a cancelled route or manifest with goods on board;
  - live ETA slipping beyond `CARGO_DELAY_EXCEPTION_MINUTES` (default 120).
- SLA by severity: critical 1 h, high 4 h, medium 24 h, low 72 h. The scheduler escalates overdue cases through `notifyStaff` (the same pattern as `escalateStaleSos`).

### Transfers (transshipment and moves to a hub)
- `POST /cargo/transfers { exception_id?, from_vehicle_id, to_vehicle_id? | to_depot_id?, items: [{ref, pieces}], meet_* }` creates a planned transfer. It checks that to_vehicle has enough free capacity. It notifies both drivers.
- `POST /cargo/transfers/:id/handover-out { items: [{ref, pieces_out, condition}], photo_paths?, signature_path? }`, called by the from-driver or staff. Status in_progress.
- `POST /cargo/transfers/:id/handover-in { items: [{ref, pieces_in, condition}], photo_paths?, signature_path? }`, called by the to-driver, hub staff or staff. If pieces_in < pieces_out, a shortage exception opens.
  - On completion it moves the goods: current_vehicle_id changes (or holder becomes hub), vehicle loads are updated, and the remaining stops are re-created on the new vehicle's route. Eway Part B is marked required when the vehicle changes.
  - Consignor, consignee and vendor are notified.
- `POST /cargo/transfers/:id/cancel { reason? }`, and `POST /cargo/transfers/:id/eway { eway_part_b_ref }`.
- A transfer is answered as the row (it has no `created_at`: `planned_at` is when it was made) plus `from_vehicle` and `to_vehicle` (`{id, plate_number, driver_name, latitude, longitude, status}`), `to_depot` (`{id, name, address, latitude, longitude}`), `exception: {id, code, type, status} | null` and `items: [{id, ref, code, status, pieces_planned, pieces_out, pieces_in, condition_in}]`.
- `GET /cargo/transfers?status=` and `GET /cargo/transfers/:id`.

### Hubs
- `GET /cargo/hubs` lists depots with their counts.
- `GET /cargo/hubs/:depot_id/inventory` returns `{ depot, items }`: the consignments at the hub with pieces, since when (ageing), next leg and exceptions. Each item is `{ ref, code, status, pieces, pieces_total, weight_kg, since, age_hours, rto, on_hold_reason, next_leg: {name, address, lat, lng} | null, open_exceptions }`; `since` is null when no arrival was recorded.

### Claims
- `POST /cargo/claims { exception_id?, ref, claim_type, claimed_amount, notes }`. Staff, the customer (their own delivered or returned shipment, within 7 days of delivery) or the vendor (their own load) can raise one. The declared_value is prefilled from `shipment_hsn`.
- `POST /cargo/claims/:id/documents-upload-url { content_type, size }` returns a signed upload URL `{ path, token, signed_url, bucket }` (the same pattern as `pod.service`), for a JPG, PNG or PDF. The path is added to the claim's `document_paths` when the URL is handed out, so the client only uploads the file; `document_paths` is not a PATCH field. A claim's `documents` lists the paths that can be signed (the file is there).
- Every claim answer carries `consignment_code`, the RTX- or CM- code of the goods.
- `PATCH /cargo/claims/:id`, staff only, moves the status and sets the insurer, FIR, survey and amounts.
- `GET /cargo/claims?status=&ref=`: staff see all, customers and vendors see their own.

### Vehicle cargo
- `GET /cargo/vehicles/:vehicle_id/on-board` returns `{ vehicle: {id, plate_number, status, driver_name, lat, lng}, totals: {consignments, pieces, weight_kg}, items }`: the consignments currently on the vehicle, each `{ ref, code, status, pieces_on_board, pieces_total, weight_kg, seal_number, condition, rto, on_hold_reason, next_stop: {stop_id, route_id, sequence, name, address, lat, lng} | null, open_exceptions }`. It is used by the vehicle page, the SOS panel and the maintenance modal.

### Customer
- `GET /customer/bookings/:id/cargo` returns where + timeline (redacted), the POD (signed URLs), open exception notices (type, a plain message, revised ETA) and the claim status.
- `POST /customer/bookings/:id/confirm-receipt { rating (1–5), comment?, issue? }`. The rating goes to the existing shipment rating columns. `issue` opens a claim or dispute. `issue` is `{ type: damage|shortage|loss|theft|delay, description, claimed_amount? }`. A delivery is rated once, and a customer rating leaves `driver_rated_by` empty (customers are not staff users).

### Driver
- `GET /cargo/driver/on-board` returns what is on the driver's vehicle, with pieces and expected condition.
- `POST /telemetry/driver-ping/accept-route { route_id }` records `accepted` custody events for the route's consignments (the server record of job acceptance).
- Actions the server refuses from the offline queue are reported with `POST /cargo/driver/rejected-action { action, error, payload_summary }`. This notifies dispatch.

## Notifications (type names, used in `notificationTargets`)

`cargo_exception_opened`, `cargo_exception_escalated`, `cargo_exception_resolved`, `cargo_transfer_planned`, `cargo_transfer_completed`, `cargo_partial_delivery`, `cargo_rto_started`, `cargo_at_hub`, `cargo_delivery_otp`, `cargo_claim_update`, `driver_action_rejected`.

Customers and vendors get plain-language messages, for example "Your goods were moved to another truck after a breakdown. New ETA 6:40 pm."

## Backend implementation notes

What the backend does where the contract above leaves a choice. These notes are part of the contract.

- **Where the code is.** `backend-ts/src/services/cargo/` (consignment, custody, exception, transfer, hub, claim, otp, onboard, customer, replan, notify) and `routes/cargo-custody.routes.ts`, mounted under `/api/v1/cargo` next to `cargo.routes.ts`.
- **Vendor loads.** In shipment terms, a load's `scheduled` is created or assigned, and `in_transit` covers picked up, in transit and out for delivery. `at_hub` is stored as `on_hold` with `current_holder = 'hub'`, `partially_delivered` as `exception`, and `lost` as `cancelled`. Loads have no `shipment_logs` (that table belongs to shipments), so their custody events are their record.
- **Status PATCH.** `PATCH /shipments/:id` accepts `created`, `picked_up` (recorded as a custody pickup) and `cancelled`. A driver asking for anything else gets 403. Staff asking for a custody status get 409 with `use: 'cargo_custody'`.
- **Stranding.**
  - Goods on a vehicle that loses its work go `on_hold` on one open case per vehicle. A second trigger (the SOS, then the maintenance job) adds to that case and links the SOS alert and the job.
  - That case is the vehicle's open case of type `vehicle_breakdown`, `vehicle_accident` or `other` and source `sos`, `maintenance` or `manual`. Its `sos_alert_id` and `maintenance_job_id` are set only when empty, so a second SOS on the same case is not linked by id: find the case by the id first, then as the vehicle's newest open hold case.
  - Opening a maintenance job answers `released_work.cargo_exception_id`, the case now holding the goods (only when goods were on board).
  - The case type is `vehicle_accident` for an accident, `vehicle_breakdown` for a breakdown or tyre job, and `other` for a plain route or load cancel and a scheduled service.
  - A case cannot be resolved while any of its goods is still on hold, and `release_hold` refuses goods on a vehicle that is not in service.
  - A vendor load still with the consignor is cancelled as before.
- **Transfers** move whole consignments: the pieces of each item equal what is on board.
  - Shortage on completion is `pieces_planned − pieces_in`. Fewer out than planned, or fewer in than out, each open a shortage case.
  - Completing a transfer of a case's goods resolves that case (`transshipped` or `moved_to_hub`).
  - A driver sees the transfers of their own vehicle (`GET /cargo/transfers`, `GET /cargo/transfers/:id`).
- **Refused or not delivered.** Each failed attempt sets `exception` and opens an `undeliverable` (or `refused`) case. The attempt that reaches `max_delivery_attempts` creates the return leg instead of a case:
  - it sets `rto` and moves to `returning` (through `exception` when there is no direct move);
  - the return leg is a delivery point of the shipment named "Return to …" at its origin, with a stop on the vehicle's open route. It becomes the shipment's final point.
- **Case actions.**
  - `transship` and `move_to_hub` take the goods of the case still on its vehicle, and answer `{ exception, transfer }`.
  - `wait_for_repair` moves the SLA to `expected_at`.
  - `reattempt` puts the failed drop back on the same vehicle's route and records `departed`.
  - `deliver_with_remarks { receiver_name, note, condition?, pieces_damaged?, photo_paths?, otp? }` records the delivery and resolves the case.
  - `write_off { pieces, note, ref? }` records `lost` pieces. The whole consignment becomes `lost` when nothing is left and nothing was delivered.
  - `raise_claim { claim_type, claimed_amount, ref? }` answers `{ exception, claim }`.
  - Every other action answers the case.
- **SLA escalation** reminds staff when the SLA passes, then every 60 minutes, at most 6 times. **Delay cases** compare the straight-line ETA from the vehicle's position (40 km/h, road factor 1.3) with the stop's planned arrival.
- **Claims.**
  - A customer may also claim on a `partially_delivered` or `lost` shipment within the 7 days, and may leave `claimed_amount` for later.
  - Staff claims start as `draft`; customer and vendor claims as `filed`. One open claim per type per consignment.
  - A survey needs a surveyor, an approval an approved amount, and a settlement a settled amount.
  - `GET /cargo/claims/:id` returns one claim with signed document links.
- **Responses.**
  - `where` also carries `code` and `on_hold_reason`. Every timeline event has a plain-words `summary`.
  - The redacted view (customers, vendors, drivers) leaves out notes, the seal, who recorded it, the driver, the case id and the driver's name on the vehicle.
  - `POST /telemetry/driver-ping/accept-route` answers `{ route_id, accepted }` and records `accepted` once per driver and consignment. `POST /cargo/driver/rejected-action` answers 201 `{ reported: true }`.
  - `GET /customer/bookings/:id/cargo` answers 409 while the booking has no shipment. Its shape is `{ booking_id, shipment_id, tracking_id, where, timeline, pod, exceptions: [{id, type, title, message, opened_at, revised_eta}], claims, rating }`.
  - `GET /cargo/hubs` lists depots with `consignments`, `pieces`, `weight_kg`, `oldest_since` and `oldest_age_hours`. Inventory items carry `pieces`, `since`, `age_hours`, `next_leg`, `rto` and `open_exceptions`.
- **Bookings and dashboard.** A booking shows `in_transit` while its shipment is out for delivery, at a hub or returning. `GET /dashboard/shipment-counts` counts every status.
- **Relationship names.** `db-ambiguous-relations.json` was extended by hand for the new keys. Regenerate it after applying the migration.

## Web client

- `frontend/src/services/cargo.ts` is the client; `frontend/src/services/cargoMap.ts` maps the answers above to the web's shapes (a consignment `{ ref, code }` becomes flat `shipment_id` / `manifest_id` / `tracking_id`; embedded vehicles, depots and people on timeline events become plates and names). `backend-ts/test/cargo-web-contract.test.ts` pins the backend side of those shapes.
- The web sets a shipment's status with `PATCH /shipments/:id` only to `created` (off its vehicle) and `cancelled`, before pickup. Pickup, in transit, delivery, hubs, holds and returns are custody events or case actions from the shipment's cargo panel; the control-room delivery (`verify-pod`) and the legacy web driver view (`complete-stop`) go through custody too.
- A vehicle is re-assigned only while the goods are with the sender. Goods on a vehicle, a failed delivery included, move by a transfer or a re-attempt.

## UI surfaces

- **Web:**
  - a Cargo section with Exceptions (queue + map), Transfers, Hubs and Claims;
  - an exception case page;
  - on shipment detail, a "Where is it now" card and the custody timeline;
  - on the vehicle page, a "Cargo on board" card;
  - the SOS and maintenance modals show the cargo on board and require a plan.
- **Driver app:** a richer pickup (pieces, condition, seal, photos, signature); a delivery sheet (full / with remarks / partial / refused / not delivered + OTP); an on-board checklist after an accident or breakdown; handover out and in; hub drop; return pickup.
- **Customer app:** the custody timeline in plain words, exception notices with the revised ETA, the delivery OTP, POD view, confirm receipt and rate, and raise and track a claim.

## Lots: splitting one consignment across drops, trucks and hubs

Real consignments are rarely one piece of goods going to one place on one truck. For example, a 100-carton lot goes 50 to consignee A, 25 to consignee B, and 25 to a hub for onward delivery. Or 30 of the 100 cartons move to a relief truck while 70 stay. Indian road freight handles this by splitting the consignment note (LR/bilty) into child consignments. Each child has its own pieces, weight, value, consignee, truck, POD, invoice and e-way bill, and all of them keep a link to the master.

We model it the same way.

### Model (migration `supabase/migrations/20260930014100_cargo_lots.sql`)

**`shipments`** gains:
- `parent_shipment_id` (uuid, FK `shipments_parent_shipment_id_fkey` → shipments). When embedding the parent, name that FK.
- `lot_seq` (int; 1, 2, 3 …) and `lot_label` (e.g. `A`, `B`, `C`).
- `is_master` (bool, default false).
- `declared_value` (numeric), which the lots split between them.
- `freight_share` (numeric), the part of the master's freight_charge that falls to this lot.
- `consignee_name`, `consignee_phone`, `consignee_gstin` (a lot can have its own consignee).
- `split_reason` (`multi_drop` | `partial_transfer` | `hub_crossdock` | `partial_delivery_remainder` | `manual`).

A lot's tracking id is the master's with a suffix: `RTX-ABC123-A`, `-B`. Customers can track the master or any lot.

**`cargo_manifest`** gets the same columns: `parent_manifest_id` (FK `cargo_manifest_parent_manifest_id_fkey`), `lot_seq`, `lot_label`, `is_master`, `declared_value`, `freight_share`, consignee fields and `split_reason`. Its lot codes are `CM-XXXXXXXX-A`.

**`delivery_points`** gains `pieces` (int), `consignee_name`, `consignee_phone` and `lot_shipment_id`. With multi-drop at booking, each drop point becomes a lot.

**New custody event kinds:** `split` (recorded on the master and on each lot) and `merge`.

### Rules the backend enforces and tests

- **Only the lots move.** A master holds no goods of its own. Once split, it can't be picked up, delivered or transferred. Its status, holder and pieces are **computed from its lots**, and that is what `GET /cargo/where/:ref` returns for a master.
- **Status rollup:**
  - `delivered` if every lot is delivered, and `partially_delivered` if some are delivered and some returned, lost or short.
  - `in_transit` if any lot is on the move.
  - `on_hold` or `exception` if any lot has an open case.
  - `returned` if every lot is returned.
- **Conservation:**
  - The sum of the lots' `pieces_total` equals the pieces the master had undelivered at the moment of the split.
  - Weight, declared value and freight are split across the lots. The default share is by pieces. The caller can give exact weights or values, but they must add up (within ±0.5 kg / ₹1 for rounding). The last lot takes the rounding remainder.
- **Where you can split:** only pieces held by one holder in one place: all on one vehicle, all at one hub, or still with the consignor. Pieces already delivered stay with the master's record, and the lot is made from what is left.
- **Lots of lots:** a lot can itself be split. Its lots point to the same master (`parent_shipment_id` = the master), so the tree stays flat. Their labels are `A1`, `A2`, …
- **Merging:** allowed only for lots of the same master with the same holder, place, consignee and drop, and before any of them has left. The counts add back up.
- **Everything else works per lot, unchanged:**
  - transfers, hub in/out, delivery outcomes, OTP, RTO, cases and claims;
  - invoices and e-way bills;
  - route stops, since each lot to a new drop gets its own delivery point.

### Where splits happen

1. **Multi-drop booking.** `POST /shipments` (and customer booking) accepts `drops: [{ address, lat, lng, consignee_name, consignee_phone, consignee_gstin?, pieces, weight_kg? }]`. When there is more than one drop, the backend creates the master with one lot per drop, each with its own delivery point, and splits freight and value.
2. **Partial transfer.** `POST /cargo/transfers` items accept `pieces` below what is on board (`pieces_planned < on board`). The backend first splits the consignment into a lot that moves and a lot that stays, then transfers the moving lot. The response returns both lot ids. Handover counts apply to the moving lot.
3. **Hub cross-dock.** `POST /cargo/lots/split` at a hub splits the goods into outbound lots, each with its own next drop, vehicle or route.
4. **Remainder after a partial delivery.** A remainder that goes to a *different* consignee or place can be split into a lot with a new drop. The same consignee's re-attempt needs no split.
5. **Manual.** Staff can split any consignment whose goods are with one holder.

### API

- `POST /cargo/lots/split { ref, reason, lots: [{ pieces, weight_kg?, declared_value?, freight_share?, consignee_name?, consignee_phone?, consignee_gstin?, drop?: { address, lat, lng }, to_vehicle_id?, to_depot_id? }] }` → `{ master: {ref, code}, lots: [{ref, code, label, pieces, weight_kg}] }`.
  - The lots' pieces must add up to the undelivered pieces held. If you give fewer, a remainder lot is made automatically for the rest (it stays where it is).
  - A lot with `drop` gets a delivery point. A lot with `to_vehicle_id` or `to_depot_id` gets a planned transfer.
- `POST /cargo/lots/merge { refs: [..] }` → `{ ref, code }`.
- `GET /cargo/lots/:ref` → `{ master, lots: [{ ref, code, label, status, current_holder, vehicle, depot, pieces, drop, consignee, open_exceptions }], totals }`. `:ref` can be the master or any lot.
- `GET /cargo/where/:ref` and `/timeline/:ref` for a master include the rolled-up totals and a `lots` array. The master's timeline merges the timelines of its lots, and each event is tagged with its lot label.
- The customer booking cargo view (`GET /customer/bookings/:id/cargo`) returns the lots with plain wording, e.g. "Lot B (25 cartons): delivered to Sharma Traders, Patna".
- Driver on-board lists **lots**, so the driver sees `RTX-ABC123-B · 25 pcs`.

### Invoices and e-way bills

- Every lot with its own consignee gets its own invoice line or invoice when it is delivered, for its `freight_share`. The master's invoice is not issued a second time.
- Each lot carries its own e-way bill reference (`eway_bill_ref` on the lot). A partial transfer marks Part B as required for the moving lot only.

### UI

- **Web:**
  - Shipment and load detail show a **Lots** panel: a tree with the master and each lot's status, holder, pieces, drop and consignee, plus the rolled-up progress bar ("60 of 100 delivered · 25 at Patna hub · 15 on HR55AB1234").
  - "Split" action: a form with rows for pieces, weight, consignee and drop or vehicle or hub. It shows live totals and blocks you until they balance.
  - "Merge".
  - "Move part to another vehicle" (a transfer with pieces).
  - The booking/create-shipment form supports multiple drops with a pieces split.
  - The exception case items and claims show the lot code.
- **Driver app:**
  - On-board and the delivery sheet work per lot.
  - A handover of a partial transfer shows "Hand over 30 of 100 (lot C)".
  - Hub drop can split into outbound lots when hub staff tell the driver to.
- **Customer app:** the booking shows the lots with their progress, and each lot has its own POD and claim.

### Lots: backend implementation notes

What the backend does where the Lots section leaves a choice, or differs from it. These notes are part of the contract.

- **Where the code is.** `backend-ts/src/services/cargo/lots.service.ts` (split, merge, rollup, labels, conservation, views, multi-drop create); the endpoints are in `routes/cargo-custody.routes.ts`. Migration `20260930014100_cargo_lots.sql` (not applied yet): apply it before deploying this backend, since the custody reads select the new columns.
- **Extra columns** beyond the model above: `eway_bill_ref` and `eway_part_b_required` (bool) on `shipments` and `cargo_manifest`, and `customer_bookings.drops` (jsonb) for a multi-drop booking until it is confirmed.
- **API shapes.**
  - `POST /cargo/lots/split` (staff, idempotent) takes `{ ref, reason = 'manual', lots: [LotInput], note? }` (the note is added to the split events) where LotInput is `{ pieces, weight_kg?, declared_value?, freight_share?, consignee_name?, consignee_phone?, consignee_gstin?, drop?: { name?, address, lat, lng }, to_vehicle_id?, to_depot_id?, eway_bill_ref? }`. It answers 201 `{ master: {ref, code}, source: {ref, code}, lots: [{ ref, code, label, pieces, weight_kg, declared_value, freight_share, status, transfer: {id, code} | null }] }`. `source` is the consignment split (the master itself, or the lot split again); the remainder lot, when made, is last.
  - `POST /cargo/lots/merge { refs }` (staff) answers `{ ref, code, label, pieces }` of the lot kept.
  - `POST /cargo/lots/eway { ref, eway_bill_ref }` (staff) sets a lot's own e-way bill reference and answers its LotView. A master refuses it (409).
  - `GET /cargo/lots/:ref` answers `{ master: { ref, code, is_master, status, current_holder, pieces, weight_kg, declared_value, freight_share, freight_charge }, lots: LotView[], totals: LotTotals }` from the master or any lot; 404 for a consignment never split. Drivers see only the lots on their own vehicle.
  - **LotView:** `{ ref, code, label, seq, status, current_holder, vehicle: {id, plate_number} | null, depot: {id, name} | null, pieces: {total, delivered, damaged, short, returned, on_board}, weight_kg, declared_value, freight_share, drop: {name, address, lat, lng} | null, consignee: {name, phone, gstin} | null, eway_bill_ref, eway_part_b_required, split_reason, open_exceptions: [{id, code, type, severity, status, sla_due_at}] }`. The redacted view (customers, vendors, drivers) has `freight_share: null`.
  - **LotTotals:** `{ pieces: {total, delivered, damaged, short, returned, on_board}, lots, pieces_total, delivered, damaged, short, returned, held, by_holder: {consignor, vehicle, hub}, weight_kg, progress_text }`, with `progress_text` like "60 of 100 delivered · 25 at Patna hub · 15 on HR55AB1234" (then "N returned", "N short or lost").
  - Every `GET /cargo/where` answer gains `is_master`, `lot: { label, seq, master: {ref, code} } | null` (also flat as `lot_label` and `master: {ref, code} | null`), `eway_bill_ref` and `eway_part_b_required`. A master's also has `lots: LotView[]` and `totals: LotTotals`; its `status` and `current_holder` are the rollup, `pieces` add its own record and its lots', `vehicle` / `depot` are set only when every held piece is on that one vehicle or hub, `open_exceptions` join its lots' cases, and `seal_number` is null.
  - A master's `GET /cargo/timeline` merges its own events with its lots', oldest first; every event carries `lot: { label, code, ref } | null`.
  - `POST /cargo/transfers` answers with `splits: [{ from: {ref, code}, moving: {ref, code, label, pieces}, staying: {ref, code, label, pieces} }]` when an item moved part of what was on board, and `lots: { moving, staying }` for the first of them; `items` then name the moving lot. A later `GET /cargo/transfers/:id` does not repeat them.
  - `GET /cargo/driver/on-board` and `/cargo/vehicles/:id/on-board` items gain `lot: { label, master: {ref, code} } | null`, `consignee_name` and `display` (`RTX-ABC123-B · 25 pcs`).
  - `GET /customer/bookings/:id/cargo` gains `lots: [{ ref, code, label, status, current_holder, pieces, consignee: {name} | null, drop, vehicle, depot, text, pod }]` (cancelled lots left out). `text` reads "Lot B (25 pieces): delivered to Sharma Traders, Boring Road, Patna" (pieces, not cartons). A master's own `pod` is null: each lot has its own.
  - `POST /shipments` accepts `drops: [{ name?, address, lat, lng, consignee_name, consignee_phone?, consignee_gstin?, pieces, weight_kg?, declared_value?, eway_bill_ref? }]` (up to 26) and top-level `declared_value`, `consignee_name`, `consignee_phone`, `consignee_gstin`, `eway_bill_ref`. Two or more drops make the master (answered as `GET /shipments/:id`, with `lots: [{ id, tracking_id, lot_label, lot_seq, status, current_holder, current_vehicle_id, current_depot_id, pieces_total, pieces_delivered, total_weight_kg, declared_value, freight_share, consignee_name, consignee_phone, consignee_gstin, eway_bill_ref, eway_part_b_required, split_reason, delivery_points }]`); one drop is the plain destination with its consignee. A lot's `GET /shipments/:id` has `master: {id, tracking_id, status}`. Drop weights and values are given for every drop or none; given weights add up to `total_weight_kg` (±0.5 kg). With `vehicle_id` every lot is assigned to it (the vehicle must take the whole weight). A multi-drop shipment can't be opened for bidding.
  - `POST /customer/bookings` accepts the same `drops` (2 to 20); weights for every drop or none, adding up to `weight_kg`. `drop_*` stays the drop the price is quoted to (the app sends the farthest). Confirming the booking creates the master and its lots; cancelling it cancels every lot while none was picked up.
  - `GET /shipments` lists masters and lots. A master has `is_master: true`, `vehicle_id: null` and `lots_summary: { count, delivered_lots, pieces_delivered, lots: [{ id, code, label, status, current_holder, current_vehicle_id, pieces_total, consignee_name }] }`; a lot has `parent_shipment_id`, `lot_label` and `master_tracking_id`. Vendor loads carry `is_master`, `parent_manifest_id`, `lot_label` and, for a master, `lots_summary`; a load lot's `tracking_id` is its lot code.
- **Rollup.**
  - When every lot is settled: `delivered` if each is delivered with nothing short or returned (the master's own record included), `partially_delivered` if anything was delivered, else `returned` or `lost`.
  - Otherwise, in this order: `on_hold` if an open lot is held; `exception` if any lot is in an open case or failed a delivery; `in_transit` if an open lot is moving (`returning` when every open lot is); `at_hub`; `partially_delivered` if some were delivered and the rest wait; `assigned`; `created`. A problem outranks movement, so the master shows it.
  - Cancelled lots (merged or emptied) are ignored.
  - The master row stores the rollup status and holder: they are rewritten with a compare-and-set after every lot write, so lists, bookings and counts read it. `where` computes the rollup live. A load master stores the load status for it.
  - The master's holder is its lots' common holder; when they differ, `vehicle` if any lot is on a vehicle, else `hub`. `totals.by_holder` gives the breakdown. Its `current_vehicle_id` and `current_depot_id` are always null.
  - A rollup status change is logged in the master's hash chain (`metadata.rollup`), bills the master's own part on `delivered`, and moves the customer's booking (a lot's failed delivery is told once, on the lot, not again for the master).
- **Conservation.**
  - Weight is shared pro rata of the held pieces.
  - The value basis is `declared_value`, else the shipment's HSN lines (or the vendor's declared value). It is stored on the master at the split.
  - The freight basis is a won bid's amount, else `freight_charge`, or for a lot its `freight_share`. A load's basis is its request's agreed cost; a load priced only per km has no freight share.
  - The lots share `basis × held / total`. The master keeps the rest as its own `freight_share` (the part delivered before the split).
  - A lot's `freight_charge` equals its `freight_share`.
- **Splits.**
  - Lots with fewer pieces than are held get a remainder lot (last) that keeps the source's drop and consignee. A single lot is allowed only when the source keeps pieces it already accounted for (the remainder after a partial delivery).
  - A lot starts in its source's status, except the remainder of a partial delivery, which is back `in_transit`. A lot with a new drop starts with `delivery_attempts` at 0.
  - Each lot gets its own delivery points (`shipment_id` and `lot_shipment_id` are the lot): its `drop`, else copies of the source's open drops. The lots are put on the source's vehicle route (when that vehicle is in service) before the source's open stops are cancelled.
  - Open cases on the source are extended to every lot (items copied, pieces capped at the lot's). A case's goods leave out masters.
  - A lot split again gives its children to the same master, labelled A1, A2; lots of A1 go on numbering under the same letter (A3, A4), so every lot label is a letter and a number. The split lot keeps only what it accounted for, with its weight, value and freight reduced to that part: cancelled with 0 pieces when it had none, else delivered, partially delivered, returned or lost (a delivered part is billed then).
  - **Refused:** a master (409 naming where its lots are, "with more than one holder" when they are in different places); goods being handed over on a transfer; goods on a planned transfer (except the split a partial transfer makes itself); delivered goods; goods without a count; goods whose vehicle or hub is not on record.
  - **Reasons:**
    - `partial_transfer` needs goods on a vehicle, and `hub_crossdock` goods at a hub.
    - `partial_delivery_remainder` needs delivered pieces and a drop or consignee on each lot.
    - `multi_drop` is before pickup, with a drop on each lot.
  - **Where a lot goes next:**
    - On a vehicle, `to_vehicle_id` or `to_depot_id` plans a transfer.
    - At a hub, only `to_vehicle_id`: the lot's drop goes on that vehicle's route, and the goods leave with `hub_out`.
    - With the sender, `to_vehicle_id` assigns the lot to that vehicle (a load's vehicle is set).
- **Merges** need lots of one master with the same holder, vehicle or hub, status, consignee (name and phone) and drops. None may have delivered, short or returned pieces, a moving custody event since the split (pickup, departed, delivery, handovers, hub in/out, returns, lost) or an open transfer. The lowest-numbered lot keeps the goods; the others are cancelled with 0 pieces and their stops cancelled.
- **Masters refuse** (409 with `use: 'lots'`, `master` and `lots: [{ref, code, label}]`): every custody kind, transfers, the delivery code, manual cases, a status PATCH, assigning a vehicle, a lot e-way reference, a split and deletion. Cancelling a master (a status PATCH to `cancelled`, or a booking cancel) cancels its lots instead, refused once any lot was picked up. `split` and `merge` are refused by `POST /cargo/custody` (400). Split and merge notes are written by the system in plain words, and are the event `summary` in every view.
- **Invoices.**
  - A lot is billed its `freight_share` when it is delivered, one invoice per lot, with `price_source: 'lot_freight_share'`. The GST rate comes from the master's HSN lines, and the vendor is the master's won bid's.
  - A master is billed only its own kept share when it rolls up to delivered, and never when that share is 0.
  - Finance's unpriced deliveries leave out masters that kept nothing.
- **E-way bills.** A transfer's handover-in to a vehicle sets `eway_part_b_required` on the goods it moved (for a partial transfer, only the moving lot). `POST /cargo/transfers/:id/eway` clears it.
- **Counting.** Masters are left out (`is_master` not true) of the dashboard counts, analytics' delivered counts, demand, the plannable loads (routing, optimizer, open loads), public delivered cities and vehicle loads. The shipments list gives masters `vehicle_id: null`, so fleet allocation counts lots only.
- **Relationship names.** `delivery_points <-> shipments` is ambiguous now (`lot_shipment_id`): embeds name `delivery_points!delivery_points_shipment_id_fkey`. Self-embeds name `shipments_parent_shipment_id_fkey` / `cargo_manifest_parent_manifest_id_fkey`. `db-ambiguous-relations.json` was extended by hand.
- **Vendor loads.** Split, merge, rollup, transfers, cross-docks, where, timeline, the customer and driver views and invoices work for loads. The limits:
  - There is no multi-drop creation for loads (a vendor request has one drop). Split a load with a `drop` per lot instead; the lot's drop is its `drop_location` and `drop_lat`/`drop_lng`, and load lots have no route stops, as loads never had.
  - A load master's `vehicle_id` is cleared at the split, so the driver app lists the lots as the loads.
  - The vendor request completes when the master rolls up to delivered.
  - Lot codes `CM-XXXXXXXX-A` resolve through `parent_manifest_id` and `lot_label`.
