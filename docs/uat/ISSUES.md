# UAT issue log

Every issue found in UAT ([plan](UAT-PLAN.md)). One row per issue; the details sit under it.
Status: `open` → `fixing` → `fixed` (in a commit) → `verified` (re-tested), or `wontfix` with a reason.

## Passes

| Area | Pass 1 | Pass 2 |
| --- | --- | --- |
| Azure public (no sign-in) | 1 Oct 2026 | |
| Azure staff screens (superadmin) | 1 Oct 2026 | |
| CUST | | |
| OPS | | |
| DRV | | |
| VND | | |
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
| UAT-007 | Major | DRV | A lot can be delivered with no pickup recorded (AZS-08) | open | |
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
| UAT-020 | Minor | ALL | Public tracking exposes internal ids, plate and live position; short CM- ids (AZP-04) | open | |
| UAT-021 | Minor | ALL | /ready says database ok without checking; X-Request-ID echoed unchecked (AZP-05, 06) | open | |
| UAT-022 | Minor | ALL | Unknown web paths return 200 (soft 404) (AZP-07) | fixed | 8bd3c91 |
| UAT-024 | Minor | OPS | UX: addresses print the place name twice ("Fab Hostels" then "Fab Hostels, Kanakapura Main Road…") on Shipments and in the drawer | open | |
| UAT-025 | Minor | OPS | UX: Requests shows 0 everywhere while 6 shipments exist; staff-created shipments never appear in Requests, and the page doesn't say so | open | |
| UAT-026 | Minor | OPS | UX: Problem cases show "RTX-…-B · 1 pcs" ("pcs" vs "piece(s)" elsewhere) and "Deadline: Overdue by 13 h 36 min" on two lines | open | |
| UAT-027 | Minor | FLT | UX: Optimize lists "Driver licence missing" on both vehicles as the only vehicle detail, with no link to fix it | open | |
| UAT-028 | Minor | OPS | UX: /3pl-partners silently redirects to Return trips → 3PL partners; the sidebar item and page title don't match | open | |
| UAT-023 | Gap | ALL | No rate limit on /auth/refresh; logout doesn't revoke; robots.txt, Permissions-Policy (AZP-08, 09) | open | |

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
