-- Migration: Cargo Manifest Simplification

-- Add load declaration to shipments
ALTER TABLE shipments 
ADD COLUMN IF NOT EXISTS declared_load_kg double precision DEFAULT 0,
ADD COLUMN IF NOT EXISTS load_type text DEFAULT 'full';

-- Make sure capacity tracking columns exist on vehicles
ALTER TABLE vehicles 
ADD COLUMN IF NOT EXISTS available_capacity_kg double precision DEFAULT 0,
ADD COLUMN IF NOT EXISTS capacity_updated_at timestamp with time zone;

-- Drop bidding logic tables safely
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_winning_bid') THEN
    ALTER TABLE capacity_windows DROP CONSTRAINT fk_winning_bid;
  END IF;
END $$;

DROP TABLE IF EXISTS capacity_bids CASCADE;
DROP TABLE IF EXISTS capacity_windows CASCADE;
