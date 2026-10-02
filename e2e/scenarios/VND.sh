#!/usr/bin/env bash
# UAT scenario: the vendor (loads, invoices, claims, return-trip bids, documents/KYC), 3PL onboarding, other vendors' data.
# Runs after the 75-step story. Read e2e/out/scenario.txt.
set -u
source "$(dirname "$0")/lib.sh"
set -a; . e2e/.env.local; set +a
V1=$(uid vendor); DA=$(uid driverA); DB=$(uid driverB)
T1=$(vehicle_id MH04E2E0001); T2=$(vehicle_id MH04E2E0002)
V2=$(node e2e/scenarios/mkvendor.mjs vendor2 "Bharat Freight Co" approved)
V3=$(node e2e/scenarios/mkvendor.mjs vendor3 "Naya Vyapar Pvt Ltd" none)
info "vendor=$V1 vendor2=$V2 (approved) vendor3=$V3 (new sign-up, no profile) truck1=$T1 truck2=$T2"
reset_trucks
STORY_REQ=$(sql "select id from vendor_shipment_requests where vendor_id='$V1' order by created_at limit 1")
STORY_MAN=$(sql "select id from cargo_manifest where vendor_request_id='$STORY_REQ'")
LA=$(sql "select id from shipments where parent_shipment_id is not null order by created_at limit 1")
STORY_WIN=$(sql "select id from capacity_windows order by opens_at limit 1")
info "story load=$STORY_REQ manifest=$STORY_MAN return-trip window=$STORY_WIN"
ld() { jq -nc '{pickup:{address:"Okhla, Delhi",lat:28.53,lng:77.27},drop:{address:"Sitapura, Jaipur",lat:26.79,lng:75.82},capacity:2000,metadata:{cargo:{gstRate:"18",declaredValue:"250000",description:"Auto parts"}}}'; }

sect "A. Post a load"
req vendor POST /vendor/shipment-request "$(ld)"; chk VA01 "post a load" "200 201"
L1=$(jb .id); info "L1=$L1 status=$(jb .status) $(ev 200)"
t VA02 "the new load is pending, owned by the vendor, with an ETA worked out" "$([ "$(jb .status)" = pending ] && [ "$(jb .vendor_id)" = "$V1" ] && echo 1 || echo 0)" "status=$(jb .status) routing=$(jb '.metadata.routing|tostring'|cut -c1-160)"
req vendor POST /vendor/shipment-request "$(ld | jq -c '.pickup.address="ओखला औद्योगिक क्षेत्र, दिल्ली" | .drop.address="सीतापुरा, जयपुर, राजस्थान" | .metadata.cargo.description="ऑटो पार्ट्स — नाज़ुक"')"; chk VA03 "post a load with Hindi addresses and description" "200 201"
LH=$(jb .id); t VA04 "the Hindi text is stored intact" "$([ "$(sql "select pickup_location from vendor_shipment_requests where id='$LH'")" = "ओखला औद्योगिक क्षेत्र, दिल्ली" ] && echo 1 || echo 0)" "$(sql "select pickup_location from vendor_shipment_requests where id='$LH'")"
bl() { req vendor POST /vendor/shipment-request "$(ld | jq -c "$2")"; chk "$1" "$3" 400; }
bl VA10 '.capacity=0' "load weight 0 refused"
bl VA11 '.capacity=-5' "negative weight refused"
bl VA12 '.capacity="abc"' "weight as text refused"
bl VA13 '.capacity=50001' "weight above 50,000 kg refused"
bl VA14 '.capacity=null' "weight null refused"
bl VA15 'del(.drop)' "a load with no drop refused"
bl VA16 'del(.pickup)' "a load with no pickup refused"
bl VA17 '.drop.lat=91' "drop latitude 91 refused"
bl VA18 '.pickup.lng="east"' "pickup longitude as text refused"
bl VA19 '.drop.address=""' "empty drop address refused"
bl VA20 ".pickup.address=\"$(printf 'A%.0s' $(seq 1 600))\"" "a 600-character address refused"
bl VA21 ".metadata={note:\"$(printf 'N%.0s' $(seq 1 25000))\"}" "25 KB of load details refused"
req vendor POST /vendor/shipment-request "$(ld | jq -c '.drop=.pickup')"; info "a load from a place to the same place: HTTP $ST $(ev 140)"
t VA22 "pickup and drop at the same point is refused" "$([ "$ST" = 400 ] && echo 1 || echo 0)" "HTTP $ST"
req vendor POST /vendor/shipment-request '{"pickup":{"address":"a","lat":0,"lng":0},"drop":{"address":"b","lat":0,"lng":0},"capacity":10}'; info "a load at 0,0 -> 0,0: HTTP $ST"
t VA23 "a load at 0,0 (not a real place) is refused" "$([ "$ST" = 400 ] && echo 1 || echo 0)" "HTTP $ST $(ev 140)"
req vendor POST /vendor/shipment-request '{bad'; chk VA24 "malformed JSON is a 400" 400
req vendor3 POST /vendor/shipment-request "$(ld)"; chk VA25 "a new vendor without approved KYC cannot post a load" 403
req superadmin POST /vendor/shipment-request "$(ld)"; chk VA26 "staff cannot post as a vendor" 403
req customer POST /vendor/shipment-request "$(ld)"; chk VA27 "a customer cannot post a vendor load" 403
req anon POST /vendor/shipment-request "$(ld)"; chk VA28 "no sign-in, no load" 401
req vendor GET /vendor/loads; chk VA30 "my loads board" 200
t VA31 "the board holds the new loads" "$([ "$(jb '[.[]|select(.id=="'"$L1"'" or .request_id=="'"$L1"'")]|length')" -ge 1 ] && echo 1 || echo 0)" "count=$(jb length) keys=$(jb '.[0]|keys|join(",")')"
t VA32 "a rejected request left no stray load behind (only valid posts: story + L1 + Hindi = 3)" "$([ "$(sql "select count(*) from vendor_shipment_requests where vendor_id='$V1'")" = 3 ] && echo 1 || echo 0)" "rows=$(sql "select count(*) from vendor_shipment_requests where vendor_id='$V1'")"
req vendor GET "/vendor/loads/$L1"; chk VA33 "open my load" 200
info "load detail keys: $(jb 'keys|join(",")') stage=$(jb .stage) price=$(jb .price)$(jb .cost)"
req vendor GET /vendor/loads/not-a-uuid; chk VA34 "a malformed load id is a 404" 404
req vendor GET /vendor/loads/00000000-0000-0000-0000-000000000000; chk VA35 "an unknown load is a 404" 404
req vendor2 GET /vendor/loads; t VA36 "another vendor's board holds none of my loads" "$([ "$ST" = 200 ] && [ "$(echo "$BODY" | grep -c "$L1")" = 0 ] && echo 1 || echo 0)" "vendor2 sees $(jb length) loads"
req vendor2 GET "/vendor/loads/$L1"; chk VA37 "another vendor cannot open my load" 404
req vendor3 GET /vendor/loads; t VA38 "a new vendor sees an empty board" "$([ "$ST" = 200 ] && [ "$(jb length)" = 0 ] && echo 1 || echo 0)" "HTTP $ST $(ev 100)"

