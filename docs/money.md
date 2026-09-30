# Money: invoices, pricing and payment

Payments are offline for now (docs/workflow-blueprint.html, Decisions). Invoices are shown and downloadable in every app, and staff mark them paid when the money arrives. A payment gateway can come later.

## Staff console

`/money` (admin and superadmin; managers have no access). `/finance` redirects here and keeps its `?tab=`.

| Tab | What it does |
|---|---|
| To price | Delivered shipments and vendor loads with no invoice. **Set price** saves the price and issues the invoice at once. A row that already has a price shows **Issue invoice** instead. |
| Invoices | Filter by status, requester type (vendor or customer), overdue and period. Shows outstanding, overdue and collected this month. A row opens the invoice page. |
| Expenses | The expense log (moved from Finance). |
| Claims | The cargo claims list. |
| Driver pay | Links to `/money/driver-pay`. |

`/money/invoices/:id` shows the invoice as a GST tax invoice, with **Mark paid** (method, reference, date received), **Void** (with a reason) and **Download PDF**. It links to the shipment (`/shipments/:id`), the requester and the trip. The shipment page's invoice link opens this page.

## Company details (the seller)

Settings > Company and invoicing. Stored in `system_settings` under `company_profile`: company name, GSTIN, PAN, address, SAC code, bank and UPI details, payment terms in days (default 15) and a footer line. Nothing is invented: an invoice shows what is saved here, and the invoice page lists what is missing.

## Due date and overdue

An invoice is issued with `due_date` = issue date + the payment terms. An invoice issued before due dates existed is shown with issue date + the current terms. An `issued` invoice is **overdue** once its due day (an India calendar day) has passed. Paid and void invoices are never overdue.

## GST split

The tax on the invoice is one amount (`gst_amount`, at `gst_rate`, from the goods' HSN lines). It is shown as CGST + SGST when the company GSTIN and the buyer GSTIN are in the same state (the first two digits), and as IGST when they differ. When either GSTIN is missing the place of supply is not known, so it is shown as one GST amount with a note.

## API

Staff (admin, superadmin), under `/api/v1/finance`:

- `GET /invoices?from=&to=&status=&requester=vendor|customer&overdue=1` lists invoices with `due_date`, `overdue`, `days_overdue`, `requester_type` and `requester_name`.
- `GET /invoices/summary` returns `outstanding`, `overdue` and `collected_this_month` (with counts).
- `PUT /invoices/:id/pay` with `{ method: 'bank'|'upi'|'cash'|'cheque', reference?, paid_on? }` records the payment (`payment_method`, `payment_reference`, `paid_at`; `paid_on` is an India date, default today, not in the future, not before the invoice date) and sends the `invoice_paid` notification to the customer or vendor.
- `PUT /invoices/:id/void` with `{ reason }` (3 to 300 characters). A paid invoice cannot be voided.
- `POST /unpriced/price` with `{ kind: 'shipment'|'manifest', id, amount }` sets the price where the invoice service reads it (shipment `freight_charge`, a vendor load's request `cost`, or `freight_share` for a lot) and issues the invoice. 409 if the delivery already has an invoice or is priced by a won bid.
- `GET` and `PUT /company` read and save the company details.

### One invoice

`GET /api/v1/invoices/:id` (admin, superadmin) returns the invoice with `seller`, `seller_gaps`, `buyer`, `lines`, `goods` (HSN lines), `tax` (`intra`, `inter`, `unknown` or `none`, with CGST, SGST and IGST), `total_in_words`, `overdue` and `links` (`shipment`, `request_id`, `requester`, `trip`).

### Invoice PDF, for the vendor portal and the customer app

`GET /api/v1/invoices/:id/pdf` returns `application/pdf` as an attachment named after the invoice number. It needs the caller's bearer token, so fetch it with the session and save the blob (a plain link cannot carry the header).

Who may download:

| Caller | Access |
|---|---|
| admin, superadmin | any invoice, including void |
| vendor | only invoices billed to them (`invoices.vendor_id`, or the vendor of the load's request); not void ones |
| customer | only invoices for shipments of their own bookings (a lot counts through its master); not void ones |
| manager, driver, anyone else | 403 |
| another vendor or customer | 404, the same as an unknown id |

The customer and vendor apps get the invoice id from the `invoice_issued` and `invoice_paid` notifications (`data.invoice_id`) and from their own invoice lists (`GET /vendor/invoices`).
