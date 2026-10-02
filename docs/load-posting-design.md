# Load posting, goods classification and shipment documents

The build spec for `docs/prd/customer-load-posting-v1.pdf`: the Customer Load Posting PRD v1 with its
Appendix A. Every numbered PRD section maps to a part below. It sits inside the platform model
(`docs/platform-model.md`) and the guest-first rule (`docs/vendor-public.md`):

- the PRD's "customer" is our **vendor**: a business, or an individual shipper with account type
  "Customer";
- "Margix matching a carrier" means the order routing to logistic companies (chosen companies, or open to
  those serving the lane);
- "Request quotation from Margix" asks those companies to quote within 2 hours.

## 0. What already exists and is reused

- **GST engine:** `core/gst.ts`. State codes, `taxLines` (CGST+SGST or IGST, integer paise) and
  `stateOf(gstin)`.
- **Idempotency:** `core/idempotency.ts`, the `idempotent(action)` middleware.
- **Phone OTP:** `routes/auth.routes.ts`, the customer and driver send-otp and verify-otp. It uses Redis and
  Twilio (`sms.service.ts`), and `createSupabaseSession`.
- **HSN tables:** `hsn_codes` and `search_hsn()` in the database are unused. `shipment_hsn` is never written.
  The web has `utils/hsnDatabase.ts`, about 150 entries with a fuzzy search.
- **Pricing:** `pricing.service.quote` (rate per km by vehicle type, with factors), plus `/public/quote`.
- **Distance:** `distance.service.getDrivingDistance` (Mappls, then Google, then haversine).
- **Proof of delivery:** `pod.service`.
- **Custody:** `cargo_custody_events` (pickup, delivery, inspection, with pieces, condition and photos).
- **Exceptions and claims:** `cargo_exceptions`, `cargo_exception_items`, `cargo_claims`.
- **Invoice PDF:** `invoice-pdf.service.ts` (pdfkit), with `core/words.ts` for amounts in words.
- **Counter pattern:** `invoice_counters` and `next_invoice_number()` (migration 20261002030000).
- **Guest drafts:** `utils/guestDraft.ts`, and the public API (`routes/public.routes.ts`).

## 1. Goods master and classification (PRD §3, §4.4, §5, §12, §13)

Migration `20261003010000_goods_master.sql`.

- **Extend `hsn_codes`.** Add:
  - `gst_rates numeric(5,2)[]` (one rate, or several for multi-rate codes; `gst_rate` stays the default);
  - `rate_note text` (e.g. "28% for bags over 25 kg");
  - `category text`;
  - `synonyms text[]`;
  - `is_hazmat bool` and `is_perishable bool`;
  - `eway_always bool` (hazardous: e-way bill at any value);
  - `effective_from date`;
  - `needs_review bool`;
  - `source text`.
- **Seed:**
  - the PRD §13 top-50 table;
  - the §3.3 category rows;
  - the 150 entries in `frontend/src/utils/hsnDatabase.ts`.
  The PRD's rates predated GST 2.0 (22 Sep 2025). Migration `20261005010000_hsn_master_gst2.sql` loads the
  full official HSN list (about 21,800 codes) with the current rates of notification 9/2025-Central Tax (Rate)
  and its amendments, and corrects the seeded rows; `docs/gst-rates.md` has the sources, the method, the
  counts and the limits, and `supabase/seed/hsn_master.csv` the rows. `needs_review` marks the codes whose
  mapping a person should confirm. The platform admin edits rates and synonyms in the admin console;
  `scripts/import-hsn.ts` loads a CSV (`hsn_code, description, gst_rates, category`, optionally `gst_rate` and
  `rate_note`).
- **`goods_categories`:** `key`, `name`, `examples`, `hsn_range`, `default_rates`, `eway_threshold_inr`
  (default 50000), `is_hazmat`, `is_perishable`, `recommended_vehicle_class`. Seeded from §3.3.
- **`vehicle_classes`:** `key`, `name`, `min_t`, `max_t`, `best_for`, `notes`, `interstate_ok`,
  `is_reefer`, `is_open`, `is_tanker`, `sort`. Seeded from §7.1:
  - mini truck;
  - 14 ft;
  - 17–20 ft;
  - 20 ft container;
  - 32 ft SXL;
  - flatbed;
  - reefer;
  - 40 ft trailer;
  - tanker.
  The key doubles as the pricing `vehicle_type` (`rate_per_km_<key>`).
