-- Narrow the writes that clients may still make directly.
--
-- Driver app 1.1.0 (already installed) writes three things straight to
-- Supabase with the driver's own session, so those writes stay allowed, but
-- only in the shapes the app really sends:
--   vehicles           position, heartbeat and idle/on_route status of the
--                      driver's own vehicle (background GPS)
--   telemetry          one history row per position for that vehicle
--   driver_confirmations  answering "I accept this inserted stop"
--   users.push_token   own push token (unchanged)
-- Everything else about those tables goes through backend-ts.
--
-- What changes:
--   * A vehicle that is in maintenance or archived can no longer be written by
--     its driver at all. Before, only the NEW status was checked, so a driver
--     could bring their own vehicle back from maintenance with a location ping.
--   * Coordinates on vehicles and telemetry must be real (lat -90..90,
--     lng -180..180, speed 0..300 km/h, fuel 0..100 %).
--   * A driver can answer a stop prompt once, and only with 'confirmed' (flagging
--     and acknowledgement go through backend-ts: /capacity/driver/flag-stop,
--     /capacity/driver/ack-stop). An answer cannot be changed afterwards, and
--     one the timeout accepted stays accepted.
--   * A user may only change the is_read flag of their own notifications, not
--     their title, text or type.
--   * Superadmins no longer edit system_settings (fuel price, rate card) from
--     the browser. The console uses PUT /finance/settings, which validates the
--     value and writes an audit entry.
--   * push_token is capped at 200 characters.
--
-- Newer driver builds use POST /capacity/driver/confirm-stop for the
-- confirmation and can move to POST /telemetry/driver-ping for position, which
-- would let these direct-write policies go entirely in a later release.
--
-- Rollout: no client change is needed first. The web app has no write to
-- system_settings; the notification bell keeps working (is_read only).
-- Safe to re-run.

-- ── vehicles: operating vehicles only, real coordinates ─────
DROP POLICY IF EXISTS vehicles_update_driver ON public.vehicles;
CREATE POLICY vehicles_update_driver ON public.vehicles FOR UPDATE TO authenticated
  USING (
    driver_id = auth.uid()
    AND status::text IN ('available', 'on_route', 'idle', 'offline')
  )
  WITH CHECK (
    driver_id = auth.uid()
    AND status::text IN ('available', 'on_route', 'idle', 'offline')
    AND (latitude IS NULL OR latitude BETWEEN -90 AND 90)
    AND (longitude IS NULL OR longitude BETWEEN -180 AND 180)
  );

-- ── telemetry: real readings for the driver's own vehicle ───
DROP POLICY IF EXISTS telemetry_insert_driver ON public.telemetry;
CREATE POLICY telemetry_insert_driver ON public.telemetry FOR INSERT TO authenticated
  WITH CHECK (
    vehicle_id IN (SELECT public.my_vehicle_ids())
    AND latitude BETWEEN -90 AND 90
    AND longitude BETWEEN -180 AND 180
    AND (speed_kmph IS NULL OR speed_kmph BETWEEN 0 AND 300)
    AND (fuel_level_pct IS NULL OR fuel_level_pct BETWEEN 0 AND 100)
  );

-- ── driver_confirmations: answer once, only "confirmed" ─────
DROP POLICY IF EXISTS driver_confirmations_update_driver ON public.driver_confirmations;
CREATE POLICY driver_confirmations_update_driver ON public.driver_confirmations FOR UPDATE TO authenticated
  USING (vehicle_id IN (SELECT public.my_vehicle_ids()) AND action IS NULL)
  WITH CHECK (vehicle_id IN (SELECT public.my_vehicle_ids()) AND action = 'confirmed');

-- ── notifications: only the read flag ───────────────────────
REVOKE UPDATE ON public.notifications FROM anon, authenticated;
GRANT UPDATE (is_read) ON public.notifications TO authenticated;

-- ── system_settings: read for everyone, written by backend-ts ─
DROP POLICY IF EXISTS system_settings_update_superadmin ON public.system_settings;
REVOKE INSERT, UPDATE, DELETE ON public.system_settings FROM anon, authenticated;

-- ── users.push_token: a token, not a payload ────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_push_token_length') THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_push_token_length CHECK (push_token IS NULL OR length(push_token) <= 200) NOT VALID;
  END IF;
END $$;
