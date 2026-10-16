-- Quick Truck Onboarding & Direct Load Allocation (docs/specs/quick-truck-onboarding.pdf)
--
--  1. Relax vehicles table constraints so only vehicle_type, plate_number and carrier_org_id are strictly required.
--     Driver, GPS, RC, insurance, fitness, permit, PUC are nullable for quick onboarding.
--  2. Add profile_status column (quick_added | pending_documents | complete).
--  3. Trigger to auto-derive profile_status when documents/driver details are updated.
--  4. Backfill existing vehicles.
--
-- Runs as app_owner where that role exists (Azure). Idempotent.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    SET LOCAL ROLE app_owner;
  END IF;
END $$;

-- 1. Loosen required fields for quick onboarding
ALTER TABLE public.vehicles ALTER COLUMN driver_id DROP NOT NULL;
ALTER TABLE public.vehicles ALTER COLUMN capacity_kg DROP NOT NULL;
ALTER TABLE public.vehicles ALTER COLUMN rc_number DROP NOT NULL;
ALTER TABLE public.vehicles ALTER COLUMN insurance_number DROP NOT NULL;
ALTER TABLE public.vehicles ALTER COLUMN fitness_certificate_number DROP NOT NULL;
ALTER TABLE public.vehicles ALTER COLUMN permit_number DROP NOT NULL;
ALTER TABLE public.vehicles ALTER COLUMN puc_number DROP NOT NULL;
ALTER TABLE public.vehicles ALTER COLUMN spark_id DROP NOT NULL;

-- 2. Track completion state
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS profile_status text NOT NULL DEFAULT 'quick_added';

ALTER TABLE public.vehicles DROP CONSTRAINT IF EXISTS vehicles_profile_status_check;
ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_profile_status_check
  CHECK (profile_status IN ('quick_added', 'pending_documents', 'complete'));

CREATE INDEX IF NOT EXISTS idx_vehicles_profile_status ON public.vehicles (profile_status);

-- 3. Function and trigger to auto-derive profile_status
CREATE OR REPLACE FUNCTION public.derive_vehicle_profile_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- If explicitly set during the update, keep unless it was default
  IF NEW.rc_number IS NOT NULL AND length(trim(NEW.rc_number)) > 0
     AND NEW.insurance_number IS NOT NULL AND length(trim(NEW.insurance_number)) > 0
     AND NEW.driver_id IS NOT NULL THEN
    NEW.profile_status := 'complete';
  ELSIF (NEW.rc_number IS NOT NULL AND length(trim(NEW.rc_number)) > 0)
     OR (NEW.insurance_number IS NOT NULL AND length(trim(NEW.insurance_number)) > 0)
     OR NEW.driver_id IS NOT NULL
     OR (NEW.fitness_certificate_number IS NOT NULL AND length(trim(NEW.fitness_certificate_number)) > 0)
     OR (NEW.permit_number IS NOT NULL AND length(trim(NEW.permit_number)) > 0)
     OR (NEW.puc_number IS NOT NULL AND length(trim(NEW.puc_number)) > 0) THEN
    NEW.profile_status := 'pending_documents';
  ELSE
    NEW.profile_status := COALESCE(NULLIF(NEW.profile_status, ''), 'quick_added');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_derive_vehicle_profile_status ON public.vehicles;
CREATE TRIGGER trg_derive_vehicle_profile_status
  BEFORE INSERT OR UPDATE OF rc_number, insurance_number, driver_id, fitness_certificate_number, permit_number, puc_number
  ON public.vehicles
  FOR EACH ROW
  EXECUTE FUNCTION public.derive_vehicle_profile_status();

-- 4. Backfill existing records
UPDATE public.vehicles
SET profile_status = CASE
  WHEN rc_number IS NOT NULL AND length(trim(rc_number)) > 0
       AND insurance_number IS NOT NULL AND length(trim(insurance_number)) > 0
       AND driver_id IS NOT NULL THEN 'complete'
  WHEN (rc_number IS NOT NULL AND length(trim(rc_number)) > 0)
       OR (insurance_number IS NOT NULL AND length(trim(insurance_number)) > 0)
       OR driver_id IS NOT NULL
       OR (fitness_certificate_number IS NOT NULL AND length(trim(fitness_certificate_number)) > 0)
       OR (permit_number IS NOT NULL AND length(trim(permit_number)) > 0)
       OR (puc_number IS NOT NULL AND length(trim(puc_number)) > 0) THEN 'pending_documents'
  ELSE 'quick_added'
END
WHERE profile_status IS NULL OR profile_status = 'quick_added';
