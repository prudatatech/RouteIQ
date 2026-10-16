# Staging performance investigation — 4 Oct 2026

## Measurements and cause

The reported 504/503 failures were reproduced in the PostgREST logs as PGRST003. Database sessions showed
notification queries waiting on disk I/O, without blocking locks. Notifications held about 2.8 million rows
(roughly 1.3 GiB before the added indexes). Recipient-only indexes caused type-filtered queries to read tens
of thousands of unrelated rows. The test REST pool had four connections; these slow queries occupied them.
CPU credits were available and CPU usage was about 13–19%, so increasing compute or the pool was not the first fix.

After recipient/type indexes were applied, the driver-action query used an index-only scan with zero heap
fetches and took 0.484 ms. The driver-without-vehicle deduplication query took 0.142 ms. All eight originally
failing staging endpoints then returned HTTP 200. Failed duplicate checks now stop rather than insert another notice.

At the owner's request, 67 operational tables were cleared. Login accounts were subsequently reduced to six
existing test personas: platform owner, company admin, manager, driver, vendor and 3PL. Password sign-in was
verified for each. Schema, migrations, reference catalogues, organisations and configuration were preserved.
Credentials were delivered separately and must never be committed.

## Baseline after cleanup, before the application optimisations

Three sequential read-only samples per endpoint, from the developer's machine to Azure. These are small-data
measurements, not a production load test. Network time is included. `Server-Timing` database durations sum
parallel calls, so they can exceed request wall time.

| Endpoint | Median request time | Warm database calls |
|---|---:|---:|
| `/ops/today` | 170 ms | 20 |
| `/dashboard/shipment-counts` | 317 ms | 22 |
| `/dashboard/kpis` | 98 ms | 2 |
| `/messages/unread` | 83 ms | 1 |
| `/company/loads/market?tab=new` | 88 ms | 3 |
| `/shipments?limit=50` | 94 ms | 2 |
| `/routes?limit=50` | 81 ms | 2 |
| Notification badge | 221 ms | direct REST |
| Notification list | 220 ms | direct REST |

All 36 probe requests returned HTTP 200. The read-only walk is reproducible with
`UAT_USER_EMAIL=<existing staging staff account> node e2e/staging/performance.mjs`.
Set `PERFORMANCE_OUTPUT` to save timing-only JSON. It creates no users or business records and sends no messages.

## Changes

- Shipment status counts use one grouped SQL function instead of 22 REST count requests. The backend resolves
  the organisation scope; only the service role can execute the invoker function. Split masters remain excluded,
  vendor load statuses keep their existing mappings, and accounts without a membership see no organisation data.
- Dashboard KPI queries run independently in parallel and fetch only status and fuel fields rather than complete
  trip records.
- Notification bodies load when the bell is opened. A user-specific React Query cache shares results across
  navigation and responsive remounts; unread counts continue to refresh and read actions update the cache.
- Simultaneous account-restoration calls share an in-flight lookup. Subsequent requests still read fresh roles;
  errors are never cached.
- GPS position polling allows one request at a time and pauses in hidden tabs. Returning to the tab refreshes
  immediately. Slow requests can no longer accumulate at the five-second polling interval.
- Staff and vendor workspace shells are lazy-loaded, so public/login pages do not load those shells up front.

Staging SQL profiling (`pg_stat_statements.track=top`) was enabled dynamically, without a restart. Early profiles
showed inexpensive operational SQL after cleanup; the dashboard's repeated REST calls remained a measurable cost.
CI bundle output was inspected instead of running a local build (the Mac workflow rule).

## Validation

Targeted frontend tests cover lazy notification fetching and cache reuse, duplicate account restores and retries,
and overlapping/hidden-tab map polls. Backend tests cover aggregation, status mapping, errors and tenant isolation.
The actual staging SQL function was checked with temporary fixtures inside a rolled-back transaction, and its
execute permissions were verified: anon/authenticated cannot call it; service_role can.

## Deployed results

All 51 read-only requests across 17 probes returned HTTP 200 after deployment.

| Measurement | Before | After |
|---|---:|---:|
| Shipment counts median | 317 ms | 90 ms |
| Shipment counts database calls | 22 | 1 |
| Dashboard KPI median | 98 ms | 92 ms |
| Initial JavaScript | 553.10 KB | 464.78 KB |
| Initial JavaScript, gzip | 161.81 KB | 135.29 KB |

Shipment counts improved by about 72%; initial JavaScript fell by about 16%. Notifications avoid loading
message bodies until requested; this reduces startup work rather than materially changing individual REST latency.
Other API medians were generally 80–110 ms. Finance summary was 96 ms, fleet overview 109 ms,
daily activity 100 ms and fleet health 85 ms.

`/ops/today` still makes 20 database calls and measured 287 ms versus 170 ms in the baseline. It remains a
performance target; this work does not establish that every screen is faster. Three sequential samples on a
cleared staging database cannot establish concurrency capacity or performance with substantial business data.
A realistic load test and browser walkthrough remain open.

Application commit `7506306` passed [CI](https://github.com/prudatatech/RouteIQ/actions/runs/37196724446),
[Azure deployment](https://github.com/prudatatech/RouteIQ/actions/runs/37196721861), and
[UAT: 91/91](https://github.com/prudatatech/RouteIQ/actions/runs/37196722146).
Targeted checks passed: 37 backend tests and 11 frontend tests, plus TypeScript, query checks, lint and vocabulary.

