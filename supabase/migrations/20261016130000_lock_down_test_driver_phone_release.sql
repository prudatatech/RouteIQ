-- Runs as app_owner where that role exists (Azure); elsewhere (CI, local) as the connecting login. Idempotent.
--
-- public.release_driver_phone_for_test and public.revert_driver_phone_after_test
-- (20261014020000_test_driver_phone_release.sql) are SECURITY DEFINER and directly reassign a real user's
-- phone number and rewrite their auth.users email. Every other SECURITY DEFINER function in this schema
-- explicitly revokes PUBLIC/anon/authenticated and grants only service_role; these two shipped with
-- neither, so they are callable over POST /rest/v1/rpc/<name> by anyone holding the anon key, no sign-in
-- required. A prior fix for this (20261015170000_lock_down_test_driver_phone_release.sql) was lost when
-- `test` was force-pushed from an older local branch before it was ever picked up by a deploy; a live
-- probe on 2026-10-16 confirmed release_driver_phone_for_test is now actually exposed to the anon key.
-- REVOKE/GRANT on a function that may or may not yet exist in a given environment is safe either order.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    SET LOCAL ROLE app_owner;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'release_driver_phone_for_test' AND pronamespace = 'public'::regnamespace) THEN
    REVOKE ALL ON FUNCTION public.release_driver_phone_for_test(text) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.release_driver_phone_for_test(text) TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'revert_driver_phone_after_test' AND pronamespace = 'public'::regnamespace) THEN
    REVOKE ALL ON FUNCTION public.revert_driver_phone_after_test(uuid, text) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.revert_driver_phone_after_test(uuid, text) TO service_role;
  END IF;
END $$;
