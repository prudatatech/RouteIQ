#!/usr/bin/env bash
# UAT scenario: the driver (trip list, accept, pickup, stops, counts, delivery code, SOS, fuel, odometer, pay, return trips).
# Calls are the ones driver-app/src/services/api.ts makes. Runs after the 75-step story. Read e2e/out/scenario.txt.
set -u
source "$(dirname "$0")/lib.sh"
DA=$(uid driverA); DB=$(uid driverB)
T1=$(vehicle_id MH04E2E0001); T2=$(vehicle_id MH04E2E0002)
info "driverA=$DA driverB=$DB truck1=$T1 truck2=$T2"
clear_routes

sect "A. Trip list and status before any new trip"
req driverA GET /routes; chk DA01 "driver lists their trips" 200
info "driverA trips: $(jb 'group_by(.status)|map({(.[0].status):length})|add|tostring')"
t DA02 "the list holds only trips of the driver's own truck" "$([ "$(jb '[.[]|select(.vehicle_id!=null and .vehicle_id!="'"$T1"'")]|length')" = 0 ] && echo 1 || echo 0)" "foreign=$(jb '[.[]|select(.vehicle_id!=null and .vehicle_id!="'"$T1"'")|.id]|tostring')"
req driverA GET '/routes?status=pending'; chk DA03 "filter by status" 200
req driverA GET /telemetry/driver-ping/my-route; info "my-route with no open trip: HTTP $ST $(ev 200)"
t DA04 "my-route with nothing to do answers 200 with an empty trip, or a clear 404 (not 500)" "$([ "$ST" = 200 ] || [ "$ST" = 404 ] && echo 1 || echo 0)" "HTTP $ST"
req driverA GET /telemetry/driver-ping/my-status; chk DA05 "my-status" 200
req driverA GET /cargo/driver/on-board; chk DA06 "what is on board" 200
req driverA GET /driver/dispatch-contact; chk DA07 "dispatch phone" 200
req driverA PUT /driver/dispatch-contact '{"phone":"+911234567890"}'; chk DA08 "a driver cannot change the dispatch phone" 403
req driverA GET /vehicles/my-registration; chk DA09 "the driver's own vehicle registration" 200
req customer GET /telemetry/driver-ping/my-route; chk DA10 "a customer cannot use my-route" 403
req vendor GET /routes; t DA11 "a vendor cannot list trips" "$([ "$ST" = 403 ] && echo 1 || echo 0)" "HTTP $ST $(ev 100)"
req anon GET /routes; chk DA12 "no sign-in, no trips" 401
req driverA POST /telemetry/driver-ping '{"pings":[{"lat":19.31,"lng":73.07,"speed":10,"heading":90,"accuracy":8,"timestamp":"'"$(date -u +%FT%TZ)"'"},{"lat":0,"lng":0},{"lat":999,"lng":10},{"lat":"x","lng":1}]}'; chk DA13 "a batch of 4 location points" 200
t DA14 "only the 1 real point is processed (0,0, out-of-range and text are skipped)" "$([ "$(jb .pings_processed)" = 1 ] && echo 1 || echo 0)" "pings_processed=$(jb .pings_processed)"
req driverA POST /telemetry/driver-ping "{\"pings\":[$(for i in $(seq 1 600); do printf '{"lat":19.3,"lng":73.0},'; done | sed 's/,$//')]}"; t DA15 "600 points in one batch are refused (400)" "$([ "$ST" = 400 ] && echo 1 || echo 0)" "HTTP $ST $(ev 120)"
req customer POST /telemetry/driver-ping '{"lat":19.3,"lng":73.0}'; chk DA16 "a customer cannot send driver pings" 403
req driverA POST /telemetry/driver-ping/break '{"is_break":true}'; chk DA17 "start a break" 200
req driverA POST /telemetry/driver-ping/break '{"is_break":false}'; chk DA18 "end the break" 200
req driverA POST /telemetry/driver-ping/break '{"is_break":"maybe"}'; t DA19 "a non-boolean break is refused" "$([ "$ST" = 400 ] && echo 1 || echo 0)" "HTTP $ST $(ev 120)"

sect "B. Trip 1: three drops (30, 20 and 10 pieces) on truck 1"
mkbk 30 20 10; chk DB00 "customer booking confirmed" 200
BK1=$BK; M1=$MASTER; LA=${LOTS[0]}; LB=${LOTS[1]}; LC=${LOTS[2]}
for L in "$LA" "$LB" "$LC"; do assign_lot "$L" "$T1"; done
R1=$(route_of "$LA"); SA=$(stop_of "$LA"); SB=$(stop_of "$LB"); SC=$(stop_of "$LC")
info "booking=$BK1 master=$M1 lots=$LA,$LB,$LC route=$R1 stops=$SA,$SB,$SC route status=$(sql "select status from routes where id='$R1'")"
t DB01 "all three lots are on one pending trip of truck 1" "$([ "$(sql "select count(*) from route_stops where route_id='$R1'")" = 3 ] && echo 1 || echo 0)" "stops=$(sql "select count(*) from route_stops where route_id='$R1'") truck status=$(sql "select status from vehicles where id='$T1'")"
req driverA GET /telemetry/driver-ping/my-route; info "my-route while the trip is only assigned (not sent): HTTP $ST $(ev 240)"
t DB02 "a trip that has been assigned but not sent is not shown to the driver as a job to do" "$([ "$(echo "$BODY" | grep -c "$R1")" = 0 ] && echo 1 || echo 0)" "contains route=$(echo "$BODY" | grep -c "$R1")"
req driverA GET /routes/$R1; info "driver reads the unsent trip: HTTP $ST"
send_route "$R1"; chk DB03 "dispatch sends the trip" 200
req driverA GET /telemetry/driver-ping/my-route; chk DB04 "my-route shows the sent trip" 200
t DB05 "my-route lists the 3 stops in order with consignee names" "$([ "$(echo "$BODY" | grep -o 'Consignee [0-9]' | sort -u | wc -l)" -ge 3 ] && echo 1 || echo 0)" "$(ev 300)"
info "my-route top-level keys: $(jb 'keys|join(",")')"
t DB06 "the driver's trip view shows no customer phone, price or invoice" "$(lacks "$BODY" 'freight_charge|quoted_price|invoice|customer_id|customer_phone')" "hits: $(printf '%s' "$BODY" | grep -oiE 'freight_charge|quoted_price|invoice|customer_id|customer_phone' | sort -u | tr '\n' ' ')"
req driverA GET "/routes/$R1"; chk DB07 "driver opens the trip" 200

