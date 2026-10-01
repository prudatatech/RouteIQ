#!/usr/bin/env bash
# UX pass 3, run 2: the transfer page the first run missed (its id lookup came back empty), at 1440 and 390 px.
cd "$(dirname "$0")/../.."
S=e2e/scenarios/ux
TRF=$(node e2e/uat.mjs sql "select id from cargo_transfers limit 1" 2>&1 | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
echo "transfer=$TRF"
node e2e/uat.mjs sql "select count(*) from cargo_transfers" 2>&1 | head -5
[ -z "$TRF" ] && { node e2e/uat.mjs sql "select tablename from pg_tables where tablename like '%transfer%'" 2>&1 | head; exit 0; }
node e2e/ui.mjs superadmin "/cargo/transfers/$TRF" 2>&1
node e2e/ux.mjs superadmin --width 390 "/cargo/transfers/$TRF" --steps $S/overflow.json --tag ov 2>&1
node e2e/ui.mjs manager "/cargo/transfers/$TRF" "/cargo?tab=transfers" 2>&1
