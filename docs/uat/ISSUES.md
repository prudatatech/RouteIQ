# UAT issue log

Every issue found in UAT ([plan](UAT-PLAN.md)). One row per issue; the details sit under it.
Status: `open` → `fixing` → `fixed` (in a commit) → `verified` (re-tested), or `wontfix` with a reason.

## Passes

| Area | Pass 1 | Pass 2 |
| --- | --- | --- |
| Azure public (no sign-in) | 1 Oct 2026 | |
| Azure staff screens (superadmin) | 1 Oct 2026 | |
| CUST | 1 Oct 2026 (GitHub runner) | |
| OPS | | |
| DRV | 1 Oct 2026 (GitHub runner) | |
| VND | 1 Oct 2026 (GitHub runner) | |
| FLT | | |

## Summary

| ID | Sev | Area | Title | Status | Commit |
| --- | --- | --- | --- | --- | --- |
| UAT-001 | Major | OPS | Duplicate delay cases for one lot, opened after it was delivered, never closed (AZS-01, 02, 10) | fixed | 6b80222 |
| UAT-002 | Major | FLT | Completed trips missing from driver pay (AZS-14) | fixed | 97e2658 |
| UAT-003 | Major | FLT | Completed trip shows 0 km on the vehicle page; odometer never moves (AZS-19) | fixed | 97e2658 |
| UAT-004 | Major | FLT | Invoices issued with no seller details and "Billed to: Not recorded" (AZS-03, 17) | fixed | 467a74c |
| UAT-005 | Major | FLT | Revenue "before GST" equals invoice totals; profit shown with no costs (AZS-15, 18) | fixed | f6eb8fd |
| UAT-006 | Major | OPS | A split master tells staff to assign a vehicle and has no driver to rate (AZS-09) | fixed | 050ad2f |
| UAT-007 | Major | DRV | A lot can be delivered with no pickup recorded (AZS-08) | fixed | uat/fix-round2 (4508375) |
| UAT-008 | Major | ALL | Malformed %-escape in a URL gives a 500 on every :param route, incl. public tracking (AZP-01) | fixed | 62b1943 |
| UAT-009 | Minor | FLT | ₹1,50,000.04: GST rounding leaves stray paise (AZS-04) | fixed | 467a74c |
| UAT-010 | Minor | OPS | Trips list has no trip number or shipment (AZS-05) | fixed | dd146ed |
| UAT-011 | Minor | OPS | Completed/cancelled trips show plan ETA and distance (AZS-06) | fixed | dd146ed |
| UAT-012 | Minor | FLT | Names not trimmed ("Vishal ") (AZS-07) | fixed | e73b37c |
| UAT-013 | Minor | OPS | Master status history: duplicate Created, Delivery failed vs 0 attempts; Destination — (AZS-11, 13) | fixed | 050ad2f |
| UAT-014 | Gap | OPS | No e-way bill warning above ₹50,000 (AZS-12) | fixed | 050ad2f |
| UAT-015 | Minor | FLT | Deliveries 9 vs Delivered 6 (AZS-16) | fixed | f6eb8fd |
| UAT-016 | Minor | FLT | Automated actions missing from the audit log (AZS-20) | fixed | 6b80222 |
| UAT-017 | Minor | OPS | Live map takes ~11 s to draw (AZS-21) | fixed | f9534e2 |
| UAT-018 | Minor | FLT | Vehicle health 100 with no inputs (AZS-22) | fixed | 49bc75c |
| UAT-019 | Minor | ALL | Public source maps; no frame-ancestors on the web app (AZP-02, 03) | fixed | 8bd3c91 |
| UAT-020 | Minor | ALL | Public tracking exposes internal ids, plate and live position; short CM- ids (AZP-04) | fixed | uat/fix-round2 (4508375) |
| UAT-021 | Minor | ALL | /ready says database ok without checking; X-Request-ID echoed unchecked (AZP-05, 06) | fixed | uat/fix-round2 (4508375) |
| UAT-022 | Minor | ALL | Unknown web paths return 200 (soft 404) (AZP-07) | fixed | 8bd3c91 |
| UAT-024 | Minor | OPS | UX: addresses print the place name twice ("Fab Hostels" then "Fab Hostels, Kanakapura Main Road…") on Shipments and in the drawer | fixed | UX rounds |
| UAT-025 | Minor | OPS | UX: Requests shows 0 everywhere while 6 shipments exist; staff-created shipments never appear in Requests, and the page doesn't say so | fixed | UX rounds |
| UAT-026 | Minor | OPS | UX: Problem cases show "RTX-…-B · 1 pcs" ("pcs" vs "piece(s)" elsewhere) and "Deadline: Overdue by 13 h 36 min" on two lines | fixed | UX rounds |
| UAT-027 | Minor | FLT | UX: Optimize lists "Driver licence missing" on both vehicles as the only vehicle detail, with no link to fix it | fixed | UX rounds |
| UAT-028 | Minor | OPS | UX: /3pl-partners silently redirects to Return trips → 3PL partners; the sidebar item and page title don't match | fixed | UX rounds |
| UAT-029 | Major | FLT | Driver-pay backfill counted a phantom 20,015 km first leg (TR-FCDACA90: 21,783 km instead of 1,768 km) | fixed | this commit; live entry corrected |
| UAT-023 | Gap | ALL | No rate limit on /auth/refresh; logout doesn't revoke; robots.txt, Permissions-Policy (AZP-08, 09) | fixed | uat/fix-round2 (4508375) |

