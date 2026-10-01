#!/usr/bin/env bash
# UAT scenario: the customer (booking, tracking, receipt, claims, invoices, notifications, account).
# Runs after the 75-step story on the throwaway stack. Prints CHECK lines; read e2e/out/scenario.txt.
set -u
source "$(dirname "$0")/lib.sh"
CUST=$(uid customer); CUST2=$(uid customer2)
T1=$(vehicle_id MH04E2E0001); T2=$(vehicle_id MH04E2E0002)
STORY_BK=$(sql "select id from customer_bookings where customer_id='$CUST' order by created_at limit 1")
STORY_TRK=$(sql "select tracking_id from customer_bookings where id='$STORY_BK'")
STORY_MASTER=$(sql "select shipment_id from customer_bookings where id='$STORY_BK'")
info "customer=$CUST customer2=$CUST2 story booking=$STORY_BK tracking=$STORY_TRK"
reset_trucks
q() { jq -nc --arg d "$TODAY" '{pickup_lat:19.30,pickup_lng:73.06,drop_lat:25.61,drop_lng:85.14,weight_kg:1000,load_type:"full",date:$d}'; }

sect "A. Quote"
req customer POST /customer/quote "$(q)"; chk CQ01 "quote for a valid trip" 200
QT=$BODY
t CQ02 "quote has low <= suggested <= high and a sane distance" "$(echo "$QT" | jq -r '(.low<=.suggested and .suggested<=.high and .distance_km>1000 and .distance_km<2400)' 2>/dev/null | grep -q true && echo 1 || echo 0)" "$(echo "$QT" | jq -c '{available,low,suggested,high,distance_km,source,factors:(.factors|length)}' 2>/dev/null)"
req anon POST /customer/quote "$(q)"; chk CQ03 "quote without sign-in is refused" "401"
req driverA POST /customer/quote "$(q)"; chk CQ04 "a driver cannot use the customer quote" "403"
req vendor POST /customer/quote "$(q)"; chk CQ05 "a vendor cannot use the customer quote" "403"
req customer POST /customer/quote "$(q)" --token garbage.token.value; chk CQ06 "a garbage token is refused" "401"
n=7
bq() { req customer POST /customer/quote "$(q | jq -c "$2")"; chk "CQ$(printf '%02d' $n)" "$1" 400; n=$((n+1)); }
bq "weight 0 refused" '.weight_kg=0'
bq "negative weight refused" '.weight_kg=-5'
bq "weight as text refused" '.weight_kg="abc"'
bq "weight over 100000 kg refused" '.weight_kg=100001'
bq "weight null refused" '.weight_kg=null'
bq "missing weight refused" 'del(.weight_kg)'
bq "latitude 91 refused" '.pickup_lat=91'
bq "longitude 181 refused" '.drop_lng=181'
bq "latitude as text refused" '.drop_lat="north"'
bq "unknown load type refused" '.load_type="half"'
bq "past date refused" ".date=\"$PAST\""
bq "date in the wrong format refused" '.date="31-12-2026"'
bq "impossible date 2026-02-30 refused" '.date="2026-02-30"'
bq "missing date refused" 'del(.date)'
bq "5000-character vehicle type refused" ".vehicle_type=\"$(printf 'V%.0s' $(seq 1 5000))\""
bq "pickup and drop at the same point refused (a 0 km quote is meaningless)" '.drop_lat=.pickup_lat | .drop_lng=.pickup_lng'
req customer POST /customer/quote "$(q | jq -c ".date=\"$FAR\"")"; info "quote for a date 120 days out: HTTP $ST (booking allows at most 90 days) $(ev 120)"
req customer POST /customer/quote "$(q | jq -c '.weight_kg=0.0001')"; info "quote for 0.0001 kg: HTTP $ST $(ev 160)"
req customer POST /customer/quote '{bad json'; chk CQ30 "malformed JSON is a 400, not a 500" "400"
req customer POST /customer/quote ''; chk CQ31 "empty body is a 400" "400"

sect "B. Booking: single drop, Hindi text, hostile fields"
HIN=$(single | jq -c '.pickup_name="भिवंडी गोदाम" | .pickup_address="भिवंडी, ठाणे, महाराष्ट्र" | .drop_name="शर्मा ट्रेडर्स" | .drop_address="गांधी मैदान, पटना, बिहार" | .quoted_price=1 | .status="delivered" | .customer_id="'"$CUST2"'" | .shipment_id="00000000-0000-0000-0000-000000000001"')
req customer POST /customer/bookings "$HIN"; chk CB01 "book a single drop with Hindi names (and hostile extra fields)" 201
B1=$(jb .id); info "B1=$B1 $(ev 300)"
t CB02 "extra fields are ignored: status requested, owned by the caller, price from the quote" "$([ "$(jb .status)" = requested ] && [ "$(jb .customer_id)" = "$CUST" ] && [ "$(jb .quoted_price)" != 1 ] && echo 1 || echo 0)" "status=$(jb .status) customer=$(jb .customer_id) price=$(jb .quoted_price) shipment_id=$(jb .shipment_id)"
req customer GET "/customer/bookings/$B1"; chk CB03 "open the booking" 200
t CB04 "Hindi names come back unchanged" "$([ "$(jb .booking.drop_name)" = "शर्मा ट्रेडर्स" ] && [ "$(jb .booking.pickup_address)" = "भिवंडी, ठाणे, महाराष्ट्र" ] && echo 1 || echo 0)" "drop_name=$(jb .booking.drop_name) pickup_address=$(jb .booking.pickup_address)"
t CB05 "an unconfirmed booking has no tracking id and no tracking block" "$([ "$(jb .booking.tracking_id)" = null ] && [ "$(jb .tracking)" = null ] && echo 1 || echo 0)" "tracking_id=$(jb .booking.tracking_id) tracking=$(jb .tracking)"
info "booking detail keys: $(jb '.booking|keys|join(",")')"
req customer GET "/customer/bookings/$B1/cargo"; info "cargo view of an unconfirmed booking: HTTP $ST $(ev 160)"
t CB06 "the cargo view of an unconfirmed booking says so (409), not 500" "$([ "$ST" = 409 ] && echo 1 || echo 0)" "HTTP $ST"

