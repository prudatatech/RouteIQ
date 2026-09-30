# Notifications

Every in-app notification is a row in `notifications` (`user_id`, `title`, `body`, `type`, `data`), sent by `notificationService` (`backend-ts/src/services/notification.service.ts`). Staff types are sent with `notifyStaff` (admin and superadmin; managers too for the types in `OPERATIONS_NOTIFICATION_TYPES`). Deactivated accounts are skipped. A driver also gets a push with the same `data` plus `type`.

Principle (workflow blueprint, principle 7): every handoff notifies and deep-links. Each notification carries the ids the receiving app needs to open the exact item, and the web resolvers in `frontend/src/components/ui/notificationTargets.ts` map staff and vendor types to a page. The mobile apps map the customer and driver types below to their own screens.

**No duplicates.** Where a trigger can fire twice (a scheduler pass, a retried request, a payment marked twice) the sender uses `sendNotificationOnce` / `notifyStaffOnce`: the same person is not sent the same `type` with the same `data[key]` again within the window given below.

## Staff (web console)

| Type | Trigger | Data ids | Opens |
| --- | --- | --- | --- |
| `driver_signed_up` | A driver account is created by OTP sign-in (once per driver) | `user_id` | `/admin/users/:user_id` |
| `driver_needs_vehicle` | Daily people job: a driver signed up over 24 h ago (within 30 days) and has no real vehicle (a `TEMP-` placeholder does not count). Once per driver | `user_id` | `/admin/users/:user_id` |
| `document_uploaded` | A driver uploads a document themselves (not when staff add one for them) | `user_id`, `doc_id`, `doc_type` | `/admin/users/:user_id?tab=documents` |
| `delivery_rated` | The customer rates a delivery (confirm receipt). A rating staff enter themselves does not notify staff | `shipment_id`, `code`, `rating`, `rated_at`, `comment?` | `/shipments/:shipment_id` |
| `stop_prompts_released` | A driver stops working with unanswered stop prompts | `user_id`, `prompts[]` | `/admin/users/:user_id` |
| `people_status` | Leave or suspension ended and people are active again | `count`, `user_ids[]` | one person: `/admin/users/:id`, several: `/admin/users` |
| `bank_details_changed` | Bank details changed (person and superadmins) | `user_id` | `/admin/users/:user_id?tab=bank` |
| `customer_booking` | A customer books or cancels | `booking_id` | `/requests?open=:booking_id&source=customer` |
| `vendor_request`, `vendor_request_cancelled` | A vendor posts or cancels a load | `request_id` | `/requests?open=:request_id&source=vendor` |
| `vehicle_request` | A driver registers a vehicle for approval | `vehicle_id`, `driver_id` | `/vehicle-requests?open=:vehicle_id` |
| `kyc_submitted` | A vendor submits KYC | `profile_id` | `/admin/kyc?open=:profile_id` |
| `capacity_bid`, `capacity_window_closed`, `stop_flagged` | Bids, closed return trips, flagged stops | `bid_id`, `window_id`, `confirmation_id`, `route_stop_id` | `/return-trips?tab=bids&open=...` (Bids to decide; the page moves to the right tab and opens the bid) |
| `tpl_application`, `tpl_update`, `tpl_order_status`, `tpl_order_accepted`, `tpl_offer_declined` | 3PL partner events (admins and superadmins: admins can view partners, only a superadmin approves) | `partner_id`, `order_id`, `offer_id` | `tpl_application` and `tpl_update`: `/return-trips?tab=partners&open=:partner_id`; the others: `/3pl-partners/:partner_id` |
| `sos` | An emergency | `alert_id`, `vehicle_id` | `/emergency?open=:alert_id` |
| `stop_failed`, `route_postponed`, `driver_action_rejected` | Trip problems | `route_id`, `shipment_id`, `manifest_id` | `/routes/:route_id`, else the consignment |
| `fleet_alert`, `document_expiring` | Alerts and expiring documents | `alert_id`, `user_id`, `doc_id` | `/fleet?tab=alerts`, `/admin/users/:user_id?tab=documents` |
| `cargo_exception_opened`, `cargo_exception_escalated`, `cargo_exception_resolved` | Cargo cases | `exception_id`, `code` | `/cargo/exceptions/:exception_id` |
| `cargo_transfer_planned`, `cargo_transfer_completed` | Transfers | `transfer_id`, `code` | `/cargo/transfers/:transfer_id` |
| `cargo_partial_delivery`, `cargo_rto_started`, `cargo_at_hub`, `cargo_delivery_otp` | Custody events | `shipment_id` or `manifest_id`, `exception_id?`, `depot_id?` | case, else `/shipments/:shipment_id` |
| `cargo_claim_update` | A claim is filed | `claim_id`, `code` | `/cargo?tab=claims&open=:claim_id` |

## Vendors and 3PL partners (shipper portal)

