#!/usr/bin/env bash
# UX review, pass 3.
#   V  verifies the round 4 fixes (UX-04, 06, 07, 10, 13, UX-26 to UX-39) on data it creates itself.
#   S  regression sweep: every staff page at 1440 and 390 px, manager, vendor, driver, public tracking.
#   C  checks: vocabulary and wording slips and problem lines, grepped from everything printed above.
# PARTS="V" bash e2e/scenarios/UX4.sh runs only the verification. The sweep stops starting new sections after 23 minutes.
# Keeps going when a page or step fails. Adapted from UX3.sh (pass 2).
cd "$(dirname "$0")/../.."
S=e2e/scenarios/ux
PARTS=${PARTS:-"V S C"}
START=$SECONDS
mkdir -p e2e/out
ALL=e2e/out/all.txt; : > $ALL
ui() { echo; echo "##### ui $*"; timeout 300 node e2e/ui.mjs "$@" 2>&1 | tee -a $ALL; }
ux() { echo; echo "##### ux $*"; timeout 300 node e2e/ux.mjs "$@" 2>&1 | tee -a $ALL; }
uxp() { echo; echo "##### ux $*"; timeout 300 node e2e/ux.mjs "$@" 2>&1 | tee -a $ALL e2e/out/pills.raw; }
api() { node e2e/uat.mjs "$@" 2>&1; }
bodyof() { node e2e/uat.mjs "$@" 2>&1 | tail -n +2; }
id() { node e2e/uat.mjs sql "$1" 2>&1 | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1; }
tid() { node e2e/uat.mjs sql "$1" 2>&1 | grep -oE 'RTX-[A-Z0-9-]+|CM-[A-Z0-9-]+' | head -1; }
sql() { node e2e/uat.mjs sql "$1" 2>&1; }
section() { if [ $((SECONDS - START)) -gt 1380 ]; then echo "SKIPPED (time budget) $1"; return 1; fi; echo; echo "=================== $1 ($((SECONDS - START))s)"; return 0; }

############ ids from the seeded data
MASTER=$(id "select id from shipments where is_master order by created_at limit 1")
LOT=$(id "select id from shipments where parent_shipment_id is not null order by created_at limit 1")
LONE=$(id "select id from shipments where parent_shipment_id is null and not coalesce(is_master,false) order by created_at limit 1")
TRIP=$(id "select id from routes order by created_at limit 1")
TRIP2=$(id "select id from routes order by created_at desc limit 1")
VEH=$(id "select id from vehicles order by created_at limit 1")
INV=$(id "select id from invoices order by created_at limit 1")
EXC=$(id "select id from cargo_exceptions order by created_at limit 1")
TRF=$(id "select id from cargo_transfers order by created_at limit 1")
DRV=$(id "select id from users where role='driver' order by created_at limit 1")
VLOAD=$(id "select id from vendor_shipment_requests order by created_at limit 1")
TRK=$(tid "select tracking_id from shipments where parent_shipment_id is null order by created_at limit 1")
LTRK=$(tid "select tracking_id from shipments where parent_shipment_id is not null order by created_at limit 1")
echo "ids master=$MASTER lot=$LOT lone=$LONE trip=$TRIP vehicle=$VEH invoice=$INV exc=$EXC trf=$TRF driver=$DRV vload=$VLOAD trk=$TRK ltrk=$LTRK"

