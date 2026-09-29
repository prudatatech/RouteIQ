-- Vendor profiles and KYC documents are written only by backend-ts.
--
-- Before: 20260928000200 let a vendor UPDATE its own vendor_profiles row and
-- staff UPDATE any row straight from the browser, guarded only by a trigger
-- that checks a few columns. That skipped the rules the backend applies:
--   * approving KYC never told the vendor and left no audit entry;
--   * a vendor could rewrite kyc_data or upload into its folder with any file
--     name, size and (before the bucket limit) type;
--   * profile fields were never validated (GST, coordinates, lengths).
--
-- After: the web app calls backend-ts for every profile and KYC write
--   PUT  /vendor/kyc/:id/approve    staff decision, notifies the vendor, audited
--   PUT  /vendor/kyc/:id/reject     staff decision, notifies the vendor, audited
--   POST /vendor/kyc/submit         vendor submits the form
--   PUT  /vendor/kyc/documents      vendor saves uploaded document paths
--   POST /vendor/kyc/upload-url     signed upload URL (PDF/JPG/PNG, size limited)
-- and clients keep only SELECT (own row / staff) plus realtime.
--
-- The backend uses the service role, which bypasses RLS, so nothing else
-- changes for it. The field-guard trigger stays as a second line of defence.
--
-- Rollout: deploy backend-ts and the web app from the same branch first (the
-- previous web build writes vendor_profiles directly and would fail with
-- "permission denied" once this is applied), then apply this migration.
-- Safe to re-run.

DROP POLICY IF EXISTS vendor_profiles_update ON public.vendor_profiles;
REVOKE INSERT, UPDATE, DELETE ON public.vendor_profiles FROM anon, authenticated;

-- KYC files reach storage only through backend-issued signed upload URLs
-- (they do not pass through storage policies), so no client may insert.
DROP POLICY IF EXISTS kyc_documents_upload_own ON storage.objects;
DROP POLICY IF EXISTS kyc_documents_upload_application ON storage.objects;