| Type | Trigger | Data ids | Opens |
| --- | --- | --- | --- |
| `return_trip_opened` | A bidding window opens (driver toggle, "open backhaul", the return-trip screen, staff console or wizard) and the truck is within 50 km by road or in the vendor's city. Approved-KYC vendors with a location only. Never includes the plate. Once per vendor per window (`window_id`). When the driver's matching toggle runs with the truck position known, `passing_route` is sent instead of this, so a vendor is not told twice | `window_id`, `closes_at`, `trigger_type` | `/vendor/corridor` |
| `passing_route` | Route-corridor match for a truck passing the vendor | `route_id` | `/vendor/corridor` |
| `vendor_profile_incomplete` | A bid can't be awarded because the vendor's profile has no pickup location. Once per bid (`bid_id`). Staff see "Vendor has been asked to add a location" and can set the location for the vendor (`PUT /vendor/:id/location`) | `bid_id`, `window_id`, `missing` (`location`) | `/vendor/documents` |
| `invoice_issued` | An invoice is created (delivery of a shipment, a vendor load, or a load a 3PL partner delivered). Once per invoice | `invoice_id`, `invoice_number`, plus below | `/vendor/invoices` |
| `invoice_paid` | Staff mark an invoice paid. Once per invoice | same | `/vendor/invoices` |
| `request_approved`, `request_rejected`, `vehicle_assigned`, `request_escalated`, `request_assigned_partner`, `request_completed`, `load_picked_up`, `load_in_transit` | Their posted load moves | `request_id` (`vehicle_assigned` also `vehicle_id`, `cost`) | `/vendor/shipments?open=:request_id` |
| `bid_accepted`, `bid_lost`, `bid_rejected`, `bid_expired`, `bid_reopened` | Their bid | `bid_id` (`bid_accepted` also `shipment_id`, `window_id`) | `/vendor/shipments?open=:bid_id` |
| `kyc_approved`, `kyc_rejected` | KYC decision | `vendor_id` | `/vendor/documents` |
| `cargo_exception_opened`, `cargo_exception_resolved`, `cargo_transfer_completed`, `cargo_partial_delivery`, `cargo_rto_started`, `cargo_at_hub` | Their goods | `request_id`, `manifest_id`, `code`, plus `exception_id`, `transfer_id`, `depot_id`, `route_id` where they apply | `/vendor/shipments?open=:request_id` |
| `cargo_claim_update` | Their claim changes status | `request_id`, `manifest_id`, `claim_id`, `code` (claim), `consignment_code` (load), `status` | `/vendor/shipments?open=:request_id` |
| `tpl_offer`, `tpl_offer_taken`, `tpl_offer_withdrawn`, `tpl_order_paid`, `tpl_approved`, `tpl_paused`, `tpl_resumed`, `tpl_rejected` | 3PL partner events (a partner is paid for an order with `tpl_order_paid`; a partner has no invoice) | `partner_id`, `offer_id`, `order_id` | `/3pl-portal/:partner_id` (Orders; `?open=:offer_id` opens an offer), `tpl_order_paid`: `/3pl-portal/:partner_id/earnings` |

A newly approved 3PL applicant has no account yet, so approval is emailed too, with a link to `/3pl/onboard/setup` (the web address comes from `WEB_APP_URL`, else the first allowed origin that is not localhost).

Invoice ids by recipient: a vendor load carries `manifest_id` and `request_id` (also for a 3PL-delivered load); space a vendor won carries `shipment_id` and `bid_id`.

## Customers (customer app)

| Type | Trigger | Data ids |
| --- | --- | --- |
| `booking` | Booking status changes | `booking_id`, `status` |
| `invoice_issued` | Invoice for their booking is issued | `invoice_id`, `invoice_number`, `shipment_id`, `booking_id` |
| `invoice_paid` | Staff mark it paid | same |
| `cargo_exception_opened`, `cargo_exception_resolved`, `cargo_transfer_completed`, `cargo_partial_delivery`, `cargo_rto_started`, `cargo_at_hub` | Their goods | `booking_id`, `shipment_id`, `code`, plus `exception_id`, `transfer_id`, `depot_id` |
| `cargo_delivery_otp` | Delivery code sent | `booking_id`, `shipment_id`, `code`, `expires_at`, `sent_by` |
| `cargo_claim_update` | Their claim changes status | `booking_id`, `shipment_id`, `claim_id`, `code` (claim), `consignment_code` (shipment tracking id), `status` |

## Drivers (driver app)

| Type | Trigger | Data ids |
| --- | --- | --- |
| `document_verified` | Staff verify their document (once, when it turns verified) | `user_id`, `doc_id`, `doc_type` |
| `document_rejected` | Staff reject it | `user_id`, `doc_id`, `doc_type` |
| `document_expiring` | Reminder before expiry | `user_id`, `doc_id` |
| `vehicle_approval` | Their registered vehicle was approved or rejected | `vehicle_id`, `decision` |
| `delivery_rated` | A delivery they made was rated (customer or staff). Once per rating | `shipment_id`, `code`, `rating`, `rated_at`, `comment?` |
| `route_assigned`, `route_activated`, `route_cancelled` | Route changes | `route_id` |
| `cargo_assigned` | New pickup or bid win | `request_id` or `shipment_id`, `vehicle_id` |
| `cargo_transfer_planned`, `cargo_transfer_completed`, `cargo_exception_opened` | Cargo work | `transfer_id`, `exception_id`, `code` |
| `shipment_delivered`, `shipment_cancelled` | Shipment changed | `shipment_id`, `route_id` |
| `dispatch_message` | Message from dispatch | `route_id` |
| `maintenance` | Vehicle moved to maintenance | `vehicle_id`, `job_id` |
| `account_changed` | Sign-in email changed | `user_id` |
