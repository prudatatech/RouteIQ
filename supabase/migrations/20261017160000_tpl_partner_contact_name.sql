-- The 3PL quick-onboarding form's only name field was "Contact person", but it was saved as
-- company_name: the record a reviewer approves could be a person's name, not the registered
-- business name. Adds a real company name field to the form and stores the contact person
-- under its own column instead of overloading company_name.
--
-- Runs as app_owner where that role exists (Azure). Idempotent.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    SET LOCAL ROLE app_owner;
  END IF;
END $$;

ALTER TABLE public.tpl_partners ADD COLUMN IF NOT EXISTS contact_name text;
