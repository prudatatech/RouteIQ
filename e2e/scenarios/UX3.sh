#!/usr/bin/env bash
# UX review, pass 2.
#   Part A  re-shoots the pages and states of pass 1 (UX.sh and UX2.sh) to verify the fixes.
#   Part B  fills the pass 1 gaps: creates a waiting booking, an accepted one with no vehicle and an assigned one that
#           is not sent; then the Accept, Assign, Send forms, the Create shipment steps, the shipment actions,
#           rating, fuel, claims, the manager's views, status colours, keyboard focus order and 390 px overflow.
# PARTS="B" bash e2e/scenarios/UX3.sh runs only part B. Part A stops starting new sections after 22 minutes.
# Keeps going when a page or step fails.
cd "$(dirname "$0")/../.."
S=e2e/scenarios/ux
PARTS=${PARTS:-"A B"}
START=$SECONDS
mkdir -p e2e/out
ui() { echo; echo "##### ui $*"; timeout 300 node e2e/ui.mjs "$@" 2>&1; }
ux() { echo; echo "##### ux $*"; timeout 300 node e2e/ux.mjs "$@" 2>&1; }
uxp() { echo; echo "##### ux $*"; timeout 300 node e2e/ux.mjs "$@" 2>&1 | tee -a e2e/out/pills.raw; }
api() { node e2e/uat.mjs "$@" 2>&1; }
bodyof() { node e2e/uat.mjs "$@" 2>&1 | tail -n +2; }
id() { node e2e/uat.mjs sql "$1" 2>&1 | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1; }
tid() { node e2e/uat.mjs sql "$1" 2>&1 | grep -oE 'RTX-[A-Z0-9-]+|CM-[A-Z0-9-]+' | head -1; }
section() { if [ $((SECONDS - START)) -gt 1320 ]; then echo "SKIPPED (time budget) $1"; return 1; fi; echo; echo "=================== $1 ($((SECONDS - START))s)"; return 0; }

############ ids from the seeded data (before part B changes anything)
MASTER=$(id "select id from shipments where is_master order by created_at limit 1")
LOT=$(id "select id from shipments where parent_shipment_id is not null order by created_at limit 1")
LONE=$(id "select id from shipments where parent_shipment_id is null and not coalesce(is_master,false) order by created_at limit 1")
TRIP=$(id "select id from routes order by created_at limit 1")
TRIP2=$(id "select id from routes order by created_at desc limit 1")
TRIPA=$(id "select id from routes where status='active' limit 1")
VEH=$(id "select id from vehicles order by created_at limit 1")
INV=$(id "select id from invoices order by created_at limit 1")
INVI=$(id "select id from invoices where status='issued' limit 1")
EXC=$(id "select id from cargo_exceptions order by created_at limit 1")
EXCO=$(id "select id from cargo_exceptions where status='open' limit 1")
EXCR=$(id "select id from cargo_exceptions where status<>'open' limit 1")
TRF=$(id "select id from cargo_transfers order by created_at limit 1")
DRV=$(id "select id from users where role='driver' order by created_at limit 1")
VLOAD=$(id "select id from vendor_shipment_requests order by created_at limit 1")
TRK=$(tid "select tracking_id from shipments where parent_shipment_id is null order by created_at limit 1")
LTRK=$(tid "select tracking_id from shipments where parent_shipment_id is not null order by created_at limit 1")
echo "ids master=$MASTER lot=$LOT lone=$LONE trip=$TRIP tripa=$TRIPA vehicle=$VEH invoice=$INV exc=$EXC exco=$EXCO excr=$EXCR trf=$TRF driver=$DRV vload=$VLOAD trk=$TRK ltrk=$LTRK"
echo "--- data shape"
node e2e/uat.mjs sql "select status, count(*) from shipments group by 1 order by 1" 2>&1 | head -20

