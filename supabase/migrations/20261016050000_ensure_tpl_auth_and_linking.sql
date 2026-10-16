-- Migration: Ensure 3PL partner auth identity, password, and user linkage
-- Fixes issue where users signing up via OAuth or quick onboarding lack
-- an 'email' provider entry in auth.identities, preventing password login.

CREATE OR REPLACE FUNCTION public.ensure_tpl_partner_auth(p_email text, p_password text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_norm_email text := lower(trim(p_email));
  v_user_id uuid;
  v_encrypted_pw text;
  v_partner_id uuid;
  v_has_identity_col boolean;
  v_full_name text;
BEGIN
  IF v_norm_email IS NULL OR v_norm_email = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Email is required');
  END IF;

  -- 1. Find or create auth.users entry
  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = v_norm_email LIMIT 1;

  IF p_password IS NOT NULL AND length(p_password) >= 6 THEN
    v_encrypted_pw := extensions.crypt(p_password, extensions.gen_salt('bf'));
  END IF;

  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();
    INSERT INTO auth.users (
      id,
      instance_id,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      aud,
      role
    ) VALUES (
      v_user_id,
      '00000000-0000-0000-0000-000000000000',
      v_norm_email,
      COALESCE(v_encrypted_pw, extensions.crypt('DefaultPass123!', extensions.gen_salt('bf'))),
      now(),
      '{"provider": "email", "providers": ["email"], "role": "vendor"}'::jsonb,
      '{"role": "vendor"}'::jsonb,
      now(),
      now(),
      'authenticated',
      'authenticated'
    );
  ELSE
    -- User exists: update password if provided, and confirm email & role
    UPDATE auth.users
    SET encrypted_password = COALESCE(v_encrypted_pw, encrypted_password),
        email_confirmed_at = COALESCE(email_confirmed_at, now()),
        raw_app_meta_data = jsonb_set(COALESCE(raw_app_meta_data, '{}'::jsonb), '{role}', '"vendor"'),
        updated_at = now()
    WHERE id = v_user_id;
  END IF;

  -- 2. Ensure auth.identities has 'email' provider entry for this user
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'identities' AND column_name = 'identity_id'
  ) INTO v_has_identity_col;

  IF NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = v_user_id AND provider = 'email') THEN
    IF v_has_identity_col THEN
      INSERT INTO auth.identities (
        identity_id,
        id,
        user_id,
        identity_data,
        provider,
        last_sign_in_at,
        created_at,
        updated_at
      ) VALUES (
        gen_random_uuid(),
        v_user_id::text,
        v_user_id,
        jsonb_build_object('sub', v_user_id::text, 'email', v_norm_email),
        'email',
        now(),
        now(),
        now()
      ) ON CONFLICT DO NOTHING;
    ELSE
      INSERT INTO auth.identities (
        id,
        user_id,
        identity_data,
        provider,
        last_sign_in_at,
        created_at,
        updated_at
      ) VALUES (
        v_user_id::text,
        v_user_id,
        jsonb_build_object('sub', v_user_id::text, 'email', v_norm_email),
        'email',
        now(),
        now(),
        now()
      ) ON CONFLICT DO NOTHING;
    END IF;
  ELSE
    UPDATE auth.identities
    SET identity_data = jsonb_build_object('sub', v_user_id::text, 'email', v_norm_email),
        updated_at = now()
    WHERE user_id = v_user_id AND provider = 'email';
  END IF;

  -- 3. Upsert public.users with role = 'vendor'
  SELECT COALESCE(
    (SELECT company_name FROM public.tpl_partners WHERE lower(email) = v_norm_email LIMIT 1),
    (SELECT raw_user_meta_data->>'full_name' FROM auth.users WHERE id = v_user_id),
    split_part(v_norm_email, '@', 1),
    '3PL Partner'
  ) INTO v_full_name;

  INSERT INTO public.users (id, email, full_name, role, is_active)
  VALUES (v_user_id, v_norm_email, COALESCE(v_full_name, '3PL Partner'), 'vendor', true)
  ON CONFLICT (id) DO UPDATE
  SET role = 'vendor',
      is_active = true,
      email = EXCLUDED.email,
      full_name = COALESCE(public.users.full_name, EXCLUDED.full_name, '3PL Partner');

  -- 4. Link tpl_partners to this user
  SELECT id INTO v_partner_id FROM public.tpl_partners WHERE lower(email) = v_norm_email LIMIT 1;
  IF v_partner_id IS NOT NULL THEN
    UPDATE public.tpl_partners
    SET user_id = v_user_id
    WHERE id = v_partner_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'email', v_norm_email,
    'partner_id', v_partner_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_tpl_partner_auth(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_tpl_partner_auth(text, text) TO postgres;
GRANT EXECUTE ON FUNCTION public.ensure_tpl_partner_auth(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_tpl_partner_auth(text, text) TO anon;

-- Apply immediately for recent test partner
SELECT public.ensure_tpl_partner_auth('bossalok69@gmail.com', '9hbywif97BFZDL5P!');

-- Backfill all existing tpl_partners to link user_id and set role = 'vendor'
DO $$
DECLARE
  r RECORD;
  u_id uuid;
BEGIN
  FOR r IN SELECT id, email, user_id FROM public.tpl_partners WHERE email IS NOT NULL LOOP
    SELECT id INTO u_id FROM auth.users WHERE lower(email) = lower(r.email) LIMIT 1;
    IF u_id IS NOT NULL THEN
      UPDATE public.tpl_partners SET user_id = u_id WHERE id = r.id AND (user_id IS NULL OR user_id != u_id);
      UPDATE public.users SET role = 'vendor', is_active = true WHERE id = u_id AND role NOT IN ('superadmin', 'admin');
      PERFORM public.ensure_tpl_partner_auth(r.email);
    END IF;
  END LOOP;
END $$;
