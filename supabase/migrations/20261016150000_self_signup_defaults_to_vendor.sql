-- handle_new_user() defaulted any self-signup with no explicit role signal to 'driver' (see
-- 20260928000000_secure_user_roles.sql: "any other self-signup gets the default driver"). That default
-- was meant to be the harmless, no-access choice, but homeForKind() in the frontend sends role='driver'
-- straight to /driver - so a brand-new Google OAuth sign-in (3PL onboarding, and the "Continue with
-- Google" button on /login) gets silently defaulted into the driver app before they have done anything.
--
-- Google OAuth never lets the client set raw_user_meta_data.role (unlike the vendor email/password
-- signup page, which explicitly sends { data: { role: 'vendor' } }), so every Google self-signup fell
-- through to the driver default. Staff and driver accounts are meant to be administrator-provisioned
-- only (raw_app_meta_data.role, settable only by the service role) - no self-service path should ever
-- land a brand-new user in the driver role. The safe default for self-signup is 'vendor'.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  granted_role text := NEW.raw_app_meta_data->>'role';
  new_role user_role;
BEGIN
  IF granted_role = 'customer' THEN
    RETURN NEW;
  END IF;

  new_role := CASE
    WHEN granted_role IN ('superadmin', 'admin', 'manager', 'driver', 'vendor') THEN granted_role::user_role
    ELSE 'vendor'::user_role
  END;

  INSERT INTO public.users (id, email, full_name, role, phone)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    new_role,
    NEW.raw_user_meta_data->>'phone'
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, public.users.full_name);
  RETURN NEW;
END;
$$;