bb() { req customer POST /customer/bookings "$(single | jq -c "$3")"; chk "$1" "$2" 400; }
bb CB10 "missing drop name refused" 'del(.drop_name)'
bb CB11 "blank (spaces) drop name refused" '.drop_name="   "'
bb CB12 "missing pickup address refused" 'del(.pickup_address)'
bb CB13 "5000-character pickup name refused" ".pickup_name=\"$(printf 'N%.0s' $(seq 1 5000))\""
bb CB14 "5000-character drop address refused" ".drop_address=\"$(printf 'A%.0s' $(seq 1 5000))\""
bb CB15 "zero weight refused" '.weight_kg=0'
bb CB16 "negative weight refused" '.weight_kg=-10'
bb CB17 "latitude out of range refused" '.drop_lat=200'
BADDATE=""; for k in 1 2 3; do m=$(TZ=Asia/Kolkata date -d "$(date +%Y-%m-01) +$k month" +%Y-%m); last=$(date -d "$m-01 +1 month -1 day" +%d); [ "$last" -lt 31 ] && { BADDATE="$m-31"; break; }; done
req customer POST /customer/bookings "$(single "$BADDATE")"; chk CB18 "an impossible pickup date ($BADDATE) is refused, not a 500 or a booking" 400
req customer POST /customer/bookings "$(single "$FAR")"; chk CB19 "a pickup date 120 days out is refused" 400
req customer POST /customer/bookings "$(multi 5 | jq -c 'del(.drops[1])')"; chk CB20 "multi-drop with one drop refused" 400
bm() { req customer POST /customer/bookings "$(multi 3 2 | jq -c "$2")"; chk "$1" "$3" 400; }
bm CB21 '.drops[1]|=del(.consignee_name)' "a drop with no consignee refused"
bm CB22 '.drops[0].pieces=0' "a drop with 0 pieces refused"
bm CB23 '.drops[0].pieces=1.5' "a drop with 1.5 pieces refused"
bm CB24 '.drops[0].weight_kg=400' "weights given for only one drop refused"
bm CB25 '.drops[0].weight_kg=100 | .drops[1].weight_kg=100' "drop weights that do not add to the booking weight refused"
bm CB26 '.drops[1]|=del(.address)' "a drop with no address refused"
req customer POST /customer/bookings "$(multi $(for i in $(seq 1 21); do printf '1 '; done))"; chk CB27 "21 drops refused (limit 20)" 400

sect "C. Double submit"
KEY="uat-dup-$(date +%s)"
req customer POST /customer/bookings "$(single)" --idem "$KEY"; D1=$(jb .id); chk CD01 "first submit with an Idempotency-Key" 201
req customer POST /customer/bookings "$(single)" --idem "$KEY"; D1B=$(jb .id); info "second submit, same key: HTTP $ST id=$D1B"
t CD02 "the same Idempotency-Key gives back the same booking (a retry after a lost reply must not book twice)" "$([ -n "$D1" ] && [ "$D1" = "$D1B" ] && echo 1 || echo 0)" "first=$D1 second=$D1B"
t CD03 "only one booking exists for that key" "$([ "$(sql "select count(*) from customer_bookings where customer_id='$CUST' and created_at > now() - interval '1 minute' and pickup_date='$TODAY' and pickup_name='Bhiwandi warehouse' and status='requested'")" = 1 ] && echo 1 || echo 0)" "rows=$(sql "select count(*) from customer_bookings where customer_id='$CUST' and created_at > now() - interval '1 minute' and pickup_name='Bhiwandi warehouse' and status='requested'")"
req customer POST /customer/bookings "$(single)" --idem "uat-diff-a-$(date +%s)"; E2=$(jb .id); chk CD04 "different key, first booking" 201
req customer POST /customer/bookings "$(single)" --idem "uat-diff-b-$(date +%s)"; E3=$(jb .id); chk CD05 "different key, second booking" 201
t CD06 "different keys give two separate bookings" "$([ -n "$E2" ] && [ "$E2" != "$E3" ] && [ "$E3" != null ] && echo 1 || echo 0)" "E2=$E2 E3=$E3"

sect "D. List and detail"
req customer GET /customer/bookings; chk CL01 "list my bookings" 200
t CL02 "the list holds the new bookings and the story booking, newest first" "$([ "$(jb 'map(.id)|index("'"$B1"'")!=null and index("'"$STORY_BK"'")!=null')" = true ] && echo 1 || echo 0)" "count=$(jb length) first=$(jb '.[0].id')"
t CL03 "list rows carry shipment_status and rated" "$([ "$(jb '.[0]|has("shipment_status") and has("rated")')" = true ] && echo 1 || echo 0)" "keys=$(jb '.[0]|keys|join(",")')"
req customer2 GET /customer/bookings; t CL04 "the other customer's list is empty of mine" "$([ "$ST" = 200 ] && [ "$(jb '[.[]|select(.customer_id=="'"$CUST"'")]|length')" = 0 ] && echo 1 || echo 0)" "customer2 sees $(jb length) bookings"
req customer2 GET "/customer/bookings/$B1"; chk CL05 "customer2 cannot open my booking" 404
req customer2 GET "/customer/bookings/$B1/cargo"; chk CL06 "customer2 cannot open my booking's cargo view" 404
req customer2 POST "/customer/bookings/$B1/cancel" '{}'; chk CL07 "customer2 cannot cancel my booking" 404
req customer2 POST "/customer/bookings/$B1/confirm-receipt" '{"rating":5}'; chk CL08 "customer2 cannot rate my booking" 404
req customer GET /customer/bookings/not-a-uuid; chk CL09 "a booking id that is not a uuid is a 404" 404
req customer GET /customer/bookings/00000000-0000-0000-0000-000000000000; chk CL10 "an unknown booking id is a 404" 404
req customer2 GET "/customer/bookings/$STORY_BK"; chk CL11 "customer2 cannot open the story booking" 404
req customer2 GET "/cargo/where/$STORY_MASTER"; info "customer2 /cargo/where/<master id>: HTTP $ST $(ev 200)"
t CL12 "customer2 cannot read where my goods are through /cargo/where" "$([ "$ST" = 403 ] || [ "$ST" = 404 ] && echo 1 || echo 0)" "HTTP $ST"
req customer2 GET "/cargo/timeline/$STORY_TRK"; t CL13 "customer2 cannot read my goods' timeline by tracking id" "$([ "$ST" = 403 ] || [ "$ST" = 404 ] && echo 1 || echo 0)" "HTTP $ST $(ev 160)"
LOT_A=$(lots_of "$STORY_MASTER" | head -1)
req customer2 GET "/cargo/where/$LOT_A"; t CL14 "customer2 cannot read a lot of my goods" "$([ "$ST" = 403 ] || [ "$ST" = 404 ] && echo 1 || echo 0)" "HTTP $ST $(ev 160)"
req customer2 GET "/cargo/lots/$STORY_MASTER"; t CL15 "customer2 cannot read my lots" "$([ "$ST" = 403 ] || [ "$ST" = 404 ] && echo 1 || echo 0)" "HTTP $ST $(ev 160)"
req customer2 GET /bookings; chk CL16 "a customer cannot use the staff booking list" 403
req customer2 POST "/bookings/$B1/confirm" '{"price":1}'; chk CL17 "a customer cannot confirm a booking" 403
req customer2 GET /shipments; chk CL18 "a customer cannot list shipments" 403
req customer2 GET /finance/invoices; chk CL19 "a customer cannot read finance invoices" 403
req customer2 GET /ops/today; chk CL20 "a customer cannot read Today" 403
req customer2 GET /vehicles; t CL21 "a customer cannot list the fleet" "$([ "$ST" = 403 ] && echo 1 || echo 0)" "HTTP $ST $(ev 120)"
req customer2 GET /routes; t CL22 "a customer cannot list trips" "$([ "$ST" = 403 ] && echo 1 || echo 0)" "HTTP $ST $(ev 120)"
req customer2 GET /driver-pay/entries; chk CL23 "a customer cannot read driver pay" 403
req customer2 GET /people; t CL24 "a customer cannot list people" "$([ "$ST" = 403 ] && echo 1 || echo 0)" "HTTP $ST $(ev 120)"
req customer2 GET "/telemetry/$T1/live"; t CL25 "a customer cannot read a vehicle's live position" "$([ "$ST" = 403 ] || [ "$ST" = 404 ] && echo 1 || echo 0)" "HTTP $ST $(ev 120)"
req customer2 GET "/fleet/vehicles/$T1/fuel-logs"; t CL26 "a customer cannot read a vehicle's fuel log" "$([ "$ST" = 403 ] && echo 1 || echo 0)" "HTTP $ST"
req customer2 GET /vendor/loads; chk CL27 "a customer cannot read vendor loads" 403
req customer2 GET /cargo/exceptions; chk CL28 "a customer cannot read cases" 403
req customer2 GET /tpl/queue; chk CL29 "a customer cannot read the 3PL queue" 403
req customer2 GET /analytics/overview; t CL30 "a customer cannot read analytics" "$([ "$ST" = 403 ] || [ "$ST" = 404 ] && echo 1 || echo 0)" "HTTP $ST"

