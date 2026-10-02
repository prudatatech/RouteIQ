# Phase 3: order routing and quotes

This builds `docs/platform-model.md` "How work flows" step 1. A vendor's posted load (`vendor_shipment_requests`,
see `docs/load-posting-design.md`) reaches logistic companies either **sent to chosen companies** or **open** to every
company serving the lane. Companies quote or accept, the vendor picks one, and the load then belongs to that company.

## Data (migration `20261004010000_order_routing.sql`)

- **`vendor_shipment_requests`.**
  - `routing` (`open` | `chosen`, default `open`).
  - `carrier_org_id uuid` (the winning company, null until awarded), indexed. `company_ids uuid[]` already exists:
    the chosen companies.
  - `quote_deadline timestamptz`: `now() + 2 hours` when `quote_requested`, else null.
  - `awarded_at`, `awarded_quote_id`.
- **`load_quotes`.** `id`, `load_id`, `carrier_org_id`, `amount_inr numeric(12,2)`, `valid_until`, `vehicle_class`,
  `pickup_eta date`, `notes`, `status` (`submitted` → `accepted` | `declined` | `withdrawn` | `expired`), `created_by`,
  `created_at`, `updated_at`.
  - Unique `(load_id, carrier_org_id)` where the status is `submitted`: one live quote per company.
  - RLS: the company reads and writes its own; the vendor org reads the quotes on its loads; platform admins read.
- **Who sees a load** (`app.can_see_load(load)`, SECURITY DEFINER, used by the RLS on `vendor_shipment_requests`,
  `load_items` and `load_quotes`):
  - the vendor (`vendor_id` = me, or `vendor_org_id` in my orgs);
  - the awarded company (`carrier_org_id` in my orgs);
  - while the status is `pending` and the vendor org is `active` (not held for verification):
    - `routing = 'chosen'`: companies in `company_ids`;
    - `routing = 'open'`: any active logistic company;
  - platform admins.
  - Replace the old `vendor_id = auth.uid() OR is_staff()` policy. Staff of company B must not see a load awarded
    to company A.
- **Vehicles.** Add `hazmat_certified bool default false`, `is_reefer bool default false`, and `body_type text`
  (`closed`, `open`, `container`, `reefer`, `tanker`, `trailer`).

## Backend

- **`POST /vendor/loads`** accepts `routing` and `company_ids` (at most 10 active logistic companies, checked). The
  `quote_deadline` is set as above. Notifications go to matching companies only:
  - `chosen`: the owners and admins of those companies;
  - `open`: companies whose vehicles or depots serve the pickup or delivery state or city. If none match, all
    active companies.
  - Never every staff member platform-wide. Never a held (unverified) vendor's load: those are announced when KYC
    is approved.
- **Company side** (logistic company staff, scoped to the active org):
  - `GET /company/loads/market?tab=new|quoted|won|lost` lists the loads this company can see, with the load
    number, lane, dates, totals, items, flags, budget, quote_requested, the deadline, and my quote if any.
  - `POST /company/loads/:id/quotes` `{ amount_inr, valid_until?, vehicle_class?, pickup_eta?, notes? }` creates or
    replaces my submitted quote. It is refused when the load is not visible, not pending, or already awarded.
  - `DELETE /company/loads/:id/quotes/mine` withdraws it.
  - `POST /company/loads/:id/accept` `{ amount_inr? }` is a direct accept at the vendor's budget, or at the amount
    given, allowed only when `quote_requested` is false. It creates an `accepted` quote and awards it at once.
    When the load has a recommended range, see "Priority, recommended range and booking" below: the amount is required
    and must be inside it.
- **Vendor side.**
  - `GET /vendor/loads/:id/quotes` lists the quotes: company name, the company's completed trips, amount, validity,
    ETA, notes.
  - `POST /vendor/loads/:id/quotes/:quoteId/accept` awards the load:
    - it sets `carrier_org_id`, `awarded_at` and `awarded_quote_id`;
    - status `approved`, `cost` = amount;
    - every other quote becomes `declined`;
    - it notifies the winner and the others.
    It is atomic, and only one award can ever happen.
  - Once awarded, the existing company flow continues: assign a vehicle (`assignVehicleToRequest`) and documents.
- **Assigning a vehicle** (`assignVehicleToRequest`) now requires:
  - the acting company is `carrier_org_id`, or the caller is a platform admin;
  - the vehicle belongs to that company;
  - the fit rules: a hazmat load needs `hazmat_certified`; a perishable load with a temperature range needs
    `is_reefer`; and ODC needs an open or trailer body. These are a single
    `assertVehicleFits(load, vehicle)` in `services/loads/vehicle-fit.ts`, 409 with the reason.
- **The old `/vendor/shipment-request/:id/approve`** ("Accept and price") becomes the direct accept for the acting
  company, and sets `carrier_org_id`.
