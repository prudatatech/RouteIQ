#!/usr/bin/env bash
# UX review, follow-up run: the modals, confirmations and tabs the first sweep missed.
cd "$(dirname "$0")/../.."
S=e2e/scenarios/ux
ui() { echo; echo "##### ui $*"; timeout 240 node e2e/ui.mjs "$@" 2>&1; }
id() { node e2e/uat.mjs sql "$1" 2>&1 | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1; }
LONE=$(id "select id from shipments where tracking_id like 'RTX-8262DCA%' limit 1")
EXC=$(id "select id from cargo_exceptions where status='open' limit 1")
EXCR=$(id "select id from cargo_exceptions where status<>'open' limit 1")
TRF=$(id "select id from cargo_transfers limit 1")
INV=$(id "select id from invoices where status='issued' limit 1")
TRIP=$(id "select id from routes where status='active' limit 1")
VEH=$(id "select id from vehicles limit 1")
echo "ids lone=$LONE exc=$EXC excr=$EXCR trf=$TRF inv=$INV trip=$TRIP veh=$VEH"
for t in analytics alerts service; do ui superadmin "/fleet?tab=$t"; done
ui superadmin /today --steps $S/palette.json
ui superadmin --width 390 /today --steps $S/palette.json
ui manager /today --steps $S/palette.json
ui superadmin "/shipments/$LONE" --steps $S/lone.json
ui manager "/shipments/$LONE" --steps $S/lone.json
ui superadmin "/cargo/exceptions/$EXC" --steps $S/case.json
ui superadmin --width 390 "/cargo/exceptions/$EXC" --steps $S/case.json
ui superadmin "/cargo/exceptions/$EXCR"
ui superadmin "/cargo/transfers/$TRF"
ui superadmin --width 390 "/cargo/transfers/$TRF"
ui superadmin /emergency --steps $S/sos.json
ui superadmin "/routes/$TRIP" --steps $S/tripactions.json
ui superadmin "/fleet/$VEH" --steps $S/vehicle.json
ui superadmin /admin/users --steps $S/people.json
ui superadmin "/money/invoices/$INV" --steps $S/invoice.json
ui superadmin "/money?tab=driver-pay" --steps $S/pay.json
ui superadmin "/money?tab=invoices" --width 390 --steps $S/rows.json
ui superadmin /shipments --steps $S/rows.json
ui superadmin /routes --steps $S/rows.json
ui superadmin /admin/users --steps $S/rows.json
ui superadmin "/cargo" --steps $S/rows.json
ui superadmin /fleet --steps $S/rows.json
ui superadmin "/return-trips?tab=pool"
ui superadmin "/admin/settings" --width 390
ui superadmin /admin/audit "/admin/audit?result=failed"
ui vendor /vendor/request --width 390
ui vendor /vendor/loads --width 390 --steps $S/bell.json
ui driverB --width 390 /driver --steps $S/bell.json
echo "UX2 done"
