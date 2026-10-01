#!/usr/bin/env bash
# UX review: screenshots of every role's pages for a design review. Reads only; writes nothing but demo
# records that already exist. Keeps going when a page fails, so one bad step never stops the sweep.
cd "$(dirname "$0")/../.."
S=e2e/scenarios/ux
ui() { echo; echo "##### ui $*"; timeout 240 node e2e/ui.mjs "$@" 2>&1; }
id() { node e2e/uat.mjs sql "$1" 2>&1 | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1; }
tid() { node e2e/uat.mjs sql "$1" 2>&1 | grep -oE 'RTX-[A-Z0-9-]+|CM-[A-Z0-9-]+' | head -1; }

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
VEND=$(id "select id from users where role='vendor' order by created_at limit 1")
VLOAD=$(id "select id from vendor_shipment_requests order by created_at limit 1")
TRK=$(tid "select tracking_id from shipments where parent_shipment_id is null order by created_at limit 1")
LTRK=$(tid "select tracking_id from shipments where parent_shipment_id is not null order by created_at limit 1")
echo "ids master=$MASTER lot=$LOT lone=$LONE trip=$TRIP vehicle=$VEH invoice=$INV exc=$EXC trf=$TRF driver=$DRV vload=$VLOAD trk=$TRK ltrk=$LTRK"
echo "--- data shape"
node e2e/uat.mjs sql "select status, count(*) from shipments group by 1 order by 1" 2>&1 | head -20

############ 1. superadmin, 1440 px, every staff page
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
ui superadmin /cargo "/cargo?tab=transfers" "/cargo?tab=hubs" "/cargo?tab=claims" "/cargo/exceptions/$EXC" "/cargo/transfers/$TRF" /cargo/exceptions/not-an-id
ui superadmin /cargo --steps $S/raise-problem.json
ui superadmin "/cargo?tab=transfers" --steps $S/transfer.json
ui superadmin "/cargo?tab=claims" --steps $S/claims-row.json
ui superadmin /fleet "/fleet?view=analytics" "/fleet?view=alerts" "/fleet?view=service" /vehicle-requests
ui superadmin "/fleet/$VEH" "/fleet/$VEH?tab=location" "/fleet/$VEH?tab=maintenance" "/fleet/$VEH?tab=fuel" "/fleet/$VEH?tab=documents" "/fleet/$VEH?tab=loads" "/fleet/$VEH?tab=sos"
ui superadmin /admin/users "/admin/users?tab=drivers" "/admin/users?tab=staff" "/admin/users?tab=attention" "/admin/users?tab=vendors" /admin/kyc
for t in overview documents bank contacts activity notes performance; do ui superadmin "/admin/users/$DRV?tab=$t"; done
ui superadmin /money --steps $S/set-price.json
ui superadmin "/money?tab=invoices" "/money?tab=expenses" "/money?tab=claims" "/money?tab=driver-pay" "/money/invoices/$INV" /money/driver-pay
ui superadmin "/money?tab=expenses" --steps $S/expense.json
ui superadmin "/money?tab=invoices" --steps $S/invoice-row.json
ui superadmin /return-trips "/return-trips?tab=bids" "/return-trips?tab=pool" "/return-trips?tab=partners"
ui superadmin /return-trips --steps $S/open-return.json
for t in overview finance vehicles health drivers vendors; do ui superadmin "/analytics?tab=$t"; done
ui superadmin /insights /admin/settings /admin/audit /route-planner /optimize
ui superadmin /today --steps $S/search.json
ui superadmin /today --steps $S/bell.json
ui superadmin /requests --steps $S/accept.json
ui superadmin /no-such-page

############ 2. 390 px (phone) for the key pages, superadmin
ui superadmin --width 390 /today /requests /shipments "/shipments/$MASTER" "/shipments?open=$LOT" /dispatch /routes "/routes/$TRIP" /cargo "/cargo/exceptions/$EXC" "/cargo/transfers/$TRF" /fleet "/fleet/$VEH" /admin/users "/admin/users/$DRV" /money "/money?tab=invoices" "/money/invoices/$INV" "/money?tab=driver-pay" /return-trips /analytics /insights /admin/settings /live-map /emergency /route-planner /optimize /admin/audit
ui superadmin --width 390 /today --steps $S/menu-mobile.json
ui superadmin --width 390 /shipments --steps $S/wizard.json
ui superadmin --width 390 /dispatch --steps $S/assign.json
ui superadmin --width 390 /today --steps $S/search.json

############ 3. manager: what differs
ui manager /today /requests /shipments "/shipments/$MASTER" /dispatch /routes "/routes/$TRIP" /live-map /emergency /cargo "/cargo?tab=claims" "/cargo/exceptions/$EXC" /fleet "/fleet/$VEH" /vehicle-requests /admin/users "/admin/users/$DRV" "/admin/users/$DRV?tab=bank" /route-planner /optimize
ui manager /money /money/invoices/$INV /money/driver-pay /return-trips /analytics /insights /admin/settings /admin/kyc /admin/audit
ui manager --width 390 /today
ui manager /today --steps $S/search.json

############ 4. vendor portal
ui vendor /vendor /vendor/loads "/vendor/loads/$VLOAD" /vendor/request /vendor/return-trips /vendor/invoices "/vendor/invoices?status=unpaid" /vendor/claims /vendor/company /vendor/onboarding /vendor/loads/00000000-0000-0000-0000-000000000000
ui vendor --width 390 /vendor/loads "/vendor/loads/$VLOAD" /vendor/request /vendor/return-trips /vendor/invoices /vendor/claims /vendor/company
ui vendor /vendor/request --steps $S/new-load.json
ui vendor /vendor/loads --steps $S/bell.json
ui vendor /today /admin/users /money

############ 5. driver and customer at 390
ui driverA --width 390 /driver /driver/dashboard
ui driverB --width 390 /driver
ui driverA /driver /today
ui customer --width 390 "/track/$TRK" "/track/$LTRK" /track /track/NOPE-0000
ui customer2 --width 390 "/track/$TRK"
ui anon --width 390 "/track/$TRK" "/track/$LTRK" /track /login /
ui anon /login "/track/$TRK"
ui customer /today /shipments /track
echo "UX sweep done"
