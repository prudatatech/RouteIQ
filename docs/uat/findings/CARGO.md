# Audit area 3: cargo custody, problems and shipments

Walk: `node e2e/staging/cargo.mjs [custody problems transfer hubs shipments claims lots isolation]` against the TEST stage
(`staging-api.margixindia.com`), fresh own company, staff, drivers with vehicles, two vendors and a second company every run.
Vendor loads go through post, quote, accept and assign; customer-style shipments (RTX) are created by staff on a vehicle.
Last run on the stage as deployed before my fixes: **338 of 351 steps passed**. The failures are the issues below (all
fixed in this branch, awaiting a stage deploy to turn green); two more were closed on the stage by other branches in the meantime.

## Issues

| # | Severity | Issue | Root cause | Fix | Status |
|---|---|---|---|---|---|
| 1 | High | Another company's staff could raise a claim on our shipment or load (201), and add documents to our claim | `createClaim` resolved the consignment without a company check for staff; `claimDocumentUploadUrl` let any staff through | `assertCompanyConsignment` for staff claims; `assertVisible` on the claim for staff uploads (`claim.service.ts`) | Fixed in code, regression test `cargo-tenancy-audit.test.ts` |
| 2 | High | A load could be dropped at another company's hub (`hub_in` with their depot id answered 201) | The hub lookup in `recordCustody` was not scoped to the company | Hub looked up with `scopeQuery(... OWNED.carrier)`, so a foreign hub is a 404 | Fixed in code, regression test |
| 3 | High | Hash chain of a shipment's log never verified once custody events existed (`GET /shipments/:id/verify` said `is_valid: false` for a returned shipment) | `generateHash` sorted only the top-level keys; the database keeps metadata as jsonb and returns the keys in its own order, so the hash could not be rebuilt | Keys sorted at every level when hashing; verify also accepts the old top-level-only hash for rows written before (`security.service.ts`) | Fixed in code, regression test `security-hash-chain.test.ts` |
| 4 | Medium | A claim could be approved for more than was claimed and settled for more than was approved | No amount ordering checks | 422 when approved > claimed or settled > approved | Fixed in code, regression test |
| 5 | Medium | A vendor load taken to a hub kept its weight on the truck (current load stayed 500 kg, so the truck looked full), and the truck collecting it from the hub never got the weight | `hub_in` and `hub_out` only recalculated capacity from shipments and stops, not vendor loads | `releaseVehicleLoad` on hub arrival, `reserveVehicleLoad` on hub departure for loads | Fixed in code |
| 6 | Low | After a transfer the vendor request still pointed at the broken truck (`assigned_vehicle_id`) | Handover-in moved the load but not the request | Request follows the load onto the relief truck (not for a lot, the rest stays) | Fixed in code |
| 7 | Info | `verify-pod` confirmed another company's shipment by tracking id on the first run | route read the shipment unscoped | Company check added (`assertVisible`); the stage had already closed it by the second run | Fixed |
| 8 | Info | One `500` on delivering a lot in one full run (not seen again in three more runs of the same steps) | Not reproduced; most likely a transient database or storage hiccup | none | Open, watch |

Not changed, by design: a vendor is told of pickup and delivery by notice (milestones `load_picked_up`, `request_completed`), and
sees departed and arrived steps on the load timeline; the `where` view of a load before pickup says `scheduled` (the stored status).
Not walked here: SLA escalation by the scheduler, `wait_for_repair`/`continue_after_repair`, return-to-origin action, 3PL trips.

## Steps

