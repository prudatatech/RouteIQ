-- Fleet health stream, part 3: alarms.
--
-- Alarms live in maintenance_alerts (the table the Cargo alerts tab already
-- reads). New columns:
--   status          open -> acknowledged -> resolved (is_resolved stays in step)
--   source          'webhook' (device event) or 'rule' (server-side rule)
--   is_test         true for staff "Send test alarm"; excluded from stats and health scores
--   details         raw event values (speed, fuel, position, limit)
--   occurrences     how many times the same open alarm repeated
--   last_seen_at    latest repeat
-- One open alarm per vehicle + type (+ test flag) is enforced by a partial
-- unique index, created only if the table has no open duplicates today.
--
-- Also seeds the rule thresholds in system_settings (edit them there or in
-- Admin > Settings). Existing values are never overwritten.
--
-- Additive and safe to re-run. Applied to the live project on 2026-09-29.

ALTER TABLE public.maintenance_alerts ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open';
ALTER TABLE public.maintenance_alerts ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.maintenance_alerts ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE public.maintenance_alerts ADD COLUMN IF NOT EXISTS details jsonb;
ALTER TABLE public.maintenance_alerts ADD COLUMN IF NOT EXISTS occurrences integer NOT NULL DEFAULT 1;
ALTER TABLE public.maintenance_alerts ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
ALTER TABLE public.maintenance_alerts ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;
ALTER TABLE public.maintenance_alerts ADD COLUMN IF NOT EXISTS acknowledged_by uuid;
ALTER TABLE public.maintenance_alerts ADD COLUMN IF NOT EXISTS resolved_by uuid;

-- Alerts resolved before this migration are resolved here too.
UPDATE public.maintenance_alerts SET status = 'resolved' WHERE is_resolved = true AND status = 'open';

CREATE INDEX IF NOT EXISTS idx_maintenance_alerts_vehicle ON public.maintenance_alerts (vehicle_id, created_at DESC);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.maintenance_alerts WHERE is_resolved = false
    GROUP BY vehicle_id, alert_type, is_test HAVING count(*) > 1
  ) THEN
    RAISE NOTICE 'maintenance_alerts has open duplicates; resolve them, then re-run this migration to add the unique index';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_maintenance_alert
      ON public.maintenance_alerts (vehicle_id, alert_type, is_test) WHERE is_resolved = false;
  END IF;
END $$;

INSERT INTO public.system_settings (key, value) VALUES
  ('alert_overspeed_kmph', '{"value": 80}'),
  ('alert_idle_minutes', '{"value": 30}'),
  ('alert_gps_lost_minutes', '{"value": 15}'),
  ('alert_low_fuel_pct', '{"value": 15}')
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
