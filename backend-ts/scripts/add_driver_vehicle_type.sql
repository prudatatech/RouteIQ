-- Add vehicle_type to users table for drivers
ALTER TABLE users ADD COLUMN IF NOT EXISTS vehicle_type text;
