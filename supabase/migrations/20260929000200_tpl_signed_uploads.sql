-- 3PL documents are uploaded only through backend-issued signed upload URLs.
--
-- 20260928000200 let anyone (anon included) insert any file under
-- kyc_documents/tpl-applications/, and 3PL partners write directly into their
-- partner folder. backend-ts now issues signed upload URLs
-- (POST /tpl/applications/upload-url) for a path it chooses, after checking
-- the application (new 3PL ID, or the partner / applicant PAN), the document
-- type, the content type (PDF, JPG, PNG) and the size. Signed uploads do not
-- go through these policies, so clients need no INSERT policy for 3PL files.
--
-- Vendors keep uploading their own KYC documents into <user id>/.
-- The bucket accepts only the formats every uploader in the app offers
-- (PDF, JPG, PNG), which also binds signed uploads to those types.
--
-- Rollout: deploy backend-ts and the web app from the same branch first, then
-- apply this migration. Safe to re-run.

DROP POLICY IF EXISTS kyc_documents_upload_application ON storage.objects;

DROP POLICY IF EXISTS kyc_documents_upload_own ON storage.objects;
CREATE POLICY kyc_documents_upload_own ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'kyc_documents'
    AND (SELECT public.current_app_role()) = 'vendor'
    AND split_part(name, '/', 1) = auth.uid()::text
  );

UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png']
 WHERE id = 'kyc_documents';
