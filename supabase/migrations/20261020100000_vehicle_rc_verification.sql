-- Vehicle RC verification (Cashfree's Vehicle RC Verification API): a full history of every check
-- run against a vehicle's registration number, plus three summary columns on vehicles itself so a
-- screen can show the latest status without a join. One row per check, kept forever - a vehicle's
-- RC status, insurance, PUC and permit all change over its life, and the history is the audit trail.
--
-- Runs as app_owner where that role exists (Azure). Idempotent.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    SET LOCAL ROLE app_owner;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.vehicle_rc_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  -- Our own id for the check, and Cashfree's own reference for it
  verification_id text NOT NULL,
  reference_id text,
  rc_number text NOT NULL,
  -- 'valid' | 'invalid' | 'unavailable' | 'not_configured' - never a hard failure to save the vehicle
  status text NOT NULL,

  -- Vehicle identification and specification, as Cashfree's response names them
  chassis_number text,
  engine_number text,
  vehicle_class text,
  vehicle_category text,
  manufacturer_name text,
  model_name text,
  vehicle_colour text,
  fuel_type text,
  norms_type text,
  body_type text,
  cubic_capacity text,
  cylinders_count text,
  gross_vehicle_weight text,
  unladen_weight text,
  seat_capacity text,
  sleeper_capacity text,
  standing_capacity text,
  wheelbase text,
  is_commercial boolean,
  manufacturing_month_year text,

  -- Registered owner (never the vehicle's driver - this is who the RTO has on file)
  owner_name text,
  owner_father_name text,
  owner_count text,
  owner_mobile_number text,
  present_address text,
  permanent_address text,

  -- Registration and compliance dates
  rc_status text,
  rc_status_as_on text,
  reg_authority text,
  reg_date text,
  rc_expiry_date text,
  rc_standard_cap text,
  tax_upto text,
  pucc_number text,
  pucc_upto text,

  -- Insurance and financing
  insurance_company_name text,
  insurance_policy_number text,
  insurance_upto text,
  financer_name text,

  -- Permit (state and national)
  permit_number text,
  permit_type text,
  permit_issue_date text,
  permit_valid_from text,
  permit_valid_upto text,
  national_permit_number text,
  national_permit_upto text,
  national_permit_issued_by text,

  -- Non-use declaration and violations
  non_use_status text,
  non_use_from text,
  non_use_to text,
  blacklist_status text,
  blacklist_details jsonb,
  challan_details jsonb,
  noc_details text,

  -- The exact response Cashfree gave, so a field this table does not yet model is never lost
  raw_response jsonb,
  error_message text,

  requested_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_rc_verifications_vehicle ON public.vehicle_rc_verifications (vehicle_id, created_at DESC);

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS rc_verification_status text,
  ADD COLUMN IF NOT EXISTS rc_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS rc_verification_id uuid REFERENCES public.vehicle_rc_verifications(id);

NOTIFY pgrst, 'reload schema';