sect "C. driverB acting on driverA's trip (every one must be refused)"
req driverB POST /telemetry/driver-ping/accept-route "{\"route_id\":\"$R1\"}"; chk DX01 "accept" 403
req driverB POST /telemetry/driver-ping/start-route "{\"route_id\":\"$R1\"}"; chk DX02 "start" 403
complete_stop driverB "$SC"; chk DX03 "complete a stop" 403
req driverB PATCH "/routes/$R1/status" '{"status":"active"}'; chk DX04 "start it through the status route" 403
req driverB PATCH "/routes/$R1/status" '{"status":"completed"}'; chk DX05 "complete it through the status route" 403
req driverB PATCH "/routes/$R1/status" '{"status":"cancelled"}'; chk DX06 "cancel it through the status route" 403
req driverB GET "/routes/$R1"; chk DX07 "read it" 403
req driverB POST /driver/pod-upload-url "{\"stop_id\":\"$SC\",\"kind\":\"photo\",\"content_type\":\"image/jpeg\",\"size\":1000}"; chk DX08 "a proof-of-delivery upload for A's stop" 403
req driverB PATCH "/vehicles/$T1" '{"declared_load_percentage":10}'; t DX09 "change A's truck load" "$([ "$ST" = 403 ] || [ "$ST" = 404 ] && echo 1 || echo 0)" "HTTP $ST $(ev 120)"
req driverB GET "/fleet/vehicles/$T1/fuel-logs"; chk DX10 "read A's truck's fuel log" 403
req driverB POST "/fleet/vehicles/$T1/fuel-logs" '{"litres":10,"price_per_litre":90,"payment_mode":"cash"}'; chk DX11 "log fuel on A's truck" 403
req driverB GET "/messages?route_id=$R1"; chk DX12 "read A's trip chat" "403 404"
req driverB POST /messages "{\"route_id\":\"$R1\",\"body\":\"hello\"}"; chk DX13 "write in A's trip chat" "403 404"
req driverB POST /capacity/driver/open-backhaul-window "{\"vehicle_id\":\"$T1\",\"available_capacity_kg\":1000,\"trigger_type\":\"return_trip\"}"; chk DX14 "open a return trip on A's truck" 403
req driverB POST /capacity/driver/toggle-matching "{\"vehicle_id\":\"$T1\",\"enabled\":false}"; t DX15 "switch matching off on A's truck" "$([ "$ST" = 403 ] || [ "$ST" = 404 ] && echo 1 || echo 0)" "HTTP $ST $(ev 120)"
req driverB GET "/telemetry/$T1/live"; t DX16 "read A's truck live position" "$([ "$ST" = 403 ] || [ "$ST" = 404 ] && echo 1 || echo 0)" "HTTP $ST $(ev 120)"
req driverB GET "/telemetry/$T1/history"; t DX17 "read A's truck position history" "$([ "$ST" = 403 ] || [ "$ST" = 404 ] && echo 1 || echo 0)" "HTTP $ST $(ev 120)"
req driverB GET "/vehicles/$T1"; t DX18 "read A's truck record (RC, insurance, odometer)" "$([ "$ST" = 403 ] || [ "$ST" = 404 ] && echo 1 || echo 0)" "HTTP $ST $(ev 160)"
req driverB GET "/cargo/where/$LA"; t DX19 "B reads where A's lot is" "$([ "$ST" = 403 ] || [ "$ST" = 404 ] && echo 1 || echo 0)" "HTTP $ST $(ev 160)"
req driverB GET "/cargo/lots/$M1"; t DX20 "B reads A's lots" "$([ "$ST" = 403 ] || [ "$ST" = 404 ] && echo 1 || echo 0)" "HTTP $ST $(ev 160)"
req driverB GET /driver-pay/entries; chk DX21 "staff driver-pay list" 403
req driverB GET "/people/$DA"; t DX22 "read A's people record" "$([ "$ST" = 403 ] || [ "$ST" = 404 ] && echo 1 || echo 0)" "HTTP $ST $(ev 120)"
req driverB GET "/people/$DA/bank-accounts"; chk DX23 "read A's bank accounts" 403
req driverB GET "/auth/driver/earnings"; t DX24 "B's earnings do not include A's trip" "$([ "$ST" = 200 ] && [ "$(echo "$BODY" | grep -c "$R1")" = 0 ] && echo 1 || echo 0)" "HTTP $ST $(ev 160)"
pickup driverB "$LC" 10; t DX30 "B records a pickup of A's lot" "$([ "$ST" = 403 ] || [ "$ST" = 404 ] || [ "$ST" = 409 ] && echo 1 || echo 0)" "HTTP $ST $(ev 200); lot status now $(sstatus "$LC"), vehicle $(sql "select current_vehicle_id from shipments where id='$LC'")"
req driverB POST /cargo/custody "{\"ref\":{\"shipment_id\":\"$LC\"},\"kind\":\"delivery\",\"receiver_name\":\"x\",\"photo_paths\":[\"$(photo "$LC")\"]}"; t DX31 "B records a delivery of A's lot" "$([ "$ST" = 403 ] || [ "$ST" = 404 ] || [ "$ST" = 409 ] && echo 1 || echo 0)" "HTTP $ST $(ev 200); lot status $(sstatus "$LC")"
req driverB POST /cargo/custody "{\"ref\":{\"shipment_id\":\"$LC\"},\"kind\":\"hold\",\"reason\":\"just because\"}"; t DX32 "B puts A's lot on hold" "$([ "$ST" = 403 ] || [ "$ST" = 404 ] || [ "$ST" = 409 ] && echo 1 || echo 0)" "HTTP $ST $(ev 200); lot status $(sstatus "$LC")"
req driverB POST /cargo/claims "{\"ref\":{\"shipment_id\":\"$LC\"},\"claim_type\":\"loss\"}"; chk DX33 "a driver cannot raise a claim" 403
sql "update shipments set status='assigned' where id='$LC' and status='picked_up' and current_vehicle_id is distinct from '$T1'" >/dev/null

sect "D. Accept twice, accept the wrong thing, start twice"
req driverA POST /telemetry/driver-ping/accept-route "{\"route_id\":\"$R1\"}" --idem uat-accept-1; chk DD01 "driver A accepts" 200
t DD02 "all three lots accepted" "$([ "$(jb .accepted)" = 3 ] && echo 1 || echo 0)" "accepted=$(jb .accepted)"
req driverA POST /telemetry/driver-ping/accept-route "{\"route_id\":\"$R1\"}"; chk DD03 "accepting again (new key) is harmless" 200
t DD04 "the second accept records nothing new" "$([ "$(jb .accepted)" = 0 ] && echo 1 || echo 0)" "accepted=$(jb .accepted)"
req driverA POST /telemetry/driver-ping/accept-route "{\"route_id\":\"$R1\"}" --idem uat-accept-1; t DD05 "a replay with the same key gets the first answer back" "$([ "$ST" = 200 ] && [ "$(jb .accepted)" = 3 ] && echo 1 || echo 0)" "HTTP $ST accepted=$(jb .accepted)"
t DD06 "one 'accepted' custody event per lot, not two" "$([ "$(sql "select count(*) from cargo_custody_events where kind='accepted' and driver_id='$DA' and shipment_id in ('$LA','$LB','$LC')")" = 3 ] && echo 1 || echo 0)" "events=$(sql "select count(*) from cargo_custody_events where kind='accepted' and driver_id='$DA' and shipment_id in ('$LA','$LB','$LC')")"
req driverA POST /telemetry/driver-ping/accept-route '{}'; chk DD07 "accept with no route id is a 400" 400
req driverA POST /telemetry/driver-ping/accept-route '{"route_id":"00000000-0000-0000-0000-000000000000"}'; t DD08 "accept an unknown trip is refused (403/404)" "$([ "$ST" = 403 ] || [ "$ST" = 404 ] && echo 1 || echo 0)" "HTTP $ST $(ev 120)"
req driverA POST /telemetry/driver-ping/accept-route '{"route_id":"not-a-uuid"}'; t DD09 "accept with a malformed id is a clean 4xx, not a 500" "$([ "$ST" -ge 400 ] && [ "$ST" -lt 500 ] && echo 1 || echo 0)" "HTTP $ST $(ev 120)"
req driverA POST /telemetry/driver-ping/accept-route '{"route_id":123}'; chk DD10 "accept with a numeric route id is a 400" 400
req customer POST /telemetry/driver-ping/accept-route "{\"route_id\":\"$R1\"}"; chk DD11 "a customer cannot accept a trip" 403
req driverA POST /telemetry/driver-ping/start-route '{"route_id":"00000000-0000-0000-0000-000000000000"}'; t DD12 "start an unknown trip is refused (403/404)" "$([ "$ST" = 403 ] || [ "$ST" = 404 ] && echo 1 || echo 0)" "HTTP $ST $(ev 120)"

