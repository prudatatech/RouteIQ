-- Managed Supabase lets the API's service_role bypass row security; Azure PostgreSQL has no BYPASSRLS,
-- so every signed upload (KYC documents, POD photos, custody signatures) failed with "new row violates
-- row-level security policy" on storage.objects. Give service_role an explicit allow-everything policy,
-- which is exactly what BYPASSRLS gave it on Supabase. User-facing reads stay governed by their own
-- policies (anon/authenticated are untouched). Runs as the storage owner; skipped where storage (or the
-- role) does not exist, e.g. the CI database before the storage service has started.

DO $$
BEGIN
  IF to_regclass('storage.objects') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_storage_admin')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RETURN;
  END IF;
  -- Where service_role already bypasses row security (managed Supabase, the CI stack) there is nothing to add
  IF (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'service_role') THEN
    RETURN;
  END IF;
  -- And only a login that may act as the storage owner can add the policy (the Azure admin can; CI's postgres cannot)
  IF NOT pg_has_role(current_user, 'supabase_storage_admin', 'MEMBER') THEN
    RETURN;
  END IF;
  SET LOCAL ROLE supabase_storage_admin;
  GRANT USAGE ON SCHEMA storage TO service_role;
  GRANT ALL ON storage.objects, storage.buckets TO service_role;
  DROP POLICY IF EXISTS service_role_all_objects ON storage.objects;
  CREATE POLICY service_role_all_objects ON storage.objects FOR ALL TO service_role USING (true) WITH CHECK (true);
  DROP POLICY IF EXISTS service_role_all_buckets ON storage.buckets;
  CREATE POLICY service_role_all_buckets ON storage.buckets FOR ALL TO service_role USING (true) WITH CHECK (true);
  RESET ROLE;
END $$;