sect "B. Assign before acceptance, accept, cancel"
req superadmin PUT "/vendor/shipment-request/$L1/assign-vehicle" "{\"vehicle_id\":\"$T1\"}"; chk VB01 "assign a truck before the load is accepted" 409
t VB02 "the refusal says to accept with a price first" "$(has "$BODY" 'accept')" "$(ev 160)"
req vendor PUT "/vendor/shipment-request/$L1/approve" '{"cost":20000}'; chk VB03 "a vendor cannot accept their own load" 403
req vendor PUT "/vendor/shipment-request/$L1/assign-vehicle" "{\"vehicle_id\":\"$T1\"}"; chk VB04 "a vendor cannot assign a truck" 403
req superadmin PUT "/vendor/shipment-request/$L1/approve" '{}'; chk VB05 "accept with no price refused" 400
req superadmin PUT "/vendor/shipment-request/$L1/approve" '{"cost":-1}'; chk VB06 "a negative price refused" 400
req superadmin PUT "/vendor/shipment-request/$L1/approve" '{"cost":"abc"}'; chk VB07 "a text price refused" 400
req superadmin PUT "/vendor/shipment-request/$L1/approve" '{"cost":99999999999}'; chk VB08 "a price of 99,999,999,999 refused" 400
req superadmin PUT "/vendor/shipment-request/$L1/approve" '{"cost":20000}'; chk VB10 "accept at 20000" 200
req vendor POST /vendor/shipment-request "$(ld)"; L5=$(jb .id)
req superadmin PUT "/vendor/shipment-request/$L5/approve" '{"cost":0}'; info "accept at a price of 0: HTTP $ST $(ev 120)"
t VB09 "a zero price is refused (an invoice for 0 is meaningless)" "$([ "$ST" = 400 ] && echo 1 || echo 0)" "HTTP $ST status now $(sql "select status,cost from vendor_shipment_requests where id='$L5'")"
req vendor PUT "/vendor/shipment-request/$L5/cancel" '{}'
req superadmin PUT "/vendor/shipment-request/$L1/approve" '{"cost":21000}'; chk VB11 "accepting again is refused (409)" 409
req vendor GET /vendor/loads; t VB12 "the vendor sees the load as accepted, with the agreed price" "$([ "$(jb '[.[]|select(.id=="'"$L1"'")][0].stage')" = accepted ] && echo 1 || echo 0)" "$(jb '[.[]|select(.id=="'"$L1"'")][0]|{stage,price,cost}|tostring')"
# cancel at pending
req vendor POST /vendor/shipment-request "$(ld)"; L2=$(jb .id)
req vendor2 PUT "/vendor/shipment-request/$L2/cancel" '{}'; chk VB20 "another vendor cannot cancel my load" 404
req vendor PUT "/vendor/shipment-request/$L2/cancel" '{}'; chk VB21 "cancel at 'waiting'" 200
req vendor PUT "/vendor/shipment-request/$L2/cancel" '{}'; chk VB22 "cancelling twice is refused (409)" 409
req superadmin PUT "/vendor/shipment-request/$L2/approve" '{"cost":5000}'; chk VB23 "staff cannot accept a cancelled load" 409
req superadmin PUT "/vendor/shipment-request/$L2/assign-vehicle" "{\"vehicle_id\":\"$T1\"}"; chk VB24 "staff cannot assign a truck to a cancelled load" 409
req vendor PUT "/vendor/shipment-request/not-a-uuid/cancel" '{}'; t VB25 "cancel with a malformed id is a clean 4xx, not a 500" "$([ "$ST" -ge 400 ] && [ "$ST" -lt 500 ] && echo 1 || echo 0)" "HTTP $ST $(ev 120)"
t VB26 "staff were told the vendor cancelled" "$([ "$(sql "select count(*) from notifications where title='Vendor cancelled a load' and created_at > now() - interval '5 minutes'")" -ge 1 ] && echo 1 || echo 0)" "$(sql "select count(*) from notifications where title='Vendor cancelled a load'")"
# cancel at accepted (no truck yet)
req vendor POST /vendor/shipment-request "$(ld)"; L3=$(jb .id)
req superadmin PUT "/vendor/shipment-request/$L3/approve" '{"cost":15000}'
req vendor PUT "/vendor/shipment-request/$L3/cancel" '{}'; chk VB30 "cancel at 'accepted' (no truck yet)" 200
# reject
req vendor POST /vendor/shipment-request "$(ld)"; L4=$(jb .id)
req superadmin PUT "/vendor/shipment-request/$L4/reject" '{}'; chk VB40 "reject with no reason refused" 400
req superadmin PUT "/vendor/shipment-request/$L4/reject" "{\"reason\":\"$(printf 'R%.0s' $(seq 1 600))\"}"; chk VB41 "a 600-character reason refused" 400
req vendor PUT "/vendor/shipment-request/$L4/reject" '{"reason":"no"}'; chk VB42 "a vendor cannot reject" 403
req superadmin PUT "/vendor/shipment-request/$L4/reject" '{"reason":"आज कोई ट्रक उपलब्ध नहीं"}'; chk VB43 "reject with a Hindi reason" 200
req vendor GET /vendor/loads; t VB44 "the vendor sees it closed with the reason" "$([ "$(jb '[.[]|select(.id=="'"$L4"'")][0].stage')" = closed ] && echo 1 || echo 0)" "$(jb '[.[]|select(.id=="'"$L4"'")][0]|tostring'|cut -c1-300)"
req vendor PUT "/vendor/shipment-request/$L4/cancel" '{}'; chk VB45 "cancelling a rejected load is refused" 409
t VB46 "the vendor was told about the rejection with the reason" "$([ "$(sql "select count(*) from notifications where user_id='$V1' and title ilike '%reject%' and body like '%ट्रक%'")" -ge 1 ] && echo 1 || echo 0)" "$(sql "select title||': '||body from notifications where user_id='$V1' and title ilike '%reject%' order by created_at desc limit 1")"
req vendor GET /vendor/loads; info "the rejected load on the board: reason=$(jb '[.[]|select(.id=="'"$L4"'")][0].rejection_reason')"
# assign L1
req superadmin PUT "/vendor/shipment-request/$L1/assign-vehicle" '{"vehicle_id":"not-a-uuid"}'; t VB50 "assign with a malformed vehicle id is a clean 4xx" "$([ "$ST" -ge 400 ] && [ "$ST" -lt 500 ] && echo 1 || echo 0)" "HTTP $ST $(ev 120)"
req superadmin PUT "/vendor/shipment-request/$L1/assign-vehicle" '{}'; chk VB51 "assign with no vehicle refused" 400
req superadmin PUT "/vendor/shipment-request/$L1/assign-vehicle" '{"vehicle_id":"00000000-0000-0000-0000-000000000000"}'; chk VB52 "assign an unknown vehicle" 404
sql "update vehicles set status='maintenance' where id='$T2'" >/dev/null
req superadmin PUT "/vendor/shipment-request/$L1/assign-vehicle" "{\"vehicle_id\":\"$T2\"}"; chk VB53 "assign a truck that is in maintenance refused" 409
sql "update vehicles set status='available' where id='$T2'" >/dev/null
req superadmin PUT "/vendor/shipment-request/$L1/assign-vehicle" "{\"vehicle_id\":\"$T1\"}"; chk VB54 "assign truck 1" 200
MAN=$(sql "select id from cargo_manifest where vendor_request_id='$L1'"); info "manifest=$MAN"
req superadmin PUT "/vendor/shipment-request/$L1/assign-vehicle" "{\"vehicle_id\":\"$T2\"}"; info "assign a second truck to the same load: HTTP $ST $(ev 160)"
t VB55 "a load that already has a truck cannot be given another one this way" "$([ "$ST" = 409 ] && echo 1 || echo 0)" "HTTP $ST manifests for the load: $(sql "select count(*) from cargo_manifest where vendor_request_id='$L1'")"
req vendor PUT "/vendor/shipment-request/$L1/cancel" '{}'; chk VB56 "the vendor cannot cancel a load that has a truck (409)" 409
req vendor GET "/vendor/loads/$L1"; t VB57 "the load page shows 'assigned' and the truck, without the driver's name or phone" "$([ "$(jb .stage)" = assigned ] && echo 1 || echo 0)" "stage=$(jb .stage) vehicle=$(jb '.vehicle|tostring'|cut -c1-120) leaks: $(printf '%s' "$BODY" | grep -oiE 'driver_phone|driver_name|"phone"|Ravi|9900000003' | sort -u | tr '\n' ' ')"
t VB58 "no driver phone or name in the vendor's view" "$(lacks "$BODY" 'driver_phone|driver_name|Ravi Driver|9900000003')" "$(printf '%s' "$BODY" | grep -oiE 'driver_phone|driver_name|Ravi Driver|9900000003' | sort -u | tr '\n' ' ')"
req driverA POST /telemetry/driver-ping/accept-route "{\"route_id\":\"$MAN\"}"; info "driver accepts the vendor load: HTTP $ST $(ev 100)"
mp() { local x="${3:-}"; [ -z "$x" ] && x='{}'; req driverA POST /cargo/custody "$(jq -nc --arg id "$MAN" --arg k "$1" --arg ph "cargo/$MAN/photo_$2.jpg" --argjson x "$x" '{ref:{manifest_id:$id},kind:$k,photo_paths:[$ph],lat:28.53,lng:77.27}+$x')"; }
mp pickup 1 '{"pieces":10,"condition":"good"}'; chk VB60 "driver picks up the vendor's load" "200 201"
req vendor GET "/vendor/loads/$L1"; t VB61 "the vendor sees it on the way" "$([ "$(jb .stage)" = on_the_way ] && echo 1 || echo 0)" "stage=$(jb .stage)"
req vendor POST /cargo/claims "{\"ref\":{\"manifest_id\":\"$MAN\"},\"claim_type\":\"damage\"}"; chk VB62 "a claim on a load still on the road is refused (409)" 409
mp departed 1; info "depart: HTTP $ST"
mp delivery 2 '{"receiver_name":"Jaipur warehouse"}'; chk VB63 "driver delivers the load" "200 201"
sleep 2
req vendor GET "/vendor/loads/$L1"; t VB64 "the vendor sees it delivered with proof of delivery" "$([ "$(jb .stage)" = delivered ] && echo 1 || echo 0)" "stage=$(jb .stage) pod=$(jb '.pod|tostring'|cut -c1-200) invoice=$(jb '.invoice|tostring'|cut -c1-160)"

