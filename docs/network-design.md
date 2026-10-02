# Phase N1: the anchor network

A logistic company's capacity is its own fleet **plus its 3PL partners**. This phase makes that real:
partners bring actual vehicles and drivers, work handed to a partner runs on the same rails as the
company's own trips (driver app, GPS, custody, photo/signature POD), offers respect the company–partner
relationship, and the company sees its whole network in one place. Builds on `docs/platform-model.md`;
the plan is `~/.claude/plans/mellow-fluttering-unicorn.md` (Phase N1).

Two tenancy bugs are fixed here:
- `findMatchingPartners` (`tpl-network.service.ts`) offers work to every active partner platform-wide.
  It must only consider partners with an **active affiliation to the acting company**
  (`tpl_affiliations`, helper `app.affiliated_org_ids()`).
- `computeAvailabilityScore` (`matching.service.ts`) counts every company's vehicles. It must count only
  the acting company's own dispatchable vehicles (plus, when `include_network`, its active partners').

## 1. Data (migration `20261006010000_network.sql`, idempotent, app_owner pattern)

- `tpl_affiliations.rules jsonb NOT NULL DEFAULT '{}'`: `{ vehicle_classes?: string[], corridor_ids?:
  uuid[], min_rate_per_km?: number, gps_required?: bool, insurance_required?: bool }`.
- `tpl_orders`: add `vehicle_id uuid REFERENCES vehicles`, `driver_id uuid REFERENCES users`,
  `manifest_id uuid REFERENCES cargo_manifest`, `pod_photo_url text`, `pod_signature_url text`,
  `pod_received_by text`. Keep `pod_note` for old rows.
- `tpl_offers`: add `targeted boolean NOT NULL DEFAULT false` (offer sent to chosen partners only).
- Partner fleet reuses `vehicles` and `users` with `carrier_org_id` = the partner's organisation
  (kind `tpl_partner`). No new fleet tables. RLS already scopes by `carrier_org_id`; verify the
  policies admit a tpl_partner org member (extend the staff policies' org-match condition if they
  assume kind logistic_company anywhere).
- `tpl_partner_statements`: `id`, `partner_org_id`, `company_org_id`, `period` (YYYYMM), order ids
  `jsonb`, `orders_total_paise bigint`, `deductions jsonb` (`[{label, amount_paise, reason}]`),
  `balance_paise bigint`, `status` (`draft`→`issued`→`paid`), `issued_at`, `paid_at`, `paid_reference`,
  unique `(partner_org_id, company_org_id, period)`. RLS: the company writes, the partner reads,
  platform reads.

## 2. Backend

