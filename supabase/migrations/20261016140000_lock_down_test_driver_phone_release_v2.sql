-- No app_owner role switch here, unlike most migrations in this folder: the two functions below were
-- created by the plain connecting admin role (their original migration never had the app_owner guard),
-- and in Postgres only an object's owner (or a superuser) can REVOKE/GRANT its privileges. The previous
-- two attempts at this fix (20261015170000, 20261016130000) both ran as app_owner and both warned
-- "no privileges could be revoked/granted" with zero actual effect — app_owner was never the owner, so
-- it silently couldn't change anything. A live probe after 20261016130000 "applied" successfully
-- confirmed both functions are still exposed to the anon key. Running as the plain connecting role (the
-- same one that created them) is what actually has the authority to change their grants.
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
