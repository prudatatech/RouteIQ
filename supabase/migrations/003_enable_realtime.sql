-- Enable Supabase Realtime for the vehicles table
-- This allows the admin dashboard to get instant GPS updates
-- when the driver app writes coordinates directly to Supabase

-- Add vehicles table to the supabase_realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE vehicles;

-- Also add telemetry for live history updates
ALTER PUBLICATION supabase_realtime ADD TABLE telemetry;
