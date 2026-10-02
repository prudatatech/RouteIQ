-- Azure parity: a signed-in user could not read ANYTHING through the storage gateway.
--
-- Every user-JWT call (createSignedUrl, download, list, info) answered 403 "new row violates row-level security
-- policy" (storage-api's text for SQLSTATE 42501, "permission denied"): the storage schema is created by the
-- storage service on Azure, where no default privileges hand its tables to the API roles, so `authenticated` has
-- no SELECT on storage.objects / storage.buckets (Supabase's own platform adds those). The web opens vendor and
-- partner documents with the user's own session (frontend/src/services/kycDocuments.ts), so on Azure the vendor's
-- own logo and documents, the KYC review page and the partner pages could not show a file. Nothing is readable
-- through the policies either: they never got the chance to run.
--
--  1. authenticated gets exactly what reading needs: SELECT on storage.objects and storage.buckets, and a policy to
--     see the two private buckets by name (the lookup a read starts with). No INSERT/UPDATE/DELETE and nothing for
--     anon: uploads stay signed links made by the API (service_role), as before.
--  2. Granting SELECT switches the read policies ON for the first time, and kyc_documents_read let ANY staff member
--     (of any company) read EVERY object in the bucket: other companies' driver documents, proofs of delivery,
--     vehicle papers. can_read_kyc_object is tightened to the tenancy model before that can happen: the platform
--     owners and admins; a person's own folder; staff for vendor KYC folders (vendors belong to the platform, a
--     company approves them) and for partner folders and applications; a partner's own. Everything else is served by
--     the API, which checks the company and signs a link (service_role is unaffected).
--
-- Runs as the storage owner where that role exists; skipped where storage does not (CI before the storage service).
-- Idempotent.

-- 1. privileges and the bucket lookup
DO $$
DECLARE
  owner_role name;
BEGIN
  IF to_regclass('storage.objects') IS NULL OR to_regclass('storage.buckets') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RETURN;
  END IF;
  -- Where authenticated can already read objects (managed Supabase, the CI stack) there is nothing to add
  IF has_table_privilege('authenticated', 'storage.objects', 'SELECT') AND has_table_privilege('authenticated', 'storage.buckets', 'SELECT') THEN
    RETURN;
  END IF;
  SELECT pg_get_userbyid(relowner) INTO owner_role FROM pg_class WHERE oid = 'storage.objects'::regclass;
  IF owner_role <> current_user THEN
    IF NOT pg_has_role(current_user, owner_role, 'MEMBER') THEN
      RAISE NOTICE 'storage grants skipped: % may not act as %', current_user, owner_role;
      RETURN;
    END IF;
    EXECUTE format('SET LOCAL ROLE %I', owner_role);
  END IF;
  GRANT USAGE ON SCHEMA storage TO authenticated;
  GRANT SELECT ON storage.objects, storage.buckets TO authenticated;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA storage TO authenticated;
  DROP POLICY IF EXISTS authenticated_see_private_buckets ON storage.buckets;
  CREATE POLICY authenticated_see_private_buckets ON storage.buckets FOR SELECT TO authenticated
    USING (id IN ('kyc_documents', 'load_documents'));
  RESET ROLE;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'storage grants for authenticated not applied: insufficient privilege';
END $$;

-- 2. who may read what in the kyc_documents bucket
DO $$
BEGIN
  IF to_regprocedure('public.can_read_kyc_object(text)') IS NULL OR to_regprocedure('app.is_platform_admin()') IS NULL THEN
    RETURN;
  END IF;
  -- the function is owned by the admin login or by app_owner depending on who ran the first migration: replace it as its owner
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
      OR split_part(object_name, '/', 1) = (SELECT auth.uid())::text
      -- vendor KYC lives in <vendor user id>/...; any staff member may review those (a vendor serves every company)
      OR (public.is_staff() AND EXISTS (SELECT 1 FROM public.vendor_profiles v WHERE v.id::text = split_part(object_name, '/', 1)))
      -- partner applications and partner folders: reviewed by staff, readable by the partner itself
      OR (public.is_staff() AND (split_part(object_name, '/', 1) = 'tpl-applications'
                                 OR EXISTS (SELECT 1 FROM public.tpl_partners tp
                                            WHERE split_part(object_name, '/', 1) IN (tp.id::text, tp.custom_id))))
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
