-- Bug fix: the vendor documents/KYC UI has always read and written
-- `vendor_profiles.company_logo` (see VendorLayout.tsx, VendorDocumentsPage.tsx)
-- but no migration ever added the column, so saving a company logo has been
-- silently failing (the PostgREST update either drops the unknown key or
-- errors, depending on client settings) and the header never showed a logo.
--
-- The path already lives in kyc_data.data.docUrls.companyLogo; this column is
-- a small denormalized copy so the layout can show it without loading the
-- whole KYC blob. Additive and safe to re-run.

ALTER TABLE public.vendor_profiles ADD COLUMN IF NOT EXISTS company_logo text;

NOTIFY pgrst, 'reload schema';