sect "E. Complete a stop before the pickup (known: UAT-007), pickup rules"
complete_stop driverA "$SC"; info "lot C delivered with NO pickup recorded: HTTP $ST $(ev 220)"
t DE01 "a stop cannot be completed for goods never picked up (409, 'record the pickup first')" "$([ "$ST" = 409 ] && echo 1 || echo 0)" "HTTP $ST lot C status=$(sstatus "$LC") custody=$(sql "select string_agg(kind,',' order by recorded_at) from cargo_custody_events where shipment_id='$LC'")"
pickup driverA "$LA" 30 uat-pick-a; chk DE02 "pickup of lot A: 30 of 30 pieces" "200 201"
FIRSTBODY=$BODY
pickup driverA "$LA" 30 uat-pick-a; t DE03 "a replay of the pickup with the same key gets the first answer, not 409" "$([ "$ST" = 200 ] || [ "$ST" = 201 ] && echo 1 || echo 0)" "HTTP $ST $(ev 160)"
pickup driverA "$LA" 30; chk DE04 "a second pickup with a new key is refused (409)" 409
pk() { req driverA POST /cargo/custody "$(jq -nc --arg id "$LB" --arg ph "${3:-$(photo "$LB")}" --argjson x "$2" '{ref:{shipment_id:$id},kind:"pickup",condition:"good",photo_paths:[$ph],lat:19.3,lng:73.06}+$x')"; }
pk x '{}'; chk DE05 "pickup with no piece count is a 400" 400
pk x '{"pieces":-1}'; chk DE06 "negative pieces refused" 400
pk x '{"pieces":1.5}'; chk DE07 "fractional pieces refused" 400
pk x '{"pieces":"abc"}'; chk DE08 "text pieces refused" 400
pk x '{"pieces":100001}'; chk DE09 "100001 pieces refused" 400
pk x '{"pieces":20}' "cargo/$LA/photo_1.jpg"; chk DE10 "a photo from another lot's folder refused" 400
pk x '{"pieces":20}' "cargo/$LB/../$LA/p.jpg"; chk DE11 "a photo path with .. refused" 400
pk x '{"pieces":20,"seal_number":"'"$(printf 'S%.0s' $(seq 1 600))"'"}'; t DE12 "a 600-character seal number refused" "$([ "$ST" = 400 ] && echo 1 || echo 0)" "HTTP $ST $(ev 120)"
pk x '{"pieces":20,"condition":"on_fire"}'; chk DE13 "an unknown condition refused" 400
pk x '{"pieces":20,"lat":123}'; chk DE14 "latitude 123 refused" 400
req driverA POST /cargo/custody "{\"ref\":{\"shipment_id\":\"$LB\"},\"kind\":\"pickup\",\"pieces\":20,\"photo_paths\":[$(for i in $(seq 1 11); do printf '"cargo/%s/p%s.jpg",' "$LB" $i; done | sed 's/,$//')]}"; chk DE15 "11 photos refused" 400
pk x '{"pieces":20,"seal_number":"SEAL-B"}'; chk DE16 "pickup of lot B: 20 of 20 pieces" "200 201"
req driverA POST /telemetry/driver-ping/start-route "{\"route_id\":\"$R1\"}"; chk DE20 "driver departs" 200
req driverA POST /telemetry/driver-ping/start-route "{\"route_id\":\"$R1\"}"; t DE21 "starting an already-started trip is harmless or a clear 409" "$([ "$ST" = 200 ] || [ "$ST" = 409 ] && echo 1 || echo 0)" "HTTP $ST $(ev 120)"
t DE22 "lots A and B are in transit" "$([ "$(sstatus "$LA")" = in_transit ] && [ "$(sstatus "$LB")" = in_transit ] && echo 1 || echo 0)" "A=$(sstatus "$LA") B=$(sstatus "$LB")"

sect "F. Counts above and below what is held (lot A holds 30)"
cs() { complete_stop driverA "$SA" "$1"; }
cs '{"outcome":"partial","pieces":20,"pieces_short":5}'; chk DF01 "partial: 20 accepted + 5 short = 25 of 30 held" 409
cs '{"outcome":"partial","pieces":25,"pieces_refused":10}'; chk DF02 "partial: 25 + 10 refused = 35 of 30 held" 409
cs '{"outcome":"partial","pieces":0,"pieces_short":30}'; chk DF03 "partial with 0 accepted" 400
cs '{"outcome":"partial","pieces":30}'; chk DF04 "partial with nothing refused or short is not a partial" 400
cs '{"outcome":"delivered","pieces":29}'; chk DF05 "full delivery of 29 when 30 are held" 409
cs '{"outcome":"delivered","pieces":31}'; chk DF06 "full delivery of 31 when 30 are held" 409
cs '{"pieces":-1}'; chk DF07 "negative pieces" 400
cs '{"pieces":2.5}'; chk DF08 "fractional pieces" 400
cs '{"pieces":"3"}'; chk DF09 "pieces as text" 400
cs '{"pieces":100001}'; chk DF10 "100001 pieces" 400
cs '{"outcome":"delivered_with_remarks","condition":"good"}'; chk DF11 "delivered with remarks but condition good" 400
cs '{"outcome":"delivered_with_remarks"}'; chk DF12 "delivered with remarks and no condition" 400
cs '{"outcome":"lost"}'; chk DF13 "an unknown outcome" 400
cs '{"photo_paths":[]}'; chk DF14 "delivered with no photo and no signature" 400
cs '{"received_by":""}'; chk DF15 "delivered with no receiver name" 400
cs '{"received_by":"'"$(printf 'R%.0s' $(seq 1 201))"'"}'; chk DF16 "a 201-character receiver name" 400
cs '{"photo_paths":["pod/'"$SB"'/photo_1.jpg"]}'; chk DF17 "a photo from another stop's folder" 400
cs '{"lat":999}'; chk DF18 "latitude 999" 400
cs '{"lat":"abc"}'; chk DF19 "latitude 'abc'" 400
cs '{"outcome":"not_delivered","reason":"teleported"}'; chk DF20 "an unknown failure reason" 400
cs '{"condition":"sparkly"}'; chk DF21 "an unknown condition" 400
cs '{"otp":"abc"}'; info "a non-numeric otp on a lot that needs none: HTTP $ST $(ev 120)"
req driverA POST /telemetry/driver-ping/complete-stop '{"outcome":"delivered"}'; chk DF22 "no stop id" 400
req driverA POST /telemetry/driver-ping/complete-stop '{"stop_id":"00000000-0000-0000-0000-000000000000","outcome":"delivered","received_by":"x"}'; t DF23 "an unknown stop is refused (403/404)" "$([ "$ST" = 403 ] || [ "$ST" = 404 ] && echo 1 || echo 0)" "HTTP $ST $(ev 120)"
req driverA POST /telemetry/driver-ping/complete-stop '{"stop_id":"not-a-uuid","outcome":"delivered","received_by":"x"}'; t DF24 "a malformed stop id is a clean 4xx, not a 500" "$([ "$ST" -ge 400 ] && [ "$ST" -lt 500 ] && echo 1 || echo 0)" "HTTP $ST $(ev 120)"
t DF25 "none of the refused attempts changed lot A" "$([ "$(sstatus "$LA")" = in_transit ] && [ "$(sql "select pieces_delivered from shipments where id='$LA'")" = 0 ] && echo 1 || echo 0)" "status=$(sstatus "$LA") $(sql "select pieces_delivered,pieces_short from shipments where id='$LA'")"
req driverA POST /telemetry/driver-ping/complete-stop "$(jq -nc --arg s "$SA" --arg ph "$(pod "$SA")" '{stop_id:$s,outcome:"partial",pieces:25,pieces_short:5,received_by:"Store manager",photo_paths:[$ph],reason:"other",note:"five cartons missing"}')" --idem uat-partial-a
chk DF30 "partial delivery: 25 accepted, 5 short" 200
t DF31 "lot A is partially delivered with 25 delivered and 5 short" "$([ "$(sstatus "$LA")" = partially_delivered ] && echo 1 || echo 0)" "$(sql "select status,pieces_delivered,pieces_short from shipments where id='$LA'")"
t DF32 "a shortage case was opened for the 5 missing pieces" "$([ "$(sql "select count(*) from cargo_exceptions e join cargo_exception_items i on i.exception_id=e.id where i.shipment_id='$LA' and e.type='shortage'")" -ge 1 ] && echo 1 || echo 0)" "cases: $(sql "select string_agg(e.type||':'||e.status,',') from cargo_exceptions e join cargo_exception_items i on i.exception_id=e.id where i.shipment_id='$LA'")"
req driverA POST /telemetry/driver-ping/complete-stop "$(jq -nc --arg s "$SA" --arg ph "$(pod "$SA")" '{stop_id:$s,outcome:"partial",pieces:25,pieces_short:5,received_by:"Store manager",photo_paths:[$ph],reason:"other",note:"five cartons missing"}')" --idem uat-partial-a; t DF33 "a replay of the stop with the same key gets the first answer" "$([ "$ST" = 200 ] && echo 1 || echo 0)" "HTTP $ST $(ev 160)"
cs '{"outcome":"partial","pieces":25,"pieces_short":5}'; t DF34 "the same answer again (new key) is accepted without changing anything" "$([ "$ST" = 200 ] && [ "$(sql "select pieces_delivered from shipments where id='$LA'")" = 25 ] && echo 1 || echo 0)" "HTTP $ST delivered=$(sql "select pieces_delivered from shipments where id='$LA'")"
cs '{"outcome":"not_delivered","reason":"customer_unavailable"}'; chk DF35 "a different answer for a decided stop is refused (409)" 409
info "truck 1 load after the delivery: $(sql "select current_load_kg,available_capacity_kg from vehicles where id='$T1'") (truck 1 capacity 8000)"

