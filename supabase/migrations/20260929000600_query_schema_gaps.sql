-- Found by backend-ts/scripts/check-queries.ts (ux-plan-2.md, section A): three
-- features query columns that were never added to the schema. Add them so the
-- features work instead of silently failing against a mock database that
-- accepted any column name.
--
-- Safe to re-run.

-- Fleet health monitor (fleet-health.service.ts) flags a vehicle going stale
-- as high priority when it's carrying cold-chain or hazardous cargo. Every
-- other cargo-carrying table (delivery_points, depots, telemetry,
-- vehicle_stoppages) already has this column as json; add it to vehicles too.
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS cargo_types json;

-- Backhaul bid acceptance (capacity.service.ts) falls back to a human-readable
-- label for the vehicle's current location when the vendor has no address on
-- file. Nothing populated this before; the column simply didn't exist.
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS current_location_name text;

-- Availability scoring (matching.service.ts) matches idle vehicles against
-- the vehicle type a shipment requires. Shipments had no such column.
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS required_vehicle_type text;
