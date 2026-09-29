-- Fleet health stream, part 1: odometer and device fuel on the vehicle.
--
-- odometer_km is counted from real GPS distance between consecutive pings by the
-- telemetry ingest path, and staff can correct it. It is NULL until a vehicle has
-- driven with a tracker or staff has entered a reading.
-- fuel_level_pct / fuel_reported_at are set only when a real device reports a fuel
-- level, so "no fuel sensor" stays distinguishable from "tank is empty".
--
-- Additive and safe to re-run. NOT YET APPLIED to the live project.

ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS odometer_km numeric(12,3) CHECK (odometer_km IS NULL OR odometer_km >= 0);
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS odometer_updated_at timestamptz;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS fuel_level_pct numeric(5,1);
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS fuel_reported_at timestamptz;

NOTIFY pgrst, 'reload schema';
