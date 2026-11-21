-- Per-document vendor KYC review, the same idea as vehicles.document_issues (20261016180000).
--
-- Rejecting a vendor's KYC today is all-or-nothing: one reason, the whole application rejected, even when
-- only the PAN scan was blurry and everything else (GST, bank, address) was fine. kyc_document_issues lets
-- the platform flag specific documents (keyed by the same names the review already uses: panScan,
-- cancelledCheque, gstRegistration, msmeCert, companyLogo) with their own reasons, while the KYC moves to
-- the existing 'info_requested' status - reusing the same "vendor must act before we can decide" state and
-- editability the request-info flow already has, rather than inventing a second one. Resubmitting the form
-- clears every flag (vendor.service.ts submitKyc), the same as a full rejection already resets the row.
--
-- Shape: { "<docKey>": reason }. Null/empty means no outstanding issues.
--
-- Runs as app_owner where that role exists (Azure). Idempotent.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    SET LOCAL ROLE app_owner;
  END IF;
END $$;

ALTER TABLE public.vendor_profiles ADD COLUMN IF NOT EXISTS kyc_document_issues jsonb;