sect "G. Delivery code (lot B holds 20)"
req superadmin POST /cargo/otp/send "{\"ref\":{\"shipment_id\":\"$LB\"}}"; chk DG01 "dispatch sends the delivery code" "200 201"
OTP=$(otp_for "$LB"); WRONG=$([ "$OTP" = 111111 ] && echo 222222 || echo 111111)
req driverA GET "/cargo/where/$LB"; t DG02 "the code does not appear in what the driver reads about the lot" "$(lacks "$BODY" "$OTP|delivery_otp")" "HTTP $ST hits: $(printf '%s' "$BODY" | grep -oE "$OTP|delivery_otp[a-z_]*" | sort -u | tr '\n' ' ')"
req driverA GET /telemetry/driver-ping/my-route; t DG03 "nor in the driver's trip view" "$(lacks "$BODY" "\"$OTP\"|otp_hash|delivery_otp_hash")" "HTTP $ST"
req driverA GET /routes; t DG03b "nor in the driver's trip list" "$(lacks "$BODY" "\"$OTP\"|otp_hash|delivery_otp_hash")" "HTTP $ST"
cb() { complete_stop driverA "$SB" "$1"; }
cb '{"pieces":20}'; chk DG04 "delivery with no code when one is required" 400
cb '{"pieces":20,"otp":"12ab56"}'; chk DG05 "delivery with a non-numeric code" 400
cb '{"pieces":20,"otp":"12345"}'; chk DG06 "delivery with a 5-digit code" 400
for i in 1 2 3 4; do cb "{\"pieces\":20,\"otp\":\"$WRONG\"}"; echo "CHECK DG1$i $([ "$ST" = 400 ] && echo PASS || echo FAIL) wrong code try $i is a 400 with the tries left | HTTP $ST tries_left=$(jb .tries_left) $(ev 140)"; done
cb "{\"pieces\":20,\"otp\":\"$WRONG\"}"; chk DG15 "the 5th wrong code locks the stop (429)" 429
cb "{\"pieces\":20,\"otp\":\"$OTP\"}"; chk DG16 "the RIGHT code is refused while locked (429)" 429
t DG17 "the lot was not delivered during the lock" "$([ "$(sstatus "$LB")" = in_transit ] && echo 1 || echo 0)" "status=$(sstatus "$LB")"
req driverA POST /cargo/custody "{\"ref\":{\"shipment_id\":\"$LB\"},\"kind\":\"delivery\",\"otp\":\"$OTP\",\"receiver_name\":\"x\",\"photo_paths\":[\"$(photo "$LB")\"]}"; t DG18 "the lock also holds on the custody route (no way round it)" "$([ "$ST" = 429 ] && echo 1 || echo 0)" "HTTP $ST $(ev 140)"
req driverA POST /cargo/custody "{\"ref\":{\"shipment_id\":\"$LB\"},\"kind\":\"delivery\",\"receiver_name\":\"x\",\"photo_paths\":[\"$(photo "$LB")\"]}"; t DG19 "a delivery recorded without a code through custody is refused when a code is required" "$([ "$ST" = 400 ] && echo 1 || echo 0)" "HTTP $ST $(ev 140)"
req superadmin POST /cargo/otp/send "{\"ref\":{\"shipment_id\":\"$LB\"}}"; info "dispatch resends the code during the lock: HTTP $ST (this clears the lock)"
OTP2=$(otp_for "$LB")
cb '{"pieces":20,"otp":"'"$OTP2"'"}'; chk DG20 "after a new code is sent the right code delivers lot B" 200
t DG21 "lot B is delivered and the code is cleared" "$([ "$(sstatus "$LB")" = delivered ] && [ -z "$(sql "select delivery_otp_hash from shipments where id='$LB'")" ] && echo 1 || echo 0)" "status=$(sstatus "$LB") hash=$(sql "select coalesce(delivery_otp_hash,'cleared') from shipments where id='$LB'" | cut -c1-12)"
cb '{"pieces":20,"otp":"'"$OTP2"'"}'; info "replay of a delivered stop with the used code: HTTP $ST $(ev 120)"
req superadmin POST /cargo/otp/send "{\"ref\":{\"shipment_id\":\"$LB\"}}"; t DG22 "a code cannot be sent for a delivered lot" "$([ "$ST" = 409 ] && echo 1 || echo 0)" "HTTP $ST $(ev 120)"
req driverA POST /cargo/otp/send "{\"ref\":{\"shipment_id\":\"$LC\"}}"; chk DG23 "a driver cannot send delivery codes" 403

sect "H. Last stop and trip completion"
info "before the last stop: lot C=$(sstatus "$LC") route=$(sql "select status from routes where id='$R1'") stops=$(sql "select string_agg(status,',') from route_stops where route_id='$R1'")"
if [ "$(sstatus "$LC")" != delivered ]; then
  pickup driverA "$LC" 10; info "pickup of lot C: HTTP $ST"
  complete_stop driverA "$SC" '{"pieces":10}'; chk DH01 "the last stop is delivered" 200
fi
sleep 1
t DH02 "all stops done: the trip is completed and the truck is free" "$([ "$(sql "select status from routes where id='$R1'")" = completed ] && [ "$(sql "select status from vehicles where id='$T1'")" != on_route ] && echo 1 || echo 0)" "route=$(sql "select status from routes where id='$R1'") stops=$(sql "select string_agg(status,',') from route_stops where route_id='$R1'") truck=$(sql "select status from vehicles where id='$T1'")"
req driverA POST /telemetry/driver-ping/complete-stop "$(jq -nc --arg s "$SB" '{stop_id:$s,outcome:"delivered",received_by:"x",photo_paths:["pod/'"$SB"'/photo_1.jpg"],pieces:20}')"; t DH03 "a stop of a completed trip: harmless repeat or a clear 409" "$([ "$ST" = 200 ] || [ "$ST" = 409 ] && echo 1 || echo 0)" "HTTP $ST $(ev 140)"
req driverA GET "/routes/$R1"; t DH04 "the trip shows completed with each stop's final status" "$([ "$(jb .status)" = completed ] && echo 1 || echo 0)" "status=$(jb .status) stops=$(jb '[.route_stops[]|.status]|join(",")')"

