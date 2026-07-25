-- Migration: Vendor Ecosystem & Dynamic Routing
-- Tables for Vendor Profiles, Shipment Requests, and Notifications

-- 1. Vendor Profiles Table
DROP TABLE IF EXISTS vendor_profiles CASCADE;
CREATE TABLE IF NOT EXISTS vendor_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name text NOT NULL,
  gst_number text NOT NULL,
  city text NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  is_verified boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE vendor_profiles ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE vendor_profiles TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Vendors can read own profile" ON vendor_profiles;
CREATE POLICY "Vendors can read own profile" 
ON vendor_profiles FOR SELECT 
USING (auth.uid() = id);

DROP POLICY IF EXISTS "Vendors can insert own profile" ON vendor_profiles;
CREATE POLICY "Vendors can insert own profile" 
ON vendor_profiles FOR INSERT 
WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Vendors can update own profile" ON vendor_profiles;
CREATE POLICY "Vendors can update own profile" 
ON vendor_profiles FOR UPDATE 
USING (auth.uid() = id);

DROP POLICY IF EXISTS "Super Admins can manage all profiles" ON vendor_profiles;
CREATE POLICY "Super Admins can manage all profiles" 
ON vendor_profiles FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'superadmin'
  )
);

-- 2. Vendor Shipment Requests
DROP TABLE IF EXISTS vendor_shipment_requests CASCADE;
CREATE TABLE IF NOT EXISTS vendor_shipment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  pickup_location text NOT NULL,
  pickup_lat double precision NOT NULL,
  pickup_lng double precision NOT NULL,
  drop_location text NOT NULL,
  drop_lat double precision NOT NULL,
  drop_lng double precision NOT NULL,
  required_capacity_kg numeric NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'fulfilled')),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE vendor_shipment_requests ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE vendor_shipment_requests TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Vendors can read own requests" ON vendor_shipment_requests;
CREATE POLICY "Vendors can read own requests" 
ON vendor_shipment_requests FOR SELECT 
USING (auth.uid() = vendor_id);

DROP POLICY IF EXISTS "Vendors can insert own requests" ON vendor_shipment_requests;
CREATE POLICY "Vendors can insert own requests" 
ON vendor_shipment_requests FOR INSERT 
WITH CHECK (auth.uid() = vendor_id);

DROP POLICY IF EXISTS "Super Admins can read all requests" ON vendor_shipment_requests;
CREATE POLICY "Super Admins can read all requests" 
ON vendor_shipment_requests FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'superadmin'
  )
);

DROP POLICY IF EXISTS "Super Admins can update all requests" ON vendor_shipment_requests;
CREATE POLICY "Super Admins can update all requests" 
ON vendor_shipment_requests FOR UPDATE 
USING (
  EXISTS (
    SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'superadmin'
  )
);

-- 3. Notifications Table
DROP TABLE IF EXISTS notifications CASCADE;
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  type text NOT NULL,
  is_read boolean DEFAULT false,
  data jsonb,
  created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE notifications TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Users can read own notifications" ON notifications;
CREATE POLICY "Users can read own notifications" 
ON notifications FOR SELECT 
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own notifications" ON notifications;
CREATE POLICY "Users can update own notifications" 
ON notifications FOR UPDATE 
USING (auth.uid() = user_id);

-- 4. Haversine Distance Function
-- Computes the distance in kilometers between two points
CREATE OR REPLACE FUNCTION calculate_distance(
  lat1 double precision, lon1 double precision,
  lat2 double precision, lon2 double precision
)
RETURNS double precision AS $$
DECLARE
  x double precision = 69.1 * (lat2 - lat1);
  y double precision = 69.1 * (lon2 - lon1) * cos(lat1 / 57.3);
BEGIN
  -- Approximation based on equirectangular projection (good enough for 50km radius)
  -- 1 degree of latitude is ~69.1 miles, converting to kilometers (* 1.60934)
  RETURN sqrt(x * x + y * y) * 1.60934;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Reload PostgREST schema cache to ensure the new tables are instantly available via the API
NOTIFY pgrst, 'reload schema';
