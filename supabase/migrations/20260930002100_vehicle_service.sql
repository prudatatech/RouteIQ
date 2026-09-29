-- Fleet health stream, part 2: service schedules and the service log.
--
-- A plan says how often an item (engine oil, brakes, tyres, general service, ...)
-- is due: every interval_km, every interval_days, or both. last_done_km and
-- last_done_at are the baseline and are updated when staff log a service.
-- The log is the history. When a service has a cost the backend also writes a
-- maintenance row to `expenses` (when that table exists) and keeps its id in
-- expense_id.
--
-- Additive and safe to re-run. Applied to the live project on 2026-09-29.

CREATE TABLE IF NOT EXISTS public.vehicle_service_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  item text NOT NULL,
  interval_km integer CHECK (interval_km IS NULL OR interval_km > 0),
  interval_days integer CHECK (interval_days IS NULL OR interval_days > 0),
  last_done_km numeric(12,1) CHECK (last_done_km IS NULL OR last_done_km >= 0),
  last_done_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_service_plans_has_interval CHECK (interval_km IS NOT NULL OR interval_days IS NOT NULL),
  CONSTRAINT vehicle_service_plans_unique_item UNIQUE (vehicle_id, item)
);

CREATE TABLE IF NOT EXISTS public.vehicle_service_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  item text NOT NULL,
  done_at date NOT NULL DEFAULT CURRENT_DATE,
  odometer_km numeric(12,1) CHECK (odometer_km IS NULL OR odometer_km >= 0),
  cost numeric(12,2) CHECK (cost IS NULL OR cost >= 0),
  note text,
  expense_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_service_plans_vehicle ON public.vehicle_service_plans (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_service_log_vehicle ON public.vehicle_service_log (vehicle_id, done_at DESC);

ALTER TABLE public.vehicle_service_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_service_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vehicle_service_plans_staff ON public.vehicle_service_plans;
CREATE POLICY vehicle_service_plans_staff ON public.vehicle_service_plans FOR ALL TO authenticated
  USING ((SELECT public.is_staff()))
  WITH CHECK ((SELECT public.is_staff()));

DROP POLICY IF EXISTS vehicle_service_log_staff ON public.vehicle_service_log;
CREATE POLICY vehicle_service_log_staff ON public.vehicle_service_log FOR ALL TO authenticated
  USING ((SELECT public.is_staff()))
  WITH CHECK ((SELECT public.is_staff()));

NOTIFY pgrst, 'reload schema';