sect "I. Trip 2: dispatch cancels while the driver holds it"
clear_routes
mkbk 5 5; chk DI00 "second booking confirmed" 200
BK2=$BK; M2=$MASTER; LX=${LOTS[0]}; LY=${LOTS[1]}
assign_lot "$LX" "$T1"; assign_lot "$LY" "$T1"
R2=$(route_of "$LX"); SX=$(stop_of "$LX"); SY=$(stop_of "$LY")
send_route "$R2"; chk DI01 "trip sent" 200
req driverA POST /telemetry/driver-ping/accept-route "{\"route_id\":\"$R2\"}"; chk DI02 "driver accepts" 200
req superadmin POST "/bookings/$BK2/cancel" '{"reason":"Customer withdrew"}'; chk DI03 "dispatch cancels the booking" 200
info "after cancel: lots=$(sstatus "$LX"),$(sstatus "$LY") route=$(sql "select status from routes where id='$R2'") stops=$(sql "select string_agg(status,',') from route_stops where route_id='$R2'") truck=$(sql "select status from vehicles where id='$T1'")"
complete_stop driverA "$SX"; chk DI04 "completing a cancelled stop is refused (409)" 409
t DI05 "the message is the driver-facing one: cancelled by dispatch" "$(has "$BODY" 'cancelled by dispatch|cancelled')" "$(ev 160)"
complete_stop driverA "$SY" '{"outcome":"not_delivered","reason":"other"}'; t DI06 "failing a cancelled stop is refused (409)" "$([ "$ST" = 409 ] && echo 1 || echo 0)" "HTTP $ST $(ev 160)"
pickup driverA "$LX" 5; t DI07 "a pickup of a cancelled lot is refused" "$([ "$ST" = 409 ] && echo 1 || echo 0)" "HTTP $ST $(ev 160)"
req driverA POST /telemetry/driver-ping/start-route "{\"route_id\":\"$R2\"}"; info "start a cancelled trip: HTTP $ST $(ev 160)"
t DI08 "a cancelled trip cannot be started" "$([ "$ST" -ge 400 ] && [ "$ST" -lt 500 ] && echo 1 || echo 0)" "HTTP $ST route=$(sql "select status from routes where id='$R2'") truck=$(sql "select status from vehicles where id='$T1'")"
req driverA POST /telemetry/driver-ping/accept-route "{\"route_id\":\"$R2\"}"; info "accept a cancelled trip: HTTP $ST $(ev 120)"
req driverA GET /telemetry/driver-ping/my-route; t DI09 "the driver's trip view no longer offers the cancelled trip" "$([ "$(echo "$BODY" | grep -c "$R2")" = 0 ] && echo 1 || echo 0)" "HTTP $ST $(ev 200)"
t DI10 "the driver was told the trip was cancelled" "$([ "$(sql "select count(*) from notifications where user_id='$DA' and created_at > now() - interval '5 minutes' and (title ilike '%cancel%' or body ilike '%cancel%')")" -ge 1 ] && echo 1 || echo 0)" "driver notifications: $(sql "select string_agg(title,' | ' order by created_at) from notifications where user_id='$DA' and created_at > now() - interval '5 minutes'" | cut -c1-300)"
t DI11 "truck 1 is free again" "$([ "$(sql "select status from vehicles where id='$T1'")" != on_route ] && echo 1 || echo 0)" "truck=$(sql "select status from vehicles where id='$T1'")"

sect "J. Trip 3: pickup counts, SOS"
clear_routes
mkbk 10 10; chk DJ00 "third booking confirmed" 200
BK3=$BK; M3=$MASTER; LP=${LOTS[0]}; LQ=${LOTS[1]}
assign_lot "$LP" "$T1"; assign_lot "$LQ" "$T1"
R3=$(route_of "$LP"); SP=$(stop_of "$LP"); SQ=$(stop_of "$LQ")
send_route "$R3"; req driverA POST /telemetry/driver-ping/accept-route "{\"route_id\":\"$R3\"}"; chk DJ01 "trip 3 accepted" 200
pickup driverA "$LP" 12; chk DJ02 "pickup of 12 pieces when 10 were booked (more than booked)" "200 201"
t DJ03 "the extra pieces are recorded and flagged (an 'excess' case), not silently accepted" "$([ "$(sql "select count(*) from cargo_exceptions e join cargo_exception_items i on i.exception_id=e.id where i.shipment_id='$LP' and e.type='excess'")" -ge 1 ] && echo 1 || echo 0)" "$(sql "select pieces_total,pieces_delivered,pieces_short from shipments where id='$LP'") cases: $(sql "select string_agg(e.type,',') from cargo_exceptions e join cargo_exception_items i on i.exception_id=e.id where i.shipment_id='$LP'")"
pickup driverA "$LQ" 7; chk DJ04 "pickup of 7 pieces when 10 were booked (fewer than booked)" "200 201"
t DJ05 "the shortage of 3 is recorded and flagged" "$([ "$(sql "select count(*) from cargo_exceptions e join cargo_exception_items i on i.exception_id=e.id where i.shipment_id='$LQ' and e.type='shortage'")" -ge 1 ] && echo 1 || echo 0)" "$(sql "select pieces_total,pieces_short from shipments where id='$LQ'") cases: $(sql "select string_agg(e.type,',') from cargo_exceptions e join cargo_exception_items i on i.exception_id=e.id where i.shipment_id='$LQ'")"
complete_stop driverA "$SP" '{"pieces":10}'; t DJ06 "delivering 10 of the 12 picked up is refused (409)" "$([ "$ST" = 409 ] && echo 1 || echo 0)" "HTTP $ST $(ev 160)"
req driverA POST /telemetry/driver-ping/start-route "{\"route_id\":\"$R3\"}"; chk DJ07 "depart" 200
# SOS
SK="uat-sos-$(date +%s)"
req driverA POST /telemetry/sos/trigger '{"lat":null,"lng":null,"alert_type":"breakdown","description":"flat tyre"}' --idem "$SK"; chk DS01 "SOS as the app sends it when no position is known (null coordinates)" 200
SOS1=$(jb .id)
req driverA POST /telemetry/sos/trigger '{"lat":null,"lng":null,"alert_type":"breakdown","description":"flat tyre"}' --idem "$SK"; t DS02 "a replay of the SOS (offline queue) gives back the same alert, no second one" "$([ "$(jb .id)" = "$SOS1" ] && [ "$(sql "select count(*) from sos_alerts where driver_id='$DA' and description='flat tyre'")" = 1 ] && echo 1 || echo 0)" "id=$(jb .id) first=$SOS1 rows=$(sql "select count(*) from sos_alerts where driver_id='$DA' and description='flat tyre'")"
req driverA POST /telemetry/sos/trigger '{"lat":"abc","lng":73}'; chk DS03 "SOS with text latitude refused" 400
req driverA POST /telemetry/sos/trigger '{"lat":999,"lng":73}'; chk DS04 "SOS with latitude 999 refused" 400
req driverA POST /telemetry/sos/trigger '{"lat":19.3}'; info "SOS with latitude only: HTTP $ST $(ev 120)"
req driverA POST /telemetry/sos/trigger '{"lat":19.3,"lng":73.0,"alert_type":"zzz","description":"'"$(printf 'D%.0s' $(seq 1 700))"'"}'; chk DS05 "SOS with an unknown type and a 700-character description is accepted (type falls back, text is cut)" 200
SOS2=$(jb .id)
t DS06 "the description is cut to 500 characters and the type falls back to panic_button" "$([ "$(sql "select length(description) from sos_alerts where id='$SOS2'")" = 500 ] && [ "$(sql "select alert_type from sos_alerts where id='$SOS2'")" = panic_button ] && echo 1 || echo 0)" "$(sql "select alert_type,length(description) from sos_alerts where id='$SOS2'")"
req driverA POST /telemetry/sos/trigger '{"lat":19.3,"lng":73.0,"alert_type":"medical","description":"चालक की तबीयत खराब है"}'; chk DS07 "SOS with a Hindi description" 200
SOS3=$(jb .id); t DS08 "the Hindi text is stored intact" "$([ "$(sql "select description from sos_alerts where id='$SOS3'")" = "चालक की तबीयत खराब है" ] && echo 1 || echo 0)" "$(sql "select description from sos_alerts where id='$SOS3'")"
req customer POST /telemetry/sos/trigger '{"lat":19.3,"lng":73.0}'; chk DS09 "a customer cannot raise an SOS" 403
t DS10 "staff were told about the SOS" "$([ "$(sql "select count(*) from notifications where type='sos' and created_at > now() - interval '10 minutes'")" -ge 1 ] && echo 1 || echo 0)" "$(sql "select count(*) from notifications where type='sos' and created_at > now() - interval '10 minutes'") notifications"
req driverB POST "/telemetry/sos/$SOS1/cancel" '{}'; chk DS11 "driver B cannot cancel driver A's SOS" "403 404"
req driverB PATCH "/telemetry/sos/$SOS1/details" '{"severity":"serious","alert_type":"accident"}'; chk DS12 "driver B cannot change driver A's SOS" "403 404"
req driverA POST "/telemetry/sos/$SOS1/cancel" '{}'; chk DS13 "driver A cancels their SOS" 200
t DS14 "the alert is cancelled and changed=true" "$([ "$(jb .changed)" = true ] && [ "$(sql "select status from sos_alerts where id='$SOS1'")" = cancelled ] && echo 1 || echo 0)" "$(ev 100) status=$(sql "select status from sos_alerts where id='$SOS1'")"
req driverA POST "/telemetry/sos/$SOS1/cancel" '{}'; t DS15 "cancelling twice is harmless (changed=false)" "$([ "$ST" = 200 ] && [ "$(jb .changed)" = false ] && echo 1 || echo 0)" "HTTP $ST $(ev 100)"
req driverA PATCH "/telemetry/sos/$SOS1/details" '{"severity":"serious"}'; chk DS16 "adding details to a cancelled SOS is refused" 404
req driverA POST /telemetry/sos/00000000-0000-0000-0000-000000000000/cancel '{}'; chk DS17 "cancelling an unknown SOS is a 404" 404
req driverA POST /telemetry/sos/not-a-uuid/cancel '{}'; t DS18 "cancelling a malformed id is a clean 4xx, not a 500" "$([ "$ST" -ge 400 ] && [ "$ST" -lt 500 ] && echo 1 || echo 0)" "HTTP $ST $(ev 120)"
req driverA PATCH "/telemetry/sos/$SOS2/details" '{"severity":"urgent"}'; chk DS19 "a severity other than serious/minor refused" 400
req driverA PATCH "/telemetry/sos/$SOS2/details" '{}'; chk DS20 "details with nothing to update refused" 400
req driverA PATCH "/telemetry/sos/$SOS2/details" '{"alert_type":"breakdown","severity":"minor","description":"खराब टायर"}'; chk DS21 "a minor breakdown detail" 200
t DS22 "a minor breakdown leaves the truck in service" "$([ "$(sql "select status from vehicles where id='$T1'")" = on_route ] && echo 1 || echo 0)" "truck=$(sql "select status from vehicles where id='$T1'")"
req driverA POST "/telemetry/sos/$SOS2/cancel" '{}'; chk DS23 "cancel the minor one" 200
req driverA POST /telemetry/sos/trigger '{"lat":20.5,"lng":75.5,"alert_type":"accident","description":"Truck hit a divider"}'; chk DS30 "an accident SOS" 200
SOS4=$(jb .id)
req driverA PATCH "/telemetry/sos/$SOS4/details" '{"severity":"serious"}'; chk DS31 "marked serious" 200
info "after a serious accident: truck=$(sql "select status from vehicles where id='$T1'") lots P,Q=$(sstatus "$LP"),$(sstatus "$LQ") cases=$(sql "select string_agg(type||':'||status,',') from cargo_exceptions where type='vehicle_accident'")"
t DS32 "a serious accident takes the truck out of service and puts the goods on hold" "$([ "$(sql "select status from vehicles where id='$T1'")" = maintenance ] && [ "$(sstatus "$LP")" = on_hold ] && echo 1 || echo 0)" "truck=$(sql "select status from vehicles where id='$T1'") P=$(sstatus "$LP") Q=$(sstatus "$LQ")"
req driverA POST "/telemetry/sos/$SOS4/cancel" '{}'; chk DS33 "the driver cancels it (raised by mistake)" 200
info "after the driver cancels the serious SOS: truck=$(sql "select status from vehicles where id='$T1'") P=$(sstatus "$LP") Q=$(sstatus "$LQ") case=$(sql "select string_agg(status,',') from cargo_exceptions where type='vehicle_accident'")"
t DS34 "cancelling the SOS puts the truck back in service and releases the goods (or the driver is told it needs dispatch)" "$([ "$(sql "select status from vehicles where id='$T1'")" != maintenance ] && echo 1 || echo 0)" "truck=$(sql "select status from vehicles where id='$T1'") P=$(sstatus "$LP") case=$(sql "select string_agg(status,',') from cargo_exceptions where type='vehicle_accident'")"
t DS35 "staff were told the driver cancelled" "$([ "$(sql "select count(*) from notifications where title='SOS cancelled' and created_at > now() - interval '10 minutes'")" -ge 1 ] && echo 1 || echo 0)" "$(sql "select count(*) from notifications where title='SOS cancelled' and created_at > now() - interval '10 minutes'")"
for i in 1 2 3 4 5; do req driverA POST /telemetry/sos/trigger '{"lat":20.5,"lng":75.5}'; echo "INFO flood SOS $i: HTTP $ST"; done
t DS36 "SOS raising is rate limited (429 after 10 in 10 minutes)" "$([ "$ST" = 429 ] && echo 1 || echo 0)" "last HTTP $ST $(ev 120)"
sql "update sos_alerts set status='resolved' where status in ('active','acknowledged')" >/dev/null