sect "E. Cancel at each stage"
# requested: D1 (customer), with a Hindi reason and a too-long reason first
req customer POST "/customer/bookings/$D1/cancel" "{\"reason\":\"$(printf 'R%.0s' $(seq 1 600))\"}"; chk CX01 "a 600-character cancel reason is refused" 400
req customer POST "/customer/bookings/$D1/cancel" '{"reason":"योजना बदल गई"}'; chk CX02 "cancel at 'requested' with a Hindi reason" 200
t CX03 "booking is cancelled, by the customer, with the reason kept" "$([ "$(jb .status)" = cancelled ] && [ "$(jb .cancelled_by)" = customer ] && [ "$(jb .cancel_reason)" = "योजना बदल गई" ] && echo 1 || echo 0)" "$(ev 200)"
req customer POST "/customer/bookings/$D1/cancel" '{}'; chk CX04 "cancelling again is a 409" 409
req superadmin POST "/bookings/$D1/confirm" '{"price":100}'; chk CX05 "staff cannot confirm a cancelled booking" 409
# confirmed: B1
confirm_booking "$B1"; chk CX10 "staff confirm B1 (single drop)" 200
B1_SH=$MASTER; B1_TRK=$(sql "select tracking_id from customer_bookings where id='$B1'")
info "B1 shipment=$B1_SH tracking=$B1_TRK"
req customer POST "/customer/bookings/$B1/cancel" '{"reason":"changed my mind"}'; chk CX11 "cancel at 'confirmed'" 200
t CX12 "the shipment is cancelled with its booking" "$([ "$(sstatus "$B1_SH")" = cancelled ] && echo 1 || echo 0)" "shipment=$(sstatus "$B1_SH")"
info "B1 shipment log statuses: $(sql "select string_agg(status,',' order by timestamp) from shipment_logs where shipment_id='$B1_SH'")"
req anon GET "/shipments/track/$B1_TRK"; t CX13 "public tracking of a cancelled booking says cancelled" "$([ "$ST" = 200 ] && [ "$(jb .status)" = cancelled ] && echo 1 || echo 0)" "HTTP $ST status=$(jb .status)"
req superadmin POST "/bookings/$B1/confirm" '{}'; chk CX14 "a cancelled booking cannot be confirmed again" 409
req customer GET "/customer/bookings/$B1"; t CX15 "booking detail after cancel: cancelled, tracking shows cancelled" "$([ "$(jb .booking.status)" = cancelled ] && echo 1 || echo 0)" "status=$(jb .booking.status) shipment_status=$(jb .booking.shipment_status) tracking.status=$(jb .tracking.status)"
# staff cancel with a reason: E3
confirm_booking "$E3"; E3_SH=$MASTER
req superadmin POST "/bookings/$E3/cancel" '{"reason":"No truck on this lane"}'; chk CX20 "staff cancel a confirmed booking with a reason" 200
req customer GET "/customer/bookings/$E3"; t CX21 "the customer sees who cancelled and why" "$([ "$(jb .booking.cancelled_by)" = staff ] && [ "$(jb .booking.cancel_reason)" = "No truck on this lane" ] && echo 1 || echo 0)" "by=$(jb .booking.cancelled_by) reason=$(jb .booking.cancel_reason)"
req superadmin POST "/bookings/$E3/cancel" '{}'; t CX22 "staff cancel without a reason is refused or asks for one" "$([ "$ST" = 400 ] || [ "$ST" = 409 ] && echo 1 || echo 0)" "HTTP $ST $(ev 120)"
# assigned: E2 (route pending), then customer cancels
confirm_booking "$E2"; E2_SH=$MASTER; E2_TRK=$(sql "select tracking_id from customer_bookings where id='$E2'")
assign_lot "$E2_SH" "$T1"; chk CX30 "assign E2 to truck 1 without sending" 200
E2_ROUTE=$(route_of "$E2_SH"); info "E2 route=$E2_ROUTE status=$(sql "select status from routes where id='$E2_ROUTE'") booking=$(sql "select status from customer_bookings where id='$E2'")"
req customer POST "/customer/bookings/$E2/cancel" '{"reason":"found another carrier"}'; chk CX31 "cancel at 'assigned'" 200
t CX32 "shipment cancelled, its pending trip cancelled, the truck free" "$([ "$(sstatus "$E2_SH")" = cancelled ] && [ "$(sql "select status from routes where id='$E2_ROUTE'")" = cancelled ] && [ "$(sql "select status from vehicles where id='$T1'")" = available ] && echo 1 || echo 0)" "shipment=$(sstatus "$E2_SH") route=$(sql "select status from routes where id='$E2_ROUTE'") truck=$(sql "select status from vehicles where id='$T1'") stop=$(sql "select string_agg(status,',') from route_stops where route_id='$E2_ROUTE'")"
req driverA GET /telemetry/driver-ping/my-route; t CX33 "the driver's trip view no longer shows the cancelled trip" "$([ "$(echo "$BODY" | grep -c "$E2_ROUTE")" = 0 ] && echo 1 || echo 0)" "HTTP $ST $(ev 200)"
# delivered: the story booking
req customer POST "/customer/bookings/$STORY_BK/cancel" '{}'; chk CX40 "cancel a delivered booking is refused" 409
t CX41 "the refusal says it was picked up, in words a customer understands" "$(has "$BODY" 'picked up|delivered')" "$(ev 160)"

