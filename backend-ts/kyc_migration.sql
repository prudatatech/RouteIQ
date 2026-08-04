-- Create kyc_profiles table
CREATE TABLE IF NOT EXISTS public.kyc_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  partner_type text NOT NULL CHECK (partner_type IN ('vendor', 'customer')),
  kyc_status text NOT NULL DEFAULT 'pending' CHECK (kyc_status IN ('pending', 'submitted', 'approved', 'rejected')),
  kyc_data jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.kyc_profiles ENABLE ROW LEVEL SECURITY;

-- Policies for kyc_profiles
DROP POLICY IF EXISTS "Users can read own kyc" ON public.kyc_profiles;
CREATE POLICY "Users can read own kyc"
ON public.kyc_profiles
FOR SELECT
USING (auth.uid() = id);

DROP POLICY IF EXISTS "Admins can read all kyc" ON public.kyc_profiles;
CREATE POLICY "Admins can read all kyc"
ON public.kyc_profiles
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid() AND (users.role = 'admin' OR users.role = 'superadmin')
  )
);

DROP POLICY IF EXISTS "Users can insert own kyc" ON public.kyc_profiles;
CREATE POLICY "Users can insert own kyc"
ON public.kyc_profiles
FOR INSERT
WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own kyc" ON public.kyc_profiles;
CREATE POLICY "Users can update own kyc"
ON public.kyc_profiles
FOR UPDATE
USING (auth.uid() = id);

-- Create storage bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('kyc_documents', 'kyc_documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
DROP POLICY IF EXISTS "Users can upload their own KYC docs" ON storage.objects;
CREATE POLICY "Users can upload their own KYC docs"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'kyc_documents' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Users can read their own KYC docs" ON storage.objects;
CREATE POLICY "Users can read their own KYC docs"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'kyc_documents' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Admins can read all KYC docs" ON storage.objects;
CREATE POLICY "Admins can read all KYC docs"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'kyc_documents'
  AND EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid() AND (users.role = 'admin' OR users.role = 'superadmin')
  )
);