sect "K. Fuel log and odometer (truck 1)"
reset_trucks
fl() { req driverA POST "/fleet/vehicles/$T1/fuel-logs" "$1" ${2:+--idem "$2"}; }
req driverA GET "/fleet/vehicles/$T1/fuel-logs?limit=5"; chk DK01 "the app's fuel list call" 200
base='{"litres":40,"price_per_litre":95.5,"odometer_km":10000,"is_full_tank":true,"station_name":"HP Pump, Panvel","payment_mode":"cash"}'
bf() { fl "$(echo "$base" | jq -c "$2")"; chk "$1" "$3" 400; }
bf DK10 '.litres=-5' "negative litres refused"
bf DK11 '.litres=0' "zero litres refused"
bf DK12 '.price_per_litre=0' "zero price refused"
bf DK13 '.litres="abc"' "text litres refused"
bf DK14 '.litres=10000000000' "10 billion litres refused"
bf DK15 '.price_per_litre=20000' "price of 20000 a litre refused"
bf DK16 'del(.price_per_litre)' "litres alone (no price or total) refused"
bf DK17 'del(.litres)|del(.price_per_litre)|.total_amount=3800' "total alone refused"
bf DK18 '.total_amount=5000' "litres x price disagree with the total (40 x 95.5 = 3820 vs 5000)"
bf DK19 ".filled_at=\"$(date -u -d '+1 day' +%FT%TZ)\"" "a fill in the future refused"
bf DK20 ".filled_at=\"$(date -u -d '-8 days' +%FT%TZ)\"" "a fill 8 days old refused for a driver"
bf DK21 '.odometer_km=-5' "negative odometer refused"
bf DK22 '.odometer_km=99999999' "odometer of 99,999,999 refused"
bf DK23 '.payment_mode="crypto"' "unknown payment mode refused"
bf DK24 ".station_name=\"$(printf 'S%.0s' $(seq 1 200))\"" "a 200-character station name refused"
bf DK25 '.is_full_tank="yes"' "full-tank as text refused"
bf DK26 '.bill_path="x"' "a malformed bill path refused"
bf DK27 '.bill_path="expenses/abc/not-uploaded.jpg"' "a bill that was never uploaded refused"
bf DK28 '.fill_latitude=19.3' "latitude without longitude refused"
bf DK29 '.litres=null|.price_per_litre=null|.total_amount=null' "no amounts at all refused"
fl "$base" uat-fuel-1; chk DK30 "log a valid fill-up (40 L at 95.5, odometer 10000)" 201
FL1=$(jb .id); info "fuel log: $(ev 420)"
t DK31 "the total is worked out (3820.00)" "$([ "$(jn .total_amount)" = 3820 ] && echo 1 || echo 0)" "total=$(jb .total_amount)"
t DK32 "an expense for finance was written with the fill" "$([ "$(jb .expense_recorded)" = true ] && [ "$(sql "select count(*) from expenses where vehicle_id='$T1' and category='fuel'")" -ge 1 ] && echo 1 || echo 0)" "expense_recorded=$(jb .expense_recorded) expenses=$(sql "select count(*) from expenses where vehicle_id='$T1' and category='fuel'")"
fl "$base" uat-fuel-1; t DK33 "a replay with the same key returns the same fill, no second row" "$([ "$(jb .id)" = "$FL1" ] && [ "$(sql "select count(*) from vehicle_fuel_logs where vehicle_id='$T1'")" = 1 ] && echo 1 || echo 0)" "id=$(jb .id) rows=$(sql "select count(*) from vehicle_fuel_logs where vehicle_id='$T1'")"
t DK34 "the vehicle's odometer took the driver's first reading (10000)" "$([ "$(sql "select odometer_km from vehicles where id='$T1'" | cut -d. -f1)" = 10000 ] && echo 1 || echo 0)" "odometer=$(sql "select odometer_km from vehicles where id='$T1'")"
fl "$base"; info "the same fill again with a new key: HTTP $ST flags=$(jb '.flags|tostring')"
t DK35 "an identical second fill (same litres, price, odometer, minutes apart) is flagged as a duplicate" "$(has "$BODY" 'duplicate')" "flags=$(jb '.flags|tostring') odometer=$(jb .odometer_km)"
fl "$(echo "$base" | jq -c '.odometer_km=9500|.litres=30')"
info "backwards odometer: HTTP $ST flags=$(jb '.flags|tostring') $(ev 200)"
t DK41 "a backwards odometer is flagged or refused" "$([ "$ST" = 400 ] || [ "$(has "$BODY" 'backwards')" = 1 ] && echo 1 || echo 0)" "HTTP $ST flags=$(jb '.flags|tostring')"
t DK42 "the vehicle's odometer did not go backwards" "$([ "$(sql "select odometer_km from vehicles where id='$T1'" | cut -d. -f1)" -ge 10000 ] && echo 1 || echo 0)" "odometer=$(sql "select odometer_km from vehicles where id='$T1'")"
fl "$(echo "$base" | jq -c '.odometer_km=910000|.litres=35')"; info "a jump of 900,000 km in one fill: HTTP $ST flags=$(jb '.flags|tostring')"
t DK43 "a 900,000 km jump is flagged or refused" "$([ "$ST" = 400 ] || [ -n "$(jb '.flags[]?')" ] && echo 1 || echo 0)" "HTTP $ST flags=$(jb '.flags|tostring')"
t DK44 "...and did not move the vehicle's odometer to 910000" "$([ "$(sql "select odometer_km from vehicles where id='$T1'" | cut -d. -f1)" -lt 900000 ] && echo 1 || echo 0)" "odometer=$(sql "select odometer_km from vehicles where id='$T1'")"
fl '{"litres":25,"total_amount":2400,"odometer_km":10600,"payment_mode":"upi"}'; chk DK45 "litres + total (price worked out) with UPI" 201
t DK46 "price per litre is worked out (96)" "$([ "$(jn .price_per_litre)" = 96 ] && echo 1 || echo 0)" "price=$(jb .price_per_litre)"
fl '{"litres":25,"price_per_litre":90}'; info "a fill with no odometer and no payment mode: HTTP $ST payment=$(jb .payment_mode) odometer=$(jb .odometer_km)"
req driverA GET "/fleet/vehicles/$T1/fuel-logs"; chk DK50 "list the fuel log" 200
t DK51 "newest first" "$([ "$(jb 'map(.filled_at)|. == (sort|reverse)')" = true ] && echo 1 || echo 0)" "first=$(jb '.[0].filled_at') last=$(jb '.[-1].filled_at')"
req driverA PUT "/fleet/fuel-logs/$FL1" '{"litres":1}'; chk DK52 "a driver cannot edit a fuel entry (staff only)" 403
req driverA DELETE "/fleet/fuel-logs/$FL1"; chk DK53 "a driver cannot delete a fuel entry" 403
req driverA GET /fleet/fuel-summary; chk DK54 "a driver cannot read the fleet fuel summary" 403
req driverA GET "/fleet/vehicles/$T1/fuel-stats"; chk DK55 "the driver's own fuel stats" 200
info "fuel stats: $(ev 300)"
req driverA POST "/fleet/vehicles/$T1/fuel-logs/bill-upload" '{"content_type":"image/jpeg","size":200000}'; chk DK56 "a bill upload URL for a JPG" 200
req driverA POST "/fleet/vehicles/$T1/fuel-logs/bill-upload" '{"content_type":"text/html","size":2000}'; chk DK57 "an HTML bill upload refused" 415
req driverA POST "/fleet/vehicles/$T1/fuel-logs/bill-upload" '{"content_type":"image/jpeg","size":900000000}'; chk DK58 "a 900 MB bill refused" 413
req vendor GET "/fleet/vehicles/$T1/fuel-logs"; chk DK59 "a vendor cannot read a truck's fuel log" "403 404"
req customer POST "/fleet/vehicles/$T1/fuel-logs" "$base"; chk DK60 "a customer cannot log fuel" "403 404"