sect "F. Full trip: multi-drop with Hindi names, pickup, in transit, delivery"
MB=$(multi 3 2 | jq -c '.drops[0].name="शर्मा ट्रेडर्स" | .drops[0].address="गांधी मैदान, पटना" | .drops[0].consignee_name="श्याम शर्मा" | .drops[1].name="गुप्ता स्टोर्स" | .drops[1].consignee_name="राम गुप्ता"')
req customer POST /customer/bookings "$MB"; chk CF01 "book a two-drop shipment (3 and 2 pieces) with Hindi consignees" 201
B2=$(jb .id); info "B2=$B2 drops=$(jb '.drops|length') $(ev 120)"
req customer GET "/customer/bookings/$B2"; t CF02 "multi-drop: the booking keeps both drops with their consignees" "$([ "$(jb '.booking.drops|length')" = 2 ] && [ "$(jb '.booking.drops[0].consignee_name')" = "श्याम शर्मा" ] && echo 1 || echo 0)" "drops=$(jb '.booking.drops|length')"
confirm_booking "$B2" 12000; chk CF03 "staff confirm the multi-drop booking" 200
B2_M=$MASTER; B2_TRK=$(sql "select tracking_id from customer_bookings where id='$B2'")
L1=$(lots_of "$B2_M" | sed -n 1p); L2=$(lots_of "$B2_M" | sed -n 2p)
info "B2 master=$B2_M lots=$L1,$L2 master tracking=$B2_TRK lot trackings=$(sql "select string_agg(tracking_id,',') from shipments where parent_shipment_id='$B2_M'")"
req customer GET "/customer/bookings/$B2/cargo"; chk CF04 "cargo view at 'confirmed'" 200
info "cargo view (confirmed): keys=$(jb 'keys|join(",")') lots=$(jb '.lots|length') timeline=$(jb '.timeline|length') where=$(jb '.where|tostring' | cut -c1-200)"
req customer POST "/customer/bookings/$B2/confirm-receipt" '{"rating":5}'; chk CF05 "rating before delivery is refused (409)" 409
assign_lot "$L1" "$T1"; chk CF06 "assign lot 1 to truck 1" 200
assign_lot "$L2" "$T1"; chk CF07 "assign lot 2 to truck 1" 200
R2=$(route_of "$L1"); info "B2 route=$R2 booking=$(sql "select status from customer_bookings where id='$B2'")"
req customer GET "/customer/bookings/$B2"; info "booking at assigned: status=$(jb .booking.status) vehicle=$(jb .booking.vehicle_id) tracking.vehicle=$(jb '.tracking.vehicle|tostring'|cut -c1-160)"
send_route "$R2"; chk CF08 "send the trip" 200
req driverA POST /telemetry/driver-ping/accept-route "{\"route_id\":\"$R2\"}"; chk CF09 "driver accepts" 200
pickup driverA "$L1" 3; chk CF10 "driver picks up lot 1 (3 pieces)" "200 201"
pickup driverA "$L2" 2; chk CF11 "driver picks up lot 2 (2 pieces)" "200 201"
req driverA POST /telemetry/driver-ping/start-route "{\"route_id\":\"$R2\"}"; chk CF12 "driver departs" 200
req customer GET "/customer/bookings/$B2"; t CF13 "booking is in transit" "$([ "$(jb .booking.status)" = in_transit ] && echo 1 || echo 0)" "status=$(jb .booking.status)"
req customer POST "/customer/bookings/$B2/cancel" '{}'; chk CF14 "cancel after pickup is refused" 409
req superadmin POST "/bookings/$B2/cancel" '{"reason":"test"}'; t CF15 "staff cancel after pickup is refused too" "$([ "$ST" = 409 ] && echo 1 || echo 0)" "HTTP $ST $(ev 160)"
req customer GET "/customer/bookings/$B2/cargo"; chk CF16 "cargo view in transit" 200
info "cargo view (in transit): where=$(jb '.where|tostring'|cut -c1-300)"
info "cargo view timeline texts: $(jb '[.timeline[]|(.text // .title // .kind)]|join(" | ")' | cut -c1-500)"
t CF17 "the customer's cargo view shows no driver phone, plate id or internal notes" "$(lacks "$BODY" 'driver_phone|staff_note|otp_hash')" "matches=$(printf '%s' "$BODY" | grep -oiE '.{50}("phone"|driver_phone|staff_note|otp_hash).{40}' | head -3 | tr '\n' ' ')"
req customer GET "/customer/bookings/$B2"; info "booking detail in transit: tracking keys=$(jb '.tracking|keys|join(",")')"
S1=$(stop_of "$L1"); S2=$(stop_of "$L2")
complete_stop driverA "$S1"; chk CF20 "driver delivers lot 1" 200
req customer GET "/customer/bookings/$B2"; t CF21 "booking still in transit while lot 2 is on the truck" "$([ "$(jb .booking.status)" = in_transit ] && echo 1 || echo 0)" "status=$(jb .booking.status)"
complete_stop driverA "$S2"; chk CF22 "driver delivers lot 2" 200
sleep 2
req customer GET "/customer/bookings/$B2"; t CF23 "booking is delivered" "$([ "$(jb .booking.status)" = delivered ] && echo 1 || echo 0)" "status=$(jb .booking.status) shipment_status=$(jb .booking.shipment_status)"
req customer GET "/customer/bookings/$B2/cargo"; chk CF24 "cargo view after delivery" 200
t CF25 "each lot shows its proof of delivery" "$([ "$(jb '[.lots[]|select(.pod!=null)]|length')" = 2 ] && echo 1 || echo 0)" "lots=$(jb '.lots|length') with pod=$(jb '[.lots[]|select(.pod!=null)]|length') pod[0]=$(jb '.lots[0].pod|tostring'|cut -c1-200)"
t CF26 "lots show the consignee name as typed (Hindi)" "$([ "$(jb '.lots[0].consignee.name')" = "श्याम शर्मा" ] && echo 1 || echo 0)" "consignee=$(jb '.lots[0].consignee.name')"

