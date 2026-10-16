-- Logistic-company KYC documents: today a company registers with only flat text fields
-- (name, GSTIN, PAN, address) and the platform decides from those alone - no GST
-- certificate, PAN card, incorporation/MSME certificate or cancelled cheque is ever
-- asked for, and a rejected company must re-register from scratch instead of fixing
-- and resubmitting. This mirrors the vendor_profiles KYC shape (20261016183000) on
-- organizations, scoped in code to kind = 'logistic_company':
--   kyc_documents        { docUrls: { <docKey>: path }, otherDocs: [{ name, path }] }
--   kyc_document_issues  { <docKey>: reason } - the platform flags one document at a time
--   kyc_submitted_at     set once the company submits documents for review; cleared when
--                        the platform flags a document (the company must act again, the
--                        same "needs fixing" idea vendor KYC uses via kyc_status) or when
--                        the company edits and resubmits after a rejection.
--
-- Runs as app_owner where that role exists (Azure). Idempotent.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    SET LOCAL ROLE app_owner;
  END IF;
END $$;

ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS kyc_documents jsonb;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS kyc_document_issues jsonb;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS kyc_submitted_at timestamptz;
