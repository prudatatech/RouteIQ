-- Migration: 007 Cargo Manifest Load Declaration

-- Add declared_load_percentage to vehicles table to track real-time container utilization
ALTER TABLE vehicles
ADD COLUMN IF NOT EXISTS declared_load_percentage numeric DEFAULT 0;

-- Ensure RLS allows the backend/admin to update it
-- (Assuming standard admin access covers this)
