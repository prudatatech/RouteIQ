#!/usr/bin/env bash
# Many sessions take an invoice number from one company's counter at the same moment: every number must be different
# and none may be skipped (public.next_invoice_number is one atomic upsert-increment). Cleans up after itself.
# Usage (the UAT workflow): bash e2e/company-settings-concurrency.sh
set -euo pipefail
DB="${DB_CONTAINER:-supabase_db_margix-e2e}"
N="${N:-40}"
psql_() { docker exec -i "$DB" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -At "$@"; }

ORG="$(psql_ -c "SELECT app.default_company_org_id()")"
[ -n "$ORG" ] || { echo "no default company"; exit 1; }
psql_ -c "DELETE FROM public.invoice_counters WHERE org_id = '$ORG' AND prefix = 'CONC'" >/dev/null

out="$(mktemp)"
for i in $(seq 1 "$N"); do
  psql_ -c "SELECT public.next_invoice_number('$ORG', 'CONC', '209901')" >> "$out" &
done
wait

distinct="$(sort -n "$out" | uniq | wc -l | tr -d ' ')"
max="$(sort -n "$out" | tail -1)"
min="$(sort -n "$out" | head -1)"
psql_ -c "DELETE FROM public.invoice_counters WHERE org_id = '$ORG' AND prefix = 'CONC'" >/dev/null
echo "concurrent numbers: $N requested, $distinct distinct, from $min to $max"
if [ "$distinct" != "$N" ] || [ "$min" != "1" ] || [ "$max" != "$N" ]; then echo "CONCURRENCY CHECK FAILED"; exit 1; fi
echo "ok: $N sessions at once got $N different, consecutive numbers"