sect "L. Pay"
reset_trucks
req driverA GET /driver/pay; chk DP01 "the driver's pay" 200
info "driver pay keys: $(jb 'keys|join(",")') totals: $(jb '.totals|tostring' | cut -c1-300)"
info "driver pay trips: $(jb '[.trips[]?|{route:.route_id,km,amount,status}]|tostring' | cut -c1-500)"
COMPLETED=$(sql "select count(*) from routes where vehicle_id='$T1' and status='completed'")
ENTRIES=$(sql "select count(*) from driver_pay_entries where driver_id='$DA'")
t DP02 "every trip this driver completed earns a pay entry (completed trips=$COMPLETED, entries=$ENTRIES) (known: UAT-002)" "$([ "$COMPLETED" = "$ENTRIES" ] && echo 1 || echo 0)" "completed=$COMPLETED entries=$ENTRIES entry routes: $(sql "select string_agg(route_id::text||':'||status,',') from driver_pay_entries where driver_id='$DA'")"
t DP03 "the driver's view agrees with the entries on the books" "$([ "$(jb '[.trips[]?]|length')" = "$ENTRIES" ] || [ "$(jb '.entries|length')" = "$ENTRIES" ] && echo 1 || echo 0)" "view rows: trips=$(jb '.trips|length') entries=$(jb '.entries|length')"
req driverA GET /auth/driver/earnings; chk DP04 "earnings summary" 200
info "earnings: $(ev 300)"
req driverA GET /auth/driver/earnings/history; chk DP05 "earnings history" 200
req driverA GET /driver-pay/rates; chk DP06 "a driver cannot read the pay rates" 403
req driverA GET /driver-pay/payouts; chk DP07 "a driver cannot list payouts" 403
req driverA POST /driver-pay/entries/approve "{\"ids\":[\"00000000-0000-0000-0000-000000000000\"]}"; chk DP08 "a driver cannot approve pay" 403
req driverB GET /driver/pay; t DP09 "driver B's pay holds nothing of driver A's" "$([ "$(echo "$BODY" | grep -c "$DA")" = 0 ] && echo 1 || echo 0)" "HTTP $ST"
E1=$(sql "select id from driver_pay_entries where driver_id='$DA' and status='pending' limit 1")
if [ -n "$E1" ]; then
  req superadmin POST /driver-pay/entries/approve "{\"ids\":[\"$E1\"]}"; info "approve entry: HTTP $ST"
  req superadmin POST /driver-pay/payouts "{\"driver_id\":\"$DA\",\"entry_ids\":[\"$E1\"],\"method\":\"upi\",\"reference\":\"UAT-DRV-PAY\"}"; info "payout: HTTP $ST"
  req driverA GET /driver/pay; t DP10 "after payout the driver sees the entry paid and the totals move" "$([ "$(echo "$BODY" | grep -c 'UAT-DRV-PAY\|paid')" -ge 1 ] && echo 1 || echo 0)" "$(jb '.totals|tostring' | cut -c1-300)"
