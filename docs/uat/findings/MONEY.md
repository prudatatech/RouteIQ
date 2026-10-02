# Audit area 4: Money (invoices, driver pay, expenses, settlement, reports)

Walked on the TEST stage (`staging-api.margixindia.com`) as real actors in throw-away companies of its own
(`makeCompany`, `makeCompanyAdmin`, `makeVendor`, `makeDriver`), by `e2e/staging/money.mjs` (re-runnable, fresh accounts every run;
`node e2e/staging/money.mjs [identity gta lifecycle lots pay expenses settle isolation]`). Nothing was deployed.

**Result: 226 steps, 205 PASS, 21 FAIL on the stage as it runs today.** Every one of the 21 is a bug found by this walk and fixed in this
branch (code and regression tests); the stage runs the old code, so they still fail there and turn green once the branch is deployed and
migration `20261010040000_driver_pay_rates_per_company.sql` is applied. Several of the failures are knock-on effects of another (marked "follows").

How the load was made: delivered vendor loads (request + manifest) are written straight to the database for the company under test; the
invoice, pay, void, price, settlement, rate and expense calls then go through the real API as the real actors. Driver pay entries come from
the real path (a driver's vehicle, a route taken pending, active, completed by the company admin through `PATCH /routes/:id/status`).
The delivery-triggered invoice path itself (`onManifestDelivered`, with the "Invoice not issued" notice) belongs to the trips audit and is
covered here by unit tests only.

## Steps

### 1. Company invoicing identity

| Step | Expected | Result | |
|---|---|---|---|
| 1.1 | invoice blocked until name/GSTIN/state are set (409, code company_profile_incomplete) | as expected | PASS |
| 1.2 | no invoice row written while blocked | as expected | PASS |
| 1.3 | pricing a delivery is refused before the profile is complete too | as expected | PASS |
| 1.4 | the refused pricing did not save a price | as expected | PASS |
| 1.5 | PATCH /org saves the invoicing identity | as expected | PASS |
| 1.6 | invoice issues once the profile is complete (201) | as expected | PASS |
| 1.7 | number uses the company prefix (PFX-YYYYMM-0001), prefix saved upper-case | as expected | PASS |
| 1.8 | stamped with the issuing company | as expected | PASS |
| 1.9 | due date = issue + payment terms (10 days) | as expected | PASS |
| 1.10 | PATCH /org refuses an invalid GTA option (400) | stage still runs the old code: PATCH /org stored any profile key unvalidated (issue 4) | FAIL |
| 1.11 | PATCH /org refuses a malformed GSTIN (4xx) | as expected | PASS |
| 1.12 | a second company cannot take the same prefix (409) | as expected | PASS |
| 1.13 | same prefix via PATCH /org is a clean 4xx, never a 500 | stage still runs the old code: same (issue 4) | FAIL |
| 1.14 | prefix must be 2-6 letters or digits (400) | as expected | PASS |
| 1.15 | numbers are sequential 0002,0003,0004 in the company sequence | as expected | PASS |
| 1.16 | concurrent issue: 6 invoices, 6 distinct numbers | as expected | PASS |
| 1.17 | company A starts its own sequence at 0001 with its own prefix | as expected | PASS |
| 1.18 | after changing the prefix new invoices use it (new prefix, sequence restarts at 0001) | as expected | PASS |
| 1.19 | the old invoice keeps its old number | as expected | PASS |
| 1.20 | a prefix another company used and gave up cannot be taken (409), so numbers never collide | stage still runs the old code: a given-up prefix was free to take (issue 6) | FAIL |

### 2. Invoice per GTA option, GST split, PDF

| Step | Expected | Result | |
|---|---|---|---|
| 2.rcm_5.1 | invoice issued | as expected | PASS |
| 2.rcm_5.2 | stored amounts to the paisa (taxable 19499.99, gst, total) | as expected | PASS |
| 2.rcm_5.3 | tax_mode and gst_rate recorded | as expected | PASS |
| 2.rcm_5.4 | intra-state (27 → 27): no tax lines | as expected | PASS |
| 2.rcm_5.5 | SAC 9965 on the line | as expected | PASS |
| 2.rcm_5.6 | goods HSN listed for reference (7306) | as expected | PASS |
| 2.rcm_5.7 | freight GST never taken from the goods' 18% rate | as expected | PASS |
| 2.rcm_5.8 | reverse-charge line only for rcm_5 | as expected | PASS |
| 2.rcm_5.9 | total in words is present and mentions paise | as expected | PASS |
| 2.rcm_5.10 | words: Rupees Nineteen Thousand Four Hundred Ninety Nine and Ninety Nine Paise Only | as expected | PASS |
| 2.rcm_5.11 | PDF renders (%PDF, > 2 KB) | as expected | PASS |
| 2.rcm_5.11b | PDF content: number, SAC 9965, HSN 7306, seller, buyer, bank and UPI | as expected | PASS |
| 2.rcm_5.11c | PDF content: reverse-charge line, no CGST/SGST amounts | as expected | PASS |
| 2.rcm_5.11d | PDF content: total 19,499.99 and the total in words | as expected | PASS |
| 2.rcm_5.12 | the vendor billed fetches its own PDF | as expected | PASS |
| 2.rcm_5.13 | another vendor gets 404 | as expected | PASS |
| 2.fcm_5.1 | invoice issued | as expected | PASS |
| 2.fcm_5.2 | stored amounts to the paisa (taxable 19499.99, gst, total) | as expected | PASS |
| 2.fcm_5.3 | tax_mode and gst_rate recorded | as expected | PASS |
| 2.fcm_5.4 | intra-state (27 → 27): CGST+SGST, no IGST | as expected | PASS |
| 2.fcm_5.5 | SAC 9965 on the line | as expected | PASS |
| 2.fcm_5.6 | goods HSN listed for reference (7306) | as expected | PASS |
| 2.fcm_5.7 | freight GST never taken from the goods' 18% rate | as expected | PASS |
| 2.fcm_5.8 | reverse-charge line only for rcm_5 | as expected | PASS |
| 2.fcm_5.9 | total in words is present and mentions paise | as expected | PASS |
| 2.fcm_5.11 | PDF renders (%PDF, > 2 KB) | as expected | PASS |
| 2.fcm_5.11b | PDF content: number, SAC 9965, HSN 7306, seller, buyer, bank and UPI | as expected | PASS |
| 2.fcm_5.11c | PDF content: CGST and SGST columns, no reverse-charge line | as expected | PASS |
| 2.fcm_5.11d | PDF content: total 20,474.99 and the total in words | as expected | PASS |
| 2.fcm_5.12 | the vendor billed fetches its own PDF | as expected | PASS |
| 2.fcm_5.13 | another vendor gets 404 | as expected | PASS |
| 2.fcm_18.1 | invoice issued | as expected | PASS |
| 2.fcm_18.2 | stored amounts to the paisa (taxable 19499.99, gst, total) | as expected | PASS |
| 2.fcm_18.3 | tax_mode and gst_rate recorded | as expected | PASS |
| 2.fcm_18.4 | intra-state (27 → 27): CGST+SGST, no IGST | as expected | PASS |
| 2.fcm_18.5 | SAC 9965 on the line | as expected | PASS |
| 2.fcm_18.6 | goods HSN listed for reference (7306) | as expected | PASS |
| 2.fcm_18.7 | freight GST never taken from the goods' 18% rate | as expected | PASS |
| 2.fcm_18.8 | reverse-charge line only for rcm_5 | as expected | PASS |
| 2.fcm_18.9 | total in words is present and mentions paise | as expected | PASS |
| 2.fcm_18.11 | PDF renders (%PDF, > 2 KB) | as expected | PASS |
| 2.fcm_18.11b | PDF content: number, SAC 9965, HSN 7306, seller, buyer, bank and UPI | as expected | PASS |
| 2.fcm_18.11c | PDF content: CGST and SGST columns, no reverse-charge line | as expected | PASS |
| 2.fcm_18.11d | PDF content: total 23,009.99 and the total in words | as expected | PASS |
| 2.fcm_18.12 | the vendor billed fetches its own PDF | as expected | PASS |
| 2.fcm_18.13 | another vendor gets 404 | as expected | PASS |
| 2.inter.1 | seller 27, buyer 29: IGST only, no CGST/SGST | as expected | PASS |
| 2.inter.2 | 18% of 10000.01 = 1800.00 (1800.0018 rounded), total 11800.01 | as expected | PASS |
| 2.inter.3 | buyer snapshot has Karnataka | as expected | PASS |
| 2.inter.4 | vendor2 fetches own inter-state PDF | as expected | PASS |
| 2.odd.1 | 333.33 @5% intra: cgst+sgst equal stored GST and total adds up to the paisa | as expected | PASS |

### 3. Invoice lifecycle

| Step | Expected | Result | |
|---|---|---|---|
| 3.1 | vendor told when the invoice is issued (notification invoice_issued) | as expected | PASS |
| 3.2 | "how to pay" comes from the ISSUING company (its bank account + UPI + 20 days) | as expected | PASS |
| 3.3 | another vendor cannot read it via ?invoice= (404) | as expected | PASS |
| 3.4 | vendor lists the invoice | as expected | PASS |
| 3.4b | another vendor does not see it in its own list | as expected | PASS |
| 3.5 | payment date in the future refused (400) | as expected | PASS |
| 3.6 | payment date before the invoice date refused (400) | as expected | PASS |
| 3.7 | method required (400) | as expected | PASS |
| 3.8 | reference over 100 chars refused (400) | as expected | PASS |
| 3.9 | a manager cannot record payments (403) | as expected | PASS |
| 3.10 | another company cannot pay it (404) | as expected | PASS |
| 3.11 | paid: status, method, reference, paid_at stored | as expected | PASS |
| 3.12 | paying twice is a 409 | as expected | PASS |
| 3.13 | a paid invoice cannot be voided (409) | as expected | PASS |
| 3.14 | vendor told on payment (invoice_paid) | as expected | PASS |
| 3.15 | payment is audited | as expected | PASS |
| 3.16 | backdated payment inside the window is accepted and paid_at is that India day | as expected | PASS |
| 3.17 | void needs a reason (400) | as expected | PASS |
| 3.18 | void with reason: status void, reason + voided_at stored | as expected | PASS |
| 3.19 | a void invoice cannot be paid (409) | as expected | PASS |
| 3.20 | a void invoice is no longer downloadable by the vendor (404) | as expected | PASS |
| 3.21 | staff can still print the void invoice | as expected | PASS |
| 3.22 | after void the delivery can be invoiced again (new number) | as expected | PASS |
| 3.23 | issuing twice for the same delivery gives the same invoice (200, no second) | as expected | PASS |
| 3.24 | overdue computed: 10 days after the due date | as expected | PASS |
| 3.25 | the overdue filter lists it | as expected | PASS |
| 3.26 | summary counts it as overdue | as expected | PASS |
| 3.28 | two simultaneous payments: exactly one wins (200), the other is a 409 | as expected | PASS |
| 3.29 | and the vendor is told once | as expected | PASS |
| 3.30 | three simultaneous issues for one delivery write exactly one invoice | as expected | PASS |
| 3.27 | due today is not overdue | as expected | PASS |

### 4. Part deliveries and lots

| Step | Expected | Result | |
|---|---|---|---|
| 4.1 | one invoice per lot, one for the master part | as expected | PASS |
| 4.2 | amounts are the freight shares: master 10000 + 12000.50 + 8000 = 30000.50, not the full 30000 three times | as expected | PASS |
| 4.3 | price_source lot_freight_share | as expected | PASS |
| 4.4 | numbers are distinct | as expected | PASS |
| 4.5 | a lot with no freight share is refused (422), nothing invoiced | as expected | PASS |
| 4.6 | pricing the lot through To price sets its share and issues (201, 1234.56) | as expected | PASS |
| 4.7 | pricing again is refused (409, already invoiced) | as expected | PASS |
| 4.8 | negative price refused | as expected | PASS |
| 4.11 | a settled partial delivery with a price is listed under To price (can_invoice) | as expected | PASS |
| 4.12 | "Create invoice" on it works (201) and bills the price 5000.50 | stage still runs the old code: To price offered "Create invoice" but the endpoint refused a partial delivery (issue 8) | FAIL |
| 4.13 | the notes say 6 of 10 delivered, 3 short, 1 refused, and that a claim can offset it | stage still runs the old code: follows 4.12 | FAIL |
| 4.14 | a partial delivery still holding pieces on a vehicle is not invoiced yet (409 with a clear reason, not "no price") | as expected | PASS |
| 4.9 | /finance/unpriced answers (no 5xx) | as expected | PASS |
| 4.10 | /finance/summary answers (no 5xx) | as expected | PASS |

### 5. Driver pay

| Step | Expected | Result | |
|---|---|---|---|
| 5.1 | trip completion accrues an entry for the vehicle's driver (earned) | as expected | PASS |
| 5.2 | no rate yet: entry is 0 and flagged rate_missing; km 100 never NULL (km_source planned) | as expected | PASS |
| 5.3 | staff told once to set the rate | as expected | PASS |
| 5.4 | an entry with no rate cannot be approved (skipped with the reason) | as expected | PASS |
| 5.5 | rate validation: unknown vehicle type / negative amount are 400 | as expected | PASS |
| 5.6 | a manager cannot touch driver pay (403) | as expected | PASS |
| 5.7 | truck rate saved and the unpriced trip is priced at once (repriced_entries 1) | as expected | PASS |
| 5.8 | priced: 500 + 12.5 x 100 km = 1750.00, rate_missing cleared | as expected | PASS |
| 5.9 | per vehicle type: truck 500 + 12.5 x 33.3 = 916.25 | as expected | PASS |
| 5.10 | per vehicle type: van 200 + 8.33 x 33.3 = 477.39 (rounded to the paisa) | as expected | PASS |
| 5.11 | a rate that starts in the future is not applied to today's trip | as expected | PASS |
| 5.12 | a same-day rate for the same type replaces (only one active van rate today) | as expected | PASS |
| 5.13 | existing priced trips keep their amount when the rate changes | as expected | PASS |
| 5.14 | approve moves earned entries to approved | as expected | PASS |
| 5.15 | approving again skips ("Already approved") | as expected | PASS |
| 5.16 | adjustments add and deduct: 1750 + 100.10 - 50.05 = 1800.05 exactly | as expected | PASS |
| 5.17 | adjustment needs a non-zero amount, a reason, and cannot take the pay below zero (400s) | as expected | PASS |
| 5.18 | payout for entries of another driver is refused (409) | as expected | PASS |
| 5.19 | payout of an unapproved entry is refused (409) | as expected | PASS |
| 5.20 | UPI payout needs a reference (400) | as expected | PASS |
| 5.21 | payout = sum of its entries (1800.05 + 916.25 = 2716.30), entries paid | as expected | PASS |
| 5.22 | both entries are paid and point at the payout | as expected | PASS |
| 5.23 | the driver is told "Payment sent" | as expected | PASS |
| 5.24 | paying the same entry twice is refused (409) | as expected | PASS |
| 5.25 | a paid entry can be neither voided nor adjusted (409) | as expected | PASS |
| 5.26 | void with a reason (idempotent), reason stored | as expected | PASS |
| 5.27 | void needs a reason (400) | as expected | PASS |
| 5.28 | a void entry cannot be approved | as expected | PASS |
| 5.29 | list totals equal the sum of the rows per state | as expected | PASS |
| 5.30 | payouts list shows it with the driver name | as expected | PASS |
| 5.31 | driver 1 sees own pay: paid 2716.30, nothing else of anyone | as expected | PASS |
| 5.32 | driver 2 sees only own trips (the voided one hidden), none of driver 1 | as expected | PASS |
| 5.33 | a driver cannot call the staff pay endpoints (403) | as expected | PASS |
| 5.34 | company B sees none of company A's driver pay or rates or payouts | as expected | PASS |
| 5.35 | company B cannot adjust (404), void (404) or approve (skipped) company A's entry | as expected | PASS |
| 5.36 | company B cannot change or withdraw company A's rate (404) | as expected | PASS |
| 5.37 | company B cannot pay company A's entries (404) | as expected | PASS |
| 5.38 | two companies can each set a truck rate for the same start date (rates are per company); B's does not replace A's | stage still runs the old code: second company's rate was a 500: global unique index (issue 1) | FAIL |
| 5.39 | the company admin can run the backfill the "no driver" notice tells them to run (not superadmin only) | stage still runs the old code: backfill was superadmin-only (issue 10) | FAIL |
| 5.40 | backfilled entry has km 0 (never NULL), source none, priced with the truck rate | stage still runs the old code: follows 5.39 | FAIL |
| 5.41 | backfill twice creates nothing new (idempotent) | stage still runs the old code: follows 5.39 | FAIL |

### 6. Expenses

| Step | Expected | Result | |
|---|---|---|---|
| 6.1 | fuel / toll / maintenance / other created (201) per vehicle and per trip | as expected | PASS |
| 6.2 | amount stored to the paisa, carrier stamped, creator recorded | as expected | PASS |
| 6.3 | invalid expenses are 400: zero, negative, future date, bad category, zero litres, long note, bad date, text amount | as expected | PASS |
| 6.4 | another company's vehicle or trip cannot be attached (400) | as expected | PASS |
| 6.5 | a manager cannot create expenses (403) | as expected | PASS |
| 6.6 | a driver cannot create expenses (403) | as expected | PASS |
| 6.7 | receipt upload refuses a non-PDF/JPG/PNG (415) and an oversize file (413) | as expected | PASS |
| 6.8 | signed upload link handed out | as expected | PASS |
| 6.9 | expense saved with the uploaded receipt | as expected | PASS |
| 6.10 | receipt link serves back exactly the bytes uploaded | as expected | PASS |
| 6.11 | company B cannot get the receipt link (404) | as expected | PASS |
| 6.12 | a receipt that was never uploaded is refused (400), not saved as a dead link | stage still runs the old code: a never-uploaded receipt path was accepted (issue 3) | FAIL |
| 6.13 | another company cannot attach this company's receipt file to its own expense | stage still runs the old code: another company's receipt file could be attached (issue 3) | FAIL |
| 6.14 | an expense with no receipt answers 404 for the link | as expected | PASS |
| 6.15 | edit amount and note | as expected | PASS |
| 6.16 | edit validation: negative, empty, future date (400) | as expected | PASS |
| 6.17 | company B cannot edit (404) or delete (404) it | as expected | PASS |
| 6.18 | a trip link can be cleared | as expected | PASS |
| 6.19 | list returns exactly this company's 5 expenses with plates | stage still runs the old code: counts the dead-receipt expense that 6.12 let through | FAIL |
| 6.20 | company B lists none of them | stage still runs the old code: follows 6.12/6.13: company B had saved A's receipt as its own expense | FAIL |
| 6.21 | filters: category fuel = 2, vehicle = 4, today only = 3 | stage still runs the old code: follows 6.12 | FAIL |
| 6.22 | summary costs per category equal the sum of the expense rows | stage still runs the old code: follows 6.12 | FAIL |
| 6.23 | summary recorded costs = sum of all rows (4800.50 + 355 + 1200.20 + 99.99 = 6455.69) | stage still runs the old code: follows 6.12 | FAIL |
| 6.24 | delete (204), a second delete is 404 | as expected | PASS |
| 6.25 | the receipt file is removed from storage with its expense | as expected | PASS |
| 6.26 | summary drops the deleted expense (6455.69 - 700 = 5755.69) | stage still runs the old code: follows 6.12 | FAIL |
| 6.27 | an expense dated yesterday (India) is not in today's range | as expected | PASS |

### 7. Trip settlement and finance reports

| Step | Expected | Result | |
|---|---|---|---|
| 7.1 | no settlement yet: 404 | as expected | PASS |
| 7.2 | the vendor cannot open the settlement (403) | as expected | PASS |
| 7.3 | opened: agreed freight defaults to the load's price (10000), advance 2500.50, balance 7499.50 | as expected | PASS |
| 7.4 | stored in integer paise | as expected | PASS |
| 7.5 | extra charge added but not counted until approved (balance unchanged, pending 300.10) | as expected | PASS |
| 7.6 | approved extra counts: balance 7799.60 | as expected | PASS |
| 7.7 | approving twice changes nothing | as expected | PASS |
| 7.8 | approve a missing extra charge = 404 | as expected | PASS |
| 7.9 | float-safe: 10000 + 300.10 - 100.05 - 0.10 - 0.20 - 2500.50 = 7699.25 exactly | as expected | PASS |
| 7.10 | deduction needs a reason; zero/negative amounts are refused (400) | as expected | PASS |
| 7.11 | a deduction larger than everything owed is refused (balance may not go negative from a deduction) | stage still runs the old code: a deduction larger than the freight was accepted (issue 9) | FAIL |
| 7.12 | the load's vendor can read the settlement | stage still runs the old code: follows 7.11 (balance -42300.75) | FAIL |
| 7.13 | another vendor and another company get 404 | as expected | PASS |
| 7.14 | another company cannot add charges (404) | as expected | PASS |
| 7.15 | close needs a final POD (409) | as expected | PASS |
| 7.16 | with a final POD the trip closes: status closed, balance fixed, closure document made | stage still runs the old code: follows 7.11 | FAIL |
| 7.17 | a closed trip is final: no more changes or second close (409) | as expected | PASS |
| 7.18 | another company cannot mark this company's 3PL order paid (404) | stage still runs the old code: another company marked a 3PL order paid (issue 2) | FAIL |
| 7.19 | the owning company marks it paid with a reference | as expected | PASS |
| 7.20 | an order inside an issued statement cannot be marked paid on its own (409) | as expected | PASS |
| 7.21 | finance summary revenue (taxable) = sum of the non-void invoices | as expected | PASS |
| 7.22 | summary GST collected and outstanding equal the invoices | as expected | PASS |
| 7.23 | invoice summary: outstanding and collected-this-month equal the invoices (paid 1000.10 is rcm: total = amount) | as expected | PASS |
| 7.24 | invoice list = every invoice of the company incl. void; none of another company's | as expected | PASS |
| 7.25 | the other company sees none of it in lists or summary | as expected | PASS |
| 7.26 | status filter paid = 1 | as expected | PASS |
| 7.27 | date filters are India days: 00:30 IST today is in, 23:30 IST yesterday is out | as expected | PASS |
| 7.28 | the summary range uses the same India day | as expected | PASS |

### 8. Isolation

| Step | Expected | Result | |
|---|---|---|---|
| 8.1 | company B cannot read company A's invoice (404) | as expected | PASS |
| 8.2 | company B cannot get its PDF (404) | as expected | PASS |
| 8.3 | company B cannot pay (404) or void (404) it | as expected | PASS |
| 8.4 | company B cannot read the payment details of that invoice (404) | as expected | PASS |
| 8.5 | company B cannot invoice or price company A's delivery (404) | as expected | PASS |
| 8.6 | the invoice is untouched | as expected | PASS |
| 8.7 | platform admin acting as the platform sees invoices across companies | as expected | PASS |
| 8.8 | and can read one invoice | as expected | PASS |
| 8.9 | and download its PDF | as expected | PASS |
| 8.10 | payment-details without an invoice never errors for a vendor (5xx) | as expected | PASS |
| 8.11 | no token: 401 | as expected | PASS |
| 8.12 | a malformed invoice id is a 404, never a 500 | as expected | PASS |
| 8.13 | malformed id on pay is a 404 | as expected | PASS |
| 8.14 | an unapproved vendor cannot open someone's invoice (404/403) | as expected | PASS |

## Issues found

| # | Severity | Issue | Root cause | Fix | Status |
|---|---|---|---|---|---|
| 1 | High | A second company could not set a driver pay rate (500), and a rate set by one company blocked every other company for the same vehicle type and start date. Its drivers stay at "rate missing, 0 rupees". | `driver_pay_rates_type_from_unique` (20260930015100) was unique on (vehicle_type, effective_from) for the whole platform, written before companies existed. | Migration `20261010040000_driver_pay_rates_per_company.sql`: unique per (company, vehicle type, start date). | Fixed in code. **Migration must be applied** (not applied by me). Walk 5.38. |
| 2 | High | Any company's admin could mark another company's 3PL order paid or unpaid (`POST /tpl-network/orders/:id/paid`) and rate it (`/rate`), and change its paid reference. | `tplNetworkService.markPaid` and `rateOrder` updated `tpl_orders` by id with no company scope (the reads in the same file are scoped). | Both check the order is the active company's (`assertVisible`, `scopeQuery`), else the same 404 as a missing order. The test fixtures gave orders no company; they now have one, and a test that marked company B's order as company A now expects 404. | Fixed, regression tests in `network-api.test.ts`. Walk 7.18. |
| 3 | Medium | An expense could be saved with a receipt path that was never uploaded (a dead link) or that already belongs to another expense, even of another company (then readable through that expense's receipt link). | `parseExpense` checked only the shape of the path. | `assertReceiptUploaded`: the file must exist in the bucket (storage list) and no other expense may hold the path. The mock storage gained `list`. | Fixed, tests in `money-audit.test.ts`. Walk 6.12, 6.13. |
| 4 | Medium | `PATCH /org` with `profile` stored the invoicing keys raw: a made-up GST option was silently ignored (the invoice then used rcm_5), a lower-case prefix (`bm1`) skipped the uniqueness check and index and could be shared by two companies, and the same prefix in the same case was a 500. | `updateOrg` merged `profile` unvalidated; only `PUT /finance/company` validates. | The invoicing keys (prefix, terms, GST option, SAC, bank, UPI, footer) are routed through `saveCompanyProfile` (400 on bad values, 409 on a taken prefix, prefix upper-cased); other keys merge as before. | Fixed, tests in `money-audit.test.ts`. Walk 1.10, 1.13. |
| 5 | Medium | A company other than the default one, with no profile of its own yet, was invoiced under the platform-wide profile (its name, GSTIN, bank and UPI) instead of being blocked ("Invoice not issued"). Not reproducible on the stage (its platform profile is empty); reproduced by unit test. | `loadCompanyProfile` fell back to `system_settings.company_profile` for every company with nothing set. | Only the default company (the one that held that profile before there were companies) falls back; any other company is blocked until it has name, GSTIN and state. `org-stamping.test.ts` gave Beta its own details. | Fixed. |
| 6 | Medium | A company that changed its invoice prefix released the old one: another company could take it, and its first numbers collided with the invoices already issued (invoice numbers are unique platform-wide), so the insert retried and burned a number (its sequence started at 0002, a gap in a GST invoice series). Seen on the stage. | Prefix uniqueness looked only at the current prefix in `profile`. | A prefix any other company ever issued under (`invoice_counters`) is taken too, for both a chosen and a derived prefix. | Fixed, test in `money-audit.test.ts`. Walk 1.20. |
| 7 | Medium | "Invoice not issued" went to every staff member of every company when the delivery was made by a 3PL partner, the scheduler or the platform (there is no company in that request context). | `logIssueFailure` called `notifyStaffOnce` without the issuing company. | The 409 carries the issuing company; the notice goes to its admins (and the platform owner) and links to Settings. | Fixed, test in `money-audit.test.ts`. |
| 8 | Medium | A shipment that settled as partly delivered is listed under To price as invoiceable, but its "Create invoice" button got "Only delivered shipments can be invoiced". (Created by the delivery itself, the invoice is right: price, short and refused pieces in the notes.) | `POST /finance/invoices` allowed only `delivered`. | Allows `partially_delivered`; one that still holds pieces answers 409 "still on a vehicle or at a hub" instead of "no price". | Fixed, tests in `money-audit.test.ts`. Walk 4.12, 4.13. |
| 9 | Low | A settlement deduction larger than the freight and approved extras was accepted (balance -42,300.75 in the walk). | `addDeduction` had no limit (driver pay refuses the same). | Deductions together may not exceed freight plus approved extras (400). | Fixed, test in `documents-api.test.ts`. Walk 7.11. |
| 10 | Low | The "no driver to pay" notice tells the company to "run the driver pay backfill", but the endpoint was superadmin-only (403 for a company admin) and the web has no button. | `requireRole('superadmin')` on `/driver-pay/backfill`. | A company admin may run it: it reads and writes only that company's trips and entries. Managers and drivers still get 403. **Owner decision, reversible**: two tests that pinned "superadmin only" were changed. | Fixed. Walk 5.39 to 5.41. |
| 11 | Low | A CSV export (expenses and the other lists) opened in a spreadsheet runs a note such as `=HYPERLINK(...)` as a formula. | `toCsv` wrote text as is. | Text starting with `=`, `+`, `-` or `@` gets a leading quote; numbers and numeric strings are untouched. | Fixed, test in `csv.test.ts`. |

## Checked and fine

- Blocked until name, GSTIN and state (409 `company_profile_incomplete`, nothing written, no price saved by a refused "To price"); numbers
  `PREFIX-YYYYMM-0001` per company, a prefix change restarts at 0001 and old invoices keep their numbers, six simultaneous issues give six
  distinct numbers, three simultaneous issues for one delivery write one invoice, two simultaneous payments give one 200 and one 409.
- Odd amounts to the paisa for all three GTA options: 19,499.99 at rcm_5 (no GST, reverse-charge line shown), fcm_5 (CGST 487.50 + SGST 487.50),
  fcm_18 (1,755.00 + 1,755.00); 10,000.01 at 18% inter-state is IGST 1,800.00 (1,800.0018 rounded once), total 11,800.01; the stored GST equals
  the CGST+SGST (or IGST) shown; never the goods' 18%. SAC 9965, HSN listed for reference, total in words. The PDF (read back with `pdftotext`)
  shows number, seller, buyer, SAC, HSN, bank account and UPI of the issuing company, due date, and the reverse-charge sentence only for rcm_5.
- PDF: 200 with `%PDF` for staff, the billed vendor and the platform admin; another vendor 404; a void invoice is not downloadable by the vendor
  but still by staff.
- Lifecycle: future payment date, date before the invoice date, missing method, over-long reference all 400; manager 403; other company 404;
  double pay 409; paid cannot be voided; void needs a reason; a void invoice cannot be paid and its delivery can be invoiced again with a new
  number; overdue is 10 days for a due date 10 India days ago and not overdue on the due day; "how to pay" comes from the issuing company
  (bank, UPI, terms) and another vendor cannot read it; vendor notified at issue and at pay (once); payment audited.
- Driver pay: rate per vehicle type (truck 500 + 12.5/km, van 200 + 8.33/km to the paisa), a rate starting in the future is not applied, a
  same-day rate replaces the old one, a rate set later prices the trips that had none, approve, adjust (+100.10, -50.05 exact; not below zero),
  payout equals its entries and marks them paid, the driver is told, a paid entry cannot be voided, adjusted or paid again, void with reason,
  each driver sees only their own (voided hidden), company B sees and changes nothing of company A's rates, entries and payouts.
  Km: planned km on completion, 0 with source `none` when nothing is known, never NULL (the migration's `CASE`/`coalesce` also guards the
  first-stop `lag` NULL; read, and exercised by walk 5.40 once the backfill is open to the company).
- Expenses: fuel/toll/maintenance/other per vehicle and per trip, validation (zero, negative, future, bad category, litres, note length, date),
  another company's vehicle or trip refused, receipt through the signed upload (bytes read back equal), 415/413 on bad type or size, company B
  cannot read the receipt link, edit/delete rules, delete removes the receipt file, summary per category equals the rows, India-day range.
- Settlement: paise exact (10000 + 300.10 - 100.05 - 0.10 - 0.20 - 2500.50 = 7699.25), an extra charge counts only once approved, close needs a
  final POD, a closed trip is final, the vendor can read but not write, another vendor or company gets 404; an order inside an issued 3PL
  statement cannot be marked paid on its own (409).
- Reports: summary revenue (taxable), GST, outstanding and the invoice summary equal the invoices in the database; the India day boundary
  (00:30 IST today in, 23:30 IST yesterday out) holds for both list and summary; company B sees none of company A's invoices, summary or
  lists; the platform admin acting as the platform sees across companies and can open a PDF.

## Observations, not changed

- `GET /finance/invoices`, `/summary` and the expense list are not paginated; the database caps a read at 1,000 rows by default, so a company
  with more rows in a range would see a silently short list and short totals. Not reproduced (needs more than 1,000 rows).
- `PATCH /routes/:id/status` on a route with no vehicle answers 500 instead of a 4xx (trips audit).
- The goods line on the PDF prints the goods' own rate ("HSN 7306 ... @ 18%") next to freight that charges 0% or 5%. Intended as a reference;
  the owner may want the rate dropped so it is not read as the freight's.
- Invoice numbers can skip when an insert fails after the counter was bumped (an unrelated error); the series stays unique, not gap-free.

## Files

`e2e/staging/money.mjs`, `backend-ts/src/services/{company,org,invoice,tpl-network}.service.ts`, `backend-ts/src/services/documents/settlement.ts`,
`backend-ts/src/routes/{finance,driver-pay}.routes.ts`, `supabase/migrations/20261010040000_driver_pay_rates_per_company.sql`,
`frontend/src/utils/csv.ts`; tests `backend-ts/test/money-audit.test.ts` (new) and edits in `documents-api`, `driver-pay`, `effective-role`,
`network-api`, `org-stamping`, `support/mock-supabase.ts`, `support/db-schema.json`; `frontend/src/utils/csv.test.ts`.