- **`pincode_prefixes`:** `prefix` (the first 3 digits), `state_code` (as in `core/gst.ts`) and
  `state_name`. Seeded with the postal-circle map. A lookup tries the full pin code first (a table
  `pincodes(pincode, district, state_code)`, empty until the owner imports the India Post directory), then
  the prefix.
- **Service `services/goods/`.** The HSN index is loaded into memory and cached for 10 minutes (about 21,800
  rows; a word index keeps a search to a few milliseconds). Search ports the layered fuzzy match from
  `hsnDatabase.ts`: exact code prefix, then synonyms ("clothes" → textiles), then word prefix, then trigram and
  Levenshtein; curated rows and headings rank above long tariff-item texts. Descriptions come back in sentence
  case (the official list is in capitals; the stored text is unchanged). It returns up to 8 hits.
  It does not depend on pg_trgm, which Azure would need allow-listed.

Public endpoints (no sign-in, rate-limited, cached):

- `GET /public/hsn/search?q=` (at least 3 characters) returns
  `{ items: [{ hsn_code, description, category, gst_rates: number[], rate_note, is_hazmat, is_perishable }] }`;
- `GET /public/hsn/:code`;
- `GET /public/pincode/:pin` returns `{ pincode, state_code, state_name, district?, city? }`;
- `GET /public/vehicle-classes` and `GET /public/goods-categories`.

`POST /public/loads/assist` takes the draft load and returns:

```
{
  totals: { weight_kg, declared_value, product_count },
  eway: { required: bool, threshold, reason },
  tax: { basis: 'intra'|'inter'|'unknown', pickup_state, delivery_state,
         lines: [{ product, hsn, rate, taxable, gst }],
         by_rate: [{ rate, taxable, gst }],
         taxable, cgst, sgst, igst, gst_total, grand_total },   // paise to rupees at the edge
  hazmat_mixed: bool, perishable: bool,
  suggested: { load_type: 'ftl'|'ptl', vehicle_class, capacity_t },
  estimate: { low, high, distance_km, label: 'Actual rate confirmed after carrier assignment' } | null,
  recommendations: [{ code, severity: 'info'|'warn', message, action?: { field, value } }]
}
```

All 12 PRD §5.2 triggers are recommendation codes, as pure functions with unit tests:

- `hsn_ambiguous`;
- `multi_rate`;
- `weight_over_18t` (recommend a 22-wheel trailer);
- `ptl_heavy` (PTL over 15 t: switch to FTL?);
- `interstate_igst`;
- `eway_required`;
- `perishable_reefer`;
- `hazmat_permit`;
- `same_city`;
- `same_day_pickup`;
- `no_value`;
- `bulk_template` (3 or more products);
- `budget_below_estimate` (§5.3).

The estimate reuses `pricingService.quote` with `persist: false`.

**Mixed rates (§4.4):**

- each line keeps its own rate;
- the primary commodity is the line with the largest value, ties broken by weight;
- any hazmat line makes the load `hazmat_mixed`, which restricts it to vehicles flagged hazmat-certified.

## 2. Loads, products and submission (PRD §2, §4, §6–§11)

Migration `20261003020000_load_posting.sql`.

**`vendor_shipment_requests`** stays the vendor load, so the existing assign, manifest and invoice flows
keep working. Add these columns:

- `load_number text unique`. Format `MRX-YYYY-NNNNN`, from `load_counters(year int pk, last_seq int)` and
  `next_load_number()`, an atomic `UPDATE ... RETURNING`. It is platform-wide and resets each year.
- **Load:** `load_type` (`ftl` or `ptl`), `vehicle_class`, `capacity_t`, `temp_min_c` and `temp_max_c`,
  `special_handling text[]` (fragile, do_not_stack, this_side_up, hazmat, odc), `budget_inr`,
  `quote_requested`, `loading_help` and `unloading_help`.
- **Pickup:** `pickup_city`, `pickup_address`, `pickup_pincode`, `pickup_state_code`, `pickup_date`,
  `pickup_slot` (`morning`, `afternoon` or `evening`), `pickup_contact_name` and `pickup_contact_phone`.
- **Delivery:** `delivery_city`, `delivery_address`, `delivery_pincode`, `delivery_state_code`,
  `delivery_date`, `delivery_contact_name` and `delivery_contact_phone`.
