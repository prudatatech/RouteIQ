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
