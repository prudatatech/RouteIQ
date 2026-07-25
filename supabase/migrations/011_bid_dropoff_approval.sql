-- Migration: 011_bid_dropoff_approval

-- 1. Add dropoff_point_id to capacity_bids to force route-aligned drop-offs
ALTER TABLE capacity_bids
ADD COLUMN IF NOT EXISTS dropoff_point_id uuid REFERENCES delivery_points(id);

-- 2. Force schema reload dummy columns
ALTER TABLE capacity_bids ADD COLUMN dummy text;
ALTER TABLE capacity_bids DROP COLUMN dummy;

NOTIFY pgrst, 'reload schema';