- **Site:** `loading_dock bool` and `access_restrictions`.
- **Totals and tax:** `total_weight_kg`, `total_declared_value`, `tax_basis`, `eway_required` and
  `hazmat_mixed`.
- **Origin:** `source` (`web`, `app`, `bulk`, `api`, `repost`), `client_request_id uuid`,
  `bulk_batch_id`, and `reposted_from`.

The existing `metadata.cargo` is still written, from the primary product, so older screens keep showing
something sensible.

**New tables:**

- `load_items`: `id`, `load_id` (→ `vendor_shipment_requests`), `line_no`, `product_name`, `hsn_code`,
  `gst_rate`, `quantity`, `unit`, `weight_kg`, `declared_value`, `handling text[]`, `category`,
  `is_hazmat`, `is_perishable`. RLS follows the parent: the vendor org, the carrier org once assigned, and
  platform admins.
- `load_bulk_batches`: `id`, `vendor_org_id`, `file_name`, `row_count`, `ok_count`, `error_count`,
  `errors jsonb`, `status`, `created_by`, `created_at`. The schema is ready now; the UI is PRD Phase 2.
- When the load becomes a shipment or manifest, the items are copied to `shipment_hsn` (with the taxable
  value, CGST, SGST and IGST), so invoices show the real goods lines.

**Endpoints:**

- `POST /vendor/loads`: vendor or customer account; zod-validated; `idempotent('vendor-load')` with
  `client_request_id`. The same `client_request_id` within 10 minutes returns the first load.
  - The server recomputes totals, tax, e-way and hazmat. Client numbers are never trusted.
  - Validation: pin codes are 6 digits; the pickup date is today or later (today triggers the same-day
    warning); at most 50 items; at most 60 t.
  - It creates the load and its items in one RPC (`create_vendor_load(jsonb)`), so no half-written loads.
  - Then it notifies: in-app, plus WhatsApp (§10.3) through a provider adapter.
  - It routes the load as today, and to the chosen companies when `company_ids` is given.
  - Unlike the old `/vendor/shipment-request`, a load can be posted before KYC approval. It shows "Business
    verification pending" and goes to companies only once the vendor org is active. The old endpoint stays
    for older screens.
- `GET /vendor/loads/mine` (paged) and `GET /vendor/loads/:id`, including the items, documents and status
  timeline.
- `POST /vendor/loads/:id/repost` returns a draft (the payload with the dates cleared). It does not
  create a load. The client opens the form prefilled.
- `GET /vendor/loads/template.csv`, and `POST /vendor/loads/bulk` (up to 50 rows, validated per row,
  valid rows submitted, a batch report returned).

**WhatsApp:** `services/whatsapp.service.ts`, an adapter for the Meta WhatsApp Cloud API. The settings are
`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` and `WHATSAPP_TEMPLATE_LOAD_POSTED`. When those are not configured it
does nothing and logs; it never throws. It uses the PRD §10.3 template parameters. Email (Resend) is the
fallback when the profile has an email.

**Web OTP sign-in (§2 step 8):**

- `POST /auth/vendor/send-otp` and `/auth/vendor/verify-otp`, reusing the customer OTP machinery (Redis,
  Twilio, the limits).
- Verify finds or creates the auth user with role `vendor` and returns a Supabase session.
- The vendor org is created by the existing auto-membership trigger.
- When SMS or Redis is not configured outside production, it logs the code exactly as the customer flow
  does.

**Business profile (§9):** `GET/PUT /vendor/business-profile`. The fields:

- full name, business name;
- account type (`customer` or `business_partner`);
- GSTIN (required for business partners; verified with `gstinService.verify`);
- address, pin code (which sets `state_code`), email;
- business type (manufacturer, trader, distributor, retailer, exporter, other);
- monthly loads (1–5, 6–20, 21–50, 50+).

It is stored on the vendor organisation (`name`, `gstin`, `address`, `pincode`, `state`, `email`, and
`profile.account_type`, `business_type`, `monthly_loads`, `contact_name`) and mirrored to `vendor_profiles`
(`company_name`, `gst_number`, `address`, `city`). It returns `complete: bool`.

## 3. Shipment documents (PRD Appendix A)

Migration `20261003030000_load_documents.sql`.

**`load_documents`:**
- `id`;
- `load_id` (→ `vendor_shipment_requests`, nullable) and `shipment_id` (nullable);
- `org_id` (the owner: the vendor org for uploads, the carrier org for generated documents);
- `kind`, one of:
  `tax_invoice`, `bill_of_supply`, `delivery_challan`, `eway_bill`, `lr`, `freight_sheet`, `pod`,
  `loading_report`, `unloading_report`, `damage_report`, `trip_closure`;