############ PART A: re-shoot of pass 1
a1() { section "A1 superadmin 1440 px: requests, shipments, dispatch, trips" || return
  ui superadmin /today /requests /requests?tab=accepted /requests?tab=progress /requests?tab=done /requests?tab=closed /requests?tab=all /requests?source=vendor
  ui superadmin /shipments "/shipments?status=delivered" "/shipments?status=in_transit" "/shipments?q=zzzzqq" /shipments/00000000-0000-0000-0000-000000000000
  ui superadmin "/shipments?open=$MASTER" --steps $S/drawer-assign.json
  ui superadmin "/shipments?open=$LOT" --steps $S/drawer-assign.json
  ui superadmin "/shipments/$MASTER" "/shipments/$LOT" "/shipments/$LONE" "/shipments/$LOT/manifest"
  ui superadmin /shipments --steps $S/wizard.json
  ui superadmin /dispatch --steps $S/assign.json
  ui superadmin "/dispatch?tab=to-send" "/dispatch?tab=plan" "/dispatch?tab=optimize"
  ui superadmin /routes "/routes?status=pending" "/routes?status=active" "/routes?status=completed" "/routes?status=cancelled" "/routes/$TRIP" "/routes/$TRIP2"
  ui superadmin /live-map /emergency
}
a2() { section "A2 superadmin: problems, fleet, people" || return
  ui superadmin /cargo "/cargo?tab=transfers" "/cargo?tab=hubs" "/cargo?tab=claims" "/cargo/exceptions/$EXC" "/cargo/transfers/$TRF" /cargo/exceptions/not-an-id
  ui superadmin /cargo --steps $S/raise-problem.json
  ui superadmin "/cargo?tab=transfers" --steps $S/transfer.json
  ui superadmin "/cargo?tab=claims" --steps $S/claims-row.json
  ui superadmin /fleet "/fleet?view=analytics" "/fleet?view=alerts" "/fleet?view=service" "/fleet?tab=analytics" /vehicle-requests
  ui superadmin "/fleet/$VEH" "/fleet/$VEH?tab=location" "/fleet/$VEH?tab=maintenance" "/fleet/$VEH?tab=fuel" "/fleet/$VEH?tab=documents" "/fleet/$VEH?tab=loads" "/fleet/$VEH?tab=sos"
  ui superadmin /admin/users "/admin/users?tab=drivers" "/admin/users?tab=staff" "/admin/users?tab=attention" "/admin/users?tab=vendors" /admin/kyc
  for t in overview documents bank contacts activity notes performance; do ui superadmin "/admin/users/$DRV?tab=$t"; done
}
a3() { section "A3 superadmin: money, return trips, reports" || return
  ui superadmin /money --steps $S/set-price.json
  ui superadmin "/money?tab=invoices" "/money?tab=expenses" "/money?tab=claims" "/money?tab=driver-pay" "/money/invoices/$INV" /money/driver-pay
  ui superadmin "/money?tab=expenses" --steps $S/expense.json
  ui superadmin "/money?tab=invoices" --steps $S/invoice-row.json
  ui superadmin /return-trips "/return-trips?tab=bids" "/return-trips?tab=pool" "/return-trips?tab=partners"
  ui superadmin /return-trips --steps $S/open-return.json
  for t in overview finance vehicles health drivers vendors; do ui superadmin "/analytics?tab=$t"; done
  ui superadmin /insights /admin/settings /admin/audit "/admin/audit?result=failed" /route-planner /optimize
  ui superadmin /today --steps $S/search.json
  ui superadmin /today --steps $S/bell.json
  ui superadmin /today --steps $S/palette.json
  ui superadmin /requests --steps $S/accept.json
  ui superadmin /no-such-page
}
a4() { section "A4 pass-1 modals and tabs (UX2.sh)" || return
  ui superadmin "/shipments/$LONE" --steps $S/lone.json
  ui superadmin "/cargo/exceptions/$EXCO" --steps $S/case.json
  ui superadmin "/cargo/exceptions/$EXCR"
  ui superadmin /emergency --steps $S/sos.json
  ui superadmin "/routes/$TRIPA" --steps $S/tripactions.json
  ui superadmin "/fleet/$VEH" --steps $S/vehicle.json
  ui superadmin /admin/users --steps $S/people.json
  ui superadmin "/money/invoices/$INVI" --steps $S/invoice.json
  ui superadmin "/money?tab=driver-pay" --steps $S/pay.json
  ui superadmin "/money?tab=invoices" --width 390 --steps $S/rows.json
  for p in /shipments /routes /admin/users /cargo /fleet; do ui superadmin $p --steps $S/rows.json; done
}
a5() { section "A5 superadmin at 390 px" || return
  ui superadmin --width 390 /today /requests /shipments "/shipments/$MASTER" "/shipments?open=$LOT" /dispatch /routes "/routes/$TRIP" /cargo "/cargo/exceptions/$EXC" "/cargo/transfers/$TRF" /fleet "/fleet/$VEH" /admin/users "/admin/users/$DRV" /money "/money?tab=invoices" "/money/invoices/$INV" "/money?tab=driver-pay" /return-trips /analytics /insights /admin/settings /live-map /emergency /route-planner /optimize /admin/audit
  ui superadmin --width 390 /today --steps $S/menu-mobile.json
  ui superadmin --width 390 /shipments --steps $S/wizard.json
  ui superadmin --width 390 /dispatch --steps $S/assign.json
  ui superadmin --width 390 /today --steps $S/search.json
  ui superadmin --width 390 /today --steps $S/palette.json
  ui superadmin --width 390 "/cargo/exceptions/$EXCO" --steps $S/case.json
  ui superadmin --width 390 "/cargo/transfers/$TRF"
}
a6() { section "A6 manager, vendor, drivers, customer, anonymous" || return
  ui manager /today /requests /shipments "/shipments/$MASTER" /dispatch /routes "/routes/$TRIP" /live-map /emergency /cargo "/cargo?tab=claims" "/cargo/exceptions/$EXC" /fleet "/fleet/$VEH" /vehicle-requests /admin/users "/admin/users/$DRV" "/admin/users/$DRV?tab=bank" /route-planner /optimize
  ui manager /money "/money/invoices/$INV" /money/driver-pay /return-trips /analytics /insights /admin/settings /admin/kyc /admin/audit
  ui manager --width 390 /today
  ui manager /today --steps $S/palette.json
  ui manager "/shipments/$LONE" --steps $S/lone.json
  ui vendor /vendor /vendor/loads "/vendor/loads/$VLOAD" /vendor/request /vendor/return-trips /vendor/invoices "/vendor/invoices?status=unpaid" /vendor/claims /vendor/company /vendor/onboarding /vendor/loads/00000000-0000-0000-0000-000000000000
  ui vendor --width 390 /vendor/loads "/vendor/loads/$VLOAD" /vendor/request /vendor/return-trips /vendor/invoices /vendor/claims /vendor/company
  ui vendor /vendor/request --steps $S/new-load.json
  ui vendor /vendor/loads --steps $S/bell.json
  ui vendor /today /admin/users /money
  ui driverA --width 390 /driver /driver/dashboard
  ui driverB --width 390 /driver
  ui driverB --width 390 /driver --steps $S/bell.json
  ui driverA /driver /today
  ui customer --width 390 "/track/$TRK" "/track/$LTRK" /track /track/NOPE-0000
  ui customer2 --width 390 "/track/$TRK"
  ui anon --width 390 "/track/$TRK" "/track/$LTRK" /track /login /
  ui anon /login "/track/$TRK"
  ui customer /today /shipments /track
}
case " $PARTS " in *" A "*) a1; a2; a3; a4; a5; a6;; esac
echo "Part A done at $((SECONDS - START))s"

