-- A reviewer validating a GST-registered B2B vendor needs to know the entity type
-- (proprietorship/partnership/Pvt Ltd/LLP/...), its CIN when it has one, and who is
-- authorized to sign on the company's behalf. None of these were collected before.
-- Required only at the point of a new KYC submission (schemas/vendor.ts); an
-- already-approved vendor is never retroactively blocked by this.
--
-- Runs as app_owner where that role exists (Azure). Idempotent.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    SET LOCAL ROLE app_owner;
  END IF;
END $$;

ALTER TABLE public.vendor_profiles ADD COLUMN IF NOT EXISTS entity_type text;
ALTER TABLE public.vendor_profiles ADD COLUMN IF NOT EXISTS cin text;
ALTER TABLE public.vendor_profiles ADD COLUMN IF NOT EXISTS authorized_signatory_name text;
