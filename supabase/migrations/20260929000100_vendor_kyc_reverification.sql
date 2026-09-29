-- A verified vendor who changes its legal identity goes back to KYC review.
--
-- Until now an approved vendor could change its company name, GST number,
-- registered address or KYC form/documents and stay approved. The vendor
-- field guard (20260928000200) now also moves an approved profile back to
-- 'submitted' and clears the review stamp when a non-staff user changes any of
-- these fields:
--   company_name, gst_number, address  (profile columns)
--   kyc_data                           (KYC form: legal name, PAN, GST,
--                                       registered address, document paths)
-- Staff edits and backend (service role) writes are not reset here; the
-- backend applies the same rule on the vendor's own profile endpoint.
--
-- Requires 20260928000100 (KYC columns) and 20260928000200 (is_staff()).
-- Safe to re-run.

CREATE OR REPLACE FUNCTION public.guard_vendor_profile_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  identity_fields constant text[] := ARRAY['company_name', 'gst_number', 'address', 'kyc_data'];
BEGIN
  IF coalesce(auth.role(), '') <> 'authenticated' OR public.is_staff() THEN
    IF NEW.kyc_status IS DISTINCT FROM OLD.kyc_status AND NEW.kyc_status IN ('approved', 'rejected') THEN
      NEW.kyc_reviewed_at := now();
      NEW.kyc_reviewed_by := auth.uid();
    END IF;
    RETURN NEW;
  END IF;

  -- Only staff can verify a vendor or approve/reject KYC
  IF NEW.is_verified IS DISTINCT FROM OLD.is_verified
     OR NEW.kyc_reviewed_at IS DISTINCT FROM OLD.kyc_reviewed_at
     OR NEW.kyc_reviewed_by IS DISTINCT FROM OLD.kyc_reviewed_by
     OR (NEW.kyc_status IS DISTINCT FROM OLD.kyc_status AND NEW.kyc_status <> 'submitted') THEN
    RAISE EXCEPTION 'Only staff can verify vendors or review KYC' USING ERRCODE = '42501';
  END IF;

  -- Changing legal identity on an approved profile needs a new review
  IF OLD.kyc_status = 'approved' AND EXISTS (
    SELECT 1 FROM unnest(identity_fields) AS f
    WHERE to_jsonb(NEW) -> f IS DISTINCT FROM to_jsonb(OLD) -> f
  ) THEN
    NEW.kyc_status := 'submitted';
    NEW.kyc_reviewed_at := NULL;
    NEW.kyc_reviewed_by := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vendor_profiles_client_update_guard ON public.vendor_profiles;
CREATE TRIGGER vendor_profiles_client_update_guard BEFORE UPDATE ON public.vendor_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_vendor_profile_update();