############ PART B: gaps
partB() {
echo; echo "=================== B0 data for the gaps"
TODAY=$(TZ=Asia/Kolkata date +%F)
# Free the trucks so a vehicle can be assigned (the story leaves one in maintenance and trips open)
node e2e/uat.mjs sql "update routes set status='cancelled' where status in ('pending','active') and vehicle_id in (select id from vehicles where plate_number like 'MH04E2E%'); update vehicles set status='available', current_load_kg=0, available_capacity_kg=capacity_kg where plate_number like 'MH04E2E%'; update sos_alerts set status='resolved' where status in ('active','acknowledged');" 2>&1 | tail -3
book() { jq -nc --arg d "$TODAY" --arg n "$1" --arg a "$2" '{pickup_lat:19.30,pickup_lng:73.06,pickup_name:"Bhiwandi warehouse",pickup_address:"Bhiwandi, Thane, Maharashtra",drop_lat:25.61,drop_lng:85.14,drop_name:$n,drop_address:$a,weight_kg:300,load_type:"full",date:$d}'; }
newbk() { bodyof customer POST /customer/bookings "$(book "$1" "$2")" | jq -r '.id // .booking.id'; }
BK1=$(newbk "Mehta Stores" "Boring Road, Patna"); echo "BK1 waiting booking=$BK1"
echo "--- waiting booking, as the dispatcher sees it"
ux superadmin /requests --steps $S/gap-accept.json
ux superadmin --width 390 /requests --steps $S/gap-accept.json --tag m
echo "--- more bookings"
BK2=$(newbk "Gupta Electricals" "Kankarbagh, Patna")
BK3=$(newbk "Rao Hardware" "Danapur, Patna")
BK4=$(newbk "Iyer Textiles" "Rajendra Nagar, Patna")
BK5=$(newbk "Khan Spices" "Patliputra, Patna")
BK6=$(newbk "Das Paper" "Ashiana, Patna")
echo "bookings $BK2 $BK3 $BK4 $BK5 $BK6"
echo "--- accept BK2 with NO price"
bodyof superadmin POST "/bookings/$BK2/confirm" '{}' > e2e/out/bk2.json; head -c 300 e2e/out/bk2.json; echo
SH2=$(jq -r '.shipment_id' e2e/out/bk2.json 2>/dev/null)
conf() { bodyof superadmin POST "/bookings/$1/confirm" "{\"price\":$2}" | jq -r '.shipment_id'; }
SH3=$(conf "$BK3" 6000); SH4=$(conf "$BK4" 7000); SH5=$(conf "$BK5" 7000); SH6=$(conf "$BK6" 5000)
echo "shipments sh2=$SH2 sh3=$SH3 sh4=$SH4 sh5=$SH5 sh6=$SH6"
V1=$(id "select id from vehicles where plate_number like 'MH04E2E%' order by plate_number limit 1")
V2=$(id "select id from vehicles where plate_number like 'MH04E2E%' order by plate_number desc limit 1")
echo "--- assign SH3 without sending (V1)"
api superadmin POST "/shipments/$SH3/assign" "{\"vehicle_id\":\"$V1\",\"dispatch\":false}" | head -c 300; echo
node e2e/uat.mjs sql "select tracking_id, status, vehicle_id is not null as has_vehicle from shipments order by created_at desc limit 7" 2>&1 | head -14

echo; echo "=================== B1 queues and the Accept form"
ui superadmin /requests "/requests?tab=accepted" "/requests?tab=all" /dispatch "/dispatch?tab=to-send" /today
ux superadmin "/requests?tab=accepted" --steps $S/gap-accepted-tab.json

echo; echo "=================== B2 Create shipment wizard (draft injected, so no address search is needed)"
ux superadmin /shipments --steps $S/wizard-full.json --tag full
ux superadmin /shipments --steps $S/wizard-multi.json --tag multi
ux superadmin --width 390 /shipments --steps $S/wizard-full.json --tag full

echo; echo "=================== B3 Set price (a delivered shipment with no price) and Assign vehicle"
node e2e/uat.mjs sql "update shipments set status='delivered' where id='$SH2'" 2>&1 | tail -2
ux superadmin /money --steps $S/gap-setprice.json
ux superadmin /dispatch --steps $S/gap-assign.json
ux superadmin --width 390 /dispatch --steps $S/gap-assign.json --tag m

echo; echo "=================== B4 Send to driver"
ux superadmin "/dispatch?tab=to-send" --steps $S/gap-send.json

echo; echo "=================== B5 shipment actions"
ux superadmin "/shipments/$SH3" --steps $S/gap-assigned-actions.json
ux superadmin "/shipments/$SH5" --steps $S/gap-cancel.json
ux superadmin "/shipments/$SH6" --steps $S/gap-delete.json
ux superadmin "/shipments/$SH4"

echo; echo "=================== B6 rate the driver"
DLOT=$(id "select id from shipments where status='delivered' order by (vehicle_id is not null) desc, (parent_shipment_id is not null) desc, created_at limit 1")
node e2e/uat.mjs sql "select tracking_id, status, vehicle_id is not null as has_vehicle, driver_rating from shipments where status='delivered'" 2>&1 | head
echo "delivered lot with a vehicle: $DLOT"
ux superadmin "/shipments/$DLOT" --steps $S/gap-rate.json
ux superadmin --width 390 "/shipments/$DLOT" --steps $S/gap-rate.json --tag m

echo; echo "=================== B7 fuel log with a bad odometer reading"
FILLED=$(date -u -d '2 days ago' +%Y-%m-%dT%H:%M:%SZ)
api superadmin POST "/fleet/vehicles/$VEH/fuel-logs" "{\"litres\":50,\"price_per_litre\":100,\"odometer_km\":50000,\"filled_at\":\"$FILLED\",\"is_full_tank\":true,\"payment_mode\":\"cash\"}" | head -c 300; echo
api superadmin POST "/fleet/vehicles/$VEH/fuel-logs" "{\"litres\":40,\"price_per_litre\":100,\"odometer_km\":100}" | head -c 400; echo
ux superadmin "/fleet/$VEH?tab=fuel" --steps $S/gap-fuel.json
ux superadmin --width 390 "/fleet/$VEH?tab=fuel" --steps $S/gap-fuel.json --tag m

echo; echo "=================== B8 claim above the declared value"
CASEC=$(id "select id from cargo_exceptions where type in ('damage','shortage','theft','vehicle_accident','seal_tamper','delay','weather','other') order by (status='open') desc, created_at desc limit 1")
echo "case for the claim: $CASEC"
ux superadmin "/cargo/exceptions/$CASEC" --steps $S/gap-claim.json
ux superadmin --width 390 "/cargo/exceptions/$CASEC" --steps $S/gap-claim.json --tag m
echo "--- the same claim straight to the API (expect 422)"
LOTC=$(id "select shipment_id from cargo_exception_items where exception_id='$CASEC' limit 1"); [ -z "$LOTC" ] && LOTC=$LOT
api superadmin POST /cargo/claims "{\"ref\":{\"shipment_id\":\"$LOTC\"},\"claim_type\":\"damage\",\"claimed_amount\":99999999}" | head -c 400; echo

echo; echo "=================== B9 manager: Problems > Claims and Fleet > Analytics"
ux manager "/cargo?tab=claims" "/fleet?view=analytics" "/fleet?tab=analytics" /fleet
ux manager "/cargo?tab=claims" --steps $S/claims-row-m.json --tag drawer
ux manager --width 390 "/cargo?tab=claims" "/fleet?view=analytics"

echo; echo "=================== B10 keyboard focus order"
ux anon /login --steps $S/focus-form.json --tag focus
ux superadmin /today --steps $S/focus-page.json --tag focus
ux superadmin /requests --steps $S/focus-page.json --tag focus
ux vendor /vendor/request --steps $S/focus-form.json --tag focus
ux driverA --width 390 /driver --steps $S/focus-page.json --tag focus

echo; echo "=================== B11 status colours (same status, same colour?)"
rm -f e2e/out/pills.raw
uxp superadmin /today /requests "/requests?tab=all" /shipments "/shipments?status=delivered" "/shipments/$MASTER" "/shipments/$LOT" "/shipments/$LONE" "/shipments/$SH3" "/shipments/$SH4" /routes "/routes?status=cancelled" "/routes/$TRIP" /dispatch "/dispatch?tab=to-send" /cargo "/cargo?tab=transfers" "/cargo?tab=claims" "/cargo/exceptions/$EXC" "/cargo/transfers/$TRF" /fleet "/fleet/$VEH" /admin/users "/admin/users?tab=vendors" "/admin/users/$DRV" /admin/kyc /money "/money?tab=invoices" "/money?tab=expenses" "/money?tab=driver-pay" "/money/invoices/$INV" /return-trips "/return-trips?tab=bids" "/return-trips?tab=partners" /emergency /vehicle-requests /admin/audit --steps $S/pills.json --tag pills
uxp vendor /vendor /vendor/loads "/vendor/loads/$VLOAD" /vendor/invoices /vendor/claims /vendor/company /vendor/return-trips --steps $S/pills.json --tag pills
uxp customer --width 390 "/track/$TRK" "/track/$LTRK" --steps $S/pills.json --tag pills
echo "--- PILL SUMMARY: label | colours seen | pages"
python3 - <<'PY'
import collections
seen = collections.defaultdict(lambda: collections.defaultdict(set))
for line in open('e2e/out/pills.raw', errors='replace'):
    if not line.startswith('PILL '): continue
    p, label, bg, fg = [x.strip() for x in line[5:].split('|', 3)]
    if label == '(none)': continue
    seen[label][(bg, fg)].add(p.split('?')[0].split('/')[1] if '/' in p else p)
for label in sorted(seen):
    combos = seen[label]
    flag = 'INCONSISTENT' if len(combos) > 1 else 'ok'
    print(f'{flag:12} {label} | ' + ' ;; '.join(f'{bg} on {fg} -> {",".join(sorted(pg))}' for (bg, fg), pg in combos.items()))
PY

echo; echo "=================== B12 390 px sideways scroll check"
ux superadmin --width 390 /today /requests /shipments "/shipments/$MASTER" "/shipments/$LOT" "/shipments/$SH3" /dispatch "/dispatch?tab=to-send" /routes "/routes/$TRIP" /cargo "/cargo/exceptions/$EXC" "/cargo/transfers/$TRF" "/cargo?tab=claims" /fleet "/fleet?view=analytics" "/fleet/$VEH" "/fleet/$VEH?tab=fuel" /admin/users "/admin/users/$DRV" /money "/money?tab=invoices" "/money?tab=driver-pay" "/money/invoices/$INV" /return-trips /analytics /insights /admin/settings /live-map /emergency /route-planner /optimize /admin/audit --steps $S/overflow.json --tag ov 2>&1 | grep -E "^(OVERFLOW|fits)|problems|^http|^console|^pageerror"
ux vendor --width 390 /vendor /vendor/loads /vendor/request /vendor/invoices /vendor/company --steps $S/overflow.json --tag ov 2>&1 | grep -E "^(OVERFLOW|fits)"
ux customer --width 390 "/track/$TRK" /track --steps $S/overflow.json --tag ov 2>&1 | grep -E "^(OVERFLOW|fits)"
}
case " $PARTS " in *" B "*) partB;; esac
echo "UX3 done at $((SECONDS - START))s"
