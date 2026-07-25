CREATE TABLE IF NOT EXISTS public.system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default rate
INSERT INTO public.system_settings (key, value) 
VALUES ('rate_per_km', '{"rate": 15}')
ON CONFLICT (key) DO NOTHING;

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.system_settings;

-- Enable RLS
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read system settings, as drivers/vendors need it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'system_settings' AND policyname = 'Allow read access to system_settings'
  ) THEN
    CREATE POLICY "Allow read access to system_settings" ON public.system_settings FOR SELECT USING (true);
  END IF;
END
$$;

-- Allow superadmin to update
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'system_settings' AND policyname = 'Allow update access to system_settings'
  ) THEN
    CREATE POLICY "Allow update access to system_settings" ON public.system_settings 
    FOR UPDATE TO authenticated USING (
      EXISTS (SELECT 1 FROM public.users WHERE users.id = auth.uid() AND users.role = 'superadmin')
    );
  END IF;
END
$$;