############ V: verification
partV() {
echo; echo "=================== V0 data: one waiting booking and five accepted ones"
TODAY=$(TZ=Asia/Kolkata date +%F)
sql "update routes set status='cancelled' where status in ('pending','active') and vehicle_id in (select id from vehicles where plate_number like 'MH04E2E%'); update vehicles set status='available', current_load_kg=0, available_capacity_kg=capacity_kg where plate_number like 'MH04E2E%'; update sos_alerts set status='resolved' where status in ('active','acknowledged');" | tail -3
book() { jq -nc --arg d "$TODAY" --arg n "$1" --arg a "$2" '{pickup_lat:19.30,pickup_lng:73.06,pickup_name:"Bhiwandi warehouse",pickup_address:"Bhiwandi, Thane, Maharashtra",drop_lat:25.61,drop_lng:85.14,drop_name:$n,drop_address:$a,weight_kg:300,load_type:"full",date:$d}'; }
newbk() { bodyof customer POST /customer/bookings "$(book "$1" "$2")" | jq -r '.id // .booking.id'; }
conf() { bodyof superadmin POST "/bookings/$1/confirm" "{\"price\":$2}" | jq -r '.shipment_id'; }
BKW=$(newbk "Mehta Stores" "Boring Road, Patna"); echo "waiting booking $BKW"
SHa=$(conf "$(newbk "Gupta Electricals" "Kankarbagh, Patna")" 6000)
SHb=$(conf "$(newbk "Rao Hardware" "Danapur, Patna")" 6000)
SHc=$(conf "$(newbk "Iyer Textiles" "Rajendra Nagar, Patna")" 7000)
SHd=$(conf "$(newbk "Khan Spices" "Patliputra, Patna")" 7000)
SHe=$(conf "$(newbk "Das Paper" "Ashiana, Patna")" 5000)
echo "shipments a=$SHa b=$SHb c=$SHc d=$SHd e=$SHe"
TRKa=$(tid "select tracking_id from shipments where id='$SHa'"); TRKc=$(tid "select tracking_id from shipments where id='$SHc'")
V1=$(id "select id from vehicles where plate_number like 'MH04E2E%' order by plate_number limit 1")
V2=$(id "select id from vehicles where plate_number like 'MH04E2E%' order by plate_number desc limit 1")
echo "tracking a=$TRKa c=$TRKc vehicles v1=$V1 v2=$V2"

echo; echo "=================== V1 UX-27 a new shipment's history (must not say With 3PL partners), UX-04/06/07 on the way"
ux superadmin "/shipments/$SHc" --tag new
ux anon --width 390 "/track/$TRKc" --tag new
echo "3PL-HITS shipment page: $(ux superadmin "/shipments/$SHc" 2>&1 | grep -c '3PL partners')"

echo; echo "=================== V2 UX-31 Accept form, UX-37 Accept and price (waiting booking)"
ux superadmin /requests --steps $S/p3-accept.json --tag accept
ux superadmin --width 390 /requests --tag m

echo; echo "=================== V3 UX-26 take a vehicle off an assigned shipment that is not picked up"
api superadmin POST "/shipments/$SHa/assign" "{\"vehicle_id\":\"$V1\",\"dispatch\":false}" | head -c 300; echo
echo "--- before"; sql "select tracking_id, status, current_vehicle_id is not null as has_vehicle, current_holder from shipments where id='$SHa'" | head -6
ux superadmin "/shipments/$SHa" --steps $S/p3-takeoff.json --tag off
echo "--- after (database)"
sql "select tracking_id, status, current_vehicle_id is not null as has_vehicle, current_holder from shipments where id='$SHa'" | head -6
sql "select r.status as trip, (select count(*) from route_stops s where s.route_id=r.id and s.status<>'cancelled') as live_stops, v.status as vehicle from routes r join vehicles v on v.id=r.vehicle_id where r.vehicle_id='$V1' order by r.created_at desc limit 2" | head -8
echo "--- the same shipment on the list and on Dispatch (must read as needing a vehicle)"
ux superadmin "/shipments?q=$TRKa" --tag off
ux superadmin /dispatch --tag off
ux superadmin --width 390 /dispatch --tag off
echo "--- UX-28 Hold on it (no vehicle)"
ux superadmin "/shipments/$SHa" --steps $S/p3-hold.json --tag hold

echo; echo "=================== V4 UX-10 pieces, UX-29 licence wording, UX-30 Tab order, UX-35 counts after an assign"
ux superadmin /dispatch --steps $S/p3-assign.json --tag assign
ux superadmin --width 390 /dispatch --steps $S/p3-assign.json --tag assignm
ux superadmin /dispatch --steps $S/p3-tabs.json --tag tabs
ux superadmin /live-map --steps $S/p3-tabs.json --tag tabs
ux superadmin --width 390 /live-map --steps $S/p3-tabs.json --tag tabs
ux superadmin /shipments --steps $S/wizard-full.json --tag full
ux superadmin /money --steps $S/p3-nav.json --tag nav
ux superadmin "/money?tab=invoices" --steps $S/p3-nav.json --tag nav

echo; echo "=================== V5 UX-26 the other half: goods already picked up (409 pointing to a transfer)"
SHP=$(id "select id from shipments where status='assigned' and id in ('$SHb','$SHc','$SHd','$SHe') order by created_at limit 1")
if [ -z "$SHP" ]; then echo "no shipment got assigned in V4; assigning b to v2"; SHP=$SHb; api superadmin POST "/shipments/$SHP/assign" "{\"vehicle_id\":\"$V2\",\"dispatch\":false}" | head -c 200; echo; fi
echo "picked-up probe shipment $SHP"
sql "update shipments set current_holder='vehicle' where id='$SHP'" | tail -2
sql "select tracking_id, status, current_holder from shipments where id='$SHP'" | head -6
echo "--- API: PATCH status=created on goods held by the vehicle (expect 409 and the transfer message)"
api superadmin PATCH "/shipments/$SHP" '{"status":"created"}' | head -c 400; echo
ux superadmin "/shipments/$SHP" --steps $S/p3-takeoff.json --tag pickedup

echo; echo "=================== V6 UX-36 cancelled shipment and trip, UX-38 delete, UX-39 status colours"
SHCAN=$(id "select id from shipments where status='created' and id in ('$SHb','$SHc','$SHd','$SHe') order by created_at limit 1")
SHDEL=$(id "select id from shipments where status='created' and id in ('$SHb','$SHc','$SHd','$SHe') and id<>'$SHCAN' order by created_at limit 1")
echo "cancel=$SHCAN delete=$SHDEL"
ux superadmin "/shipments/$SHCAN" --steps $S/gap-cancel.json --tag cancel
ux superadmin "/shipments/$SHDEL" --steps $S/gap-delete.json --tag delete
TRC=$(id "select id from routes where status='cancelled' order by created_at desc limit 1"); echo "cancelled trip $TRC"
ux superadmin "/routes/$TRC" --tag cancelled
rm -f e2e/out/pills.raw
uxp superadmin /shipments "/shipments?status=cancelled" "/shipments/$SHCAN" "/shipments/$SHa" "/shipments/$LONE" /routes "/routes?status=cancelled" /today /requests --steps $S/pills.json --tag pills
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
    print(('INCONSISTENT ' if len(combos) > 1 else 'ok           ') + f'{label} | ' + ' ;; '.join(f'{bg} on {fg} -> {",".join(sorted(pg))}' for (bg, fg), pg in combos.items()))
cols = {}
for label in seen:
    for c in seen[label]: cols.setdefault(c, set()).add(label)
for c, labels in cols.items():
    if 'Created' in labels or 'Cancelled' in labels: print('COLOUR', c, '->', sorted(labels))
PY

echo; echo "=================== V7 UX-32 fuel odometer, UX-31 claim form, UX-33 case page"
FILLED=$(date -u -d '2 days ago' +%Y-%m-%dT%H:%M:%SZ)
api superadmin POST "/fleet/vehicles/$VEH/fuel-logs" "{\"litres\":50,\"price_per_litre\":100,\"odometer_km\":50000,\"filled_at\":\"$FILLED\",\"is_full_tank\":true,\"payment_mode\":\"cash\"}" | head -c 200; echo
ux superadmin "/fleet/$VEH?tab=fuel" --steps $S/gap-fuel.json --tag fuel
CASEC=$(id "select id from cargo_exceptions where type in ('damage','shortage','theft','vehicle_accident','seal_tamper','delay','weather','other') order by (status='open') desc, created_at desc limit 1")
ux superadmin "/cargo/exceptions/$CASEC" --steps $S/gap-claim.json --tag claim
ux superadmin "/cargo/exceptions/$EXC"

echo; echo "=================== V8 UX-34 notification text, UX-37 Trips to send, UX-13 Export CSV, UX-04 bad ids"
ux superadmin /today --steps $S/bell.json --tag bell
ux superadmin "/dispatch?tab=to-send" --tag tosend
ux superadmin "/cargo?tab=transfers" "/cargo?tab=hubs" "/cargo?tab=claims" /money/driver-pay "/return-trips?tab=bids" "/return-trips?tab=partners"
ux superadmin /cargo/exceptions/not-an-id /cargo/transfers/not-an-id /money/invoices/not-an-id /admin/users/not-an-id /shipments/not-an-id /routes/not-an-id /fleet/not-an-id /shipments/00000000-0000-0000-0000-000000000000

echo; echo "=================== V9 UX-06 settings wording, UX-07 directions call, Optimize licence wording"
ux superadmin /today /optimize "/dispatch?tab=optimize" /route-planner /insights /live-map "/routes/$TRIP" "/routes/$TRIP2" /admin/settings
ux manager /today /optimize /route-planner /insights /live-map "/routes/$TRIP"
}
case " $PARTS " in *" V "*) partV;; esac
echo "Part V done at $((SECONDS - START))s"

