-- Add field_issues column to tpl_partners to allow platform owners to flag specific application details
-- (company name, PAN, GSTIN, bank details, entity type, etc.) with revision reasons.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    SET LOCAL ROLE app_owner;
  END IF;
END $$;

ALTER TABLE public.tpl_partners ADD COLUMN IF NOT EXISTS field_issues jsonb;

-- Backfill custom_id for any partners missing one
UPDATE public.tpl_partners
SET custom_id = 'tpl_' || substring(regexp_replace(lower(coalesce(company_name, 'partner')), '[^a-z0-9]', '', 'g') from 1 for 10) || '_' || lpad(floor(random() * 9000 + 1000)::text, 4, '0')
WHERE custom_id IS NULL;
