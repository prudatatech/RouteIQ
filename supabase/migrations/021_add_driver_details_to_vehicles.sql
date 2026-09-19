ALTER TABLE vehicles
ADD COLUMN IF NOT EXISTS driver_name text,
ADD COLUMN IF NOT EXISTS driver_phone text;
