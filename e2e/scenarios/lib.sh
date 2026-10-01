# Shared helpers for the UAT role scenarios (CUST.sh, DRV.sh, VND.sh). Sourced, not run.
# Every check prints:  CHECK <id> PASS|FAIL <what> | <evidence>   and notes print:  INFO <text>
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 1
ACC=e2e/accounts.json
TODAY=$(TZ=Asia/Kolkata date +%F)
TOMORROW=$(TZ=Asia/Kolkata date -d '+1 day' +%F)
PAST=2020-01-01
FAR=$(TZ=Asia/Kolkata date -d '+120 days' +%F)
BACKEND_LOG=e2e/out/backend.log

uid() { jq -r ".$1.id" "$ACC"; }
req() { R=$(node e2e/scenarios/call.mjs "$@" 2>&1); ST=$(printf '%s\n' "$R" | head -1 | awk '{print $2}'); ST=${ST:-000}; BODY=$(printf '%s\n' "$R" | tail -n +2); }
jb() { printf '%s' "$BODY" | jq -r "$1" 2>/dev/null; }
jn() { printf '%s' "$BODY" | jq -r "(($1)|tonumber)+0" 2>/dev/null; }   # a number, normalised (3820.00 -> 3820)
ev() { printf '%s' "$BODY" | tr '\n' ' ' | cut -c1-"${1:-260}"; }
sql() { docker exec -i supabase_db_margix-e2e psql -U postgres -d postgres -At -F '|' -c "$1" 2>&1; }
info() { echo "INFO $*"; }
sect() { echo; echo "=== $*"; }

# chk ID "what" "ok statuses"  (uses ST and BODY of the last req)
chk() {
  local id=$1 what=$2 want=$3 w
  for w in $want; do
    if [ "$ST" = "$w" ]; then echo "CHECK $id PASS $what | HTTP $ST $(ev)"; return 0; fi
  done
  echo "CHECK $id FAIL $what | want HTTP $want, got HTTP $ST $(ev)"; return 1
}
# t ID "what" 1|0 "evidence"
t() { if [ "$3" = 1 ]; then echo "CHECK $1 PASS $2 | ${4:-}"; else echo "CHECK $1 FAIL $2 | ${4:-}"; fi; }
yes_() { [ "$1" = "$2" ] && echo 1 || echo 0; }          # equal
has() { printf '%s' "$1" | grep -qiE "$2" && echo 1 || echo 0; }   # regex found
lacks() { printf '%s' "$1" | grep -qiE "$2" && echo 0 || echo 1; }

# ---- booking bodies ----
single() { # [date]
  jq -nc --arg d "${1:-$TODAY}" '{pickup_lat:19.30,pickup_lng:73.06,pickup_name:"Bhiwandi warehouse",pickup_address:"Bhiwandi, Thane, Maharashtra",drop_lat:25.61,drop_lng:85.14,drop_name:"Sharma Traders",drop_address:"Gandhi Maidan, Patna",weight_kg:1000,load_type:"full",date:$d}'
}
multi() { # pieces per drop...  (date is $TODAY)
  local p; p=$(IFS=,; echo "$*")
  jq -nc --arg d "$TODAY" --argjson p "[$p]" '{pickup_lat:19.30,pickup_lng:73.06,pickup_name:"Bhiwandi warehouse",pickup_address:"Bhiwandi, Thane, Maharashtra",drop_lat:25.62,drop_lng:85.14,drop_name:"Drop 1",drop_address:"Boring Road, Patna",weight_kg:1000,load_type:"full",date:$d,
    drops:($p|to_entries|map({name:("Drop "+((.key+1)|tostring)),address:("Boring Road "+((.key+1)|tostring)+", Patna"),lat:(25.6+.key*0.01),lng:(85.1+.key*0.02),consignee_name:("Consignee "+((.key+1)|tostring)),consignee_phone:("987650000"+((.key+1)|tostring)),pieces:.value}))}'
}

# ---- fixtures ----
vehicle_id() { sql "select id from vehicles where plate_number='$1'" | head -1; }
lots_of() { sql "select id from shipments where parent_shipment_id='$1' order by lot_seq"; }
stop_of() { sql "select rs.id from route_stops rs join delivery_points dp on dp.id=rs.delivery_point_id where dp.shipment_id='$1' limit 1"; }
route_of() { sql "select rs.route_id from route_stops rs join delivery_points dp on dp.id=rs.delivery_point_id where dp.shipment_id='$1' limit 1"; }
sstatus() { sql "select status from shipments where id='$1'"; }
photo() { echo "cargo/$1/photo_1.jpg"; }
pod() { echo "pod/$1/photo_1.jpg"; }
otp_for() { # shipment id: recovers the 6-digit code from its stored hash
  local h; h=$(sql "select delivery_otp_hash from shipments where id='$1'")
  node -e 'const c=require("crypto");const [id,h]=process.argv.slice(1);for(let n=0;n<1e6;n++){const s=String(n).padStart(6,"0");if(c.createHash("sha256").update(id+":"+s).digest("hex")===h){console.log(s);break}}' "$1" "$h"
}
reset_trucks() {
  sql "update vehicles set status='available', current_load_kg=0, available_capacity_kg=capacity_kg where plate_number like 'MH04E2E%'" >/dev/null
  sql "update sos_alerts set status='resolved' where status in ('active','acknowledged')" >/dev/null
}
# confirm_booking BOOKING_ID [price]  -> sets MASTER (shipment id)
confirm_booking() { req superadmin POST "/bookings/$1/confirm" "{\"price\":${2:-10000}}"; MASTER=$(jb .shipment_id); }
# assign_lot SHIPMENT_ID VEHICLE_ID (no dispatch)
assign_lot() { req superadmin POST "/shipments/$1/assign" "{\"vehicle_id\":\"$2\",\"dispatch\":false}"; }
send_route() { req superadmin PATCH "/routes/$1/status" '{"status":"active"}'; }
pickup() { # WHO SHIPMENT_ID PIECES [idempotency-key]
  req "$1" POST /cargo/custody "$(jq -nc --arg id "$2" --arg ph "$(photo "$2")" --argjson n "$3" '{ref:{shipment_id:$id},kind:"pickup",pieces:$n,condition:"good",seal_number:"SEAL-UAT",photo_paths:[$ph],lat:19.30,lng:73.06}')" ${4:+--idem "$4"}
}
complete_stop() { # WHO STOP_ID [extra-json merged over the defaults]
  local x="${3:-}"; [ -z "$x" ] && x='{}'
  req "$1" POST /telemetry/driver-ping/complete-stop "$(jq -nc --arg s "$2" --arg ph "$(pod "$2")" --argjson x "$x" '{stop_id:$s,outcome:"delivered",received_by:"Store manager",photo_paths:[$ph],lat:25.61,lng:85.14}+$x')"
}
clear_routes() { sql "update routes set status='cancelled' where status in ('pending','active') and vehicle_id in (select id from vehicles where plate_number like 'MH04E2E%')" >/dev/null; reset_trucks; }
mkbk() { # pieces per drop... -> BK, MASTER, LOTS (array)
  req customer POST /customer/bookings "$(multi "$@")"; BK=$(jb .id)
  confirm_booking "$BK" 6000
  LOTS=($(lots_of "$MASTER"))
}
ui() { timeout 150 node e2e/ui.mjs "$@" 2>&1 | cut -c1-260 | head -70; }
echo "TODAY=$TODAY TOMORROW=$TOMORROW"
