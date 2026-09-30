-- Route planner: what a planned route was built from.
--
-- A route made in the route planner keeps the plan it came from in one JSON column:
-- where the truck starts (the start is not a stop), the planned departure, the road
-- options that were avoided, which service worked out the road (tomtom or mapbox),
-- whether truck restrictions were considered, the toll distance, and who created it.
-- Routes made any other way leave it empty.
--
-- Additive and safe to re-run. NOT yet applied to the live project.

ALTER TABLE public.routes ADD COLUMN IF NOT EXISTS plan jsonb;

COMMENT ON COLUMN public.routes.plan IS
  'Route planner details: source, provider, truck_aware, origin, departure_at, toll_km, avoid, created_by. Null for routes not made in the planner.';
