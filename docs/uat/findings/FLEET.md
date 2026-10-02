# Audit 1: Fleet and people (test stage)

Walk: `e2e/staging/fleet.mjs` (two throw-away companies, admin + manager + driver actors, re-runnable). Last run against the
stage on `origin/m1/parity` code: **213 PASS, 3 FAIL of 216** (the 3 are listed under open issues; two are fixed in code and
wait for a deploy, one is an owner action).

## Steps

| Step | Expected | Result |
|---|---|---|
| 1.1 Staff adds a vehicle (POST /vehicles) | 201, stamped with the company, approved | PASS |
| 1.2 Plate, class, capacity, hazmat, reefer, body type, RC/insurance/fitness/permit/PUC numbers and expiries | all read back from the database | PASS |
| 1.3 Duplicate plate (same company and other company); bad capacity; bad body type | 409 (no data of the other company), 400, 400 | PASS |
| 1.4 Photos: upload-url, signed PUT, bytes read back, save to slot, list gives signed link serving same bytes; PDF 415; bad slot 400; foreign folder path 400; replace deletes old file; delete 204 | as stated | PASS |
| 1.6 Driver registers a vehicle, staff see request and count, B does not; B cannot approve (404); company A staff notified, B staff not; reject needs a reason, archives with reason; driver resubmits; manager approves (reviewer recorded); driver notified | as stated | PASS |
| 1.7 Status moves: on_route by hand 400, bogus 400, maintenance, maintenance to archived (allowed by the table, frees driver), archived to offline 409, back to available, archive, restore, restore of a live vehicle 409, delete | as stated | PASS |
| 1.8 Capacity edit moves free space (5000 to 9000 with 1000 carried leaves 8000; shrink to 1500 leaves 500) | free space follows | FAIL on the stage (fixed in code, see I-1) |
| 2.1 Add driver by phone (admin only, manager 403), onboarding, one company membership, duplicate phone 409, no phone 400, invite 200, on the list; company B using A's phone is refused with no person data | as stated | PASS |
| 2.2 Assign by name+phone links the same account; second vehicle 409; clearing phone unassigns; reassign; exactly one vehicle per driver; B cannot edit A's vehicle or take A's driver | as stated | PASS |
| 2.3 Driver without a vehicle after a day | daily scheduler step (`promptDriversWithoutVehicle`), no API trigger; not exercised | NOT TESTABLE (see open) |
| 2.4 CSV import: dry run (5 rows: 2 ok, bad role, no phone, duplicate flagged, nobody created), commit creates 2 in company A, manager 403, header-only 400, export.csv is CSV with A's people only, B's export has none of A | as stated | PASS |
| 3.1 People documents: consent first (409), upload-url, bytes back, licence needs expiry 400, expired licence saved as expired, file link serves the bytes, foreign-folder path 400, list, expiring.csv lists it (and not for B), days=0 400, empty body 4xx | as stated | PASS |
| 3.2 Dispatch rule: grace days range 400, manager cannot set (403), block mode, B's setting untouched; onboarding driver blocked (not_active); expired licence blocks a shipment (409 licence_expired) and shows on the vehicle list; grace 10 days lets a 3-day-old expiry through; renewal archives the old document; valid licence goes through; suspending releases the vehicle (needs confirmation); warn mode does not block | as stated | PASS |
| 3.3 Another company cannot list, fetch, edit or delete the documents (404) | 404 | PASS |
| 4.1 Maintenance: preview, bad reason 400, open job puts vehicle in maintenance, second job 409, list (A only), update, maintenance vehicle cannot take a shipment (409), attachment upload and bytes, close needs odometer, B cannot close (404), close frees the vehicle with the final odometer, writes service record, vehicle takes a shipment again | as stated | PASS |
| 4.2 Service plans (add, no interval 400, defaults, list with status), odometer up / lower refused / corrected with reason, odometer events, service-due, service log, items, foreign items 404, sync | as stated | PASS |
| 4.3 Fuel: fill, total 9250, second fill, negative 400, list, km/l from two full tanks, summary, anomalies, bill upload and bytes back, B cannot read/log/edit/summarise A | as stated | PASS |
| 4.4 Alerts list/summary, seeded alert visible to A only, B cannot acknowledge, acknowledge, resolve; stoppage logged by staff, B refused, bad latitude 400 | as stated | PASS |
| 5.1 Telematics webhook without secret / wrong secret / bad signature / staff token refused; test-alarm superadmin only; live and history 403/404 for B | refused | PASS (refused as 503, not 401: see I-3) |
| 5.2 Share links: bad hours 400, create, only a hash stored, public read without sign-in, exposes plate, position, speed, trail only (no driver, documents, org, capacity), unknown token 404, list never shows the token, B cannot list/create/revoke, expired 404, revoke, revoked 404, revoke twice 404, location endpoint | as stated | PASS |
| 5.3 Fleet health, vehicle health, analytics; B gets none of A; alert settings per company: A's change does not move B's and B's does not move A's; out of range 400; manager reads but cannot write | as stated | PASS |
| 6 Isolation: company B admin and manager each probe 49 guessed vehicle, fleet, telemetry and people sub-routes with A's ids: all 404/403 with no data; B's lists, summary, people, duplicates, jobs, service-due hold none of A; A's driver sees only their vehicle, cannot read a colleague, create a vehicle or change status | 404/403 | PASS |
| 5.1b The stage has FLEET_TELEMATICS_WEBHOOK_SECRET set | 401 for bad credentials | FAIL (503: not configured) |

## Issues

| # | Severity | Root cause | Fix | Status |
|---|---|---|---|---|
| I-1 | High | `PATCH /vehicles/:vehicle_id` read the carried load with `req.params.id` (undefined), so a capacity edit set free space to the full new capacity, as if the truck were empty. | `vehicles.routes.ts` uses `req.params.vehicle_id`. Regression test `test/fleet-audit.test.ts`. | Fixed in code, not yet on the stage (two 1.8 checks still FAIL there until deployed) |
| I-2 | High (tenancy) | "Already used" errors (phone, email, employee code, document number) returned the other company's person id, name, role and status to any company. Parity fixed the phone path; email, employee code and document-number paths still leaked. | `duplicateError` is now async and answers neutrally for a person outside the active company; used by every caller. Test in `fleet-audit.test.ts`. | Fixed in code |
| I-3 | Medium (infra) | `vehicle_stoppages.id` had no default on Azure, so reporting a stoppage returned 500. Seen on the first run; the stage now passes (parity change). | API also sends an id; migration `20261010010000_fleet_stoppage_id_default.sql` sets the default. | Fixed |
| I-4 | Medium (owner action) | `FLEET_TELEMATICS_WEBHOOK_SECRET` is not set on the test stage, so every device event gets 503 and the success path (alarms, GPS from devices) could not be tested. | Set the secret in the stage's settings and give it to the device provider (nothing applied from here). | Open |

## Left open / not covered

- Daily scheduler jobs (document expiry notifications `document_expiring`, drivers-without-vehicle notice) cannot be triggered through the API; their rules were reviewed in code (`people-jobs.service.ts`) only. Expiry is computed live for dispatch, which was exercised.
- Telematics ingestion with a valid secret (I-4).
- Duplicate document number across companies was fixed in code (I-2) but not walked live, because the licence numbers are made unique per run.
