-- 022: Add truck container dimensions, current load tracking, and vehicle model
-- This enables auto-empty on delivery and Indian truck presets

ALTER TABLE vehicles
ADD COLUMN IF NOT EXISTS container_length_ft double precision DEFAULT 0,
ADD COLUMN IF NOT EXISTS container_width_ft double precision DEFAULT 0,
ADD COLUMN IF NOT EXISTS container_height_ft double precision DEFAULT 0,
ADD COLUMN IF NOT EXISTS current_load_kg double precision DEFAULT 0,
ADD COLUMN IF NOT EXISTS vehicle_model text;

-- Ensure available_capacity_kg exists (may have been added by earlier migrations)
ALTER TABLE vehicles
ADD COLUMN IF NOT EXISTS available_capacity_kg double precision;

-- Backfill: set available_capacity_kg = capacity_kg - current_load_kg for existing rows
UPDATE vehicles
SET available_capacity_kg = COALESCE(capacity_kg, 1000) - COALESCE(current_load_kg, 0)
WHERE available_capacity_kg IS NULL;

-- Set default for future rows
ALTER TABLE vehicles
ALTER COLUMN available_capacity_kg SET DEFAULT 0;
