-- Migration: 010_vendor_route_matching
-- Creates the table and functions required to match routes to nearby vendors

-- 1. Create the Vendor Route Opportunities Table
CREATE TABLE IF NOT EXISTS vendor_route_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid REFERENCES routes(id) ON DELETE CASCADE,
  vendor_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  status text DEFAULT 'notified' CHECK (status IN ('notified', 'ignored', 'bidded')),
  eta_minutes integer,
  available_capacity_kg numeric,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(route_id, vendor_id)
);

ALTER TABLE vendor_route_opportunities ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE vendor_route_opportunities TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Vendors can read own opportunities" ON vendor_route_opportunities;
CREATE POLICY "Vendors can read own opportunities" 
ON vendor_route_opportunities FOR SELECT 
USING (auth.uid() = vendor_id);

DROP POLICY IF EXISTS "Vendors can update own opportunities" ON vendor_route_opportunities;
CREATE POLICY "Vendors can update own opportunities" 
ON vendor_route_opportunities FOR UPDATE 
USING (auth.uid() = vendor_id);

DROP POLICY IF EXISTS "Super Admins can read all opportunities" ON vendor_route_opportunities;
CREATE POLICY "Super Admins can read all opportunities" 
ON vendor_route_opportunities FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'superadmin'
  )
);

-- 2. PostgreSQL Function to Match Vendors to Route Points
-- Expects route_points as a JSON array of objects: [{"lat": 28.6139, "lng": 77.2090}, ...]
CREATE OR REPLACE FUNCTION match_vendors_to_route(
  route_points jsonb,
  radius_km double precision DEFAULT 50.0
)
RETURNS TABLE (
  vendor_id uuid,
  min_distance_km double precision
) AS $$
BEGIN
  RETURN QUERY
  WITH points AS (
    SELECT 
      (value->>'lat')::double precision as point_lat,
      (value->>'lng')::double precision as point_lng
    FROM jsonb_array_elements(route_points)
  ),
  distances AS (
    SELECT 
      v.id as v_id,
      calculate_distance(p.point_lat, p.point_lng, v.latitude, v.longitude) as dist
    FROM vendor_profiles v
    CROSS JOIN points p
  )
  SELECT 
    v_id as vendor_id,
    MIN(dist) as min_distance_km
  FROM distances
  WHERE dist <= radius_km
  GROUP BY v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
