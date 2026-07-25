CREATE TABLE IF NOT EXISTS public.sos_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    driver_id UUID REFERENCES auth.users(id),
    vehicle_id UUID REFERENCES public.vehicles(id),
    alert_type TEXT NOT NULL,
    description TEXT,
    latitude NUMERIC,
    longitude NUMERIC,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.sos_alerts ENABLE ROW LEVEL SECURITY;

-- Allow insert by authenticated users (drivers)
CREATE POLICY "Drivers can insert sos_alerts" ON public.sos_alerts
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Allow select by admins and superadmins
CREATE POLICY "Admins can view sos_alerts" ON public.sos_alerts
    FOR SELECT USING (
      EXISTS (
        SELECT 1 FROM public.users
        WHERE users.id = auth.uid() AND users.role IN ('admin', 'superadmin')
      )
    );

-- Enable realtime for sos_alerts
ALTER PUBLICATION supabase_realtime ADD TABLE public.sos_alerts;
