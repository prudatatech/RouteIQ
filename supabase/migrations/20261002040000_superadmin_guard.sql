-- A users row with role = 'superadmin' is no longer added to the platform organisation automatically.
-- Until now the membership trigger made every new or promoted superadmin the platform's OWNER, so anyone who could
-- write users.role = 'superadmin' (for instance a company admin through the people screens) took platform control.
-- Platform membership is granted only explicitly, by a platform owner or admin, through org_members.
-- The company membership still follows the app role, and every existing membership (platform ones included) stays.
-- Idempotent: CREATE OR REPLACE of the one function; the triggers already call it.
CREATE OR REPLACE FUNCTION app.sync_user_membership() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  company uuid := app.default_company_org_id();
  company_role public.org_role;
  changed boolean := TG_OP = 'UPDATE';
BEGIN
  IF NEW.role::text = 'vendor' THEN
    PERFORM app.sync_vendor_org(NEW.id);
    RETURN NEW;
  END IF;
  company_role := CASE NEW.role::text
    WHEN 'superadmin' THEN 'owner' WHEN 'admin' THEN 'admin' WHEN 'manager' THEN 'ops' WHEN 'driver' THEN 'driver' END;
  IF company_role IS NULL THEN RETURN NEW; END IF;

  IF company IS NOT NULL THEN
    IF changed THEN
      INSERT INTO public.org_members (org_id, user_id, role, status) VALUES (company, NEW.id, company_role, 'active')
      ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role WHERE public.org_members.status <> 'removed';
    ELSE
      INSERT INTO public.org_members (org_id, user_id, role, status) VALUES (company, NEW.id, company_role, 'active') ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  -- No platform membership here, whatever the role: it is granted explicitly, and never taken away by a role change.
  RETURN NEW;
END $$;
