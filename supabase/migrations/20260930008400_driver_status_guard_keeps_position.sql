-- Keep tracking a vehicle whose status a driver may not change.
--
-- 20260930008300 added vehicles_driver_status_guard, which RAISEd when a
-- driver's own update changed the status of a vehicle in maintenance/archived
-- (or moved it into either). The installed driver app sends `status` together
-- with every position/heartbeat write, so the whole update was rejected and a
-- vehicle held in maintenance after a serious SOS stopped reporting its
-- location - exactly when it matters most.
--
-- The guard now keeps the old status and lets the rest of the row (position,
-- heartbeat, speed) through. The rule is unchanged: a driver still cannot move
-- a vehicle into or out of maintenance/archived. Backend and staff writes
-- (no auth.uid() or not the vehicle's driver) are unaffected.
--
-- Safe to re-run. Applied to the live project on 2026-09-29.

CREATE OR REPLACE FUNCTION public.vehicles_driver_status_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND OLD.driver_id = auth.uid()
     AND NEW.status IS DISTINCT FROM OLD.status
     AND (OLD.status::text NOT IN ('available', 'on_route', 'idle', 'offline')
          OR NEW.status::text NOT IN ('available', 'on_route', 'idle', 'offline')) THEN
    NEW.status := OLD.status;
  END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
