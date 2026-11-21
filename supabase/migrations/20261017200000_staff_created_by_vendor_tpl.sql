-- Staff can now create a vendor KYC or 3PL application on behalf of an applicant who called or
-- messaged their details in rather than filling the form themselves. `organizations` already has
-- `created_by`; adds the same column to vendor_profiles and tpl_partners so review screens can show
-- an "entered by staff" signal consistently across all three applicant types.
--
-- Runs as app_owner where that role exists (Azure). Idempotent.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    SET LOCAL ROLE app_owner;
  END IF;
END $$;

ALTER TABLE public.vendor_profiles ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.users(id);
ALTER TABLE public.tpl_partners ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.users(id);
