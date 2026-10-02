# Audit 5: the 3PL lifecycle (test stage)

Walk: `node e2e/staging/tpl.mjs` (fresh companies A and B, their admins, a platform admin, a vendor per company, three
partner applications). Partner owner sign-ins are seeded (see issue 7). Onboarding is limited to 5 submissions per hour per
address, failures included, so `SEED=1 node e2e/staging/tpl.mjs` inserts the 2nd and 3rd applications and the first one
directly (everything else is the real API). Results below are from the stage as it was before these fixes were deployed
(runs of the same day), except where noted.

## Steps

| # | Step | Expected | Result | |
|---|---|---|---|---|
| 1 | Guest upload-url for PAN card, GST certificate, cancelled cheque; PUT; read back | link, bytes identical | identical | PASS |
| 1 | upload-url with a bad document type, .exe, 5 MB, no application id | 400 / 415 / 413 / 400 | as expected | PASS |
| 1 | Submit with GSTIN of another PAN, bad GSTIN, PAN, phone, IFSC, account, e-mail, corridor rate without unit, document path not issued | 400 each | 400 each (checked at submit and through the edit route) | PASS |
| 1 | Guest submits a valid application with documents and corridors | pending, tracking id, 3 documents, corridors as number + unit, organisation (tpl_partner, pending) | as expected | PASS |
| 1 | Duplicate e-mail, duplicate partner id | 409 | 409 | PASS |
| 1 | Track page for a guest | status only, e-mail masked, no PAN/bank/phone/documents, nothing of other applications | as expected; right PAN gives the full record; wrong id 404 | PASS |
| 1 | Company B admin reads the application queue and a stranger's application | no bank or PAN | full queue (every applicant's PAN and bank account) | FAIL, fixed (issue 1) |
| 2 | Platform approves, rejects (reason required), approve/reject twice, company admin approves | 200 / 400 / 409 / 403 | as expected; rejection reason visible on the track page | PASS |
| 2 | Partner organisation after approval | kind tpl_partner, active | yes | PASS |
| 2 | send-otp (e-mail is not configured on the stage) | clean error | 503 "Email delivery is not configured" (no 500); unknown e-mail 200, bad address 400, wrong code 400 | PASS |
| 2 | Partner requests changes (SLA, tax, corridors); staff reject, then approve; partner replaces a document | review, old terms kept on reject, applied on approve, back to review on document change | as expected | PASS |
| 2 | Pause / resume by platform, company admin cannot | 200 / 403 | as expected | PASS |
| 3 | Partner asks to join A; A approves, pauses, resumes, ends; B never sees A's partner; P1 joins B too | per company | as expected; B gets 404 on A's partner, fleet and approve | PASS |
| 4 | Vehicle with RC and insurance usable, without waits; duplicate plate; foreign fleet 403; fleet counts only for the company | | as expected | PASS |
| 4 | Partner uploads a vehicle photo or document copy through the signed flow | link, bytes read back | 403 (route was staff and driver only) | FAIL, fixed (issue 4) |
| 4 | Rules (min rate/km, GPS, insurance, vehicle class, lane) in the preview | excluded with reasons; unknown key and negative value refused; B cannot set A's rules | as expected | PASS |
| 5 | Broadcast escalation, targeted escalation, repeat 409, foreign company 404 | | as expected | PASS |
| 5 | Accept needs vehicle and driver of the partner's own fleet (400/404/409 for the wrong ones); first accept wins, second is "taken" | | as expected | PASS |
| 5 | Order of the accepted offer belongs to company A | carrier = A | carrier = the partner's own organisation | FAIL, fixed on `test` meanwhile (issue 2) |
| 5 | Trip: pickup, departed, delivery with a signed POD photo and signature read back; order and vendor load follow; delivery without POD refused; invoice made from the company's price (22000) | | as expected | PASS |
| 5 | Legacy accept (partner without vehicles), note-based delivery, step order, decline, withdraw | | as expected | PASS |
| 5 | B's load goes to P1 only; P1's portal lists offers and orders grouped by company | two groups, named | grouped under the partner itself because of issue 2 | FAIL, fixed |
| 6 | Earnings (paise-exact totals), statement per company, deductions (422 over the total), issue, partner reads list/detail/PDF (`%PDF-`), mark paid, orders paid, per-order markPaid 409 inside an issued statement and a paid one, balance in paise | | as expected | PASS |
| 6 | Company B rates / marks paid an order of A | 404 | 200 (rated, paid) | FAIL, fixed on `test` meanwhile (issue 2) |
| 7 | Stats: offers, accepted, declined, acceptance rate, average response minutes, SLA breaches, rating average (recomputed from the rows) | equal | equal | PASS |
| 7 | Company B reads stats of A's partner / all partners | only its own partners and its own work | all partners, all work | FAIL, fixed (issue 3) |
| 8 | B withdraws A's offer, B sets the price of A's load | 404, unchanged | 200, changed | FAIL, fixed (issue 3) |
| 8 | A partner's driver (company-level driver seat in the test) on partner routes | 403 | 200 | FAIL, fixed (issue 5) |
| 8 | Vendor on partner and staff routes, partner on staff/company routes, P2 on P1's fleet/statements/offers, guests | 403 / 401 | as expected | PASS |

