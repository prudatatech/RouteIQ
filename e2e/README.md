# End-to-end run (local only)

`run.mjs` walks one shipment story through the real backend and a real (local) Supabase: a multi-drop
booking, assign without sending, pickup, an accident, a transfer with a short count, delivery with a
delivery code, a partial delivery, receipt and claim, invoices, driver pay, a vendor load, a return trip
and permission checks. 75 steps, each PASS or FAIL.

## Safety

- The script refuses to run unless every URL it uses is `127.0.0.1`, `localhost` or `[::1]`.
- It reads only `e2e/.env.local`. It never reads `~/.routeiq` or any hosted project's settings.
- `--reset` empties the LOCAL database (the `supabase_db_margix-e2e` container) and the local Redis
  (`margix-e2e-redis`). Nothing else is touched.

## 1. Start the local stack

The database, GoTrue, PostgREST and Storage run as Docker containers named `supabase_*_margix-e2e`, with
Redis as `margix-e2e-redis` on port 6380. The Supabase API is on `127.0.0.1:54321` and the database on
`127.0.0.1:54322` (user `postgres`, password `postgres`).

If they are stopped, start Docker (OrbStack or Docker Desktop) and then the containers:

```bash
docker start $(docker ps -aq --filter name=margix-e2e)
```

or start a fresh stack from `e2e/supabase` (created by step 2), which needs the schema loaded afterwards:

```bash
cd e2e && npx -y supabase@latest start -x studio,edge-runtime,logflare,vector,imgproxy,supavisor,postgres-meta,mailpit
```

The database must already hold the production schema (the `supabase/migrations` folder). This run does
not create tables.

## 2. Set up

```bash
bash e2e/setup-local.sh
```

This re-creates the gitignored project folder `e2e/supabase` (project id `margix-e2e`), writes
`e2e/.env.local` (local API URL, anon and service keys, JWT secret; the standard local-dev secret is used
when `supabase status` cannot find the containers), and applies
`supabase/migrations/20260930016200_invoice_notes.sql` to the local database.

## 3. Start the backend on port 8011

```bash
bash e2e/start-backend.sh        # leave it running; PORT=8011 by default
```

## 4. Run

```bash
node e2e/run.mjs --reset --api http://localhost:8011/api/v1
```

- `--reset` empties the local database first. Without it the run adds to what is there.
- `--api` (or `E2E_API`) is the backend to test.
- `--only B,C` runs only those sections after the seed (later sections need the earlier ones).

The exit code is 1 when any step fails. `e2e/accounts.json` (the seeded accounts) and `e2e/results.json`
are written next to the script and are not committed.

Stop the backend (Ctrl+C) when you are done.

## What the sections cover

| Section | Story |
| --- | --- |
| S | Seed: seven accounts, a hub, two trucks with drivers, an approved vendor in Delhi, pay rate, company profile |
| A | Multi-drop booking (100 pieces, 50/25/25), Today counts, accept with a price: a master with three lots |
| B | Assign with `dispatch=false`: trips stay pending, no driver told, `trips_to_send`; then send |
| C | Driver A accepts, records the pickup and departs; driver B the same for lot C |
| D | Accident SOS: truck in maintenance, lots on hold, `vehicle_accident` case, customer sees the notice |
| E | Transfer to truck 2 with a short count (49 of 50): shortage case; driver A paid for the leg before it |
| F | Delivery code (recovered by brute force, wrong code refused), partial delivery, booking closes when settled |
| G | Receipt and rating (a second is refused), shortage claim approved, another customer refused |
| H | An invoice per lot including the partial one, none for the master, PDF access, paid |
| I | Driver pay: approve, pay out, `/driver/pay` totals |
| J | Vendor load: assign before accept is refused, accept, assign, deliver, invoice, payment details |
| K | Return trip: `return_trip_opened`, the vendor bids, staff award |
| L | Permissions: manager refused Money, drivers and customers cannot read others' pay or invoices |
