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
  CHECK (status IN ('onboarding', 'active', 'on_leave', 'suspended', 'inactive'));

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
  employer_type text NOT NULL DEFAULT 'company' CHECK (employer_type IN ('company', 'partner')),
  employer_partner_id uuid REFERENCES public.tpl_partners(id) ON DELETE SET NULL,
  no_pan_reason text,   -- set when the person has no PAN; satisfies the tax ID group
  suspended_until date,
  leave_from date,
  leave_until date,
  consent_at timestamptz,
  consent_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  consent_method text,
  invite_sent_at timestamptz,
  anonymised_at timestamptz,
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
    'medical_fitness', 'address_proof', 'offer_letter', 'voter_id', 'passport', 'bank_proof', 'other')),
  doc_number text,       -- never the full Aadhaar number: that keeps only number_last4 and number_hash
  number_last4 text,
  number_hash text,      -- HMAC of the normalised number, for duplicate checks
  name_on_document text,
  extra_file_paths text[],
  review_by date,
  verification_method text NOT NULL DEFAULT 'manual' CHECK (verification_method IN ('manual', 'digilocker', 'parivahan')),
  resubmission_count integer NOT NULL DEFAULT 0,
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
CREATE INDEX IF NOT EXISTS user_documents_hash_idx ON public.user_documents (doc_type, number_hash) WHERE number_hash IS NOT NULL;

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
  effective_from timestamptz NOT NULL DEFAULT now(),  -- used for payouts only after this time
  proof_document_id uuid REFERENCES public.user_documents(id) ON DELETE SET NULL,
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

-- 9. Phone numbers a person used before (a released number can't be reused for 90 days)
CREATE TABLE IF NOT EXISTS public.user_phone_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  phone text NOT NULL,
  from_at timestamptz NOT NULL DEFAULT now(),
  to_at timestamptz
);
CREATE INDEX IF NOT EXISTS user_phone_history_phone_idx ON public.user_phone_history (phone);
CREATE INDEX IF NOT EXISTS user_phone_history_user_idx ON public.user_phone_history (user_id);
INSERT INTO public.user_phone_history (user_id, phone, from_at)
  SELECT u.id, u.phone, u.created_at FROM public.users u
  WHERE u.phone IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.user_phone_history h WHERE h.user_id = u.id AND h.phone = u.phone);

-- 10. Which driver had which vehicle, and when. Written by a trigger so every path
-- that changes vehicles.driver_id (fleet wizard, driver app, backend) is covered.
CREATE TABLE IF NOT EXISTS public.driver_vehicle_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  unassigned_at timestamptz,
  assigned_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS driver_vehicle_assignments_driver_idx ON public.driver_vehicle_assignments (driver_id);
CREATE INDEX IF NOT EXISTS driver_vehicle_assignments_vehicle_idx ON public.driver_vehicle_assignments (vehicle_id);

INSERT INTO public.driver_vehicle_assignments (driver_id, vehicle_id, assigned_at)
  SELECT v.driver_id, v.id, COALESCE(v.created_at, now()) FROM public.vehicles v
  WHERE v.driver_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.driver_vehicle_assignments a WHERE a.vehicle_id = v.id AND a.driver_id = v.driver_id AND a.unassigned_at IS NULL);

CREATE OR REPLACE FUNCTION public.track_driver_vehicle_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.driver_id IS NOT DISTINCT FROM OLD.driver_id THEN
      RETURN NEW;
    END IF;
    UPDATE public.driver_vehicle_assignments
       SET unassigned_at = now()
     WHERE vehicle_id = NEW.id AND unassigned_at IS NULL;
  END IF;
  IF NEW.driver_id IS NOT NULL THEN
    INSERT INTO public.driver_vehicle_assignments (driver_id, vehicle_id, assigned_by)
    VALUES (NEW.driver_id, NEW.id, NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS track_driver_vehicle_assignment ON public.vehicles;
CREATE TRIGGER track_driver_vehicle_assignment
  AFTER INSERT OR UPDATE OF driver_id ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.track_driver_vehicle_assignment();

-- 11. Settings the people features read (editable on the Settings page)
INSERT INTO public.system_settings (key, value) VALUES
  ('licence_grace_days', '{"value": 0}'::jsonb),
  ('document_retention_days', '{"value": 365}'::jsonb),
  ('bank_change_cooldown_hours', '{"value": 24}'::jsonb),
  ('driver_document_enforcement', '{"value": "warn"}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 12. Row level security on every table. Writes: service role only.
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_emergency_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_phone_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_vehicle_assignments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.user_profiles, public.user_documents, public.user_emergency_contacts,
  public.user_bank_accounts, public.user_status_history, public.user_notes, public.user_activity,
  public.user_phone_history, public.driver_vehicle_assignments
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
