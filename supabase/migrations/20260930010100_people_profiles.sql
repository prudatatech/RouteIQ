-- People profiles: status, employment profile, documents, emergency contacts,
-- bank accounts, status history, notes and an activity trail for staff and drivers.
-- See docs/people-plan.md. Safe to re-run.
--
-- All writes go through backend-ts (service role). Clients get no write access;
-- a person may only read their own profile, documents and emergency contacts.

-- 1. users.status (users.is_active follows it: only active and onboarding can sign in)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS status text;
UPDATE public.users SET status = CASE WHEN is_active THEN 'active' ELSE 'inactive' END WHERE status IS NULL;
ALTER TABLE public.users ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE public.users ALTER COLUMN status SET NOT NULL;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE public.users ADD CONSTRAINT users_status_check
  CHECK (status IN ('onboarding', 'active', 'suspended', 'inactive'));

-- 2. One profile per person
CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  employee_code text UNIQUE,
  designation text,
  department text,
  employment_type text CHECK (employment_type IN ('permanent', 'contract', 'on_call')),
  date_of_joining date,
  date_of_birth date,
  gender text,
  blood_group text,
  alternate_phone text,
  personal_email text,
  address_line text,
  city text,
  state text,
  pincode text,
  latitude double precision,
  longitude double precision,
  base_depot_id uuid REFERENCES public.depots(id) ON DELETE SET NULL,
  reporting_manager_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  photo_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);

-- 3. Documents (files live in the private kyc_documents bucket under people/<user_id>/...)
CREATE TABLE IF NOT EXISTS public.user_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  doc_type text NOT NULL CHECK (doc_type IN (
    'driving_licence', 'aadhaar', 'pan', 'photo', 'police_verification',
    'medical_fitness', 'address_proof', 'offer_letter', 'other')),
  doc_number text,
  issued_on date,
  expires_on date,
  file_path text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected', 'expired')),
  rejection_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  uploaded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  verified_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  verified_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_documents_user_idx ON public.user_documents (user_id);
CREATE INDEX IF NOT EXISTS user_documents_expiry_idx ON public.user_documents (expires_on) WHERE archived_at IS NULL;

-- 4. Emergency contacts
CREATE TABLE IF NOT EXISTS public.user_emergency_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  relation text,
  phone text NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_emergency_contacts_user_idx ON public.user_emergency_contacts (user_id);

-- 5. Bank and payout details (no client access at all; the backend masks the number)
CREATE TABLE IF NOT EXISTS public.user_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  account_holder text NOT NULL,
  account_number text NOT NULL,
  ifsc text NOT NULL,
  bank_name text,
  upi_id text,
  is_primary boolean NOT NULL DEFAULT false,
  is_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_bank_accounts_user_idx ON public.user_bank_accounts (user_id);

-- 6. Status history
CREATE TABLE IF NOT EXISTS public.user_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  reason text,
  changed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_status_history_user_idx ON public.user_status_history (user_id, created_at DESC);

-- 7. Staff notes
CREATE TABLE IF NOT EXISTS public.user_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  author_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_notes_user_idx ON public.user_notes (user_id, created_at DESC);

-- 8. Activity trail: profile edits, document events, bank reveals, status changes
CREATE TABLE IF NOT EXISTS public.user_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_activity_user_idx ON public.user_activity (user_id, created_at DESC);

-- 9. Row level security on every table. Writes: service role only.
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_emergency_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_activity ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.user_profiles, public.user_documents, public.user_emergency_contacts,
  public.user_bank_accounts, public.user_status_history, public.user_notes, public.user_activity
  FROM anon, authenticated;
GRANT SELECT ON public.user_profiles, public.user_documents, public.user_emergency_contacts TO authenticated;

DROP POLICY IF EXISTS user_profiles_select_own ON public.user_profiles;
CREATE POLICY user_profiles_select_own ON public.user_profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_documents_select_own ON public.user_documents;
CREATE POLICY user_documents_select_own ON public.user_documents FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_emergency_contacts_select_own ON public.user_emergency_contacts;
CREATE POLICY user_emergency_contacts_select_own ON public.user_emergency_contacts FOR SELECT TO authenticated
  USING (user_id = auth.uid());
