-- ═══════════════════════════════════════════════════════════════════════
-- Migration: Test Driver Phone Release & Revert Utilities
-- Enables safe testing with identical phone numbers by archiving previous
-- test driver phone bindings without breaking foreign key integrity.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Function to release / archive an existing driver phone for testing ──
CREATE OR REPLACE FUNCTION public.release_driver_phone_for_test(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_norm_phone text;
  v_old_user record;
  v_archived_phone text;
  v_affected_count int := 0;
  v_results jsonb := '[]'::jsonb;
BEGIN
  -- Normalize phone (ensure clean prefix)
  v_norm_phone := trim(p_phone);
  IF NOT v_norm_phone LIKE '+%' THEN
    v_norm_phone := '+' || regexp_replace(v_norm_phone, '\D', '', 'g');
  END IF;

  -- Find any users holding this phone
  FOR v_old_user IN
    SELECT id, email, full_name, role, phone, status
    FROM public.users
    WHERE phone = v_norm_phone
       OR phone = regexp_replace(v_norm_phone, '^\+', '')
       OR phone = regexp_replace(v_norm_phone, '^\+91', '')
  LOOP
    -- Suffix with timestamp so uniqueness constraint is satisfied while preserving row
    v_archived_phone := v_old_user.phone || '_test_' || floor(extract(epoch from clock_timestamp()))::text;
    
    -- 1. Update public.users
    UPDATE public.users
    SET phone = v_archived_phone,
        updated_at = now()
    WHERE id = v_old_user.id;

    -- 2. Update user_phone_history to close the active period
    UPDATE public.user_phone_history
    SET to_at = now()
    WHERE user_id = v_old_user.id AND to_at IS NULL;

    -- 3. Also update auth.users email placeholder if driver email is tied to this phone
    UPDATE auth.users
    SET email = regexp_replace(email, '@', '_' || floor(extract(epoch from clock_timestamp()))::text || '@')
    WHERE id = v_old_user.id
      AND email LIKE 'driver_%@driver.margixindia.local';

    v_affected_count := v_affected_count + 1;
    v_results := v_results || jsonb_build_object(
      'user_id', v_old_user.id,
      'full_name', v_old_user.full_name,
      'role', v_old_user.role,
      'original_phone', v_old_user.phone,
      'archived_phone', v_archived_phone
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'released_phone', v_norm_phone,
    'affected_records', v_affected_count,
    'details', v_results
  );
END;
$$;

-- ── 2. Function to revert an archived test phone back to the original user ──
CREATE OR REPLACE FUNCTION public.revert_driver_phone_after_test(p_user_id uuid, p_original_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_norm_phone text;
  v_current_holder record;
BEGIN
  v_norm_phone := trim(p_original_phone);
  IF NOT v_norm_phone LIKE '+%' THEN
    v_norm_phone := '+' || regexp_replace(v_norm_phone, '\D', '', 'g');
  END IF;

  -- Ensure no other active user is currently holding the target phone
  SELECT id, full_name, role INTO v_current_holder
  FROM public.users
  WHERE phone = v_norm_phone AND id <> p_user_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Cannot revert: phone ' || v_norm_phone || ' is currently held by user ' || v_current_holder.id || ' (' || v_current_holder.full_name || ')'
    );
  END IF;

  -- Restore phone in public.users
  UPDATE public.users
  SET phone = v_norm_phone,
      updated_at = now()
  WHERE id = p_user_id;

  -- Restore auth.users email if driver placeholder
  UPDATE auth.users
  SET email = 'driver_' || regexp_replace(v_norm_phone, '\+', '', 'g') || '@driver.margixindia.local'
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'restored_user_id', p_user_id,
    'phone', v_norm_phone
  );
END;
$$;

COMMENT ON FUNCTION public.release_driver_phone_for_test(text) IS 'Archives previous user phone bindings so a new driver can be tested with the same phone number.';
COMMENT ON FUNCTION public.revert_driver_phone_after_test(uuid, text) IS 'Reverts an archived phone number back to the original user.';
