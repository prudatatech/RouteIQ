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