############ S: regression sweep
s1() { section "S1 superadmin 1440 px, every staff page" || return
  ui superadmin /today /requests /requests?tab=accepted /requests?tab=progress /requests?tab=done /requests?tab=closed /requests?tab=all /requests?source=vendor
  ui superadmin /shipments "/shipments?status=delivered" "/shipments?status=in_transit" "/shipments?q=zzzzqq" "/shipments/$MASTER" "/shipments/$LOT" "/shipments/$LONE" "/shipments/$LOT/manifest"
  ui superadmin /dispatch "/dispatch?tab=to-send" "/dispatch?tab=plan" "/dispatch?tab=optimize"
  ui superadmin /routes "/routes?status=pending" "/routes?status=active" "/routes?status=completed" "/routes?status=cancelled" "/routes/$TRIP" "/routes/$TRIP2"
  ui superadmin /live-map /emergency /route-planner /optimize /insights
}
s2() { section "S2 superadmin 1440 px: problems, fleet, people, money, reports" || return
  ui superadmin /cargo "/cargo?tab=transfers" "/cargo?tab=hubs" "/cargo?tab=claims" "/cargo/exceptions/$EXC" "/cargo/transfers/$TRF"
  ui superadmin /fleet "/fleet?view=analytics" "/fleet?view=alerts" "/fleet?view=service" /vehicle-requests "/fleet/$VEH" "/fleet/$VEH?tab=location" "/fleet/$VEH?tab=maintenance" "/fleet/$VEH?tab=fuel" "/fleet/$VEH?tab=documents" "/fleet/$VEH?tab=loads" "/fleet/$VEH?tab=sos"
  ui superadmin /admin/users "/admin/users?tab=drivers" "/admin/users?tab=staff" "/admin/users?tab=attention" "/admin/users?tab=vendors" /admin/kyc "/admin/users/$DRV" "/admin/users/$DRV?tab=documents" "/admin/users/$DRV?tab=bank"
  ui superadmin /money "/money?tab=invoices" "/money?tab=expenses" "/money?tab=claims" "/money?tab=driver-pay" "/money/invoices/$INV" /money/driver-pay
  ui superadmin /return-trips "/return-trips?tab=bids" "/return-trips?tab=pool" "/return-trips?tab=partners"
  for t in overview finance vehicles health drivers vendors; do ui superadmin "/analytics?tab=$t"; done
  ui superadmin /admin/settings /admin/audit "/admin/audit?result=failed" /no-such-page
}
s3() { section "S3 superadmin 390 px, every staff page with the sideways-scroll check" || return
  ux superadmin --width 390 /today /requests "/requests?tab=all" /shipments "/shipments/$MASTER" "/shipments/$LOT" "/shipments/$LONE" /dispatch "/dispatch?tab=to-send" "/dispatch?tab=optimize" /routes "/routes/$TRIP" /cargo "/cargo?tab=transfers" "/cargo?tab=claims" "/cargo/exceptions/$EXC" "/cargo/transfers/$TRF" /fleet "/fleet?view=analytics" "/fleet/$VEH" "/fleet/$VEH?tab=fuel" /vehicle-requests /admin/users "/admin/users/$DRV" /admin/kyc /money "/money?tab=invoices" "/money?tab=driver-pay" "/money/invoices/$INV" /return-trips /analytics /insights /admin/settings /live-map /emergency /route-planner /optimize /admin/audit --steps $S/overflow.json --tag ov
  ux superadmin --width 390 /today --steps $S/menu-mobile.json
  ux superadmin --width 390 /shipments --steps $S/wizard.json
  ux superadmin --width 390 /today --steps $S/search.json
}
s4() { section "S4 manager, vendor, driver, public tracking" || return
  ui manager /today /requests /shipments "/shipments/$MASTER" /dispatch /routes "/routes/$TRIP" /live-map /emergency /cargo "/cargo?tab=claims" "/cargo/exceptions/$EXC" /fleet "/fleet/$VEH" /admin/users "/admin/users/$DRV" /optimize /route-planner
  ui manager /money /analytics /admin/settings /insights
  ux manager --width 390 /today /requests /shipments /dispatch /cargo /fleet --steps $S/overflow.json --tag ov
  ui vendor /vendor /vendor/loads "/vendor/loads/$VLOAD" /vendor/request /vendor/return-trips /vendor/invoices /vendor/claims /vendor/company /vendor/onboarding
  ux vendor --width 390 /vendor /vendor/loads "/vendor/loads/$VLOAD" /vendor/request /vendor/return-trips /vendor/invoices /vendor/claims /vendor/company --steps $S/overflow.json --tag ov
  ui vendor /today /money
  ux driverA --width 390 /driver /driver/dashboard --steps $S/overflow.json --tag ov
  ux driverB --width 390 /driver --steps $S/overflow.json --tag ov
  ux anon --width 390 "/track/$TRK" "/track/$LTRK" "/track/${TRKc:-$TRK}" /track /track/NOPE-0000 /login --steps $S/overflow.json --tag ov
  ui anon "/track/$TRK" "/track/$LTRK" /login
  ui customer --width 390 "/track/$TRK"
  ui customer /today /shipments
}
case " $PARTS " in *" S "*) s1; s2; s3; s4;; esac
echo "Part S done at $((SECONDS - START))s"

############ C: checks over everything printed
partC() {
echo; echo "=================== C1 problems (console errors, failed requests) by page"
awk '/^=== /{page=$0; inp=0} /^--- problems/{inp=1; next} /^--- no console/{inp=0} inp && /^(http|console|pageerror|goto|login)/{print page " :: " $0}' $ALL | sort | uniq -c | sort -rn | head -80
echo; echo "=================== C2 sideways scroll"
grep -E "^OVERFLOW" $ALL | sort -u; echo "fits: $(grep -c '^fits' $ALL)"
echo; echo "=================== C3 wording slips, by page"
awk 'index($0,"=== ")==1{page=$0} /Driver licence missing|TomTom|OpenWeather|OR-Tools|genetic algorithm|With 3PL partners|[0-9] items?( |$)|[0-9] pcs|consignment|Transship|backhaul|Employee code|Accept &|pickup 20[0-9][0-9]-|undefined|NaN|\[object|min away|Planned by: Trip|Raise problem/{print page " :: " $0}' $ALL | sort -u | head -80
}
case " $PARTS " in *" C "*) partC;; esac
echo "UX4 done at $((SECONDS - START))s"
