-- Apply changes as the app_owner to respect security
SET ROLE app_owner;

DO $$ 
BEGIN
  -- 1. Make strict KYC fields nullable for Quick Onboarding
  ALTER TABLE public.tpl_partners ALTER COLUMN pan_number DROP NOT NULL;
  ALTER TABLE public.tpl_partners ALTER COLUMN gstin DROP NOT NULL;

  -- 2. Add Quick Onboarding specific fields
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tpl_partners' AND column_name = 'operating_from') THEN
    ALTER TABLE public.tpl_partners ADD COLUMN operating_from TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tpl_partners' AND column_name = 'fleet_size') THEN
    ALTER TABLE public.tpl_partners ADD COLUMN fleet_size TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tpl_partners' AND column_name = 'truck_type') THEN
    ALTER TABLE public.tpl_partners ADD COLUMN truck_type TEXT;
  END IF;
END $$;

RESET ROLE;
