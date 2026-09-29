-- Staff can already reject a bid, a vendor shipment request or a vendor's
-- KYC, but no reason is stored anywhere — the vendor is just told "no" (or,
-- for KYC, not even that). Store the reason next to each rejected record, the
-- same way 3PL partner rejections already work (20260929000300).
--
-- Safe to re-run.

ALTER TABLE public.capacity_bids ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE public.vendor_shipment_requests ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE public.vendor_profiles ADD COLUMN IF NOT EXISTS kyc_rejection_reason text;

-- Only staff may write kyc_rejection_reason (mirrors kyc_reviewed_at/by), and
-- it is cleared whenever a rejected KYC moves out of 'rejected' — approved by
-- staff, or sent back to 'submitted' when the vendor edits and resubmits.
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
    IF NEW.kyc_status IS DISTINCT FROM OLD.kyc_status AND NEW.kyc_status <> 'rejected' THEN
      NEW.kyc_rejection_reason := NULL;
    END IF;
    RETURN NEW;
  END IF;

  -- Only staff can verify a vendor or approve/reject KYC (or set why)
  IF NEW.is_verified IS DISTINCT FROM OLD.is_verified
     OR NEW.kyc_reviewed_at IS DISTINCT FROM OLD.kyc_reviewed_at
     OR NEW.kyc_reviewed_by IS DISTINCT FROM OLD.kyc_reviewed_by
     OR NEW.kyc_rejection_reason IS DISTINCT FROM OLD.kyc_rejection_reason
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

  -- Resubmitting after a rejection (the vendor's own edit sets kyc_status
  -- back to 'submitted') always clears the old reason.
  IF OLD.kyc_status = 'rejected' AND NEW.kyc_status = 'submitted' THEN
    NEW.kyc_rejection_reason := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vendor_profiles_client_update_guard ON public.vendor_profiles;
CREATE TRIGGER vendor_profiles_client_update_guard BEFORE UPDATE ON public.vendor_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_vendor_profile_update();