### UI/UX review (all roles, GitHub runner)

Details and screenshots: [UX](findings/UX.md).

| ID | Sev | Area | Title | Status | Commit |
| --- | --- | --- | --- | --- | --- |
| UX-01 | Major | UX | Public tracking `/track/:id`: A split booking shows "Booked", "Not yet assigned" and a failed-delivery history though 2 of 3 lots are delivered | fixed | uat/ux-fix-detail, uat/ux-fix-consistency, uat/ux-fix-leftovers |
| UX-02 | Major | UX | Vehicle page: "Nothing is expired" next to five missing documents; fuel tank 100% next to "no fuel level" | fixed | uat/ux-fix-detail, uat/ux-fix-consistency, uat/ux-fix-leftovers |
| UX-03 | Major | UX | Shipment page (master and lot): Contradictory lines and a wall of repeated history | fixed | uat/ux-fix-detail, uat/ux-fix-consistency, uat/ux-fix-leftovers |
| UX-04 | Minor | UX | Several: Raw system text shown to users (enums, audit keys, UUIDs) | reopened | uat/ux-fix-detail, uat/ux-fix-consistency, uat/ux-fix-leftovers |
| UX-05 | Minor | UX | Several: Vocabulary slips: consignment, route, Cargo, Finance, Transship, Raise problem | fixed | uat/ux-fix-detail, uat/ux-fix-consistency, uat/ux-fix-leftovers |
| UX-06 | Minor | UX | Plan a trip, Insights, trip page, Optimize: Server-setup instructions and solver jargon shown to dispatchers | reopened | uat/ux-fix-detail, uat/ux-fix-consistency, uat/ux-fix-leftovers |
| UX-07 | Minor | UX | Trip page: A normal trip page logs a 503 and says "No driving route was found" | reopened | uat/ux-fix-detail, uat/ux-fix-consistency, uat/ux-fix-leftovers |
| UX-08 | Minor | UX | Today, Fleet, Trips: Counts disagree: active trips, vehicles on the road, on trip | fixed | uat/ux-fix-detail, uat/ux-fix-consistency, uat/ux-fix-leftovers |
| UX-09 | Minor | UX | Several: One trip, one lot, several ids and spellings | fixed | uat/ux-fix-detail, uat/ux-fix-consistency, uat/ux-fix-leftovers |
| UX-10 | Minor | UX | Several: Pieces, items, pcs, "1 pcs", "1 vehicles" | reopened | uat/ux-fix-detail, uat/ux-fix-consistency, uat/ux-fix-leftovers |
| UX-11 | Minor | UX | Manifest, Analytics: ISO dates and unformatted numbers beside "1 Oct 2026" | fixed | uat/ux-fix-detail, uat/ux-fix-consistency, uat/ux-fix-leftovers |
| UX-12 | Minor | UX | All lists: Status column moves around; Vehicle column shows different things | fixed | uat/ux-fix-detail, uat/ux-fix-consistency, uat/ux-fix-leftovers |
| UX-13 | Minor | UX | Lists: CSV export on some lists only | reopened | uat/ux-fix-detail, uat/ux-fix-consistency, uat/ux-fix-leftovers |
| UX-14 | Minor | UX | Requests, Money, KYC, Dispatch: Pages open on an empty tab while the work sits in another | fixed | uat/ux-fix-detail, uat/ux-fix-consistency, uat/ux-fix-leftovers |
| UX-15 | Minor | UX | Create shipment: The form opens already showing red errors | fixed | uat/ux-fix-detail, uat/ux-fix-consistency, uat/ux-fix-leftovers |
| UX-16 | Minor | UX | Manager, customer: Blocked pages redirect silently | fixed | uat/ux-fix-detail, uat/ux-fix-consistency, uat/ux-fix-leftovers |
| UX-17 | Minor | UX | Trip detail at 390 px: Page scrolls sideways (402 px wide) | fixed | uat/ux-fix-detail, uat/ux-fix-consistency, uat/ux-fix-leftovers |
| UX-18 | Minor | UX | Menu and tabs: Same thing in two places; names that do not match the target | fixed (Claims kept in Problems and Money on purpose: managers handle claims in Problems and can't open Money) | uat/ux-fix-detail, uat/ux-fix-consistency, uat/ux-fix-leftovers |
| UX-19 | Minor | UX | Problems, transfers, lots: "Part B due", "Add" and "Count mismatch" without explanation | fixed | uat/ux-fix-detail, uat/ux-fix-consistency, uat/ux-fix-leftovers |
| UX-20 | Minor | UX | Return trips: "Combine loads" inside "Combine loads"; auto-accept after 2 minutes; ineligible options | fixed | uat/ux-fix-detail, uat/ux-fix-consistency, uat/ux-fix-leftovers |
| UX-21 | Minor | UX | Money, Driver pay: A cancelled trip paid in full; "Straight line"; Reports labels | fixed | uat/ux-fix-detail, uat/ux-fix-consistency, uat/ux-fix-leftovers |
| UX-22 | Minor | UX | Vendor portal: Verified company with no PAN, bank or documents; onboarding reopens | fixed | uat/ux-fix-detail, uat/ux-fix-consistency, uat/ux-fix-leftovers |
| UX-23 | Minor | UX | Driver `/driver`: Origin and next stop identical; Complete delivery with no trip | fixed | uat/ux-fix-detail, uat/ux-fix-consistency, uat/ux-fix-leftovers |
| UX-24 | Minor | UX | SOS page, vehicle page: Eight equal buttons; Raise SOS is the loudest button on a healthy vehicle | fixed | uat/ux-fix-detail, uat/ux-fix-consistency, uat/ux-fix-leftovers |
| UX-25 | Polish | UX | Several: Smaller layout and copy items | fixed | uat/ux-fix-detail, uat/ux-fix-consistency, uat/ux-fix-leftovers |

**Pass 2** ([UX-PASS2](findings/UX-PASS2.md)): 19 of 25 verified, 6 reopened; new:

| ID | Sev | Area | Title | Status | Commit |
| --- | --- | --- | --- | --- | --- |
| UX-26 | Major | UX | Shipment page | fixing | |
| UX-27 | Major | UX | Shipment history, tracking | fixing | |
| UX-28 | Minor | UX | Shipment page | fixing | |
| UX-29 | Minor | UX | Assign modal, wizard step 3 | fixing | |
| UX-30 | Minor | UX | Assign modal, wizard | fixing | |
| UX-31 | Minor | UX | Modals | fixing | |
| UX-32 | Minor | UX | Add fuel | fixing | |
| UX-33 | Polish | UX | Problem case page | fixing | |
| UX-34 | Polish | UX | Notifications | fixing | |
| UX-35 | Minor | UX | Sidebar | fixing | |
| UX-36 | Polish | UX | Cancelled shipment, cancelled trip | fixing | |
| UX-37 | Polish | UX | Several | fixing | |
| UX-38 | Polish | UX | Delete shipment | fixing | |
| UX-39 | Polish | UX | Status pills | fixing | |

### Customer, driver and vendor roles (GitHub runner)

Details: [ROLES](findings/ROLES.md). Permissions held in every check (about 790).

| ID | Sev | Area | Title | Status | Commit |
| --- | --- | --- | --- | --- | --- |
| ROL-01 | Major | ROLES | A booking ignores its Idempotency-Key: a retry books twice | fixed | uat/fix-roles |
| ROL-02 | Major | ROLES | The cargo view never shows the rating given, so the app asks the customer to rate again | fixed | uat/fix-roles |
| ROL-03 | Major | ROLES | A rating on a multi-drop booking is stored with no driver or truck: the driver is never told | fixed | uat/fix-roles |
| ROL-04 | Major | ROLES | A trip assigned but not sent is already shown to the driver, who can accept and start it | fixed | uat/fix-roles |
| ROL-05 | Major | ROLES | Cancelling a serious SOS leaves the truck in maintenance and the goods on hold | fixed | uat/fix-roles |
| ROL-06 | Major | ROLES | One mistyped odometer reading makes every later fuel log for that truck fail with 500 | fixed | uat/fix-roles |
| ROL-07 | Major | ROLES | The tracking link of a multi-drop booking shows no destination and "Carrier: Not yet assigned" after delivery | fixed | uat/fix-roles |
| ROL-08 | Minor | ROLES | Malformed ids give 500 on several routes instead of 404 | fixed | uat/fix-roles |
| ROL-09 | Minor | ROLES | A pickup date that does not exist (2026-11-31) gives 500 | fixed | uat/fix-roles |
| ROL-10 | Minor | ROLES | Same pickup and drop, or 0,0, is accepted for a quote and for a vendor load | fixed | uat/fix-roles |
| ROL-11 | Minor | ROLES | A claim has no ceiling: 99,999,999 rupees on a 2,000-rupee lot was filed | fixed | uat/fix-roles |
| ROL-12 | Minor | ROLES | A cancelled booking's public history reads "With 3PL partners" | fixed | uat/fix-roles |
| ROL-13 | Minor | ROLES | `PATCH /tpl/:id` replaces instead of patching: the partner ID, MSME status and tax treatment are wiped | fixed | uat/fix-roles |
| ROL-14 | Minor | ROLES | 3PL onboarding accepts a malformed email address | fixed | uat/fix-roles |
| ROL-15 | Minor | ROLES | Switching return-trip matching off closes the open window and switching it on does not reopen it | fixed | uat/fix-roles |
| ROL-16 | Minor | ROLES | The web driver page shows the first drop as the trip's "Origin" | fixed | uat/fix-roles |
| ROL-17 | Minor | ROLES | A 1-rupee bid was accepted on a driver-opened return trip (no price from the engine) | fixed | uat/fix-roles |
| ROL-18 | Gap | ROLES | A customer has no name, company or account page: every customer is "Customer 7701" | open | |
| ROL-19 | Gap | ROLES | A customer can read and download invoices but cannot report a payment or question one | open | |

## Details

Details and evidence for each issue are in the findings files it cites:
[AZ-STAFF](findings/AZ-STAFF.md) (AZS-*, staff screens on Azure, live data) and
[AZ-PUBLIC](findings/AZ-PUBLIC.md) (AZP-*, the public side of Azure, no sign-in).

<!-- One section per issue:

### UAT-001 · Blocker · OPS · <title>
- **Where:** screen / endpoint, file:line
- **Steps:** 1. … 2. …
- **Expected:** …
- **Actual:** …
- **Fix:** what changed (filled in when fixed)
-->

## Notes from the fixes (round 1, 1 Oct 2026)

- **UAT-003:** the vehicle Trips tab reads `routes` directly and still shows stored `total_distance_km`; the API now returns `distance_km` + `distance_basis`, so the tab must switch to it (follow-up). The odometer stays "Unknown" until a vehicle has a first dashboard reading.
- **UAT-009:** the ₹0.04 on INV-202609-0001 was in the stored amount (no GST was charged; no HSN GST rates are set). New invoices use whole-paise GST lines.
- **UAT-011:** completed trips now show the real duration; distance is labelled "planned", because the driven distance isn't stored yet (roadmap: store it from the GPS trail).
- **UAT-017:** the cause was the uncompressed 356 KB borders file; re-time /live-map on Azure after the deploy.
- **UAT-019:** production builds no longer publish source maps; if an error tracker is added, switch to `hidden` maps uploaded to it.
- **Migrations applied to live:** `20261001010000` resolved the 2 stale delay cases and backfilled 3 missing driver-pay entries (4 → 7). `20261001020000` added `invoices.bill_to`.

## Round 3 notes (1 Oct 2026)

- **Kept for managers:** Claims stay a tab in Problems (where cases are handled) and in Money (where they are settled); fleet analytics stay a Fleet tab. A leftovers pass had moved both where managers can't go.
- **New settings with defaults:** `CLAIM_MAX_WITHOUT_DECLARED_VALUE` (₹1,00,000: the claim ceiling when the goods have no declared value) and `CAPACITY_MIN_BID_INR` (₹500: the return-trip bid floor when staff set none).
- **Driver app:** a trip appears to the driver only once dispatch sends it (ROL-04), and arrives active; the "offer to accept" path for pending trips no longer fires.
- **App follow-ups (open):** the customer app should send `Idempotency-Key` on booking and show the rating already given; the vendor load and quote forms, and the fuel-log form, should show the server's 422 messages; label the new fuel flag `odometer_jump` in the web app.
- **Open gaps (roadmap):** ROL-18, a customer profile with name and company; ROL-19, a customer can report a payment or query an invoice.
