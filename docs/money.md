# Money: invoices, pricing and payment

Payments are offline for now (docs/workflow-blueprint.html, Decisions). Invoices are shown and downloadable in every app, and staff mark them paid when the money arrives. A payment gateway can come later.

## Staff console

`/money` (admin and superadmin; managers have no access). `/finance` redirects here and keeps its `?tab=`.

| Tab | What it does |
|---|---|
| To price | Delivered shipments and vendor loads with no invoice. **Set price** saves the price and issues the invoice at once. A row that already has a price shows **Issue invoice** instead. |
| Invoices | Filter by status, requester type (vendor or customer), overdue and period. Shows outstanding, overdue and collected this month. A row opens the invoice page. |
| Expenses | The expense log (moved from Finance). |
| Claims | The cargo claims list, with Export CSV. This is the one place for claims; `/cargo?tab=claims` opens it here. |
| Driver pay | Pay rates, each finished trip, approval and payouts, with Export CSV. The old `/money/driver-pay` address opens this tab. |

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

### Where to pay, for vendors and customers

`GET /api/v1/invoices/payment-details` (vendor, customer, admin, superadmin) returns only `account_name`, `bank_name`, `bank_account_no`, `bank_ifsc`, `upi_id`, `payment_terms_days` and `available` (true when a bank account or UPI id is saved). Nothing else from the company settings is returned. `GET /vendor/invoices` and the invoice on `GET /vendor/loads/:id` carry `due_date`, `overdue`, `days_overdue`, `paid_at`, `payment_method` and `payment_reference`.

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

### The customer's own invoice list

`GET /api/v1/customer/invoices` (customer only; each row also has `amount_paid` and `outstanding`) lists the invoices of the caller's bookings, lots included, newest first. Void invoices and ones billed to a vendor are left out, so every row can be downloaded with `GET /invoices/:id/pdf`. Each row has `id`, `invoice_number`, `status`, `total`, `amount`, `gst_amount`, `issued_at`, `due_date`, `overdue`, `days_overdue`, `paid_at`, `payment_method`, `payment_reference`, `shipment_id`, `booking_id`, `tracking_id`, `pickup_name` and `drop_name`. `GET /customer/bookings` rows also carry `rated` (the delivery has been rated).

### A customer's profile and the buyer on their invoices

`GET` and `PATCH /api/v1/customer/profile` (customer only) read and save `full_name`, `company_name`, `gstin`, `email`, `billing_address`, `city`, `state` and `pincode`. Values are trimmed; an empty value clears a field; a field not sent is left alone; anything else is a 400. A bad value is a 422 with a plain message: the GSTIN needs the right format and check character, the PIN code 6 digits, the state must be one of the GST states, and the GSTIN's state must be the state given. The reply adds `display_name` (company, else name, else "Customer 7701" from the phone) and `billing_ready` (GSTIN, address and state on record). Staff read and edit any customer with `GET` and `PATCH /api/v1/bookings/customers/:id/profile` (the booking list's `customer.id`).

A new invoice is billed to the company name (else the name) with the GSTIN and the address (address, city, state, PIN code). The place of supply is the GSTIN's state, else the state the customer chose, and decides CGST + SGST or IGST. A customer with neither is billed with the place of supply unknown, as before. Invoices already issued keep the buyer they were issued with.

### Reporting a payment or asking about an invoice

The customer, on an invoice of their own that is not void (`GET` and `POST /api/v1/customer/invoices/:id/reports`):

- `{ kind: 'payment', amount, paid_on, method: upi|neft|rtgs|imps|cheque|cash|other, reference }`. The amount cannot be more than what is due (422), nor can the date be in the future or before the invoice date. A UTR or cheque number is needed except for cash and other. An invoice that is already paid takes no payment report. The same reference is not taken twice while the first is open.
- `{ kind: 'query', message }`, 3 to 1000 characters; allowed on a paid invoice too.

Another customer's invoice, one billed to a vendor, and an unknown one are all 404; a void invoice is 409. Reports are kept in `invoice_payment_reports` (status `open`, then `confirmed` or `rejected` for a payment, `answered` for a query). Proof files are not attached yet (`attachment_path` is reserved).

Staff (admin, superadmin), under `/api/v1/finance`:

- `GET /invoice-reports?status=&kind=&invoice_id=` lists them with the invoice number, total and the customer's name. `GET /invoices?reports=open` lists the invoices with an open report (whatever their date) and every invoice row carries `open_reports`. `GET /invoices/summary` adds `open_reports`, `open_payment_reports` and `open_query_reports`.
- `POST /invoice-reports/:id/confirm` `{ method?, reference?, paid_on?, note? }` marks the invoice paid through the same path as `PUT /invoices/:id/pay` (so the audit entry and totals are the same), with the customer's reference and date. Repeating it records nothing twice. An invoice already marked paid only has the report confirmed. Invoices have no part payments, so a report below the amount due is refused (409): reject it, or record the payment when the rest arrives. A transfer is recorded as `bank`; "other" needs the method chosen (`method`).
- `POST /invoice-reports/:id/reject` `{ reason }` and `POST /invoice-reports/:id/answer` `{ answer }` close a payment or a query; the customer is told.

Today's "waiting on you" list has `queues.payment_reports.count`, the open payment reports.