sect "G. Public tracking as anyone (no sign-in)"
trk() { req anon GET "/shipments/track/$1"; }
trk "$B2_TRK"; chk CT01 "public tracking of the delivered multi-drop shipment" 200
info "public tracking paths: $(printf '%s' "$BODY" | jq -r '[paths(scalars)|map(tostring)|join(".")]|map(gsub("\\.[0-9]+\\.";".#."))|unique|join(" ")' 2>/dev/null | cut -c1-1500)"
BAD=$(printf '%s' "$BODY" | jq -r '[paths(scalars)|map(tostring)|join(".")]|map(select(test("phone|otp|hash|email|customer|consignee|freight|price|amount|driver|metadata|signature|gstin|declared|invoice|rating";"i")))|unique|join(", ")' 2>/dev/null)
t CT02 "public tracking carries no contact, money, rating or OTP fields" "$([ -z "$BAD" ] && echo 1 || echo 0)" "sensitive-looking keys: ${BAD:-none}"
t CT03 "public tracking does not show the proof-of-delivery photo or signature links" "$(lacks "$BODY" 'photo|signature|supabase|signed_url|token=')" "$(printf '%s' "$BODY" | grep -oiE '[a-z_]*(photo|signature|signed_url|token)[a-z_]*' | sort -u | tr '\n' ' ')"
t CT04 "public tracking shows the status and a history" "$([ "$(jb .status)" != null ] && [ "$(jb '.history|length')" -gt 0 ] 2>/dev/null && echo 1 || echo 0)" "status=$(jb .status) history=$(jb '.history|length')"
info "history texts: $(jb '[.history[]|(.description // .text // .status)]|join(" | ")' | cut -c1-500)"
for LT in $(sql "select tracking_id from shipments where parent_shipment_id='$B2_M'"); do trk "$LT"; info "lot tracking $LT: HTTP $ST status=$(jb .status) destination=$(jb '.destination.name') consignee-ish=$(printf '%s' "$BODY" | grep -oiE 'consignee[a-z_]*' | head -1)"; done
trk RTX-ZZZZZZZZ; chk CT05 "an unknown tracking id is a 404" 404
trk "$(echo "$B2_TRK" | tr 'A-Z' 'a-z')"; info "lower-case tracking id: HTTP $ST"
trk "RTX-1'; DROP TABLE shipments;--"; t CT06 "an injection-looking tracking id is a clean 404/400" "$([ "$ST" = 404 ] || [ "$ST" = 400 ] && echo 1 || echo 0)" "HTTP $ST $(ev 120)"
trk "$(printf 'X%.0s' $(seq 1 400))"; t CT07 "a 400-character tracking id is a clean 404/400" "$([ "$ST" = 404 ] || [ "$ST" = 400 ] && echo 1 || echo 0)" "HTTP $ST"
trk "CM-ZZZZZZZZ"; chk CT08 "an unknown CM- (vendor load) id is a 404" 404
req anon GET "/shipments/track/$B2_TRK/route"; info "public route line for a delivered shipment: HTTP $ST $(ev 160)"
RL=0; for i in $(seq 1 70); do req anon GET /shipments/track/RTX-NOPE0000; [ "$ST" = 429 ] && RL=$((RL+1)); done
t CT09 "public tracking is rate limited (429 after 60 a minute)" "$([ "$RL" -gt 0 ] && echo 1 || echo 0)" "429s in 70 calls: $RL"
info "tracking id is RTX- plus 8 hex of the booking id (32 bits): ids look like $B2_TRK, $E2_TRK"
info "tracking id of a single drop is RTX- plus the first 8 hex of its booking id: booking=$B1 tracking=$B1_TRK"

sect "H. Receipt and rating"
req superadmin GET "/customer/bookings/$B2"; info "staff on the customer endpoint: HTTP $ST"
req customer2 POST "/customer/bookings/$B2/confirm-receipt" '{"rating":5}'; chk CR01 "customer2 cannot rate my delivery" 404
for r in 0 6 1.5 '"5"' null; do req customer POST "/customer/bookings/$B2/confirm-receipt" "{\"rating\":$r}"; chk "CR02[$r]" "rating $r refused" 400; done
req customer POST "/customer/bookings/$B2/confirm-receipt" "{\"rating\":4,\"comment\":\"$(printf 'C%.0s' $(seq 1 501))\"}"; chk CR03 "a 501-character comment is refused" 400
req customer POST "/customer/bookings/$B2/confirm-receipt" '{"rating":4,"issue":{"type":"damage","description":"x"}}'; chk CR04 "an issue with a 1-character description is refused" 400
req customer POST "/customer/bookings/$B2/confirm-receipt" '{"rating":4,"issue":{"type":"rust","description":"rusted boxes"}}'; chk CR05 "an issue of an unknown type is refused" 400
RK="uat-rate-$(date +%s)"
req customer POST "/customer/bookings/$B2/confirm-receipt" '{"rating":4,"comment":"ड्राइवर समय पर आया"}' --idem "$RK"; chk CR06 "rate 4 with a Hindi comment" 200
t CR07 "the rating is stored on the delivery" "$([ "$(sql "select driver_rating from shipments where id='$B2_M'")" = 4 ] && echo 1 || echo 0)" "driver_rating=$(sql "select driver_rating,driver_rating_note from shipments where id='$B2_M'")"
req customer POST "/customer/bookings/$B2/confirm-receipt" '{"rating":4,"comment":"ड्राइवर समय पर आया"}' --idem "$RK"; chk CR08 "the same key replays the first answer (200)" 200
req customer POST "/customer/bookings/$B2/confirm-receipt" '{"rating":1}'; chk CR09 "a second rating with a new key is refused (409)" 409
req customer GET "/customer/bookings/$B2/cargo"; t CR10 "the cargo view shows the rating given" "$([ "$(jb .rating.rating)" = 4 ] && echo 1 || echo 0)" "rating=$(jb '.rating|tostring')"
t CR10b "the rating is linked to the driver and the truck that delivered (so it counts for them)" "$([ -n "$(sql "select rated_driver_id from shipments where id='$B2_M'")" ] && echo 1 || echo 0)" "rated_driver_id=$(sql "select coalesce(rated_driver_id::text,'NULL') from shipments where id='$B2_M'") rated_vehicle_id=$(sql "select coalesce(rated_vehicle_id::text,'NULL') from shipments where id='$B2_M'")"
req customer GET /customer/bookings; t CR11 "the bookings list marks it rated" "$([ "$(jb '[.[]|select(.id=="'"$B2"'")][0].rated')" = true ] && echo 1 || echo 0)" "rated=$(jb '[.[]|select(.id=="'"$B2"'")][0].rated')"
t CR12 "the driver was told about the rating" "$([ "$(sql "select count(*) from notifications where user_id='$(uid driverA)' and created_at > now() - interval '10 minutes' and (title ilike '%rat%' or body ilike '%rat%')")" -ge 1 ] && echo 1 || echo 0)" "driverA notifications: $(sql "select string_agg(title,' | ') from notifications where user_id='$(uid driverA)' and created_at > now() - interval '10 minutes'" | cut -c1-300)"

