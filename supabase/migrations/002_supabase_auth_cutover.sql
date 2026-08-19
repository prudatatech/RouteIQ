-- ═══════════════════════════════════════════════════════════
-- margixindia — Supabase Auth Cutover Migration
-- Run in Supabase SQL Editor (Dashboard → SQL → New Query)
-- ═══════════════════════════════════════════════════════════

-- 1. Drop the legacy password column
ALTER TABLE public.users DROP COLUMN IF EXISTS hashed_password;

-- 2. Ensure FK to auth.users exists (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'users_pkey' 
    AND table_name = 'users'
    AND constraint_type = 'FOREIGN KEY'
  ) THEN
    -- Check if there's already a FK named users_id_fkey
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints 
      WHERE constraint_name = 'users_id_fkey' 
      AND table_name = 'users'
    ) THEN
      ALTER TABLE public.users 
        ADD CONSTRAINT users_id_fkey 
        FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
    END IF;
  END IF;
END $$;

-- 3. Update trigger to pass role and phone from signup metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, role, phone)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'role', '')::user_role,
      'driver'::user_role
    ),
    NEW.raw_user_meta_data->>'phone'
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, public.users.full_name);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger already exists from supabase_init.sql — function body is replaced above.
-- Re-create trigger to be safe (DROP + CREATE is idempotent)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ═══════════════════════════════════════════════════════════
-- DONE. public.users is now:
--   - Keyed off auth.users (FK with CASCADE delete)
--   - No hashed_password column
--   - Auto-populated via trigger on signup
-- ═══════════════════════════════════════════════════════════
