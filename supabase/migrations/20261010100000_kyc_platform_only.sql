-- Approvals belong to the platform (docs/platform-model.md): vendor KYC and 3PL applications.
--
-- Until now every staff member of every company could read all vendor profiles (PAN, GSTIN, bank details, KYC data) and
-- all 3PL applications straight through PostgREST, and the KYC bucket policy let any staff member open any vendor's
-- documents. Now only the platform's owners and admins and the owner of the record can. A company reads the basic
-- profile (name, city) of a vendor whose load it can see through the API (GET /vendor/basic), which serves nothing else.
--
--  1. vendor_profiles, kyc_profiles, tpl_partners, tpl_corridors, tpl_documents: SELECT for the owner and platform admins.
--  2. can_read_kyc_object: platform admins, the person's own folder, a partner's own folders. No staff branch.
--
-- Runs as app_owner where that role exists (Azure). Idempotent.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    SET LOCAL ROLE app_owner;
  END IF;
END $$;

-- 1. the tables
DROP POLICY IF EXISTS vendor_profiles_select ON public.vendor_profiles;
CREATE POLICY vendor_profiles_select ON public.vendor_profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR (SELECT app.is_platform_admin()));

DO $$
BEGIN
  IF to_regclass('public.kyc_profiles') IS NOT NULL THEN
    DROP POLICY IF EXISTS kyc_profiles_select ON public.kyc_profiles;
    CREATE POLICY kyc_profiles_select ON public.kyc_profiles FOR SELECT TO authenticated
      USING (id = auth.uid() OR (SELECT app.is_platform_admin()));
  END IF;
END $$;

DROP POLICY IF EXISTS tpl_partners_select ON public.tpl_partners;
CREATE POLICY tpl_partners_select ON public.tpl_partners FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR (SELECT app.is_platform_admin()));

DROP POLICY IF EXISTS tpl_corridors_select ON public.tpl_corridors;
CREATE POLICY tpl_corridors_select ON public.tpl_corridors FOR SELECT TO authenticated
  USING (partner_id IN (SELECT public.my_tpl_partner_ids()) OR (SELECT app.is_platform_admin()));

DROP POLICY IF EXISTS tpl_documents_select ON public.tpl_documents;
CREATE POLICY tpl_documents_select ON public.tpl_documents FOR SELECT TO authenticated
  USING (partner_id IN (SELECT public.my_tpl_partner_ids()) OR (SELECT app.is_platform_admin()));

RESET ROLE;

-- 2. the KYC bucket (created by 20261010080000 from 20260928000200; owned by the admin login or app_owner)
DO $$
BEGIN
  IF to_regprocedure('public.can_read_kyc_object(text)') IS NULL OR to_regprocedure('app.is_platform_admin()') IS NULL THEN
    RETURN;
  END IF;
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
      ALTER FUNCTION public.can_read_kyc_object(text) OWNER TO app_owner;
      SET LOCAL ROLE app_owner;
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'can_read_kyc_object keeps its owner';
  END;

  CREATE OR REPLACE FUNCTION public.can_read_kyc_object(object_name text)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $f$
    SELECT (SELECT app.is_platform_admin())
      -- a person's own folder (a vendor's KYC lives in <vendor user id>/...)
      OR split_part(object_name, '/', 1) = (SELECT auth.uid())::text
      -- a partner's own folders and its application files
      OR EXISTS (
        SELECT 1 FROM public.tpl_partners tp
        WHERE tp.user_id = (SELECT auth.uid())
          AND (split_part(object_name, '/', 1) IN (tp.id::text, tp.custom_id)
               OR (split_part(object_name, '/', 1) = 'tpl-applications' AND split_part(object_name, '/', 2) = tp.custom_id))
      )
  $f$;
  REVOKE ALL ON FUNCTION public.can_read_kyc_object(text) FROM PUBLIC, anon;
  GRANT EXECUTE ON FUNCTION public.can_read_kyc_object(text) TO authenticated, service_role;
  RESET ROLE;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'can_read_kyc_object not replaced: insufficient privilege';
END $$;

NOTIFY pgrst, 'reload schema';