sect "I. Claims"
cl() { req customer POST /cargo/claims "$1"; }
cl "{\"ref\":{\"shipment_id\":\"$L1\"},\"claim_type\":\"damage\",\"claimed_amount\":500,\"notes\":\"दो डिब्बे टूटे हुए थे\"}"; chk CM01 "raise a damage claim on lot 1 with a Hindi note" "200 201"
CLM=$(jb '.id // .claim.id'); info "claim=$CLM $(ev 300)"
t CM02 "the claim is filed, raised by the customer, with the amount and note kept" "$([ "$(jb '.status // .claim.status')" = filed ] && [ "$(jn '.claimed_amount // .claim.claimed_amount')" = 500 ] && echo 1 || echo 0)" "$(ev 200)"
cl "{\"ref\":{\"shipment_id\":\"$L1\"},\"claim_type\":\"damage\",\"claimed_amount\":500}"; chk CM03 "a duplicate open claim of the same type on the same lot is refused" 409
cl "{\"ref\":{\"shipment_id\":\"$L1\"},\"claim_type\":\"shortage\",\"claimed_amount\":100}"; info "a second claim of another type on the same lot: HTTP $ST"
cl "{\"ref\":{\"shipment_id\":\"$L2\"},\"claim_type\":\"loss\",\"claimed_amount\":-5}"; chk CM04 "a negative claim amount is refused" 400
cl "{\"ref\":{\"shipment_id\":\"$L2\"},\"claim_type\":\"loss\",\"notes\":\"$(printf 'N%.0s' $(seq 1 2500))\"}"; chk CM05 "2500-character claim notes refused" 400
cl "{\"ref\":{\"shipment_id\":\"$L2\"},\"claim_type\":\"fire\"}"; chk CM06 "an unknown claim type refused" 400
cl "{\"claim_type\":\"loss\"}"; chk CM07 "a claim with no shipment refused" 400
cl "{\"ref\":{\"shipment_id\":\"$L2\"},\"claim_type\":\"delay\",\"claimed_amount\":99999999}"; info "a delay claim for 99,999,999 rupees on a 2,000-rupee freight lot: HTTP $ST declared_value=$(jb '.declared_value // .claim.declared_value') $(ev 120)"
t CM08 "a claim far above the freight and declared value is capped or flagged" "$([ "$ST" = 400 ] || [ "$(jb '.claimed_amount // .claim.claimed_amount')" != 99999999 ] && echo 1 || echo 0)" "HTTP $ST claimed=$(jb '.claimed_amount // .claim.claimed_amount')"
cl "{\"ref\":{\"shipment_id\":\"$(sql "select id from shipments where parent_shipment_id='$STORY_MASTER' order by lot_seq limit 1 offset 2")\"},\"claim_type\":\"shortage\",\"claimed_amount\":10}"; info "a claim on story lot C (delivered, no claim yet): HTTP $ST"
# someone else's shipment
req customer2 POST /cargo/claims "{\"ref\":{\"shipment_id\":\"$LOT_A\"},\"claim_type\":\"damage\"}"; chk CM10 "customer2 cannot claim on a lot of the story booking (404)" 404
req customer2 POST /cargo/claims "{\"ref\":{\"shipment_id\":\"$L1\"},\"claim_type\":\"damage\"}"; chk CM11 "customer2 cannot claim on my lot (404)" 404
req customer2 POST /cargo/claims "{\"ref\":{\"shipment_id\":\"$B2_M\"},\"claim_type\":\"loss\"}"; chk CM12 "customer2 cannot claim on my master shipment (404)" 404
req customer2 POST /cargo/claims "{\"ref\":\"$B2_TRK\",\"claim_type\":\"loss\"}"; t CM13 "customer2 cannot claim by tracking code either" "$([ "$ST" = 404 ] || [ "$ST" = 400 ] && echo 1 || echo 0)" "HTTP $ST $(ev 160)"
req customer2 GET "/cargo/claims/$CLM"; chk CM14 "customer2 cannot read my claim (404)" 404
req customer2 GET /cargo/claims; t CM15 "customer2's claim list holds none of mine" "$([ "$ST" = 200 ] && [ "$(echo "$BODY" | grep -c "$CLM")" = 0 ] && echo 1 || echo 0)" "HTTP $ST $(ev 160)"
req customer2 POST "/cargo/claims/$CLM/documents-upload-url" '{"content_type":"image/jpeg","size":1000,"file_name":"x.jpg"}'; chk CM16 "customer2 cannot add a document to my claim" "403 404"
req customer GET /cargo/claims; chk CM20 "list my claims" 200
t CM21 "the list has my claim(s)" "$([ "$(echo "$BODY" | grep -c "$CLM")" -ge 1 ] && echo 1 || echo 0)" "$(ev 220)"
req customer GET "/cargo/claims/$CLM"; chk CM22 "open my claim" 200
req customer PATCH "/cargo/claims/$CLM" '{"status":"approved","approved_amount":500}'; chk CM23 "a customer cannot approve their own claim" 403
req customer POST "/cargo/claims/$CLM/documents-upload-url" '{"content_type":"image/jpeg","size":1000,"file_name":"damage.jpg"}'; chk CM24 "request a claim photo upload" 200
req customer POST "/cargo/claims/$CLM/documents-upload-url" '{"content_type":"text/html","size":1000,"file_name":"x.html"}'; chk CM25 "an HTML upload is refused" "400 415"
req customer POST "/cargo/claims/$CLM/documents-upload-url" '{"content_type":"image/jpeg","size":999999999,"file_name":"big.jpg"}'; chk CM26 "a 1 GB upload is refused" "400 413"
RK2="uat-claim-$(date +%s)"
cl "{\"ref\":{\"shipment_id\":\"$L2\"},\"claim_type\":\"theft\",\"claimed_amount\":50}" ; CLM2=$(jb '.id // .claim.id'); info "theft claim on lot 2: HTTP $ST"
# the 7-day claim window, using a time machine on the test database
sql "update cargo_custody_events set recorded_at = recorded_at - interval '10 days' where shipment_id in (select id from shipments where parent_shipment_id='$STORY_MASTER' or id='$STORY_MASTER')" >/dev/null
sql "update shipment_logs set timestamp = timestamp - interval '10 days' where shipment_id in (select id from shipments where parent_shipment_id='$STORY_MASTER' or id='$STORY_MASTER')" >/dev/null
cl "{\"ref\":{\"shipment_id\":\"$LOT_A\"},\"claim_type\":\"loss\",\"claimed_amount\":10}"; chk CM30 "a claim 10 days after delivery is refused (7-day window)" 409
cl "{\"ref\":{\"shipment_id\":\"$B1_SH\"},\"claim_type\":\"loss\"}"; chk CM31 "a claim on a cancelled booking's shipment is refused" 409
cl "{\"ref\":{\"shipment_id\":\"$E2_SH\"},\"claim_type\":\"loss\"}"; chk CM32 "a claim on a shipment never picked up is refused" 409
req customer GET "/customer/bookings/$B2/cargo"; t CM33 "the cargo view lists the claims raised" "$([ "$(jb '.claims|length')" -ge 1 ] && echo 1 || echo 0)" "claims=$(jb '.claims|length') first=$(jb '.claims[0]|tostring'|cut -c1-200)"