### Affiliation scoping and rules
- `findMatchingPartners(companyOrgId, ...)`: active affiliations of that company only, then apply the
  affiliation `rules` (vehicle class of the shipment if known, corridor match, min rate vs the proposed
  price, gps/insurance flags vs the partner's fleet). Every caller passes the acting org
  (`memberOrgId()`); escalation previews show why a partner was excluded (`excluded: [{partner, reason}]`).
- `escalate(..., partner_ids?: uuid[])`: when given (1–10), offer only to those affiliated partners
  (`targeted: true`); otherwise the existing broadcast to matching affiliated partners.
- `computeAvailabilityScore(shipment, companyOrgId, { include_network })`: own dispatchable vehicles of
  the required class near the origin; with network, add active affiliated partners' vehicles.

### 3PL fleet (partner portal API, account kind `tpl`)
- `GET/POST /tpl-portal/:id/vehicles`, `PATCH /tpl-portal/:id/vehicles/:vid`: the partner's own vehicles
  (reuse the vehicles service/schemas: plate, class/body, capacity, RC/insurance/fitness/permit/PUC
  numbers + expiries, hazmat_certified, is_reefer). Stamped `carrier_org_id` = partner org. No approval
  queue in N1: a partner vehicle is usable once its RC and insurance numbers are present (the company
  sees document status).
- Drivers: `POST /tpl-portal/:id/drivers/invite` reuses the existing people invite flow
  (phone → driver OTP login). Driver's `carrier_org_id`/membership = the partner org;
  `people.profile.employer_partner_id` kept in step for old screens.
- `GET /org/tpl-affiliations/:tplId/fleet` (company side): counts only — `{vehicles_total, available,
  on_trip, maintenance, by_class: {...}, docs_ok: n, docs_expiring: n}`. Never the partner's documents.

### Real 3PL execution
- `accept(offerId, { vehicle_id, driver_id })` (partner): both must belong to the partner org; run
  `assertVehicleFits(load, vehicle)`; capacity check like `assignVehicleToRequest`. On accept:
  - create the `cargo_manifest` for the source load (reuse the existing manifest-creation path in
    `vendor.service.ts` — extract a helper rather than duplicating) with `carrier_org_id` = the
    **company** (it stays responsible to the vendor) and `metadata.executed_by_org` = the partner org;
  - the driver gets the trip exactly like a company driver (driver app, custody, GPS);
  - `tpl_orders` row links `vehicle_id`, `driver_id`, `manifest_id`.
- POD: delivery goes through the normal custody/POD rails; `deliverOrder` requires the manifest's POD
  (photo or signature) instead of `pod_note`. Old orders without a manifest keep the note path.
- Status sync: manifest `picked_up`/`in_transit`/`delivered` transitions update the `tpl_orders` status
  (one function, called from the custody transition hook — see how customer-bookings syncs on shipment
  status).
- Partner views grouped by company: `offersForPartner` / `ordersForPartner` return
  `{companies: [{org_id, name, offers|orders: [...]}]}` (keep a flat `items` too for old clients).
  Replace `requireRole('vendor')` on partner routes with requireAuth + partner-org membership checks.

### Partner settlement v1
- `POST /org/tpl-affiliations/:tplId/statements {period}`: builds a draft from that period's delivered
  orders (`agreed_amount` summed in paise); `PATCH .../statements/:id` adds/removes deductions
  (label, amount, reason); `POST .../statements/:id/issue` and `/mark-paid {reference}`.
  `GET /tpl-portal/:id/statements` (partner, read).
- Balance always recomputed server-side in integer paise. PDF via the documents service pattern
  (pdfkit, like the freight sheet): orders table, deductions, balance, both org names/GSTINs.
- `markPaid` on single orders stays; an order inside an issued statement can no longer be marked paid
  individually (409).

## 3. Web

- **3PL portal** gains tabs **Fleet** (vehicles list/add/edit, document numbers + expiry badges) and
  **Drivers** (list + invite by phone), and **Statements** (list, PDF). **Orders/Offers grouped by
  company** with the company name as the section header. Accept dialog: pick vehicle + driver
  (only their own, fit errors shown from the 409 message).
- **Company dashboard**: a **My network** card/page (under fleet or the partners page): own fleet counts
  + one card per active partner (fleet counts, docs status, `computeStats` numbers), link to the
  partner detail. Escalation panel gains "Offer to: all matching / chosen partners" (multi-select of
  affiliated partners) and shows excluded partners with reasons. Affiliation detail gets a **Rules**
  editor (vehicle classes, lanes from the corridor list, min ₹/km, GPS and insurance toggles) and a
  **Statements** tab (build month, deductions, issue, mark paid, PDF).
- Vocabulary: "partner", "network", "statement", "handed to <partner>"; never "exception/route/
  consignment/manifest" in user-visible text.

## 4. Done when

- Two companies A and B, partner P affiliated to A only: B's escalation never reaches P; A's targeted
  offer to P works; the preview explains exclusions (rules).
- P registers a vehicle + driver; accepting A's offer requires both; the driver app runs the trip;
  delivery needs a real POD; the vendor's tracking shows the custody chain; `tpl_orders` reflects the
  manifest statuses.
- A's "My network" shows own + P's fleet counts; the availability score counts only A's network.
- A statement for the month sums the delivered orders in paise, takes a deduction, issues, PDF renders,
  mark-paid blocks per-order markPaid.
- CI green; the 75-step story gains a 3PL-fleet leg (register vehicle+driver, targeted offer, accept
  with vehicle, deliver with POD, statement) and stays green.
