-- Stream B, part 2: driver performance.
--
--   - route_stops.planned_arrival_at: when the stop was expected to be reached,
--     worked out when the route is dispatched.
--   - route_stops.actual_arrival_at: when the driver marked the stop completed.
--   - shipments.driver_rating (1 to 5) with a note: staff rate a delivery after
--     it is delivered. The vehicle and driver are stored with the rating so it
--     stays with them if the vehicle is reassigned later.
--   - system_settings 'on_time_window_minutes': a stop counts as on time when it
--     is reached within this many minutes of its planned arrival (default 30).
--
-- Additive and safe to re-run. NOT YET APPLIED to the live project.

ALTER TABLE public.route_stops ADD COLUMN IF NOT EXISTS planned_arrival_at timestamptz;
ALTER TABLE public.route_stops ADD COLUMN IF NOT EXISTS actual_arrival_at timestamptz;

ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS driver_rating smallint;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS driver_rating_note text;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS driver_rated_at timestamptz;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS driver_rated_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS rated_vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS rated_driver_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.shipments DROP CONSTRAINT IF EXISTS shipments_driver_rating_check;
ALTER TABLE public.shipments ADD CONSTRAINT shipments_driver_rating_check CHECK (driver_rating IS NULL OR driver_rating BETWEEN 1 AND 5);

CREATE INDEX IF NOT EXISTS idx_shipments_rated_vehicle ON public.shipments (rated_vehicle_id) WHERE driver_rating IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_route_stops_completed ON public.route_stops (route_id) WHERE actual_arrival_at IS NOT NULL;

INSERT INTO public.system_settings (key, value)
VALUES ('on_time_window_minutes', to_jsonb(30))
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