sect "J. Invoices"
req customer GET /customer/invoices; chk CI01 "list my invoices" 200
INV=$BODY; info "invoices: count=$(echo "$INV" | jq length) $(echo "$INV" | jq -c '[.[]|{n:.invoice_number,t:.tracking_id,amt:.amount,gst:.gst_amount,tot:.total,s:.status}]' | cut -c1-900)"
t CI02 "story booking: 3 invoices, 2 more for the multi-drop trip (one per lot)" "$([ "$(echo "$INV" | jq length)" = 5 ] && echo 1 || echo 0)" "count=$(echo "$INV" | jq length)"
t CI03 "each invoice total = amount + GST" "$([ "$(echo "$INV" | jq '[.[]|select(((.amount|tonumber)+(.gst_amount|tonumber)-(.total|tonumber))|fabs>0.005)]|length')" = 0 ] && echo 1 || echo 0)" "bad rows: $(echo "$INV" | jq -c '[.[]|select(((.amount|tonumber)+(.gst_amount|tonumber)-(.total|tonumber))|fabs>0.005)|.invoice_number]')"
t CI04 "the multi-drop invoices add up to the price 12000 (7200 + 4800)" "$([ "$(echo "$INV" | jq '([.[]|select(.booking_id=="'"$B2"'")|.amount|tonumber]|add)+0')" = 12000 ] && echo 1 || echo 0)" "sum=$(echo "$INV" | jq '[.[]|select(.booking_id=="'"$B2"'")|.amount|tonumber]|add') rows=$(echo "$INV" | jq -c '[.[]|select(.booking_id=="'"$B2"'")|.amount]')"
t CI05 "GST is a whole number of paise" "$([ "$(echo "$INV" | jq '[.[]|select(((.gst_amount|tonumber)*100) as $g | (($g-($g|round))|fabs) > 0.001)]|length')" = 0 ] && echo 1 || echo 0)" "gst: $(echo "$INV" | jq -c '[.[].gst_amount]')"
IV1=$(echo "$INV" | jq -r '.[0].id'); IV_B2=$(echo "$INV" | jq -r '[.[]|select(.booking_id=="'"$B2"'")][0].id')
req customer GET "/invoices/$IV_B2/pdf"; chk CI10 "download the PDF of my invoice" 200
t CI11 "the download is a PDF with a file name" "$([ "$(jb ._nonjson)" = true ] && [ "$(jb .head | head -1 | cut -c1-4)" = '%PDF' ] && echo 1 || echo 0)" "$(ev 220)"
req customer2 GET "/invoices/$IV_B2/pdf"; chk CI12 "customer2 cannot download my PDF" "403 404"
req customer2 GET "/invoices/$IV_B2"; chk CI13 "customer2 cannot read the invoice document" "403 404"
req customer GET "/invoices/$IV_B2"; chk CI14 "a customer cannot read the staff invoice document (403)" 403
req customer GET /invoices/not-a-uuid/pdf; t CI15 "a malformed invoice id is a 404, not a 500" "$([ "$ST" = 404 ] || [ "$ST" = 400 ] && echo 1 || echo 0)" "HTTP $ST $(ev 160)"
req customer GET /invoices/00000000-0000-0000-0000-000000000000/pdf; chk CI16 "an unknown invoice is a 404" 404
req customer PUT "/finance/invoices/$IV_B2/pay" '{"method":"upi","reference":"x"}'; chk CI20 "a customer cannot mark an invoice paid" 403
req customer GET /finance/invoices; chk CI21 "a customer cannot read finance invoices" 403
req customer GET /invoices/payment-details; chk CI22 "payment details are readable by the customer" 200
info "payment details: $(ev 400)"
t CI23 "payment details say where to pay (bank or UPI)" "$(has "$BODY" 'HDFC|upi|account|bank')" "available=$(jb '.available|tostring') $(ev 160)"
req superadmin PUT "/finance/invoices/$IV_B2/pay" '{"method":"upi","reference":"UPI-UAT-CUST-1"}'; chk CI30 "staff mark the multi-drop invoice paid" 200
req customer GET /customer/invoices; t CI31 "the customer sees it paid, with method and reference" "$([ "$(jb '[.[]|select(.id=="'"$IV_B2"'")][0]|.status')" = paid ] && echo 1 || echo 0)" "$(jb '[.[]|select(.id=="'"$IV_B2"'")][0]|{status,paid_at,payment_method,payment_reference}|tostring')"
req superadmin PUT "/finance/invoices/$IV_B2/pay" '{"method":"upi","reference":"UPI-UAT-CUST-2"}'; t CI32 "paying an invoice twice is refused" "$([ "$ST" = 409 ] || [ "$ST" = 400 ] && echo 1 || echo 0)" "HTTP $ST $(ev 160)"
info "GAP: no customer endpoint exists to report a payment, upload proof or dispute an invoice; payment is by staff marking it paid"