| Step | Expected | Result | |
|---|---|---|---|
| custody: where before pickup | scheduled (stored status), held by the consignor | as expected | PASS |
| pickup without a piece count | 400 (count the pieces) | as expected | PASS |
| pickup with negative pieces | 400 | as expected | PASS |
| pickup with 2.5 pieces | 400 | as expected | PASS |
| pickup with a photo path from somewhere else | 400 (not this shipment's upload) | as expected | PASS |
| delivery of goods never picked up | 409 (record the pickup first) | as expected | PASS |
| custody photo: signed upload link | link, PUT works, file is stored | as expected | PASS |
| pickup 10 of 10, good, sealed, photo | 201, in transit, held by the vehicle, 10 on board | as expected | PASS |
| pickup replayed with the same Idempotency-Key | same answer, no second event | as expected | PASS |
| second pickup | 409 already picked up | as expected | PASS |
| manifest row after pickup | in_transit, seal saved, pieces_total 10, holder vehicle, vehicle V | as expected | PASS |
| custody event for the pickup | one pickup event with photo path, seal, recorder = driver | as expected | PASS |
| departed | 201, still in transit | as expected | PASS |
| arrived at the drop | 201, informational | as expected | PASS |
| deliver 9 of 10 as a full delivery | 409 (record a partial delivery) | as expected | PASS |
| deliver 11 of 10 | 409 (only 10 on board) | as expected | PASS |
| delivery with no receiver name | 400 | as expected | PASS |
| delivery with no photo or signature (driver) | 400 | as expected | PASS |
| delivery 10 of 10 with receiver and photo | 201, delivered, held by the consignee | as expected | PASS |
| delivery again | 409 already delivered | as expected | PASS |
| manifest row after delivery | delivered, received_by saved, delivered 10 | as expected | PASS |
| the vendor request after delivery | completed | as expected | PASS |
| vehicle after delivery | available again, load released (0 kg) | as expected | PASS |
| invoice raised on delivery | one invoice for the vendor | as expected | PASS |
| custody timeline (company) | pickup, departed, arrived_drop, delivery in order | as expected | PASS |
| custody timeline (the load's vendor) | readable, redacted | as expected | PASS |
| vendor timeline hides the driver and staff | no driver id, no user ids | as expected | PASS |
| where (the load's vendor) | 200, delivered | as expected | PASS |
| vendor where hides the driver's name and phone | redacted | as expected | PASS |
| vendor milestones as notifications | picked up and delivered | as expected | PASS |
| vendor "my loads" board shows the load as delivered | stage delivered/completed | as expected | PASS |
| pickup with damaged goods | 201 and a damage problem opens by itself | as expected | PASS |
| damage problem fields | type damage, medium, open, source driver, the load attached | as expected | PASS |
| damage problem SLA | due 24 h after opening, not overdue | as expected | PASS |
| problem belongs to the company running the load | carrier_org_id = the company | as expected | PASS |
| vendor told about the damage | a notice in the vendor's inbox | as expected | PASS |
| inspection during the trip finding wet goods | 201 and a second problem | as expected | PASS |
| set_status resolved directly | 400 use the resolve action | as expected | PASS |
| assign owner (a manager) moves it to investigating | 200, investigating, owner set | as expected | PASS |
| assign owner with a nonsense id | 400 | as expected | PASS |
| assign a driver as owner | 400 staff only | as expected | PASS |
| investigating to action planned | 200 | as expected | PASS |
| action planned back to investigating | 200 (allowed) | as expected | PASS |
| add a note | 200 and the note is on the timeline | as expected | PASS |
| resolve without a resolution | 400 | as expected | PASS |
| resolve with an unknown resolution | 400 | as expected | PASS |
| unknown action | 400 | as expected | PASS |
| resolve delivered_with_remarks | 200, resolved, resolver and time saved | as expected | PASS |
| reopen a resolved problem | 409 | as expected | PASS |
| resolve twice | 409 | as expected | PASS |
| close a resolved problem | 200 closed | as expected | PASS |
| problem queue filter | only open ones of that type; the closed one is not in it | as expected | PASS |
| queue filter with an unknown status | 400 | as expected | PASS |
| delivery with 2 damaged pieces | 201 delivered and a damage-on-delivery problem | as expected | PASS |
| more damage than delivered cannot be recorded | 409 on a settled load | as expected | PASS |
| partial delivery with nothing refused or short | 400 | as expected | PASS |
| partial 7 + 5 short of 10 on board | 409 does not add up | as expected | PASS |
| partial with 0 accepted | 400 (at least 1) | as expected | PASS |
| partial delivery: 7 accepted, 3 short | 201, shortage problem opens, 7 delivered / 3 short | as expected | PASS |
| shortage problem | type shortage, severity high, SLA 4 h | as expected | PASS |
| load after a partial delivery | pieces 7/3, status not delivered | as expected | PASS |
| the vendor request after a partial delivery | not completed (7 of 10) | as expected | PASS |
| deliver one more piece after 7 + 3 accounted | 409 or refused: nothing left on board | as expected | PASS |
| where after a partial delivery | open shortage case listed, 0 on board | as expected | PASS |
| raise a claim from the problem | 200 with a draft claim | as expected | PASS |
| partial 8 accepted, 2 refused | 201, 2 still on board | as expected | PASS |
| re-attempt the 2 refused pieces | 200, action planned, departed recorded | as expected | PASS |
| deliver the last 2 pieces | 201 delivered, 10 delivered in all | as expected | PASS |
| driver raises a serious breakdown SOS with cargo on board | 201 | as expected | PASS |
| a problem opened by itself for the load on board | one case linked to the load | as expected | PASS |
| breakdown problem | vehicle_breakdown, high, source sos, SLA 4 h, vehicle and position set | as expected | PASS |
| load on the broken truck | on hold, still held by that vehicle | as expected | PASS |
| broken truck | in maintenance (not offered for work) | as expected | PASS |
| vendor told the truck broke down | a notice mentioning the delay | as expected | PASS |
| resolve a breakdown while the goods are still on hold | 409 plan the goods first | as expected | PASS |
| driver reports a problem by hand on their own load | 201 | as expected | PASS |
| driver reports a problem on a load that is not on their truck | 403 | as expected | PASS |
| manual problem with an unknown type | 400 | as expected | PASS |
| manual problem with no goods and no vehicle | 400 | as expected | PASS |
| relief vehicles for the breakdown | the working truck is offered, the broken one is not | as expected | PASS |
| plan a transfer of 11 of 10 pieces | 409 | as expected | PASS |
| plan a transfer to the same truck | 400 | as expected | PASS |
| plan a transfer with no target | 400 | as expected | PASS |
| plan a transfer to another company's truck | 404 | as expected | PASS |
| the same load listed twice | 400 | as expected | PASS |
| another company plans a transfer of our load | 404 | as expected | PASS |
| plan the transfer from the breakdown problem | 200, transfer planned, problem action planned | as expected | PASS |
| plan a second transfer for the same load | 409 already on a transfer | as expected | PASS |
| receiving driver counts in before handover out | 409 | as expected | PASS |
| a driver of another company counts out | 404 or 403 | as expected | PASS |
| count out 11 of 10 planned | 409 | as expected | PASS |
| photo for the handover (transfer folder) | signed link works | as expected | PASS |
| the broken truck's driver counts 10 out | 200, in progress | as expected | PASS |
| a driver cancels a transfer | 403 (staff only) | as expected | PASS |
| cancel a transfer in progress | 409 | as expected | PASS |
| the giving driver counts the goods in | 403 (only the receiving driver or staff) | as expected | PASS |
| the relief truck's driver counts 10 in | 200 completed, no problems opened | as expected | PASS |
| transfer after completion | e-way Part B required (the load has an e-way bill) | as expected | PASS |
| load after the transfer | on the relief truck, in transit, ownership unchanged, e-way Part B flagged | as expected | PASS |
| e-way Part B flag on the load | update required | as expected | PASS |
| old truck's load released, new truck loaded | old 0 kg, new 500 kg | as expected | PASS |
| the vendor's request after the transfer | still the same vendor and company; shows the relief truck | {"assigned_vehicle_id":"2f8dca9a-4412-4a63-addf-3bdeba5680c5","status":"assigned","vendor_id":"19f4fde6-6d6e-4dc0-b794-b18bc6cfaef0","carrier_org_id":"56e284f2-05a1-4047-b86f-05463f3b57b8","relief":"f | FAIL |
| breakdown problem after the transfer | resolved: transshipped | as expected | PASS |
| custody chain around the transfer | pickup, hold, handover_out, handover_in | as expected | PASS |
| vendor sees the load on the new truck without driver details | 200, in transit | as expected | PASS |
| record the new Part B | 200 | as expected | PASS |
| e-way flag after Part B is recorded | cleared | as expected | PASS |
| empty Part B reference | 400 | as expected | PASS |
| relief driver delivers the load | 201 delivered | as expected | PASS |
| the old driver tries to deliver it | 403/409 (not on their truck) | as expected | PASS |
| plan a transfer on a load without an e-way bill | 201 planned | as expected | PASS |
| receiving driver counts only 8 of 10 | 200 completed and a shortage problem opened | as expected | PASS |
| shortage problem from the handover | type shortage, 2 pieces, high | as expected | PASS |
| load after the short handover | 2 short, 8 on board on the new truck, no Part B | as expected | PASS |
| transfer without an e-way bill | Part B not required | as expected | PASS |
| deliver the 8 that arrived | 201 delivered (8) with 2 short on record | as expected | PASS |
| transfer 6 of 10 pieces | 201: the load is split into a moving lot and a staying lot | as expected | PASS |
| hub arrival without a hub | 400 | as expected | PASS |
| hub arrival at another company's hub | 404 (not your hub) | {"event":{"id":"cf179645-0609-4d31-a4d3-522cc128cab4","shipment_id":null,"manifest_id":"699121a2-a91a-4c99-902b-4a80c752caea","kind":"hub_in","from_holder":"vehicle","from_vehicle_id":"73e3c41e-c802-4 | FAIL |
| hub arrival at a hub that does not exist | 404 | as expected | PASS |
| hub arrival counting 9 of 10 | 201, at hub, a shortage problem opens | as expected | PASS |
| load at the hub | held by the hub, depot set, no vehicle | as expected | PASS |
| the truck is free after dropping at the hub | load released from the truck | as expected | PASS |
| hub list | our hub shows 1 consignment, 9 pieces; their hub is not listed | as expected | PASS |
| hub inventory ageing | one item, age about 30 h, next leg is the drop | as expected | PASS |
| hub inventory lists the open shortage | the problem is attached to the item | as expected | PASS |
| hub list ageing | oldest age about 30 h | as expected | PASS |
| another company reads our hub inventory | 404 | as expected | PASS |
| we read their hub inventory | 404 | as expected | PASS |
| the old driver (not on the load) takes it out of the hub | 403/409/400 | as expected | PASS |
| hub departure without naming the vehicle | 400 | as expected | PASS |
| hub departure on a vehicle that does not exist | 404 | as expected | PASS |
| hub departure on a second truck | 201 in transit on that truck | as expected | PASS |
| hub empty after departure | no items | as expected | PASS |
| the second truck delivers the 9 pieces | 201 delivered | as expected | PASS |
| hub departure of goods that are not at a hub | 409 | as expected | PASS |
| shipment pickup 5 of 5 | 201 picked up | as expected | PASS |
| shipment departed | in transit | as expected | PASS |
| a driver asks for a delivery code | 403 (staff only) | as expected | PASS |
| staff sends the delivery code | 200 with an expiry | as expected | PASS |
| delivery code is stored as a hash only | 64 hex chars, otp required, expiry about 24 h | as expected | PASS |
| the code is not stored anywhere in the clear | no plain code in the row or its notices | as expected | PASS |
| delivery with no code when one is required | 400 | as expected | PASS |
| delivery with a malformed code | 400 | as expected | PASS |
| five wrong codes | 400 four times then 429 locked | as expected | PASS |
| the right code while locked | 429 (lockout holds for 15 minutes) | as expected | PASS |
| staff sends a fresh code | 200 and the lock is cleared | as expected | PASS |
| a new code replaces the old hash | different hash | as expected | PASS |
| the old code after a new one was sent | 400 wrong | as expected | PASS |
| delivery with the right code | 201 delivered, hash cleared | as expected | PASS |
| shipment row after delivery | delivered, hash and expiry cleared, received_by saved | as expected | PASS |
| send a code for a delivered shipment | 409 | as expected | PASS |
| send a code for a vendor load | 400 (shipments only) | as expected | PASS |
| six codes in an hour for one shipment | five go out, the sixth is 429 | as expected | PASS |
| verify-pod before any pickup | 409 (record the pickup first) | as expected | PASS |
| verify-pod without pickup and without a reason | 400 | as expected | PASS |
| verify-pod with no evidence and no reason | 400 | as expected | PASS |
| verify-pod with a 2-character reason | 400 | as expected | PASS |
| verify-pod with no recipient | 400 | as expected | PASS |
| verify-pod with a photo that is not this shipment's | 400 | as expected | PASS |
| ANOTHER COMPANY confirms delivery of our shipment | 404 (not theirs) | as expected | PASS |
| our shipment after that attempt | still not delivered | as expected | PASS |
| verify-pod with a written reason | 200 delivered | as expected | PASS |
| the confirmation is a custody delivery with the reason | recorded by the staff member, notes carry the reason | as expected | PASS |
| verify-pod twice | 409 | as expected | PASS |
| verify-pod with a code nobody sent | 409 (expired or never sent) | as expected | PASS |
| failed delivery without a reason | 400 | as expected | PASS |
| failed delivery with an unknown reason | 400 | as expected | PASS |
| failed delivery attempt 1 | 201, exception status, a problem opens | as expected | PASS |
| undeliverable problem | type undeliverable, medium | as expected | PASS |
| where after attempt 1 | 1 of 3 attempts, 3 on board, not RTO | as expected | PASS |
| plan a re-attempt | 200 action planned, goods back out for delivery | as expected | PASS |
| failed delivery attempt 2 | 201 exception | as expected | PASS |
| failed delivery attempt 3 | 201 returning, return to origin started, no new re-attempt case | as expected | PASS |
| shipment after the last attempt | returning, rto true, attempts 3 | as expected | PASS |
| deliver goods that are being returned | 409 | as expected | PASS |
| return delivery of 3 | 201 returned, back with the consignor, 3 returned | as expected | PASS |
| custody chain of the returned shipment | pickup, departed, 3 failed attempts, return_delivery | as expected | PASS |
| truck after the return | free (no load on it) | as expected | PASS |
| shipment log hash chain for the returned shipment | every entry chains to the one before | as expected | PASS |
| the chain verifies | valid | {"shipment_id":"98e73ac0-1833-4b45-81a3-c0be484ed796","is_valid":false,"log_count":10,"last_status":"returned"} | FAIL |
| partial delivery of a shipment: 4 accepted, 2 refused | 201 partially delivered, the 2 stay on the truck | as expected | PASS |
| no invoice while part of the goods is still on the truck | none yet | as expected | PASS |
| send the 2 refused pieces back | 201 returning | as expected | PASS |
| return delivery of 1 of 2 pieces | 201 returned with 1 short and a shortage problem | as expected | PASS |
| piece arithmetic of that shipment | delivered 4 + short 1 + returned 1 = 6, never above total | as expected | PASS |
| write off a piece that is not held | 409 or no-op, never negative | as expected | PASS |
| no counter went negative or past the total | ok | as expected | PASS |
| vendor claims on a load still on the road | 409 (after delivery only) | as expected | PASS |
| vendor claims more than the declared value (50,000) | 422 | as expected | PASS |
| vendor claims a negative amount | 400 | as expected | PASS |
| vendor claims with an unknown type | 400 | as expected | PASS |
| ANOTHER VENDOR claims on this load | 404 | as expected | PASS |
| vendor files a damage claim for 12,000 | 201, status filed (vendor files directly), declared value 50,000 | as expected | PASS |
| a second open claim of the same type | 409 | as expected | PASS |
| vendor reads own claim | 200 | as expected | PASS |
| another vendor reads the claim | 404 | as expected | PASS |
| claim lists are per vendor | vendor sees theirs, other vendor sees none of them | as expected | PASS |
| vendor approves own claim | 403 (staff only) | as expected | PASS |
| claim document upload link (vendor, PDF) | 200 link | as expected | PASS |
| claim document is stored | the same bytes come back | as expected | PASS |
| claim shows the document with a signed link | one document with a url | as expected | PASS |
| claim document of a bad type | 415 | as expected | PASS |
| claim document that is too big | 413 | as expected | PASS |
| another vendor uploads to the claim | 404 | as expected | PASS |
| ANOTHER COMPANY'S STAFF uploads to our claim | 404 | {"path":"claims/2673d8b4-9774-4833-abb0-0d4e23e0773e/d1f692ee-d28a-4d97-ad68-4b15152eb28c.png","token":"eyJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJreWNfZG9jdW1lbnRzL2NsYWltcy8yNjczZDhiNC05Nzc0LTQ4MzMtYWJiMC0wZDR | FAIL |
| another company reads our claim | 404 | as expected | PASS |
| another company rejects our claim | 404 | as expected | PASS |
| another company's staff raise a claim on our load | 404 | {"id":"55e911d0-91d3-4f85-8d8d-ae5e2a63ae8e","code":"CLM-7BVHNH","exception_id":null,"shipment_id":null,"manifest_id":"591a55e3-729d-469a-8ed6-6c57bf29fd01","claim_type":"theft","declared_value":50000 | FAIL |
| settle a claim that is only filed | 409 | as expected | PASS |
| survey without a surveyor | 400 | as expected | PASS |
| survey with a surveyor | 200 surveyed | as expected | PASS |
| approve without an amount | 400 | as expected | PASS |
| approve more than the claimed amount (12,000) | refused (approved may not exceed claimed) | {"id":"2673d8b4-9774-4833-abb0-0d4e23e0773e","code":"CLM-VBQ7V4","exception_id":null,"shipment_id":null,"manifest_id":"591a55e3-729d-469a-8ed6-6c57bf29fd01","claim_type":"damage","declared_value":5000 | FAIL |
| approve 10,000 | 200 approved | as expected | PASS |
| settle without an amount | 400 | as expected | PASS |
| settle for more than was approved | refused (settled may not exceed approved) | {"id":"2673d8b4-9774-4833-abb0-0d4e23e0773e","code":"CLM-VBQ7V4","exception_id":null,"shipment_id":null,"manifest_id":"591a55e3-729d-469a-8ed6-6c57bf29fd01","claim_type":"damage","declared_value":5000 | FAIL |
| settle 10,000 | 200 settled with a time | {"detail":"This claim is settled."} | FAIL |
| withdraw a settled claim | 409 | as expected | PASS |
| edit a settled claim | 409 | as expected | PASS |
| add a document to a settled claim | 409 | as expected | PASS |
| vendor notified as the claim moves | filed, surveyed, approved, settled notices | as expected | PASS |
| approve a draft claim | 409 (file it first) | as expected | PASS |
| file the draft | 200 filed | as expected | PASS |
| reject a filed claim | 200 rejected | as expected | PASS |
| reopen a rejected claim | 409 | as expected | PASS |
| staff claim above the declared value | 422 | as expected | PASS |
| a new claim after the first was rejected | 201 draft | as expected | PASS |
| withdraw a draft | 200 | as expected | PASS |
| split a load nobody counted yet | 409 (count the pieces first) | as expected | PASS |
| pickup of the whole load | 201 | as expected | PASS |
| split the load on the truck into 4 + 3 + the rest | 201 three lots | as expected | PASS |
| lots add up | pieces 4 + 3 + 3 = 10 | as expected | PASS |
| split the master again | 409 (the master holds no goods) | as expected | PASS |
| deliver the master directly | 403/409 (act on a lot) | as expected | PASS |
| lots overview from the master | the master and 3 lots with codes | as expected | PASS |
| lots overview from a lot code | same master | as expected | PASS |
| deliver lot A (4 pieces) | 201 delivered | as expected | PASS |
| master after one lot is delivered | partly delivered (not delivered) | as expected | PASS |
| vendor request while lots are open | not completed | as expected | PASS |
| deliver 2 of lot B's 3 pieces as a full delivery | 409 | as expected | PASS |
| deliver lot B (3) | 201 delivered | as expected | PASS |
| deliver lot C (3) | 201 delivered | as expected | PASS |
| master after all lots | delivered, 10 of 10 delivered, rolled up | as expected | PASS |
| vendor request after all lots | completed | as expected | PASS |
| vendor sees the master rolled up | 200 delivered | as expected | PASS |
| another vendor reads the lots | 404 | as expected | PASS |
| two-drop shipment | 201 master with 2 lots | as expected | PASS |
| two-drop master: lots | 2 lots, pieces 3 + 2 | as expected | PASS |
| other company staff reads where of the delivered load | 404 | as expected | PASS |
| other company staff reads timeline of the delivered load | 404 | as expected | PASS |
| other company staff reads lots of the delivered load | 404 | as expected | PASS |
| other vendor reads where of the delivered load | 404 | as expected | PASS |
| other vendor reads timeline of the delivered load | 404 | as expected | PASS |
| other vendor reads lots of the delivered load | 404 | as expected | PASS |
| other company driver reads where of the delivered load | 403/404 | as expected | PASS |
| other company driver reads timeline of the delivered load | 403/404 | as expected | PASS |
| other company driver reads lots of the delivered load | 403/404 | as expected | PASS |
| other company staff records custody on the delivered load | 404 | as expected | PASS |
| other company driver records custody on the delivered load | 403/404 | as expected | PASS |
| other vendor records custody on the delivered load | 403 | as expected | PASS |
| other company sends a delivery code for the delivered load | 404 | as expected | PASS |
| other company opens a problem on the delivered load | 404 | as expected | PASS |
| other company splits the delivered load | 404 | as expected | PASS |
| other company claims on the delivered load | 404 | 201 {"id":"3e87fa9d-2df0-431f-8610-1bddfd35b39f","code":"CLM-BA5NB8","exception_id":null,"shipment_id":null,"manifest_id":"cd0c3c7e-1f57-43fb-a9b9-2dbce0dd873f","claim_type":"damage","declared_value": | FAIL |
| other company staff reads where of the transferred load | 404 | as expected | PASS |
| other company staff reads timeline of the transferred load | 404 | as expected | PASS |
| other company staff reads lots of the transferred load | 404 | as expected | PASS |
| other vendor reads where of the transferred load | 404 | as expected | PASS |
| other vendor reads timeline of the transferred load | 404 | as expected | PASS |
| other vendor reads lots of the transferred load | 404 | as expected | PASS |
| other company driver reads where of the transferred load | 403/404 | as expected | PASS |
| other company driver reads timeline of the transferred load | 403/404 | as expected | PASS |
| other company driver reads lots of the transferred load | 403/404 | as expected | PASS |
| other company staff records custody on the transferred load | 404 | as expected | PASS |
| other company driver records custody on the transferred load | 403/404 | as expected | PASS |
| other vendor records custody on the transferred load | 403 | as expected | PASS |
| other company sends a delivery code for the transferred load | 404 | as expected | PASS |
| other company opens a problem on the transferred load | 404 | as expected | PASS |
| other company splits the transferred load | 404 | as expected | PASS |
| other company claims on the transferred load | 404 | 201 {"id":"03bebf15-e065-437f-a990-47d4edced78c","code":"CLM-BGEPPC","exception_id":null,"shipment_id":null,"manifest_id":"4b3aa99a-3b74-4993-9ede-afc89d227ddb","claim_type":"damage","declared_value": | FAIL |
| other company staff reads where of the delivered shipment | 404 | as expected | PASS |
| other company staff reads timeline of the delivered shipment | 404 | as expected | PASS |
| other company staff reads lots of the delivered shipment | 404 | as expected | PASS |
| other vendor reads where of the delivered shipment | 404 | as expected | PASS |
| other vendor reads timeline of the delivered shipment | 404 | as expected | PASS |
| other vendor reads lots of the delivered shipment | 404 | as expected | PASS |
| other company driver reads where of the delivered shipment | 403/404 | as expected | PASS |
| other company driver reads timeline of the delivered shipment | 403/404 | as expected | PASS |
| other company driver reads lots of the delivered shipment | 403/404 | as expected | PASS |
| other company staff records custody on the delivered shipment | 404 | as expected | PASS |
| other company driver records custody on the delivered shipment | 403/404 | as expected | PASS |
| other vendor records custody on the delivered shipment | 403 | as expected | PASS |
| other company sends a delivery code for the delivered shipment | 404 | as expected | PASS |
| other company opens a problem on the delivered shipment | 404 | as expected | PASS |
| other company splits the delivered shipment | 404 | as expected | PASS |
| other company claims on the delivered shipment | 404 | 201 {"id":"9729a86c-04a5-49c1-ace3-e2d4661fb1c8","code":"CLM-TS6YG8","exception_id":null,"shipment_id":"8e2771fc-ca9b-4fc5-97d5-9ccee72c5223","manifest_id":null,"claim_type":"damage","declared_value": | FAIL |
| other company staff reads where of the returned shipment | 404 | as expected | PASS |
| other company staff reads timeline of the returned shipment | 404 | as expected | PASS |
| other company staff reads lots of the returned shipment | 404 | as expected | PASS |
| other vendor reads where of the returned shipment | 404 | as expected | PASS |
| other vendor reads timeline of the returned shipment | 404 | as expected | PASS |
| other vendor reads lots of the returned shipment | 404 | as expected | PASS |
| other company driver reads where of the returned shipment | 403/404 | as expected | PASS |
| other company driver reads timeline of the returned shipment | 403/404 | as expected | PASS |
| other company driver reads lots of the returned shipment | 403/404 | as expected | PASS |
| other company staff records custody on the returned shipment | 404 | as expected | PASS |
| other company driver records custody on the returned shipment | 403/404 | as expected | PASS |
| other vendor records custody on the returned shipment | 403 | as expected | PASS |
| other company sends a delivery code for the returned shipment | 404 | as expected | PASS |
| other company opens a problem on the returned shipment | 404 | as expected | PASS |
| other company splits the returned shipment | 404 | as expected | PASS |
| other company claims on the returned shipment | 404 | 201 {"id":"4eec5763-06a1-49df-834f-16f6bc1541d7","code":"CLM-KBTYZD","exception_id":null,"shipment_id":"98e73ac0-1833-4b45-81a3-c0be484ed796","manifest_id":null,"claim_type":"damage","declared_value": | FAIL |
| other company staff reads where of the hub load | 404 | as expected | PASS |
| other company staff reads timeline of the hub load | 404 | as expected | PASS |
| other company staff reads lots of the hub load | 404 | as expected | PASS |
| other vendor reads where of the hub load | 404 | as expected | PASS |
| other vendor reads timeline of the hub load | 404 | as expected | PASS |
| other vendor reads lots of the hub load | 404 | as expected | PASS |
| other company driver reads where of the hub load | 403/404 | as expected | PASS |
| other company driver reads timeline of the hub load | 403/404 | as expected | PASS |
| other company driver reads lots of the hub load | 403/404 | as expected | PASS |
| other company staff records custody on the hub load | 404 | as expected | PASS |
| other company driver records custody on the hub load | 403/404 | as expected | PASS |
| other vendor records custody on the hub load | 403 | as expected | PASS |
| other company sends a delivery code for the hub load | 404 | as expected | PASS |
| other company opens a problem on the hub load | 404 | as expected | PASS |
| other company splits the hub load | 404 | as expected | PASS |
| other company claims on the hub load | 404 | 201 {"id":"def11bcc-4371-4a19-bf3a-27ea7e0b13d3","code":"CLM-HG4FXQ","exception_id":null,"shipment_id":null,"manifest_id":"7a5a7f6c-65ad-4d8c-b8c4-9f563cf27883","claim_type":"damage","declared_value": | FAIL |
| other company staff reads the case | 404 | as expected | PASS |
| other company staff adds a note to the case | 404 | as expected | PASS |
| other company staff resolves the case | 404 | as expected | PASS |
| other company staff asks for relief trucks of the case | 404 | as expected | PASS |
| another vendor reads the case | 403 | as expected | PASS |
| the load's own vendor reads the staff case | 403 (staff only) | as expected | PASS |
| other company staff reads the case | 404 | as expected | PASS |
| other company staff adds a note to the case | 404 | as expected | PASS |
| other company staff resolves the case | 404 | as expected | PASS |
| other company staff asks for relief trucks of the case | 404 | as expected | PASS |
| another vendor reads the case | 403 | as expected | PASS |
| the load's own vendor reads the staff case | 403 (staff only) | as expected | PASS |
| another company's problem list | none of ours | as expected | PASS |
| another company reads our transfer | 404 | as expected | PASS |
| another company sets Part B on our transfer | 404 | as expected | PASS |
| another company cancels our transfer | 404 | as expected | PASS |
| another company's driver reads our transfer | 403/404 | as expected | PASS |
| another company's transfer list | none of ours | as expected | PASS |
| another company's claim list | none of ours | as expected | PASS |
| another company's hubs | none of ours | as expected | PASS |
| another company reads what is on our truck | 403/404 | as expected | PASS |
| another company's staff read what is on our truck | 403/404 | as expected | PASS |
