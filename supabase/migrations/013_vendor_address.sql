-- Add address to vendor_profiles
ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS address text;
-- Add a dummy column to force PostgREST schema reload
ALTER TABLE vendor_profiles ADD COLUMN IF NOT EXISTS dummy2 text;
NOTIFY pgrst, 'reload schema';
