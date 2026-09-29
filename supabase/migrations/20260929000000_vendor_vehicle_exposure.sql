-- Vendors no longer read vehicle rows.
--
-- 20260928000200 let vendors SELECT every column of the vehicle behind any
-- open capacity window (driver phone, live position, plate, ...). Vendors now
-- get a column-limited view of open windows and of their own bids from
-- backend-ts (GET /capacity/windows/open, GET /capacity/bids/mine): vehicle
-- type, free capacity and origin city; the plate only on a bid they have won.
--
-- Staff keep full access; drivers keep their own vehicle. Vendors keep reading
-- capacity_windows rows (no vehicle details) for realtime refreshes.
--
-- Rollout: deploy backend-ts and the web app from the same branch first, then
-- apply this migration. Safe to re-run.

DROP POLICY IF EXISTS vehicles_select ON public.vehicles;
CREATE POLICY vehicles_select ON public.vehicles FOR SELECT TO authenticated
  USING ((SELECT public.is_staff()) OR driver_id = auth.uid());

-- Only the dropped policy branch used this helper
DROP FUNCTION IF EXISTS public.vendor_visible_vehicle_ids();