sect "C. Invoices and payment"
req vendor GET /vendor/invoices; chk VC01 "my invoices" 200
VI=$(jb '[.[]|select(.manifest_id=="'"$MAN"'")][0].id'); info "invoice of L1: $(jb '[.[]|select(.manifest_id=="'"$MAN"'")][0]|{n:.invoice_number,amount,gst_rate,gst_amount,total,status,reference,due_date,vendor_request_id}|tostring')"
t VC02 "the load has an invoice for the agreed price, freight GST under reverse charge (20000, 0%, 20000)" "$([ "$(jb '[.[]|select(.manifest_id=="'"$MAN"'")][0]|[((.amount|tonumber)+0),((.gst_rate|tonumber)+0),((.total|tonumber)+0)]|tostring')" = "[20000,0,20000]" ] && echo 1 || echo 0)" "$(jb '[.[]|select(.manifest_id=="'"$MAN"'")][0]|[.amount,.gst_rate,.total]|tostring')"
t VC03 "every vendor invoice has total = amount + GST" "$([ "$(jb '[.[]|select(((.amount|tonumber)+(.gst_amount|tonumber)-(.total|tonumber))|fabs>0.005)]|length')" = 0 ] && echo 1 || echo 0)" "rows=$(jb length)"
t VC04 "the invoice has a reference the vendor recognises (the load code)" "$([ -n "$(jb '[.[]|select(.manifest_id=="'"$MAN"'")][0].reference // empty')" ] && echo 1 || echo 0)" "reference=$(jb '[.[]|select(.manifest_id=="'"$MAN"'")][0].reference')"
req vendor GET "/invoices/$VI/pdf"; chk VC10 "download the invoice PDF" 200
t VC11 "it is a PDF" "$([ "$(jb .head | head -1 | cut -c1-4)" = '%PDF' ] && echo 1 || echo 0)" "$(ev 200)"
req vendor2 GET "/invoices/$VI/pdf"; chk VC12 "another vendor cannot download it" "403 404"
req customer GET "/invoices/$VI/pdf"; chk VC13 "a customer cannot download it" "403 404"
req vendor2 GET /vendor/invoices; t VC14 "another vendor's invoice list holds none of mine" "$([ "$(echo "$BODY" | grep -c "$VI")" = 0 ] && echo 1 || echo 0)" "vendor2 sees $(jb length)"
req customer GET /vendor/invoices; chk VC15 "a customer cannot read vendor invoices" 403
req vendor GET "/invoices/$VI"; chk VC16 "a vendor cannot read the staff invoice document" 403
req vendor PUT "/finance/invoices/$VI/pay" '{"method":"upi","reference":"x"}'; chk VC17 "a vendor cannot mark an invoice paid" 403
req vendor GET /finance/invoices; chk VC18 "a vendor cannot read finance invoices" 403
req vendor GET /invoices/payment-details; chk VC20 "payment details" 200
t VC21 "payment details say where to pay" "$(has "$BODY" 'HDFC|upi|account|bank')" "$(ev 200)"
req superadmin PUT "/finance/invoices/$VI/pay" '{"method":"bank","reference":"NEFT-UAT-1"}'; chk VC30 "staff mark it paid" 200
req vendor GET /vendor/invoices; t VC31 "the vendor sees it paid with the reference" "$([ "$(jb '[.[]|select(.id=="'"$VI"'")][0].status')" = paid ] && echo 1 || echo 0)" "$(jb '[.[]|select(.id=="'"$VI"'")][0]|{status,paid_at,payment_method,payment_reference}|tostring')"
req vendor GET "/vendor/loads/$L1"; t VC32 "the load is closed once it is delivered and paid" "$([ "$(jb .stage)" = closed ] && echo 1 || echo 0)" "stage=$(jb .stage)"
t VC33 "the vendor was told the invoice was paid" "$([ "$(sql "select count(*) from notifications where user_id='$V1' and (title ilike '%paid%' or body ilike '%paid%')")" -ge 1 ] && echo 1 || echo 0)" "$(sql "select string_agg(title,' | ') from notifications where user_id='$V1' and created_at > now() - interval '10 minutes'" | cut -c1-300)"

sect "D. Claims"
cv() { req vendor POST /cargo/claims "$1"; }
cv "{\"ref\":{\"manifest_id\":\"$MAN\"},\"claim_type\":\"damage\",\"claimed_amount\":5000,\"notes\":\"दो डिब्बे टूटे मिले\"}"; chk VD01 "raise a damage claim on the delivered load" "200 201"
VCL=$(jb '.id // .claim.id'); info "claim=$VCL $(ev 260)"
cv "{\"ref\":{\"manifest_id\":\"$MAN\"},\"claim_type\":\"damage\",\"claimed_amount\":5000}"; chk VD02 "a duplicate open claim of the same type refused" 409
cv "{\"ref\":{\"manifest_id\":\"$MAN\"},\"claim_type\":\"fire\"}"; chk VD03 "an unknown claim type refused" 400
cv "{\"ref\":{\"manifest_id\":\"$MAN\"},\"claim_type\":\"loss\",\"claimed_amount\":-1}"; chk VD04 "a negative amount refused" 400
cv "{\"ref\":{\"manifest_id\":\"$MAN\"},\"claim_type\":\"loss\",\"notes\":\"$(printf 'N%.0s' $(seq 1 2500))\"}"; chk VD05 "2500-character notes refused" 400
cv '{"claim_type":"loss"}'; chk VD06 "a claim with no load refused" 400
cv "{\"ref\":{\"shipment_id\":\"$(sql "select id from shipments where parent_shipment_id is not null limit 1")\"},\"claim_type\":\"loss\"}"; chk VD07 "a vendor cannot claim on a customer's shipment (404)" 404
req vendor2 POST /cargo/claims "{\"ref\":{\"manifest_id\":\"$MAN\"},\"claim_type\":\"loss\"}"; chk VD08 "another vendor cannot claim on my load (404)" 404
req vendor2 GET "/cargo/claims/$VCL"; chk VD09 "another vendor cannot read my claim (404)" 404
req vendor2 GET /cargo/claims; t VD10 "another vendor's claim list holds none of mine" "$([ "$ST" = 200 ] && [ "$(echo "$BODY" | grep -c "$VCL")" = 0 ] && echo 1 || echo 0)" "HTTP $ST $(ev 140)"
req customer GET "/cargo/claims/$VCL"; chk VD11 "a customer cannot read a vendor's claim (404)" 404
req vendor GET /cargo/claims; chk VD12 "my claims" 200
t VD13 "my claim is listed" "$([ "$(echo "$BODY" | grep -c "$VCL")" -ge 1 ] && echo 1 || echo 0)" "$(ev 200)"
req vendor PATCH "/cargo/claims/$VCL" '{"status":"approved","approved_amount":5000}'; chk VD14 "a vendor cannot approve their own claim" 403
req vendor POST "/cargo/claims/$VCL/documents-upload-url" '{"content_type":"image/jpeg","size":1000,"file_name":"damage.jpg"}'; chk VD15 "a claim photo upload URL" 200
req vendor GET "/vendor/loads/$L1"; t VD16 "the load page lists the claim" "$([ "$(jb '.claims|length')" -ge 1 ] && echo 1 || echo 0)" "claims=$(jb '.claims|length') window=$(jb '.claim_window|tostring')"
sql "update cargo_custody_events set recorded_at = recorded_at - interval '10 days' where manifest_id='$STORY_MAN'" >/dev/null
cv "{\"ref\":{\"manifest_id\":\"$STORY_MAN\"},\"claim_type\":\"shortage\"}"; chk VD17 "a claim on the story load 10 days after delivery is refused (7-day window)" 409
t VD18 "the refusal tells the vendor the window" "$(has "$BODY" '7 days|within')" "$(ev 160)"