- `number` and `doc_date`;
- `fields jsonb` (the A2 fields for that kind, validated per kind with zod);
- `file_path` (upload or generated PDF, in the private bucket `load_documents`);
- `status` (`draft`, `final`, `expired`, `cancelled`, `superseded`);
- `valid_until` (e-way bill), `version`, `supersedes`;
- `created_by`, `created_at`, `updated_by`, `updated_at`.

**`load_document_events`:** `document_id`, `action` (created, updated, uploaded, generated, status), the
`changes`, `by` and `at`. This is the A3 document history.

**`lr_counters`:** `org_id`, `year`, `last_seq`. LR numbers are `<org prefix or LR>-YYYY-NNNNN`, and
freight sheets use `FS-`.

**`trip_settlements`:**
- `id`, `load_id` / `shipment_id`, `carrier_org_id`;
- `agreed_freight`, `advance_paid`;
- `extra_charges jsonb` (`[{ label, amount, approved_by, approved_at }]`) and `deductions jsonb`
  (`[{ label, amount, reason }]`);
- `balance` (computed by the server: freight + approved extras − deductions − advance);
- `payment_terms` (`paid`, `to_pay` or `to_be_billed`), `payment_status`;
- `pod_document_id`, `closed_at`, `closed_by`, `status` (`open` or `closed`).

**Service `services/documents/`:**

- **Uploads:** signed upload URLs for invoices, challans, e-way bills and POD photos, plus metadata entry.
  Documents can be added after submission. E-way bill records hold the number (12 digits), the generation
  date, `valid_until`, the linked invoice or challan, the transporter ID and name, the vehicle number, the
  approximate distance and the status. Updating the vehicle number writes a version.
- **Generated PDFs (pdfkit, styled like `invoice-pdf.service.ts`):**
  - the LR/GR consignment note, from the load, transporter, route, goods and assigned vehicle (A2 fields);
  - the freight sheet;
  - the trip closure report;
  - the loading/unloading report and damage report, assembled from custody events and exceptions.
- **POD:** a document view over the existing `pod.service` and `verify-pod` custody data: delivered
  quantity, shortage and damage.
- **Pre-dispatch checklist:** `GET /loads/:id/dispatch-check` returns the required documents for this
  movement, as conditional rules:
  - invoice or challan: always;
  - e-way bill: when `eway_required` or hazmat;
  - LR: once a transporter is accepted;
  - vehicle documents valid: from `vehicles`;
  - driver licence valid.
  It flags missing, expired (an e-way bill past `valid_until`) or inconsistent items (the e-way bill
  vehicle differs from the assigned vehicle). Dispatch shows the flags. It warns, but does not block,
  unless a company setting turns blocking on.
- **Trip closure:** `POST /loads/:id/settlement` (open or update), `/extra-charges` (add, approve),
  `/deductions` and `/close`. Closing requires a final POD and a balance computed in paise.
- **Endpoints:** under `/api/v1/loads/:id/documents` (list, upload-url, create, update, generate/:kind,
  pdf, history). Who may act: the vendor org (its uploads, and reading everything on its load), the carrier
  org (generate, update and close), and platform admins (read).
- **Status timeline (A3):** `GET /loads/:id/timeline` merges the load status changes, documents, custody,
  exceptions and settlement.

## 4. Web: the Post a Load flow (PRD §2, §3.2, §4.2, §6–§11)

`/vendor/request` becomes the 5-step form. It is public, and the guest draft is restored after sign-in.

1. **Goods and HSN.** "Describe your goods" (at least 3 characters) searches as you type and shows up to
   8 suggestions: code, short description and a rate badge.
   - Picking one fills and locks the HSN code and GST rate. A multi-rate code shows "Select applicable GST
     rate", limited to its valid rates.
   - "Can't find your goods? Enter HSN manually."
   - A "Why is HSN needed?" tooltip.
2. **Products.** Product rows with: name (HSN search), HSN, rate, quantity and unit, weight in kg,
   declared value, and handling (fragile, temperature-controlled, hazmat).
   - "+ Add another product"; × on every row but the first.
   - Live totals: weight, value, and "e-Way Bill required: Yes/No", with the counter "Current declared
     value: ₹X".
   - 3 or more products shows the bulk template hint.