sect "K. Notifications and account"
req customer GET /notifications; chk CN01 "list my notifications" 200
NOTES=$BODY; info "total=$(jb .total) unread=$(jb .unread_count) titles=$(jb '[.notifications[]|.title]|unique|join(" | ")' | cut -c1-700)"
t CN02 "customer notifications use the shared vocabulary (no consignment, manifest, route, exception, incident...)" "$(lacks "$NOTES" '[Cc]onsignment|[Mm]anifest|[Rr]oute|[Ee]xception|[Ii]ncident|[Bb]ackhaul|[Tt]ransshipment')" "hits: $(printf '%s' "$NOTES" | grep -oiE 'consignment|manifest|route|exception|incident|backhaul|transshipment' | sort | uniq -c | tr '\n' ' ')"
t CN03 "no duplicate notifications for one event" "$([ "$(jb '[.notifications[]|(.title+.body+(.data.booking_id // "")+(.created_at|.[0:19]))]|(length - (unique|length))')" = 0 ] && echo 1 || echo 0)" "dups=$(jb '[.notifications[]|(.title+.body+(.data.booking_id // "")+(.created_at|.[0:19]))]|(length - (unique|length))') sample: $(jb '[.notifications[]|(.title+" | "+(.data.booking_id // "")+" | "+(.created_at|.[0:19]))]|group_by(.)|map(select(length>1)|.[0])|.[0:3]|join(" ;; ")')"
FIRST=$(jb '.notifications[0].id')
req customer POST "/notifications/$FIRST/read"; chk CN04 "mark one read" 200
req customer2 POST "/notifications/$FIRST/read"; chk CN05 "customer2 cannot mark my notification read" 404
req customer GET '/notifications?limit=1000'; t CN06 "limit is capped at 100" "$([ "$(jb .limit)" = 100 ] && echo 1 || echo 0)" "limit=$(jb .limit)"
req customer GET '/notifications?limit=-1&offset=-5'; t CN07 "negative limit and offset fall back to defaults" "$([ "$ST" = 200 ] && [ "$(jb .limit)" = 20 ] && [ "$(jb .offset)" = 0 ] && echo 1 || echo 0)" "limit=$(jb .limit) offset=$(jb .offset)"
req customer POST /notifications/read-all; chk CN08 "mark all read" 200
req customer GET /notifications; t CN09 "unread count is 0 after read-all" "$([ "$(jb .unread_count)" = 0 ] && echo 1 || echo 0)" "unread=$(jb .unread_count)"
req customer2 GET /notifications; t CN10 "customer2 sees none of my booking notifications" "$([ "$(echo "$BODY" | grep -c "$B2")" = 0 ] && echo 1 || echo 0)" "customer2 total=$(jb .total)"
req customer PUT /customer/push-token '{"token":"not-a-token"}'; chk CN11 "an invalid push token is refused" 400
req customer PUT /customer/push-token '{"token":"ExponentPushToken[uat-customer-token-0001]"}'; chk CN12 "register a push token" 200
req customer2 PUT /customer/push-token '{"token":"ExponentPushToken[uat-customer-token-0001]"}'; info "the same token for customer2 (phone changed hands): HTTP $ST; customer's token now: $(sql "select coalesce(push_token,'null') from customers where id='$CUST'")"
req customer DELETE /customer/push-token; chk CN13 "clear the push token" 200
req customer GET /users/me; info "/users/me as a customer: HTTP $ST $(ev 120)"
# sign-up with a phone OTP
PH="98$(printf '%08d' $(( (RANDOM * 32768 + RANDOM) % 100000000 )))"
req anon POST /auth/customer/send-otp "{\"phone\":\"$PH\"}"; chk CA01 "send a sign-up OTP" 200
otp_of() { grep -a "DEV SMS" "$BACKEND_LOG" 2>/dev/null | grep -a "$PH" | tail -1 | grep -oE 'OTP is: [0-9]+' | grep -oE '[0-9]+$'; }
OTP=$(otp_of); info "otp found in the dev log: ${OTP:+yes}${OTP:-no}"
req anon POST /auth/customer/send-otp '{"phone":"123"}'; chk CA02 "an invalid phone is refused" 400
req anon POST /auth/customer/verify-otp "{\"phone\":\"$PH\",\"otp\":\"\"}"; chk CA03 "an empty OTP is refused" 400
for i in 1 2 3 4 5; do req anon POST /auth/customer/verify-otp "{\"phone\":\"$PH\",\"otp\":\"00000$i\"}"; done
t CA04 "the 5th wrong OTP answers 401 with no attempts left" "$([ "$ST" = 401 ] && [ "$(jb .remaining_attempts)" = 0 ] && echo 1 || echo 0)" "HTTP $ST $(ev 120)"
req anon POST /auth/customer/verify-otp "{\"phone\":\"$PH\",\"otp\":\"${OTP:-123456}\"}"; chk CA05 "after 5 wrong tries even the right OTP is locked (429)" 429
req anon POST /auth/customer/send-otp "{\"phone\":\"$PH\"}"; chk CA06 "request a new OTP" 200
OTP=$(otp_of)
req anon POST /auth/customer/verify-otp "{\"phone\":\"$PH\",\"otp\":\"${OTP:-000000}\"}"; chk CA07 "sign up with the right OTP" 200
NEWTOK=$(jb .access_token); NEWREF=$(jb .refresh_token); NEWID=$(jb .user_id)
info "new customer $NEWID name stored: $(sql "select full_name from customers where id='$NEWID'")"
t CA08 "a new customer gets a usable name, not 'Customer 1234'" "$([ "$(sql "select full_name from customers where id='$NEWID'")" != "Customer ${PH: -4}" ] && echo 1 || echo 0)" "full_name=$(sql "select full_name from customers where id='$NEWID'")"
req anon GET /customer/bookings --token "$NEWTOK"; chk CA09 "the new session lists bookings (empty)" 200
req anon POST /auth/refresh "{\"refresh_token\":\"$NEWREF\"}"; chk CA10 "refresh the session" 200
req anon POST /auth/refresh "{\"refresh_token\":\"$NEWTOK\"}"; t CA11 "an access token is refused as a refresh token" "$([ "$ST" = 401 ] && echo 1 || echo 0)" "HTTP $ST"
req anon PUT /users/language '{"language":"hi"}' --token "$NEWTOK"; info "language change for a customer: HTTP $ST $(ev 120)"
t CA12 "a customer can edit their name, company or delete the account (customer app Account screen offers sign-out only)" "0" "no customer profile endpoint: PUT/PATCH /customer/profile -> $(node e2e/scenarios/call.mjs anon PATCH /customer/profile '{"full_name":"X"}' --token "$NEWTOK" | head -1)"

sleep 65   # the public tracking rate limit window
sect "L. Web pages (a customer has the public tracking page only; bookings live in the app)"
ui anon "/track/$B2_TRK" --width 390
ui anon "/track/$B2_TRK"
ui anon /track "/track/RTX-NOPE0000" --width 390
ui anon "/track/$B1_TRK" --width 390
ui customer /today
ui customer /