sect "E. Return-trip bids"
P0=$(sql "select count(*) from delivery_points where name='Gurgaon depot'")
sql "update vehicles set latitude=28.6, longitude=77.2, current_location_name='Delhi', status='available', available_capacity_kg=8000 where id='$T1'" >/dev/null
req superadmin POST /capacity/driver/open-backhaul-window "{\"vehicle_id\":\"$T1\",\"available_capacity_kg\":5000,\"trigger_type\":\"return_trip\",\"floor_price\":5000}"; chk VE01 "staff open a return trip with a minimum bid of 5000" "200 201"
W2=$(jb .id); info "window=$W2 $(ev 200)"
req vendor GET /capacity/windows/open; chk VE02 "the vendor lists open return trips" 200
t VE03 "the new window is listed, without driver name or phone" "$([ "$(echo "$BODY" | grep -c "$W2")" -ge 1 ] && echo 1 || echo 0)" "keys=$(jb '.[0]|keys|join(",")') leaks: $(printf '%s' "$BODY" | grep -oiE 'driver_name|driver_phone|Ravi|9900000003|"phone"' | sort -u | tr '\n' ' ')"
t VE04 "no driver name or phone in the open list" "$(lacks "$BODY" 'driver_name|driver_phone|Ravi Driver|Sunil Driver|9900000003|9900000004')" "$(printf '%s' "$BODY" | grep -oiE 'driver_name|driver_phone|Ravi Driver|Sunil Driver|9900000003|9900000004' | sort -u | tr '\n' ' ')"
bid() { jq -nc --arg w "$W2" '{window_id:$w,bid_amount:9000,weight_kg:1500,dropoff_name:"Gurgaon depot",dropoff_address:"Sector 18, Gurgaon",dropoff_lat:28.47,dropoff_lng:77.03}'; }
bb() { req "$1" POST /capacity/bids "$(bid | jq -c "${2:-.}")"; }
bb vendor '.bid_amount=4000'; chk VE10 "a bid below the minimum (4000 < 5000) refused" 400
t VE11 "the refusal names the minimum" "$(has "$BODY" '5,000|5000|minimum')" "$(ev 160)"
bb vendor '.weight_kg=99999'; chk VE12 "a load heavier than the free space refused" 400
bb vendor '.weight_kg=0'; chk VE13 "weight 0 refused" 400
bb vendor '.weight_kg=-5'; chk VE14 "negative weight refused" 400
bb vendor '.bid_amount=0'; chk VE15 "bid of 0 refused" 400
bb vendor '.bid_amount=-100'; chk VE16 "negative bid refused" 400
bb vendor '.bid_amount="abc"'; chk VE17 "text bid refused" 400
bb vendor 'del(.window_id)'; chk VE18 "no window refused" 400
bb vendor '.window_id="00000000-0000-0000-0000-000000000000"'; chk VE19 "an unknown window" 404
bb vendor '.eway_bill_ref="12345"'; chk VE20 "an e-way bill of 5 digits refused" 400
bb vendor 'del(.dropoff_name)'; chk VE21 "no drop-off name refused" 400
bb vendor '.dropoff_lat=999'; chk VE22 "drop-off latitude 999 refused" 400
bb vendor '.dropoff_lat=0|.dropoff_lng=0'; chk VE23 "a drop-off at 0,0 refused" 400
bb vendor3 ''; chk VE24 "a vendor without approved KYC cannot bid" 403
bb customer ''; chk VE25 "a customer cannot bid" 403
bb driverA ''; chk VE26 "a driver cannot bid" 403
req anon POST /capacity/bids "$(bid)"; chk VE27 "no sign-in, no bid" 401
t VE28 "rejected bids left no stray drop-off points behind" "$([ "$(sql "select count(*) from delivery_points where name='Gurgaon depot'")" = "$P0" ] && echo 1 || echo 0)" "points before=$P0 after=$(sql "select count(*) from delivery_points where name='Gurgaon depot'")"
bb vendor '.eway_bill_ref="1234 5678 9012"'; chk VE30 "bid 9000 for 1500 kg (an e-way bill with spaces is cleaned up)" "200 201"
BID1=$(jb .id); info "bid=$BID1 $(ev 240)"
bb vendor ''; chk VE31 "a second pending bid by the same vendor refused" 409
bb vendor2 '.bid_amount=8000'; chk VE32 "another vendor bids 8000" "200 201"
BID2=$(jb .id)
req vendor GET /capacity/bids/mine; t VE33 "'my bids' holds mine only" "$([ "$(echo "$BODY" | grep -c "$BID1")" -ge 1 ] && [ "$(echo "$BODY" | grep -c "$BID2")" = 0 ] && echo 1 || echo 0)" "$(jb 'length') bids; keys=$(jb '.[0]|keys|join(",")')"
req vendor2 GET /capacity/bids/mine; t VE34 "the other vendor's list holds theirs only" "$([ "$(echo "$BODY" | grep -c "$BID2")" -ge 1 ] && [ "$(echo "$BODY" | grep -c "$BID1")" = 0 ] && echo 1 || echo 0)" "$(jb length) bids"
req vendor GET /capacity/bids/pending; chk VE35 "a vendor cannot read the staff list of bids" 403
req vendor POST "/capacity/bids/$BID1/approve" '{}'; chk VE36 "a vendor cannot award their own bid" 403
req vendor2 POST "/capacity/bids/$BID1/reject" '{"reason":"nope"}'; chk VE37 "another vendor cannot reject my bid" 403
req vendor GET "/capacity/windows/$W2/bid-count"; info "bid count visible to a vendor: HTTP $ST $(ev 100)"
t VE38 "a vendor sees the number of bids but not other vendors' prices" "$(lacks "$BODY" 'bid_amount|8000|9000')" "$(ev 140)"
req superadmin GET /capacity/bids/pending; t VE39 "staff see both bids with company and price" "$([ "$(echo "$BODY" | grep -c "$BID1")" -ge 1 ] && [ "$(echo "$BODY" | grep -c "$BID2")" -ge 1 ] && echo 1 || echo 0)" "$(jb length) pending"
req superadmin POST "/capacity/bids/$BID2/reject" '{}'; chk VE40 "reject without a reason refused" 400
req superadmin POST "/capacity/bids/$BID2/reject" '{"reason":"Price too low for this lane"}'; chk VE41 "staff reject the 8000 bid with a reason" 200
req vendor2 GET /capacity/bids/mine; t VE42 "the vendor sees the rejection and the reason" "$([ "$(jb '[.[]|select(.id=="'"$BID2"'")][0].status')" = rejected ] && echo 1 || echo 0)" "$(jb '[.[]|select(.id=="'"$BID2"'")][0]|{status,rejection_reason,reason}|tostring')"
bb vendor2 '.bid_amount=7500'; chk VE43 "after a rejection the vendor can bid again" "200 201"
BID3=$(jb .id)
req superadmin POST "/capacity/bids/$BID1/approve" '{}'; chk VE50 "staff award the 9000 bid" 200
sleep 1
info "after the award: bid1=$(sql "select status from capacity_bids where id='$BID1'") bid3=$(sql "select status from capacity_bids where id='$BID3'") window=$(sql "select status from capacity_windows where id='$W2'") manifests/shipments made: $(sql "select count(*) from shipments where metadata::text like '%$BID1%'")/$(sql "select count(*) from cargo_manifest where created_at > now() - interval '3 minutes'")"
t VE51 "the winning bid is won" "$([ "$(sql "select status from capacity_bids where id='$BID1'")" = won ] && echo 1 || echo 0)" "bid1=$(sql "select status from capacity_bids where id='$BID1'")"
t VE52 "the other pending bid on the window is closed as lost when the window is awarded" "$([ "$(sql "select status from capacity_bids where id='$BID3'")" != pending ] && echo 1 || echo 0)" "bid3=$(sql "select status from capacity_bids where id='$BID3'")"
req superadmin POST "/capacity/bids/$BID1/approve" '{}'; chk VE53 "awarding the same bid again refused (409)" "400 409"
req superadmin POST "/capacity/bids/$BID3/approve" '{}'; chk VE54 "awarding a second bid on an awarded window refused" "400 409"
bb vendor2 '.bid_amount=9500'; chk VE55 "a new bid after the award refused (409)" 409
req vendor POST /capacity/bids "{\"window_id\":\"$STORY_WIN\",\"bid_amount\":99999,\"weight_kg\":10,\"dropoff_name\":\"Gurgaon depot\",\"dropoff_address\":\"Sector 18\",\"dropoff_lat\":28.47,\"dropoff_lng\":77.03}"; chk VE56 "a bid on the story's awarded window refused (409)" 409
req vendor GET /notifications; t VE57 "the winner was told" "$([ "$(jb '[.notifications[]|select((.title+.body)|test("won|awarded|accepted";"i"))]|length')" -ge 1 ] && echo 1 || echo 0)" "titles: $(jb '[.notifications[]|.title]|unique|join(" | ")' | cut -c1-400)"
req vendor2 GET /notifications; t VE58 "the other bidder was told they did not win" "$([ "$(jb '[.notifications[]|select((.title+.body)|test("lost|not won|not selected|rejected|closed";"i"))]|length')" -ge 1 ] && echo 1 || echo 0)" "titles: $(jb '[.notifications[]|.title]|unique|join(" | ")' | cut -c1-400)"
req vendor GET /vendor/loads; info "after winning, my loads board: $(jb 'length') rows, stages: $(jb '[.[]|.stage]|join(",")')"
info "the won space on the board: kinds $(jb '[.[]|.kind]|join(",")') bid rows: $(jb '[.[]|select(.kind!="posted")|{code,stage,price}|tostring]|join(" ")')"
# a driver-opened window has no minimum; the vendor's price is checked by the pricing engine
sql "update vehicles set latitude=28.6, longitude=77.2, current_location_name='Delhi', status='available', available_capacity_kg=8000 where id='$T2'" >/dev/null
req driverB POST /capacity/driver/open-backhaul-window "{\"vehicle_id\":\"$T2\",\"available_capacity_kg\":3000,\"trigger_type\":\"return_trip\"}"; chk VE60 "driver B opens a return trip (no minimum price)" "200 201"
W3=$(jb .id); info "driver window=$W3 floor=$(sql "select coalesce(floor_price::text,'null') from capacity_windows where id='$W3'")"
req vendor2 POST /capacity/bids "$(jq -nc --arg w "$W3" '{window_id:$w,bid_amount:1,weight_kg:500,dropoff_name:"Gurgaon depot",dropoff_address:"Sector 18",dropoff_lat:28.47,dropoff_lng:77.03}')"; t VE61 "a 1-rupee bid on a driver-opened trip is refused by the pricing engine" "$([ "$ST" = 400 ] && echo 1 || echo 0)" "HTTP $ST $(ev 200)"
sql "update capacity_windows set closes_at = now() - interval '1 minute' where id='$W3'" >/dev/null
req vendor2 POST /capacity/bids "$(jq -nc --arg w "$W3" '{window_id:$w,bid_amount:90000,weight_kg:500,dropoff_name:"Gurgaon depot",dropoff_address:"Sector 18",dropoff_lat:28.47,dropoff_lng:77.03}')"; chk VE62 "a bid on a window that has closed refused (409)" 409

