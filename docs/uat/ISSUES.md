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
| UAT-001 | Major | OPS | Duplicate delay cases for one lot, opened after it was delivered, never closed (AZS-01, 02, 10) | open | |
| UAT-002 | Major | FLT | Completed trips missing from driver pay (AZS-14) | open | |
| UAT-003 | Major | FLT | Completed trip shows 0 km on the vehicle page; odometer never moves (AZS-19) | open | |
| UAT-004 | Major | FLT | Invoices issued with no seller details and "Billed to: Not recorded" (AZS-03, 17) | open | |
| UAT-005 | Major | FLT | Revenue "before GST" equals invoice totals; profit shown with no costs (AZS-15, 18) | open | |
| UAT-006 | Major | OPS | A split master tells staff to assign a vehicle and has no driver to rate (AZS-09) | open | |
| UAT-007 | Major | DRV | A lot can be delivered with no pickup recorded (AZS-08) | open | |
| UAT-008 | Major | ALL | Malformed %-escape in a URL gives a 500 on every :param route, incl. public tracking (AZP-01) | open | |
| UAT-009 | Minor | FLT | ₹1,50,000.04: GST rounding leaves stray paise (AZS-04) | open | |
| UAT-010 | Minor | OPS | Trips list has no trip number or shipment (AZS-05) | open | |
| UAT-011 | Minor | OPS | Completed/cancelled trips show plan ETA and distance (AZS-06) | open | |
| UAT-012 | Minor | FLT | Names not trimmed ("Vishal ") (AZS-07) | open | |
| UAT-013 | Minor | OPS | Master status history: duplicate Created, Delivery failed vs 0 attempts; Destination — (AZS-11, 13) | open | |
| UAT-014 | Gap | OPS | No e-way bill warning above ₹50,000 (AZS-12) | open | |
| UAT-015 | Minor | FLT | Deliveries 9 vs Delivered 6 (AZS-16) | open | |
| UAT-016 | Minor | FLT | Automated actions missing from the audit log (AZS-20) | open | |
| UAT-017 | Minor | OPS | Live map takes ~11 s to draw (AZS-21) | open | |
| UAT-018 | Minor | FLT | Vehicle health 100 with no inputs (AZS-22) | open | |
| UAT-019 | Minor | ALL | Public source maps; no frame-ancestors on the web app (AZP-02, 03) | open | |
| UAT-020 | Minor | ALL | Public tracking exposes internal ids, plate and live position; short CM- ids (AZP-04) | open | |
| UAT-021 | Minor | ALL | /ready says database ok without checking; X-Request-ID echoed unchecked (AZP-05, 06) | open | |
| UAT-022 | Minor | ALL | Unknown web paths return 200 (soft 404) (AZP-07) | open | |
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