3. **Pickup and delivery.** City (ArcGIS suggest, restricted to India), full address, 6-digit pin code
   (which fills the state and shows "Interstate (IGST)" or "Within state (CGST + SGST)"), pickup date,
   time slot, preferred delivery date, contacts, loading dock, and access restrictions.
4. **Transport.** FTL/PTL (recommended from the weight), vehicle class with icons from
   `/public/vehicle-classes`, capacity in tonnes (suggested, can be overridden), and temperature (shown and
   required when anything is perishable: 2–8 °C, −18 °C or ambient). Also special handling, budget (with
   the warning when below the estimate and a "use ₹X" action), "Request quotation", and loading and
   unloading help. The live estimate is "₹18,000 – ₹24,000, Actual rate confirmed after carrier
   assignment".
5. **Review.**
   - A header with the weight, value, route and pickup date;
   - the product table;
   - the GST summary by rate and the per-line table (§8.3), with CGST + SGST or IGST;
   - the e-way bill notice;
   - the route, transport and estimate;
   - Edit buttons on each section;
   - a large yellow **Submit Load** button.

**Recommendations** (from `/public/loads/assist`, debounced at 400 ms) appear inline next to the field they
concern, with a one-click fix where there is one.

**Form state:**
- the guest draft (`margix:guest-draft:load`) is saved on every change and survives a refresh, closing
  the tab and the sign-in redirect;
- `client_request_id` is a UUID generated when the form opens and kept in the draft.

**Submit:**
- A guest gets the **OTP modal**: phone, then a 6-digit code, then a session, with no page change.
- New users then get the **business profile** step (§9), once.
- The submit itself.
- Existing email and password sign-in stays available as a link in the modal.

**Confirmation (§10.2):**
- the load ID, large, with a copy button;
- the route, date and vehicle;
- with a quote requested: "Logistic companies serving this lane will send quotes, usually within 2 hours"; without:
  "Logistic companies serving this lane can now accept your load. We'll notify you when one does";
- **Track this load** (My Loads) and **Post another load** (which resets the form and the draft).

**My Loads:** `/vendor/loads` lists them by load number, with a **Repost** button on each, which opens the
form prefilled with the dates cleared. The load detail page has a **Documents** tab with uploads, generated
documents, history and the pre-dispatch checklist.

**Bulk upload:** a page to download the template and upload a file. The API is ready; the page is
optional in this round.

## 5. Web: documents for logistic companies

On a vendor load or shipment in the company dashboard, a **Documents** panel:

- the checklist with flags;
- generate LR/GR, freight sheet and trip closure;
- record or update the e-way bill (number, validity, vehicle);
- the POD;
- the damage and shortage report;
- the settlement (advance, extra charges with approval, deductions, balance, close);
- each document's history.

## 6. Done when

- **Signed out:**
  - search "cement" and get 2523 with its rate;
  - add 4 products (the §4.3 example) and get 20,900 kg and ₹7,62,500, with the e-way bill required;
  - Mumbai pin codes to Delhi show IGST;
  - the review screen matches §8.3 for the rates in the database.
- **Submit:** the OTP, then the profile, then **MRX-2026-00001**. A WhatsApp send is attempted, or logged
  when not configured. Submitting twice with the same id gives one load.
- **Repost** prefills everything except the dates.
- **Company:** generates an LR and a freight sheet as PDFs, records the e-way bill, sees the checklist
  flags, captures POD and damage, and closes the trip with the correct balance.
- **Quality:**
  - tests cover the HSN search, every recommendation code, the tax maths (§8.3 totals: GST ₹56,050,
    grand total ₹8,18,550 at the PRD rates), load numbering under concurrency, idempotency, each document
    kind's validation, the settlement maths and permissions;
  - CI is green, and the 75-step story still passes.

## Owner actions (not code)

- **SMS OTP on live:** Twilio credentials and Upstash Redis on the live API. Live has no Redis today.
- **WhatsApp:** a Meta Business account, a WhatsApp Cloud API token and phone ID, and an approved
  `load_posted` template.
- **The full HSN master:** loaded by migration `20261005010000_hsn_master_gst2.sql` from the GST portal list
  and the CBIC notifications. Have a CA confirm the codes marked `needs_review` (`docs/gst-rates.md`).
- **The India Post pin code directory** (optional; the prefix map works without it).
