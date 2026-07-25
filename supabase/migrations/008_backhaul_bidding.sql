-- Migration: Backhaul Bidding System Updates

-- 1. Add trigger_type to capacity_windows
ALTER TABLE capacity_windows 
ADD COLUMN IF NOT EXISTS trigger_type text DEFAULT 'return_trip'
CHECK (trigger_type IN ('mid_route', 'return_trip'));

-- 2. Add RLS policies to allow vendors to view open opportunities
-- The previous migration only allowed admins to view capacity_windows

-- Drop existing restricted policy if it exists (optional but safe)
DROP POLICY IF EXISTS "Vendors can view open capacity_windows" ON capacity_windows;

-- Create policy allowing authenticated users (vendors) to see open capacity_windows
CREATE POLICY "Vendors can view open capacity_windows" 
ON capacity_windows FOR SELECT 
USING (auth.role() = 'authenticated');

-- Ensure vendors can also see the vehicle details for those windows
DROP POLICY IF EXISTS "Vendors can view vehicles" ON vehicles;
CREATE POLICY "Vendors can view vehicles" 
ON vehicles FOR SELECT 
USING (auth.role() = 'authenticated');