else info "no pending pay entry for driver A to approve"; fi
req driverA GET "/people/me"; chk DP11 "the driver's own profile" 200
req driverA GET /notifications; chk DP12 "the driver's notifications" 200
info "driver notification titles: $(jb '[.notifications[]|.title]|unique|join(" | ")' | cut -c1-600)"
t DP13 "driver notifications use the shared vocabulary" "$(lacks "$BODY" '[Cc]onsignment|[Mm]anifest|[Rr]oute |[Ee]xception|[Ii]ncident|[Bb]ackhaul|[Tt]ransshipment')" "hits: $(printf '%s' "$BODY" | grep -oiE 'consignment|manifest|route |exception|incident|backhaul|transshipment' | sort | uniq -c | tr '\n' ' ')"
req driverA POST /cargo/driver/rejected-action '{"action":"complete_stop","error":"Delivery code wrong","payload_summary":"stop 3"}'; chk DP14 "the offline queue reports a refused action" 201
req driverA POST /cargo/driver/rejected-action '{"action":"complete_stop"}'; chk DP15 "a report with no error text is refused" 400
req driverA POST /cargo/driver/rejected-action "{\"action\":\"x\",\"error\":\"$(printf 'E%.0s' $(seq 1 600))\"}"; chk DP16 "a 600-character error text is refused" 400
req customer POST /cargo/driver/rejected-action '{"action":"x","error":"y"}'; chk DP17 "a customer cannot report as a driver" 403

sect "M. Trip chat"
clear_routes
req driverA POST /messages "{\"route_id\":\"$R3\",\"body\":\"पहुँच गया\"}"; info "driver writes on trip 3 (cancelled by clear_routes): HTTP $ST $(ev 160)"
mkbk 4 4; BK4=$BK; L41=${LOTS[0]}; L42=${LOTS[1]}; assign_lot "$L41" "$T1"; assign_lot "$L42" "$T1"; R4=$(route_of "$L41"); send_route "$R4"
req driverA POST /messages "{\"route_id\":\"$R4\",\"body\":\"पहुँच गया, गेट पर हूँ\"}"; chk DM01 "driver writes to dispatch in Hindi" 201
req driverA POST /messages "{\"route_id\":\"$R4\",\"body\":\"\"}"; chk DM02 "an empty message refused" 400
req driverA POST /messages "{\"route_id\":\"$R4\",\"body\":\"$(printf 'M%.0s' $(seq 1 3000))\"}"; chk DM03 "a 3000-character message refused" 400
req superadmin POST /messages "{\"route_id\":\"$R4\",\"body\":\"Wait at gate 2\"}"; chk DM04 "dispatch replies" 201
req driverA GET "/messages?route_id=$R4"; t DM05 "the driver reads both messages, Hindi intact" "$([ "$(jb '.messages|length')" = 2 ] && [ "$(jb '.messages[0].body')" = "पहुँच गया, गेट पर हूँ" ] && echo 1 || echo 0)" "$(ev 300)"
req driverA GET /messages/unread; chk DM06 "unread count" 200
req driverA POST /messages/read "{\"route_id\":\"$R4\"}"; chk DM07 "mark read" 200
req driverB GET "/messages?route_id=$R4"; chk DM08 "the other driver cannot read this chat" "403 404"
req customer GET "/messages?route_id=$R4"; chk DM09 "a customer cannot read the driver chat" "403 404"
req driverA POST /messages "{\"route_id\":\"$R4\",\"body\":\"x\",\"shipment_id\":\"$LA\"}"; info "driver posts with a foreign shipment_id as well: HTTP $ST"

sect "N. Return trip (driver B, truck 2)"
reset_trucks
sql "update vehicles set latitude=28.6,longitude=77.2,current_location_name='Delhi' where id='$T2'" >/dev/null
rw() { req driverB POST /capacity/driver/open-backhaul-window "$1"; }
rw "{\"vehicle_id\":\"$T2\",\"available_capacity_kg\":0,\"trigger_type\":\"return_trip\"}"; t DR01 "free space 0 refused" "$([ "$ST" = 400 ] && echo 1 || echo 0)" "HTTP $ST $(ev 140)"
rw "{\"vehicle_id\":\"$T2\",\"available_capacity_kg\":99999,\"trigger_type\":\"return_trip\"}"; t DR02 "free space above the truck's capacity refused" "$([ "$ST" = 400 ] && echo 1 || echo 0)" "HTTP $ST $(ev 140)"
rw "{\"vehicle_id\":\"$T2\",\"available_capacity_kg\":-5,\"trigger_type\":\"return_trip\"}"; t DR03 "negative free space refused" "$([ "$ST" = 400 ] && echo 1 || echo 0)" "HTTP $ST $(ev 140)"
rw "{\"vehicle_id\":\"$T2\",\"available_capacity_kg\":3000,\"trigger_type\":\"superadmin_dispatch\"}"; t DR04 "a driver cannot open a dispatch window" "$([ "$ST" = 400 ] || [ "$ST" = 403 ] && echo 1 || echo 0)" "HTTP $ST $(ev 140)"
rw "{\"vehicle_id\":\"$T2\",\"available_capacity_kg\":3000}"; t DR05 "missing trigger refused" "$([ "$ST" = 400 ] && echo 1 || echo 0)" "HTTP $ST $(ev 140)"
rw "{\"vehicle_id\":\"$T2\",\"available_capacity_kg\":3000,\"trigger_type\":\"return_trip\",\"floor_price\":1}"; t DR06 "the driver opens a return trip (3000 kg free); a floor price from a driver is ignored" "$([ "$ST" = 200 ] && echo 1 || echo 0)" "HTTP $ST $(ev 300)"
WIN=$(jb .id)
rw "{\"vehicle_id\":\"$T2\",\"available_capacity_kg\":3000,\"trigger_type\":\"return_trip\"}"; t DR07 "opening a second one while one is open is refused (409)" "$([ "$ST" = 409 ] || [ "$ST" = 400 ] && echo 1 || echo 0)" "HTTP $ST $(ev 160)"
req driverA POST /capacity/driver/open-backhaul-window "{\"vehicle_id\":\"$T2\",\"available_capacity_kg\":1000,\"trigger_type\":\"return_trip\"}"; chk DR08 "driver A cannot open a return trip on driver B's truck" 403
req driverB GET "/capacity/windows/$WIN/bid-count"; chk DR09 "the driver sees how many bids" 200
info "bid count: $(ev 100)"
req driverB POST /capacity/driver/toggle-matching "{\"vehicle_id\":\"$T2\",\"enabled\":false}"; chk DR10 "the driver switches matching off" 200
req driverB POST /capacity/driver/toggle-matching "{\"vehicle_id\":\"$T2\",\"enabled\":true}"; chk DR11 "and on again" 200
req driverB GET /capacity/bids/mine; chk DR12 "a driver cannot read a vendor's bids" 403
req driverB POST /capacity/bids "{\"window_id\":\"$WIN\",\"bid_amount\":9000,\"weight_kg\":100}"; chk DR13 "a driver cannot bid" 403
req driverB POST "/capacity/bids/$(uid vendor)/approve" '{}'; chk DR14 "a driver cannot award a bid" 403
req vendor POST /capacity/bids "{\"window_id\":\"$WIN\",\"bid_amount\":1,\"weight_kg\":500,\"dropoff_name\":\"Gurgaon\",\"dropoff_address\":\"Sector 18, Gurgaon\",\"dropoff_lat\":28.47,\"dropoff_lng\":77.03}"; t DR15 "a 1-rupee bid on a driver-opened window (no staff minimum) is refused by the price engine" "$([ "$ST" = 400 ] && echo 1 || echo 0)" "HTTP $ST $(ev 200)"

sect "O. Web: the driver page"
ui driverA /driver
ui driverA /driver --width 390
ui driverA /today
ui driverB /driver/dashboard
sect "End"
