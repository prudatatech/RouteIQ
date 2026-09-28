-- Stop users from choosing their own role.
--
-- Before: handle_new_user copied `role` from raw_user_meta_data, which any
-- caller of supabase.auth.signUp() controls, so anyone could self-register
-- as superadmin. Clients could also UPDATE public.users directly.
--
-- After: roles come from raw_app_meta_data, which only the service role can
-- set. Self-signup may only request `vendor` (the vendor signup page); any
-- other self-signup gets the default `driver`. Customers are stored in
-- public.customers by the backend and get no public.users row.

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
    WHEN NEW.raw_user_meta_data->>'role' = 'vendor' THEN 'vendor'::user_role
    ELSE 'driver'::user_role
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Clients only read public.users; writes go through the backend (service role).
-- The driver app updates its own push token directly, so that one column stays writable.
REVOKE INSERT, UPDATE, DELETE ON public.users FROM anon, authenticated;
GRANT UPDATE (push_token) ON public.users TO authenticated;
