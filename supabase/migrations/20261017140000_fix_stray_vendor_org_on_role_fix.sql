-- Fixes a regression from 20261016150000 (self-signup defaults to vendor instead of driver, a real fix
-- for an anonymous public sign-up with no role claim at all).
--
-- Every account created through the ADMIN API (inviteUserByEmail, used by people.service.ts createPerson
-- for every invited admin/manager/finance/dispatcher/ops person, and the 91-step UAT story's own account
-- helpers) sets the real role in TWO steps: create the auth user (no role in app_metadata yet - it can
-- only be set by a second, separate call), then a moment later set app_metadata.role and upsert
-- public.users.role to the real value. handle_new_user() fires on step one, when no role is present
-- yet, and - since 20261016150000 - now falls through its ELSE branch to 'vendor' instead of 'driver'.
-- sync_user_membership() reacts to that transient 'vendor' role by eagerly creating a real vendor
-- organisation (app.sync_vendor_org), which the role fix a moment later does not know to undo: every
-- newly invited admin/manager/finance/dispatcher/ops person was left with a permanent, orphaned vendor
-- organisation nobody asked for (caught by the 91-step UAT story failing to seed a second company's
-- admin cleanly, "seats of B admin").
--
-- Fix: when a role flips away from 'vendor' moments after being set (the UPDATE trigger, OLD.role was
-- 'vendor', NEW.role is not), remove the vendor organisation sync_vendor_org just created for this user,
-- but ONLY when it is unmistakably the auto-created, untouched one: still pending, created in the last
-- five minutes, with no vendor_profiles row behind it (a genuine vendor who later gets invited as staff
-- keeps their real organisation - this only ever matches the org a role mix-up created for someone who
-- was never a vendor in the first place).
--
-- Runs as app_owner where that role exists (Azure). Idempotent (CREATE OR REPLACE).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    SET LOCAL ROLE app_owner;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION app.sync_user_membership() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  company uuid := app.default_company_org_id();
  platform uuid := app.platform_org_id();
  company_role public.org_role;
  changed boolean := TG_OP = 'UPDATE';
BEGIN
  IF changed AND OLD.role::text = 'vendor' AND NEW.role::text <> 'vendor' THEN
    DELETE FROM public.organizations o
    WHERE o.kind = 'vendor'
      AND o.status = 'pending'
      AND o.profile ->> 'legacy_user_id' = NEW.id::text
      AND o.created_at > now() - interval '5 minutes'
      AND NOT EXISTS (SELECT 1 FROM public.vendor_profiles vp WHERE vp.id = NEW.id);
  END IF;

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
  IF platform IS NOT NULL THEN
    IF NEW.role::text = 'superadmin' THEN
      INSERT INTO public.org_members (org_id, user_id, role, status) VALUES (platform, NEW.id, 'owner', 'active')
      ON CONFLICT (org_id, user_id) DO UPDATE SET role = 'owner', status = 'active' WHERE public.org_members.status <> 'removed' OR changed;
    ELSIF changed THEN
      UPDATE public.org_members SET status = 'removed' WHERE org_id = platform AND user_id = NEW.id AND status <> 'removed';
    END IF;
  END IF;
  RETURN NEW;
END $$;
