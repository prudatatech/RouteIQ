ALTER TABLE public.cargo_manifest ADD COLUMN IF NOT EXISTS cost NUMERIC DEFAULT 0;
ALTER TABLE public.cargo_manifest ADD COLUMN IF NOT EXISTS cost_per_km NUMERIC DEFAULT 0;

-- Reload postgREST schema cache
NOTIFY pgrst, 'reload schema';
