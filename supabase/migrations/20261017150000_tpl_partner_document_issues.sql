-- Per-document 3PL application review, the same idea as vehicles.document_issues (20261016180000) and
-- vendor_profiles.kyc_document_issues (20261016183000).
--
-- Rejecting a 3PL application today is all-or-nothing: one reason, the whole application rejected, and
-- a rejected applicant can only start over from scratch (updateApplication refuses anything but a
-- 'pending' application). document_issues lets the platform flag specific documents (keyed by the same
-- doc_type strings already stored on tpl_documents: "PAN Card", "GST Certificate", "Cancelled Cheque",
-- "Signed Rate Agreement") with their own reasons, while the application stays 'pending' so the existing
-- edit flow keeps working. Resubmitting (or a flagged document being replaced) clears the matching flag.
--
-- Shape: { "<doc type>": reason }. Null/empty means no outstanding issues.
--
-- Runs as app_owner where that role exists (Azure). Idempotent.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    SET LOCAL ROLE app_owner;
  END IF;
END $$;

ALTER TABLE public.tpl_partners ADD COLUMN IF NOT EXISTS document_issues jsonb;
