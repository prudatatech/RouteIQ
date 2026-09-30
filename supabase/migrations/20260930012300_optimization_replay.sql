-- Optimization fallback and trip replay.
--
-- Neither feature adds a table or a column (test/support/db-schema.json is unchanged): the in-process
-- optimizer works on routes, route_stops, delivery_points and telemetry as they are, and the trip replay
-- reads gps_points through GET /api/v1/gps/vehicle/:id/track (already indexed by idx_gps_points_vehicle_time).
--
-- The one addition is an index for the replay's route picker, which lists a vehicle's routes newest first
-- (GET /api/v1/routes?vehicle_id=...). Idempotent; safe to run more than once.

CREATE INDEX IF NOT EXISTS idx_routes_vehicle_created ON public.routes (vehicle_id, created_at DESC);

NOTIFY pgrst, 'reload schema';