sect "F. Documents and KYC (vendor3, a new sign-up)"
req vendor3 GET /vendor/profile; t VF01 "a new vendor gets an empty profile template, not an error" "$([ "$ST" = 200 ] && echo 1 || echo 0)" "$(ev 160)"
vp() { jq -nc '{companyName:"Naya Vyapar Pvt Ltd",gstNumber:"27AAPFU0939F1ZV",city:"Delhi",address:"Nehru Place, Delhi",lat:28.55,lng:77.25}'; }
bp() { req vendor3 POST /vendor/profile "$(vp | jq -c "$2")"; chk "$1" "$3" 400; }
bp VF10 '.companyName="A"' "a 1-character company name refused"
bp VF11 ".companyName=\"$(printf 'C%.0s' $(seq 1 201))\"" "a 201-character company name refused"
bp VF12 '.gstNumber="ABC123"' "a malformed GST number refused"
bp VF13 '.lat=200' "latitude 200 refused"
bp VF14 '.lat="north"' "latitude as text refused"
bp VF15 '.city=""' "no city refused"
bp VF16 ".address=\"$(printf 'A%.0s' $(seq 1 501))\"" "a 501-character address refused"
bp VF17 'del(.lng)' "no longitude refused"
req vendor3 POST /vendor/profile "$(vp | jq -c '.companyName="नया व्यापार प्राइवेट लिमिटेड" | .kyc_status="approved" | .is_verified=true')"; chk VF20 "save the profile (Hindi company name, with hostile kyc_status and is_verified fields)" 200
t VF21 "hostile fields are ignored: still not approved, not verified" "$([ "$(sql "select kyc_status from vendor_profiles where id='$V3'")" != approved ] && [ "$(sql "select is_verified from vendor_profiles where id='$V3'")" != t ] && echo 1 || echo 0)" "kyc_status=$(sql "select kyc_status,is_verified from vendor_profiles where id='$V3'")"
t VF22 "the Hindi company name is stored intact" "$([ "$(sql "select company_name from vendor_profiles where id='$V3'")" = "नया व्यापार प्राइवेट लिमिटेड" ] && echo 1 || echo 0)" "$(sql "select company_name from vendor_profiles where id='$V3'")"
req vendor3 POST /vendor/shipment-request "$(ld)"; chk VF23 "with a profile but no approved KYC, still no loads" 403
up() { req vendor3 POST /vendor/kyc/upload-url "$1"; }
up '{"content_type":"application/pdf","size":2000}'; chk VF30 "an upload with no document key refused" 400
up '{"key":"bad key!","content_type":"application/pdf","size":2000}'; chk VF31 "a document key with spaces refused" 400
up '{"key":"gst_certificate","content_type":"text/html","size":2000}'; chk VF32 "an HTML file refused" 415
up '{"key":"gst_certificate","content_type":"application/pdf","size":0}'; chk VF33 "size 0 refused" 400
up '{"key":"gst_certificate","content_type":"application/pdf","size":-5}'; chk VF34 "negative size refused" 400
up '{"key":"gst_certificate","content_type":"application/pdf","size":"big"}'; chk VF35 "text size refused" 400
up '{"key":"gst_certificate","content_type":"application/pdf","size":900000000}'; chk VF36 "a 900 MB file refused" 413
up '{"key":"gst_certificate","content_type":"application/pdf","size":2000}'; chk VF37 "a signed upload URL for a PDF" 200
DOCPATH=$(jb .path); SIGNED=$(jb .signed_url)
t VF38 "the path is inside the vendor's own folder" "$([ "${DOCPATH%%/*}" = "$V3" ] && echo 1 || echo 0)" "path=$DOCPATH"
printf '%%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%%%EOF\n' > /tmp/uat-kyc.pdf
UPST=$(curl -s -o /tmp/uat-up.txt -w '%{http_code}' -X PUT -H 'content-type: application/pdf' --data-binary @/tmp/uat-kyc.pdf "$SIGNED"); info "upload to the signed URL: HTTP $UPST $(head -c 160 /tmp/uat-up.txt)"
t VF39 "the file was stored" "$([ "$UPST" = 200 ] && echo 1 || echo 0)" "HTTP $UPST"
kd() { req vendor3 PUT /vendor/kyc/documents "$1"; }
kd "{\"docUrls\":{\"gst_certificate\":\"$DOCPATH\"}}"; chk VF40 "save the uploaded document" 200
kd "{\"docUrls\":{\"gst_certificate\":\"$V2/stolen.pdf\"}}"; chk VF41 "a path in another vendor's folder refused" 400
kd "{\"docUrls\":{\"gst_certificate\":\"$V3/../$V2/x.pdf\"}}"; chk VF42 "a path with .. refused" 400
kd "{\"docUrls\":{\"bad key\":\"$DOCPATH\"}}"; chk VF43 "a document key with a space refused" 400
kd '{}'; chk VF44 "saving nothing refused" 400
kd "{\"otherDocs\":[$(for i in $(seq 1 11); do printf '{"name":"d%s","path":"%s/o%s.pdf"},' $i "$V3" $i; done | sed 's/,$//')]}"; chk VF45 "11 other documents refused" 400
req vendor2 PUT /vendor/kyc/documents "{\"docUrls\":{\"x\":\"$DOCPATH\"}}"; chk VF46 "another vendor cannot attach my document" 400
sb() { req vendor3 POST /vendor/kyc/submit "$(vp | jq -c ". + {kycData:{data:{panNumber:\"AAPFU0939F\",docUrls:{gst_certificate:\"$DOCPATH\"}},otherDocs:[]}} | $1")"; }
sb '.kycData.data.panNumber="12345"'; chk VF50 "a malformed PAN refused" 400
sb 'del(.kycData)'; chk VF51 "no KYC data refused" 400
sb '.kycData.data.docUrls.gst_certificate="'"$V2"'/x.pdf"'; chk VF52 "a document of another vendor refused" 400
sb '.companyLogo="../x.png"'; chk VF53 "a logo path outside the folder refused" 400
sb '.kycData.data.pad="'"$(printf 'P%.0s' $(seq 1 110000))"'"'; chk VF54 "a 110 KB KYC form refused" 400
sb '.'; chk VF55 "submit the KYC" 200
t VF56 "the profile is now waiting for review" "$([ "$(sql "select kyc_status from vendor_profiles where id='$V3'")" = submitted ] && echo 1 || echo 0)" "kyc_status=$(sql "select kyc_status from vendor_profiles where id='$V3'")"
t VF57 "staff were told a KYC was submitted" "$([ "$(sql "select count(*) from notifications where title='KYC submitted' and created_at > now() - interval '10 minutes'")" -ge 1 ] && echo 1 || echo 0)" "$(sql "select count(*) from notifications where title='KYC submitted'")"
req vendor3 POST /vendor/shipment-request "$(ld)"; chk VF58 "while the KYC is in review the vendor still cannot post a load" 403
req manager PUT "/vendor/kyc/$V3/approve" '{}'; chk VF60 "a manager cannot approve a KYC" 403
req vendor3 PUT "/vendor/kyc/$V3/approve" '{}'; chk VF61 "a vendor cannot approve their own KYC" 403
req vendor2 PUT "/vendor/kyc/$V3/approve" '{}'; chk VF62 "another vendor cannot approve it" 403
req vendor3 PUT "/vendor/$V3/location" '{"lat":1,"lng":1}'; chk VF63 "a vendor cannot move their own pickup point through the staff route" 403
req superadmin PUT "/vendor/kyc/$V3/reject" '{}'; chk VF64 "reject with no reason refused" 400
req superadmin PUT "/vendor/kyc/00000000-0000-0000-0000-000000000000/approve" '{}'; chk VF65 "approve an unknown vendor" 404
req superadmin PUT "/vendor/kyc/$V3/reject" '{"reason":"GST certificate is not readable"}'; chk VF66 "staff reject with a reason" 200
req vendor3 GET /vendor/profile; t VF67 "the vendor sees why" "$([ "$(jb .kyc_status)" = rejected ] && [ "$(has "$BODY" 'GST certificate')" = 1 ] && echo 1 || echo 0)" "status=$(jb .kyc_status) reason=$(jb .kyc_rejection_reason)"
req superadmin PUT "/vendor/kyc/$V3/reject" '{"reason":"again"}'; chk VF68 "rejecting twice refused (409)" 409
sb '.'; chk VF70 "the vendor resubmits" 200
req superadmin PUT "/vendor/kyc/$V3/approve" '{}'; chk VF71 "staff approve" 200
req superadmin PUT "/vendor/kyc/$V3/approve" '{}'; chk VF72 "approving again refused (409)" 409
req vendor3 POST /vendor/shipment-request "$(ld)"; chk VF73 "an approved vendor can post a load" "200 201"
req vendor3 GET /notifications; t VF74 "the vendor was told about the rejection and the approval" "$([ "$(jb '[.notifications[]|select(.title|test("KYC"))]|length')" -ge 2 ] && echo 1 || echo 0)" "$(jb '[.notifications[]|.title]|join(" | ")')"
req vendor3 POST /vendor/profile "$(vp | jq -c '.address="Saket, New Delhi"')"; info "an approved vendor changes the address: HTTP $ST kyc_status now $(sql "select kyc_status from vendor_profiles where id='$V3'")"
info "an approved vendor changes only the address: kyc_status is now $(sql "select kyc_status from vendor_profiles where id='$V3'") (the web asks first; the API answers 200 with no warning)"
req vendor3 POST /vendor/shipment-request "$(ld)"; info "post a load after the address change: HTTP $ST $(ev 120)"
req vendor GET /vendor/rates; chk VF80 "market rates" 200
req vendor GET /vendor/passing-routes; chk VF81 "passing routes" 200

sect "G. Another vendor's data (everything must be refused)"
req vendor2 GET "/vendor/loads/$L1"; chk VG01 "open my load" 404
req vendor2 PUT "/vendor/shipment-request/$L1/cancel" '{}'; chk VG02 "cancel my load" 404
req vendor2 GET "/cargo/where/$MAN"; t VG03 "read where my load is" "$([ "$ST" = 403 ] || [ "$ST" = 404 ] && echo 1 || echo 0)" "HTTP $ST $(ev 160)"
req vendor2 GET "/cargo/timeline/$MAN"; t VG04 "read my load's timeline" "$([ "$ST" = 403 ] || [ "$ST" = 404 ] && echo 1 || echo 0)" "HTTP $ST $(ev 160)"
req vendor2 GET "/cargo/where/$LA"; t VG05 "read a customer shipment" "$([ "$ST" = 403 ] || [ "$ST" = 404 ] && echo 1 || echo 0)" "HTTP $ST $(ev 160)"
req vendor2 GET "/invoices/$VI"; chk VG06 "read my invoice" 403
req vendor2 GET "/telemetry/$T1/live"; t VG07 "read my load's truck live position" "$([ "$ST" = 403 ] || [ "$ST" = 404 ] && echo 1 || echo 0)" "HTTP $ST $(ev 160)"
req vendor2 GET "/vehicles/$T1"; t VG08 "read the truck record" "$([ "$ST" = 403 ] || [ "$ST" = 404 ] && echo 1 || echo 0)" "HTTP $ST $(ev 160)"
req vendor2 GET /vehicles; t VG09 "list the fleet" "$([ "$ST" = 403 ] && echo 1 || echo 0)" "HTTP $ST $(ev 120)"
req vendor2 GET /routes; t VG10 "list trips" "$([ "$ST" = 403 ] && echo 1 || echo 0)" "HTTP $ST $(ev 120)"
req vendor2 GET /shipments; chk VG11 "list shipments" 403
req vendor2 GET /bookings; chk VG12 "list customer bookings" 403
req vendor2 GET /customer/bookings; chk VG13 "use customer bookings" 403
req vendor2 GET /ops/today; chk VG14 "read Today" 403
req vendor2 GET /finance/summary; chk VG15 "read the finance summary" 403
req vendor2 GET /driver-pay/entries; chk VG16 "read driver pay" 403
req vendor2 GET /vendor/shipment-request/pending; chk VG17 "read the staff list of requests needing a truck" 403
req vendor2 GET "/people/$V1"; t VG18 "read my people record" "$([ "$ST" = 403 ] || [ "$ST" = 404 ] && echo 1 || echo 0)" "HTTP $ST $(ev 120)"
req vendor2 GET /users; chk VG19 "list users" 403
req vendor2 GET /cargo/exceptions; chk VG20 "read cases" 403
req vendor2 GET /cargo/hubs; chk VG21 "read hubs" 403
req vendor2 GET /tpl/queue; chk VG22 "read the 3PL queue" 403
req vendor2 GET /tpl-network/orders; chk VG23 "read 3PL orders" 403
req vendor2 GET /search?q=Acme; t VG24 "search finds nothing of mine" "$([ "$ST" = 403 ] || [ "$(echo "$BODY" | grep -c 'Acme')" = 0 ] && echo 1 || echo 0)" "HTTP $ST $(ev 160)"
req vendor2 GET /notifications; t VG25 "their notifications hold none of mine" "$([ "$(echo "$BODY" | grep -c "$L1")" = 0 ] && echo 1 || echo 0)" "total=$(jb .total)"
req vendor2 GET "/messages?route_id=$MAN"; chk VG26 "read the chat of my load" "403 404"
req vendor2 GET /vendor/profile; t VG27 "their own profile is their own, not mine" "$([ "$(jb .id)" = "$V2" ] && echo 1 || echo 0)" "id=$(jb .id)"
req vendor2 PUT "/vendor/$V1/location" '{"lat":10,"lng":10}'; chk VG28 "move my pickup point" 403

sect "H. 3PL onboarding (public) and staff verification"
xf() { echo "--hdr X-Forwarded-For:10.77.$1.$2"; }
PANA=AAPFU0939F
tpl() { jq -nc --arg e "$1" --arg c "$2" --arg id "$3" --arg pan "${4:-ABCDE1234F}" --arg gst "${5:-27ABCDE1234F1Z0}" '{custom_id:$id,companyName:$c,email:$e,pan:$pan,phone:"9876543210",msmeStatus:"Small",slaCommitment:"4 Hours",taxTreatment:"12% GTA (With ITC) - Forward Charge",corridors:[{name:"Delhi - Jaipur",vehicles:"Truck, Trailer",rate:25000,rate_unit:"per_trip",priority:"1"}],documents:[]}+(if $gst!="" then {gst:$gst} else {} end)'; }
n=1; ob() { n=$((n+1)); req anon POST /tpl/onboard "$1" --hdr "X-Forwarded-For:10.77.1.$n"; }
ob "$(tpl uat-a1@example.test "Sharma Roadlines" uat_tpl_a1 "$PANA" 27AAPFU0939F1ZV)"; chk VH01 "apply as a 3PL partner" "200 201"
TA=$(jb .data.id); TAC=$(jb .data.custom_id); TBC=uat_tpl_b1; info "application id=$TA custom_id=$TAC status=$(jb .data.status)"
t VH02 "the application starts pending, with an id to track it by" "$([ "$(jb .data.status)" = pending ] && [ -n "$TA" ] && echo 1 || echo 0)" "$(ev 160)"
ob "$(tpl uat-b1@example.test "भारत परिवहन सेवा" uat_tpl_b1)"; chk VH03 "apply with a Hindi company name" "200 201"
TB=$(jb .data.id)
ob "$(tpl uat-a1@example.test "Duplicate Email Co" uat_tpl_a2)"; chk VH04 "the same email twice refused" 409
ob "$(tpl uat-c1@example.test "Dup Id Co" uat_tpl_a1)"; chk VH05 "the same partner ID twice refused" 409
ob "$(tpl uat-d1@example.test "Bad Pan Co" uat_tpl_d1 | jq -c '.pan="12345"')"; chk VH06 "a malformed PAN refused" 400
ob "$(tpl uat-e1@example.test "Bad Gst Co" uat_tpl_e1 | jq -c '.gst="07ZZZZZ9999Z1Z5"')"; chk VH07 "a GSTIN that does not match the PAN refused" 400
ob "$(tpl uat-f1@example.test "Bad Phone Co" uat_tpl_f1 | jq -c '.phone="12345"')"; chk VH08 "a malformed mobile number refused" 400
ob "$(tpl uat-g1@example.test "$(printf 'C%.0s' $(seq 1 5000))" uat_tpl_g1)"; chk VH09 "a 5000-character company name refused" 400
ob "$(tpl uat-h1@example.test "Bad Rate Co" uat_tpl_h1 | jq -c '.corridors[0].rate=-5')"; chk VH10 "a negative corridor rate refused" 400
ob "$(tpl uat-i1@example.test "No Unit Co" uat_tpl_i1 | jq -c 'del(.corridors[0].rate_unit)')"; chk VH11 "a rate with no unit refused" 400
ob "$(tpl uat-j1@example.test "Bad Id Co" 'AB')"; chk VH12 "a partner ID of 2 letters refused" 400
ob "$(tpl uat-k1@example.test "Bad Bank Co" uat_tpl_k1 | jq -c '.bankAccount="abc"')"; chk VH13 "a bank account of letters refused" 400
ob "$(tpl uat-l1@example.test "Bad Sla Co" uat_tpl_l1 | jq -c '.slaCommitment="1 Minute"')"; chk VH14 "an unknown SLA refused" 400
ob "$(tpl 'not-an-email' "Bad Email Co" uat_tpl_m1)"; info "a malformed email: HTTP $ST $(ev 140)"
t VH15 "a malformed email address is refused" "$([ "$ST" = 400 ] && echo 1 || echo 0)" "HTTP $ST $(ev 140)"
ob '{"companyName":"No Email Co","pan":"ABCDE1234F"}'; chk VH16 "no email refused" 400
RLC=0; for i in $(seq 1 7); do req anon POST /tpl/onboard '{"companyName":"x"}' --hdr "X-Forwarded-For:10.88.0.1"; [ "$ST" = 429 ] && RLC=$((RLC+1)); done
t VH17 "onboarding is rate limited per address (5 an hour)" "$([ "$RLC" -ge 1 ] && echo 1 || echo 0)" "429s in 7 calls from one address: $RLC"
req anon GET "/tpl/$TAC"; chk VH20 "track the application by its partner ID" 200
t VH21 "the public view shows status only: no PAN, email, phone, bank or GSTIN" "$(lacks "$BODY" 'pan_number|AAPFU0939F|9876543210|bank_account|"email"|uat-a1@|gstin|phone')" "keys=$(jb 'keys|join(",")') leaks: $(printf '%s' "$BODY" | grep -oiE 'pan_number|AAPFU0939F|9876543210|bank_account|"email"|uat-a1@|gstin|"phone"' | sort -u | tr '\n' ' ')"
t VH22 "the status is pending and the email is masked" "$([ "$(jb .status)" = pending ] && [ "$(has "$(jb .email_masked)" '\*\*\*')" = 1 ] && echo 1 || echo 0)" "status=$(jb .status) email_masked=$(jb .email_masked)"
req anon GET "/tpl/$TA"; t VH23 "by the internal id too, still only the public view" "$([ "$ST" = 200 ] && [ "$(has "$BODY" 'pan_number')" = 0 ] && echo 1 || echo 0)" "HTTP $ST"
req anon GET "/tpl/$TAC?pan=$PANA"; t VH24 "with the right PAN the applicant sees the full record" "$([ "$ST" = 200 ] && [ "$(has "$BODY" 'pan_number')" = 1 ] && echo 1 || echo 0)" "HTTP $ST keys=$(jb 'keys|join(",")'|cut -c1-200)"
req anon GET "/tpl/$TAC?pan=ZZZZZ9999Z"; t VH25 "with a wrong PAN only the public view" "$([ "$(has "$BODY" 'pan_number')" = 0 ] && echo 1 || echo 0)" "HTTP $ST"
req anon GET /tpl/does_not_exist; chk VH26 "an unknown application is a 404" 404
req anon GET "/tpl/$TAC'%20OR%201=1"; t VH27 "an injection-looking id is a clean 404/400" "$([ "$ST" = 404 ] || [ "$ST" = 400 ] && echo 1 || echo 0)" "HTTP $ST $(ev 100)"
LOCK=0; for i in $(seq 1 12); do req anon GET "/tpl/$TBC?pan=AAAAA000${i}A" --hdr "X-Forwarded-For:10.99.0.5"; [ "$ST" = 429 ] && LOCK=$((LOCK+1)); done
t VH28 "guessing the PAN is limited (10 tries per 15 minutes)" "$([ "$LOCK" -ge 1 ] && echo 1 || echo 0)" "429s in 12 guesses: $LOCK"
req anon PATCH "/tpl/$TAC" '{"companyName":"Hijacked"}'; chk VH30 "edit an application with no PAN refused" 403
req anon PATCH "/tpl/$TAC" "{\"companyName\":\"Hijacked\",\"verify_pan\":\"ZZZZZ9999Z\",\"pan\":\"$PANA\"}" --hdr "X-Forwarded-For:10.99.0.6"; chk VH31 "edit with a wrong PAN refused" 403
req anon PATCH "/tpl/$TAC" "{\"companyName\":\"Sharma Roadlines (Delhi)\",\"pan\":\"$PANA\",\"verify_pan\":\"$PANA\",\"slaCommitment\":\"6 Hours\"}" --hdr "X-Forwarded-For:10.99.0.7"; chk VH32 "the applicant edits their pending application with the PAN" 200
req anon GET "/tpl/$TAC"; t VH32b "the partner ID the applicant was given still works after they edit the application" "$([ "$ST" = 200 ] && echo 1 || echo 0)" "HTTP $ST custom_id now: $(sql "select coalesce(custom_id,'NULL') from tpl_partners where id='$TA'")"
req anon PATCH "/tpl/$TA" "{\"companyName\":\"Sharma Roadlines (Delhi)\",\"pan\":\"$PANA\",\"verify_pan\":\"$PANA\",\"gst\":\"27AAPFU0939F1ZV\",\"slaCommitment\":\"6 Hours\"}" --hdr "X-Forwarded-For:10.99.0.12"; chk VH32c "the same edit through the internal id (what the web form uses) works" 200
req anon GET "/tpl/$TAC"; t VH32d "after an edit through the API (without re-sending the partner ID) the application can still be found by its partner ID" "$([ "$ST" = 200 ] && echo 1 || echo 0)" "HTTP $ST custom_id=$(sql "select coalesce(custom_id,'NULL') from tpl_partners where id='$TA'") msme_status=$(sql "select msme_status from tpl_partners where id='$TA'") (it was Small) tax_treatment=$(sql "select coalesce(tax_treatment,'NULL') from tpl_partners where id='$TA'")"
t VH33 "the edit was saved" "$([ "$(sql "select company_name from tpl_partners where id='$TA'")" = "Sharma Roadlines (Delhi)" ] && echo 1 || echo 0)" "$(sql "select company_name,sla_commitment from tpl_partners where id='$TA'")"
req anon POST /tpl/applications/upload-url '{"custom_id":"uat_tpl_a1","doc_type":"pan_card","content_type":"application/pdf","size":2000}' --hdr "X-Forwarded-For:10.99.0.8"; info "public document upload URL for a new application: HTTP $ST $(ev 140)"
req anon POST /tpl/applications/upload-url '{"custom_id":"uat_tpl_a1","doc_type":"pan_card","content_type":"text/html","size":2000}' --hdr "X-Forwarded-For:10.99.0.9"; chk VH34 "an HTML upload refused" "400 415"
req anon POST /tpl/applications/upload-url '{"custom_id":"uat_tpl_a1","doc_type":"pan_card","content_type":"application/pdf","size":900000000}' --hdr "X-Forwarded-For:10.99.0.10"; chk VH35 "a 900 MB upload refused" "400 413"
req anon GET /tpl/queue; chk VH40 "the anonymous visitor cannot see the queue" 401
req vendor GET /tpl/queue; chk VH41 "a vendor cannot see the queue" 403
req manager GET /tpl/queue; t VH42 "a manager cannot see the partner queue (admin or superadmin only)" "$([ "$ST" = 403 ] && echo 1 || echo 0)" "HTTP $ST"
req superadmin GET /tpl/queue; chk VH43 "staff see the pending queue" 200
t VH44 "both applications are in it" "$([ "$(echo "$BODY" | grep -c "$TA")" -ge 1 ] && [ "$(echo "$BODY" | grep -c "$TB")" -ge 1 ] && echo 1 || echo 0)" "$(jb length) pending"
req manager POST "/tpl/approve/$TA" '{}'; chk VH45 "a manager cannot approve" 403
req vendor POST "/tpl/approve/$TA" '{}'; chk VH46 "a vendor cannot approve" 403
req anon POST "/tpl/approve/$TA" '{}'; chk VH47 "no sign-in, no approval" 401
req superadmin POST "/tpl/reject/$TB" '{}'; chk VH48 "reject with no reason refused" 400
req superadmin POST "/tpl/approve/00000000-0000-0000-0000-000000000000" '{}'; chk VH49 "approve an unknown partner" 404
req superadmin POST "/tpl/approve/$TA" '{}'; chk VH50 "the superadmin approves Sharma Roadlines" 200
req superadmin POST "/tpl/approve/$TA" '{}'; chk VH51 "approving twice refused (409)" 409
req anon GET "/tpl/$TA"; t VH52 "tracking now shows approved" "$([ "$(jb .status)" = active ] || [ "$(jb .status)" = approved ] && echo 1 || echo 0)" "status=$(jb .status)"
req superadmin POST "/tpl/reject/$TB" '{"reason":"दस्तावेज़ अधूरे हैं"}'; chk VH53 "the superadmin rejects the Hindi-named one with a Hindi reason" 200
req anon GET "/tpl/$TB"; t VH54 "the applicant sees the reason on the tracking page" "$([ "$(jb .status)" = rejected ] && [ "$(jb .rejection_reason)" = "दस्तावेज़ अधूरे हैं" ] && echo 1 || echo 0)" "status=$(jb .status) reason=$(jb .rejection_reason)"
req superadmin POST "/tpl/approve/$TB" '{}'; info "approving a rejected application: HTTP $ST $(ev 120)"
req anon PATCH "/tpl/$TB" '{"companyName":"x","pan":"ABCDE1234F","verify_pan":"ABCDE1234F","gst":"27ABCDE1234F1Z0"}' --hdr "X-Forwarded-For:10.99.0.11"; t VH55 "a rejected application cannot be edited back to life without staff (409)" "$([ "$ST" = 409 ] && echo 1 || echo 0)" "HTTP $ST $(ev 120)"
# set the password and sign in
req anon POST /tpl/auth/send-otp '{"email":"uat-a1@example.test"}' --hdr "X-Forwarded-For:10.99.1.1"; chk VH60 "the approved partner asks for a set-up code" 200
sleep 1
TOTP=$(grep -a "development OTP for uat-a1@example.test" "$BACKEND_LOG" 2>/dev/null | tail -1 | grep -oE '[0-9]{6}$')
info "set-up code found in the dev log: ${TOTP:+yes}${TOTP:-no}"
req anon POST /tpl/auth/send-otp '{"email":"nobody@example.test"}' --hdr "X-Forwarded-For:10.99.1.2"; t VH61 "an unknown email gets the same answer (no way to tell who is a partner)" "$([ "$ST" = 200 ] && echo 1 || echo 0)" "HTTP $ST $(ev 140)"
req anon POST /tpl/auth/send-otp '{"email":"x"}' --hdr "X-Forwarded-For:10.99.1.3"; chk VH62 "a malformed email refused" 400
req anon POST /tpl/auth/setup-password '{"email":"uat-a1@example.test","otp":"000000","password":"E2e-Local-Pass-1"}' --hdr "X-Forwarded-For:10.99.1.4"; t VH63 "a wrong set-up code refused" "$([ "$ST" -ge 400 ] && [ "$ST" -lt 500 ] && echo 1 || echo 0)" "HTTP $ST $(ev 140)"
req anon POST /tpl/auth/setup-password "{\"email\":\"uat-a1@example.test\",\"otp\":\"${TOTP:-000000}\",\"password\":\"short\"}" --hdr "X-Forwarded-For:10.99.1.5"; chk VH64 "a 5-letter password refused" 400
req anon POST /tpl/auth/setup-password "{\"email\":\"uat-a1@example.test\",\"otp\":\"${TOTP:-000000}\",\"password\":\"E2e-Local-Pass-1\"}" --hdr "X-Forwarded-For:10.99.1.6"; chk VH65 "set the password with the right code" 200
req anon POST /tpl/auth/setup-password "{\"email\":\"uat-a1@example.test\",\"otp\":\"${TOTP:-000000}\",\"password\":\"E2e-Local-Pass-2\"}" --hdr "X-Forwarded-For:10.99.1.7"; t VH66 "the same code cannot be used twice" "$([ "$ST" -ge 400 ] && [ "$ST" -lt 500 ] && echo 1 || echo 0)" "HTTP $ST $(ev 140)"
GT=$(curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" -H "apikey: $SUPABASE_ANON_KEY" -H 'content-type: application/json' -d '{"email":"uat-a1@example.test","password":"E2e-Local-Pass-1"}')
PTOK=$(echo "$GT" | jq -r .access_token); PUID=$(echo "$GT" | jq -r .user.id)
t VH67 "the partner signs in with the new password" "$([ "$PTOK" != null ] && [ -n "$PTOK" ] && echo 1 || echo 0)" "user=$PUID $(echo "$GT" | cut -c1-100)"
jq --arg id "$PUID" '. + {tpl1:{id:$id,email:"uat-a1@example.test",role:"vendor",password:"E2e-Local-Pass-1"}}' "$ACC" > /tmp/acc.json && cp /tmp/acc.json "$ACC"
pc() { req anon "$1" "$2" "${3:-}" --token "$PTOK"; }
pc GET /tpl-network/my/offers; chk VH70 "the partner's offers" 200
pc GET /tpl-network/my/orders; chk VH71 "the partner's orders" 200
pc GET /tpl-network/my/earnings; chk VH72 "the partner's earnings" 200
pc GET /tpl-network/my/stats; chk VH73 "the partner's stats" 200
pc GET "/tpl/by-user/$PUID"; chk VH74 "the partner reads their own record" 200
pc GET "/tpl/$TA"; t VH75 "the partner's full record" "$([ "$ST" = 200 ] && [ "$(has "$BODY" 'pan_number')" = 1 ] && echo 1 || echo 0)" "HTTP $ST"
pc GET /tpl-network/orders; chk VH76 "a partner cannot read the staff orders list" 403
pc GET /tpl-network/settings; chk VH77 "a partner cannot read network settings" 403
pc GET /tpl/queue; chk VH78 "a partner cannot read the queue" 403
pc GET /vendor/loads; info "a 3PL partner on the vendor loads route: HTTP $ST"
pc POST /vendor/shipment-request "$(ld)"; t VH79 "a 3PL partner cannot post vendor loads without a vendor KYC" "$([ "$ST" = 403 ] && echo 1 || echo 0)" "HTTP $ST $(ev 140)"
pc GET "/tpl/by-user/$V1"; chk VH80 "the partner cannot read another account's partner record" 403
pc GET "/tpl/$TB"; t VH81 "the partner sees only the public view of another application" "$([ "$(has "$BODY" 'pan_number')" = 0 ] && echo 1 || echo 0)" "HTTP $ST"
pc POST "/tpl/$TB/settings" '{"sla_commitment":"2 Hours","tax_treatment":"12% GTA (With ITC) - Forward Charge","corridors":[]}'; t VH82 "the partner cannot change another application's settings" "$([ "$ST" = 403 ] || [ "$ST" = 404 ] && echo 1 || echo 0)" "HTTP $ST $(ev 140)"
pc POST "/tpl/$TA/settings" '{"sla_commitment":"1 Minute","tax_treatment":"x","corridors":[]}'; chk VH83 "an invalid SLA in a settings request refused" 400
pc POST "/tpl/$TA/settings" '{"sla_commitment":"2 Hours","tax_treatment":"12% GTA (With ITC) - Forward Charge","corridors":[{"name":"Delhi - Mumbai","vehicles":"Truck","rate":41200,"rate_unit":"per_trip","priority":"1"}]}'; chk VH84 "the partner asks for new settings and a new corridor" 200
info "after a settings request: partner status=$(sql "select status from tpl_partners where id='$TA'") pending_updates=$(sql "select (pending_updates is not null) from tpl_partners where id='$TA'")"
pc GET /tpl-network/my/offers; info "offers while the settings request is in review: HTTP $ST $(ev 120)"
req superadmin POST "/tpl/approve/$TA" '{}'; chk VH85 "staff approve the settings change" 200
req manager POST "/tpl/$TA/pause" '{}'; chk VH86 "a manager cannot pause a partner" 403
req superadmin POST "/tpl/$TA/pause" '{}'; chk VH87 "the superadmin pauses the partner" 200
pc GET /tpl-network/my/offers; info "offers while paused: HTTP $ST $(ev 120)"
t VH88 "a paused partner gets no offers (empty list or refused)" "$([ "$ST" = 403 ] || [ "$ST" = 404 ] || { [ "$ST" = 200 ] && [ "$(jb length)" = 0 ]; } && echo 1 || echo 0)" "HTTP $ST $(ev 80)"
req superadmin POST "/tpl/$TA/resume" '{}'; chk VH89 "resume" 200

sect "I. Web: the vendor portal and 3PL pages"
ui vendor /vendor/loads
ui vendor "/vendor/loads/$L1"
ui vendor /vendor/request
ui vendor /vendor/return-trips
ui vendor /vendor/invoices
ui vendor /vendor/claims
ui vendor /vendor/company
ui vendor /vendor/onboarding
ui vendor /vendor/loads --width 390
ui vendor /vendor/request --width 390
ui vendor /vendor/invoices --width 390
ui vendor3 /vendor/loads
ui anon /vendor/return-trips
ui anon /vendor/loads
ui anon /3pl/onboard
ui anon /3pl/onboard --width 390
ui anon "/3pl/onboard/track?id=$TAC"
ui anon "/3pl/onboard/track?id=$TAC" --width 390
ui anon "/3pl/onboard/track?id=$TB"
ui tpl1 "/3pl-portal/$TA"
ui vendor /today
sect "End"