- **Scheduler.** Every 15 minutes:
  - quotes whose `valid_until` has passed become `expired`;
  - for loads with `quote_requested` and a passed `quote_deadline` and no quote: escalate once to the platform
    admins and tell the vendor "Companies need a little longer".
- **Documents.** The carrier for documents is now `carrier_org_id` on the load (fallback: the manifest), so a
  company can generate the LR before assigning a vehicle.

## Web

- **Vendor.**
  - In the Transport step: "Who should quote?". Either open to all companies serving the route (default), or
    chosen companies, picked from `/public/companies` filtered by the cities.
  - The load page has a **Quotes** card: the quotes with Accept, and the deadline countdown.
  - The confirmation copy follows the choice: "Sent to N companies" or "Open to companies serving Mumbai → Delhi",
    plus "Quotes usually arrive within 2 hours" when a quote was requested.
- **Company.** `RequestsPage` "To accept" becomes **New loads** (market):
  - tabs New, Quoted, Won and Lost;
  - the drawer shows every posted field: load number, products with HSN, the GST summary, e-way, hazmat and
    temperature, dates and slot, contacts, dock and access, budget, and quote requested with its deadline;
  - a **Quote** form, plus **Accept at ₹X** when allowed.
  - Won loads go to the existing assign and documents flow.
- **Fleet.** The vehicle form gets "Hazmat certified", "Refrigerated (reefer)" and the body type.

## Priority, recommended range and booking (migration `20261010120000_load_priority_price_range.sql`)

Owner decision, 2 Oct 2026. The vendor no longer chooses quotes versus an own price, gives no budget and does not choose
who sees the load. The platform shows a recommended freight range, a logistic company books the load at any price inside
it, and every load is offered to all companies serving the lane (routing `open`). Internal order matching decides who is
told first. The older fields stay in the table and the API for old loads and API clients.

- **Columns on `vendor_shipment_requests`.**
  - `priority` (`high` | `medium` | `low`, default `medium`): how urgent the load is. The vendor picks it.
  - `price_min_inr`, `price_max_inr` (`numeric(12,2)`, `min <= max` when both are set): the recommended range.
  - Index `idx_vsr_board` on (`priority`, `pickup_date`, `created_at`) for pending, unawarded loads.
  - `create_vendor_load(jsonb)` writes the three columns.
- **The range is computed on the server** when the load is created (`recommendedRange` in `loads.service.ts`): the same
  estimator as `POST /public/loads/assist` (`estimateFreight`, the pricing service), rounded to the rupee, on the server's
  own totals. A range sent by the client is ignored. When no estimate can be made (no rate card, routing down) the load is
  posted with both prices null and a warning is logged; it then behaves as before (budget, quotes).
- **Direct book.** A payload without `quote_requested` and `budget_inr` (the new web form) is a direct-book load
  (`quote_requested` false). Loads with `quote_requested` true (older loads, API clients) keep the quote flow.
- **Booking inside the range.** `POST /company/loads/:id/accept { amount_inr }`: when the load has a range, `amount_inr` is
  required and must be within `[price_min_inr, price_max_inr]`, bounds included; otherwise 400 with the range in the message
  ("...within the recommended range for this load: Rs 18,000 to Rs 24,000."). Without a range: the budget, or the amount
  given, as before.
- **Views.**
  - Company market list and load detail: `priority`, `price_min_inr`, `price_max_inr`. The `new` and `quoted` tabs are ordered
    by priority (high, medium, low), then pickup date (no date last), then newest post first. `network_vehicles` (this
    company's network size) is on the market rows for platform staff only; a company never sees how it is ranked.
  - Vendor views: `POST /vendor/loads` answers with `priority`, `price_min_inr`, `price_max_inr` (also inside `load`); the
    posted-load detail (`load`), `/vendor/loads/mine`, the "My loads" board (`GET /vendor/loads`) and the quotes summary carry
    them. A repost draft copies `priority`; the range is worked out again when the draft is posted.
- **Matching (internal order).** `rankCompanies` in `order-routing.ts` scores each company by network size and sorts the
  highest first (ties by id, so the order is always the same).
  - Network size = the company's active vehicles (not archived, not pending approval) + the active vehicles of its active
    affiliated 3PL partners (`tpl_affiliations.status = 'active'`, `vehicles.carrier_org_id`).
  - `notifyCompanies`: `high` tells the companies one after another in rank order and marks the notification urgent
    (title "Urgent: ...", `data.priority = 'high'`, `data.urgent = true`); `medium` and `low` tell everyone as before with
    `data.priority` set (low may be batched later).
  - The scorer is a function (`CompanyScorer`); N2 (carrier scores, `docs/network-blueprint.md`) replaces `networkSizeScorer`.
  - Matching never gates visibility: `app.can_see_load` is unchanged, every company serving the lane can still open the load.
