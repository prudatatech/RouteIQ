-- Fleet UI: the SOS lifecycle and the per-vehicle SOS counts.
--
-- An SOS alert is active -> acknowledged -> resolved, or cancelled (a false alarm: the driver
-- cancelled it in the app, or staff closed it as one). Before this, only those first three were
-- ever written, and a driver could not withdraw an alert at all. The console treated every status
-- other than "resolved" as open, so an alert in any other state stayed on screen with Resolve and
-- Acknowledge buttons the server refused.
--
-- Idempotent and safe to re-run. NOT YET APPLIED to the live project. The app needs nothing new
-- from it to run (no new columns); it makes the status values a rule the database keeps, and
-- speeds up the counts.

-- 1. An alert nobody has touched is active (the column default already says so for new rows).
UPDATE public.sos_alerts SET status = 'active' WHERE status IS NULL;
UPDATE public.sos_alerts SET status = 'cancelled' WHERE status = 'canceled';
UPDATE public.sos_alerts SET status = 'resolved' WHERE status IN ('closed', 'complete', 'completed', 'done');

ALTER TABLE public.sos_alerts ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE public.sos_alerts ALTER COLUMN status SET NOT NULL;

-- 2. The four statuses. NOT VALID: it applies to every new or changed row without failing on an
--    old row that holds some other value; validate it once such rows have been looked at.
--    Any earlier CHECK on status (which would refuse 'cancelled') is replaced.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
    WHERE con.conrelid = 'public.sos_alerts'::regclass
      AND con.contype = 'c'
      AND att.attname = 'status'
      AND con.conname <> 'sos_alerts_status_check'
  LOOP
    EXECUTE format('ALTER TABLE public.sos_alerts DROP CONSTRAINT %I', c.conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.sos_alerts'::regclass AND conname = 'sos_alerts_status_check'
  ) THEN
    ALTER TABLE public.sos_alerts
      ADD CONSTRAINT sos_alerts_status_check
      CHECK (status IN ('active', 'acknowledged', 'resolved', 'cancelled')) NOT VALID;
  END IF;
END $$;

-- 3. Per-vehicle history and counts (Fleet list, the vehicle page's SOS tab) and the open-alert
--    reminder sweep.
CREATE INDEX IF NOT EXISTS sos_alerts_vehicle_created_idx ON public.sos_alerts (vehicle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sos_alerts_open_idx ON public.sos_alerts (created_at) WHERE status IN ('active', 'acknowledged');

NOTIFY pgrst, 'reload schema';
