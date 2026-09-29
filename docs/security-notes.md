# Security notes

## Write paths

Every change to business data goes through backend-ts, which validates the
request, checks the caller's role and ownership, applies the status transition
only if the record is still in the status the caller saw, notifies the people
who need to know and writes an audit entry (`ai_agent_logs`, listed on the
superadmin Audit Logs page; shipment status changes also go into the
hash-chained `shipment_logs`).

Clients (web app, driver app, customer app) read with their own Supabase
session, subject to row-level security. They write directly only where the
table below says so. Anything not listed is service-role only: a client write
fails with "permission denied".

Status transitions live in one place, `backend-ts/src/core/transitions.ts`
(routes, shipments, cargo manifests, operating vehicle states).

| Table / bucket | Only allowed write path | Direct client write still allowed |
| --- | --- | --- |
| `vendor_profiles` | `POST /vendor/profile`, `POST /vendor/kyc/submit`, `PUT /vendor/kyc/documents` (vendor); `PUT /vendor/kyc/:id/approve` and `/reject` (staff, notifies the vendor, audited) | none |
| `kyc_documents` bucket (vendor KYC files) | signed upload URL from `POST /vendor/kyc/upload-url` (PDF, JPG, PNG, size limited, path chosen by the server in the vendor's folder) | none |
| `tpl_partners` | `POST /tpl/onboard`, `PATCH /tpl/:id` (applicant with PAN, pending only), `POST /tpl/:id/settings` (partner), `POST /tpl/approve/:id`, `/reject/:id`, `/:id/pause`, `/:id/resume`, `DELETE /tpl/:id` (superadmin; each applies only from the expected status, notifies the partner, audited) | none |
| `tpl_documents`, `tpl_corridors` | `POST /tpl/onboard`, `PATCH /tpl/:id`, `POST /tpl/:id/documents/:docId/replace` (partner), applied corridors on approval | none |
| `kyc_documents` bucket (3PL files) | signed upload URL from `POST /tpl/applications/upload-url` | none |
| `vendor_shipment_requests`, `cargo_manifest` | `POST /vendor/shipment-request` (approved KYC only), `PUT /vendor/shipment-request/:id/approve` / `reject` / `assign-vehicle`, driver `complete-stop` and `start-route` | none |
| `capacity_windows`, `capacity_bids` | `POST /capacity/bids` (approved KYC), `POST /capacity/bids/:id/approve` / `reject`, `POST /capacity/driver/open-backhaul-window`, `POST /vehicles/:id/return-trip` | none |
| `routes`, `route_stops` | `PATCH /routes/:id/status` (staff any allowed transition, drivers only start their own), `PATCH /routes/:id`, `POST /telemetry/driver-ping/start-route`, `.../complete-stop` | none |
| `shipments`, `shipment_logs`, `parcels`, `delivery_points` | `POST /shipments`, `PATCH /shipments/:id` (status, staff and drivers), `PATCH /shipments/:id/edit` (priority, items, weight), `POST /shipments/:id/assign`, `POST /cargo/verify-pod` | none |
| `vehicles` | `POST/PATCH/DELETE /vehicles`, `PATCH /vehicles/:id` (driver: load and position only), `POST /telemetry/driver-ping`, `.../break` | driver app 1.1.0: position, heartbeat and status (`available`, `on_route`, `idle`, `offline`) of the driver's own vehicle; position and heartbeat are accepted in every vehicle status, but the driver cannot change the status of a vehicle in maintenance or archived (a trigger enforces it), coordinates range-checked |
| `telemetry`, `gps_points` | `POST /telemetry/driver-ping`, `POST /telemetry`, `POST /gps` | driver app 1.1.0: insert for the driver's own vehicle, readings range-checked |
| `driver_confirmations` | `POST /capacity/driver/ack-stop`, `/confirm-stop`, `/flag-stop` (answered once) | driver app 1.1.0: answer `confirmed` once, while the prompt is unanswered |
| `sos_alerts` | `POST /telemetry/sos/trigger`, `POST /vehicles/:id/sos` (driver, notifies staff), `PATCH /telemetry/sos/:id/details` (driver), `PUT /telemetry/sos/:id/acknowledge` / `resolve` (staff) | none |
| `notifications` | created by backend-ts services only; `POST /notifications/:id/read`, `/read-all` | own `is_read` flag only (the bell) |
| `users` | `PATCH /users/:id` (admin; no self role change or deactivation, audited), `PUT /auth/driver/profile`, `PUT /users/language`, driver OTP sign-in | own `push_token` only (length capped) |
| `invoices`, `payments`, `expenses`, `system_settings` (fuel price) | `/finance/*` (staff; invoice pay/void, expense delete and fuel price changes are audited) | none |
| `customers` | customer OTP sign-in and `/auth/customer/*` | none |

Storage: no client may insert into `kyc_documents` directly. Every upload uses a
signed URL that backend-ts issues for a path it picked.

### Installed driver app 1.1.0

The installed driver app keeps working with the policies above. It writes
directly, with the driver's own session, only:

- `vehicles` (position, heartbeat, `idle` / `on_route`) for its own vehicle,
- `telemetry` rows for its own vehicle,
- `driver_confirmations.action = 'confirmed'` when the driver accepts an
  inserted stop,
- `users.push_token`.

What changed for it: a vehicle in maintenance or archived keeps accepting
position and heartbeat writes, so tracking continues during an emergency, but
its driver cannot change its status (a trigger on `vehicles` refuses it). An SOS
does not change the vehicle's status; only a serious breakdown or accident does
(maintenance), and tracking continues. A stop prompt that was already answered
or accepted by the timeout can no longer be answered again. Builds after 1.1.0
call `POST /capacity/driver/confirm-stop`; position can move to
`POST /telemetry/driver-ping`, after which these direct-write policies can be
dropped.

### Known gaps

- Supabase Realtime broadcast channels are not authorised per user. The channel
  `driver-confs-<vehicle id>` used for the dispatcher "call driver" nudge can be
  joined and sent to by any signed-in user. It carries no data that changes
  records, but a hostile client could send a driver a fake call prompt. Fixing
  it needs Realtime authorization (private channels) in the Supabase project.
- The public shipment tracking endpoint (`GET /shipments/track/:tracking_id`)
  is rate limited per IP; the tracking id is the secret, as with a courier.