## Issues

1. **High: any company's admin could read every 3PL application in full** (`GET /tpl/queue`, `GET /tpl/:id`, and edit one
   with `PATCH /tpl/:id` or fetch upload links): PAN, bank account and IFSC of strangers. The optional-auth routes never
   attached the caller's organisation, so the account's base role (admin) counted as platform staff. Fix: a signed-in caller
   on those routes gets the role of the organisation they act for; the platform sees and edits everything; a company sees only
   its own (not ended) partners, without bank, PAN or documents, gets the status view of anyone else's, and cannot edit.
   `routes/tpl.routes.ts`, `tpl-affiliation.ts`. Test `tpl-isolation.test.ts`. Status: fixed, needs deploy.
2. **High: an accepted order was stamped with the partner's own organisation, not the company's.** The company's orders list,
   the partner's grouping by company, staff notifications and (now that orders are scoped) rating and payment all keyed on
   the wrong owner. Fixed on `test` by another audit (order takes its offer's company, rating and mark-paid are scoped);
   merged here. Migration `20261010050000_tpl_orders_company_owner.sql` moves rows already stamped with a partner
   organisation to the company of their offer. Status: fixed, needs the migration applied.
3. **High: company B could withdraw A's offer, re-price A's load, and read stats of any partner.** Withdraw, vendor price
   and the stats routes were not limited to the caller's company. Fix in `tpl-network.service.ts`: withdraw and offer lookup
   scoped, the price of another company's load is a 404, stats take the company's own work only and only for a partner it works
   with. The partner's own `/my/stats` is unchanged. Status: fixed, needs deploy.
4. **Medium: a partner could not upload photos or document copies for its vehicles** (the vehicle photo routes are for staff
   and drivers; a partner owner acts as a vendor). Added `GET/POST upload-url/PUT/DELETE /tpl-portal/:id/vehicles/:vid/photos`
   (same slots, same signed flow, own vehicles only, writes need an active partner and a non-driver). Web screens for it
   are not built yet. Status: backend fixed.
5. **Medium: a partner's driver-role member could use the partner's offers, orders and earnings routes** (any membership of the
   partner organisation counted). Driver seats are now left out of the partner lookup. Status: fixed.
6. **Low (note): onboarding rate limit** is per address and counts rejected submissions, so a person fixing typos burns the
   five allowed per hour; the PAN check on track and edit allows 10 per 15 minutes. By design, flagged for the owner.
7. **Not testable on the stage:** the real partner set-up (e-mail code) needs e-mail delivery, which is not configured, and
   the partner driver's sign-in is a phone code. The walk seeds the partner owner (linked to the partner row, whose trigger
   gives the owner seat) and gives the driver a password sign-in with an extra company driver seat so it has the driver role.
   "Request changes" on a first application does not exist (staff approve or reject only); the partner can request changes
   to an active profile, which works.
8. **Observation:** the database trigger affiliates every new partner (pending) to the default company, so an applicant
   appears in that company's partner list before any company chose it.
