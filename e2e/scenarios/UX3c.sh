#!/usr/bin/env bash
# UX pass 2, run 3: the rate-the-driver form on a delivered lot (the lookup in UX3.sh used a column that does not exist)
cd "$(dirname "$0")/../.."
S=e2e/scenarios/ux
id() { node e2e/uat.mjs sql "$1" 2>&1 | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1; }
for q in "parent_shipment_id is not null" "parent_shipment_id is null and not coalesce(is_master,false)"; do
  D=$(id "select id from shipments where status='delivered' and $q order by created_at limit 1"); echo "delivered ($q): $D"
  [ -n "$D" ] && { node e2e/ux.mjs superadmin "/shipments/$D" --steps $S/gap-rate.json --tag "r$(echo $q | wc -c)" 2>&1; node e2e/ux.mjs superadmin --width 390 "/shipments/$D" --steps $S/gap-rate.json --tag m 2>&1; }
done
