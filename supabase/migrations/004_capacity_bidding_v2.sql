-- Migration: Unified Capacity Bidding System v2

-- 0. Add vendor role
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'vendor';

-- 1. Extend Vehicles Table
ALTER TABLE vehicles 
ADD COLUMN IF NOT EXISTS available_capacity_kg numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS capacity_confirmed_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS capacity_updated_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS bidding_window_open boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS bidding_window_closes_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS last_known_connectivity_zone text;

-- 2. Create Capacity Windows Table
CREATE TABLE IF NOT EXISTS capacity_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES vehicles(id) NOT NULL,
  opens_at timestamp with time zone NOT NULL,
  closes_at timestamp with time zone NOT NULL,
  floor_price numeric NOT NULL,
  winning_bid_id uuid, -- Foreign key added below
  fallback_used boolean DEFAULT false,
  fallback_shipment_id uuid REFERENCES shipments(id)
);

-- 3. Create Capacity Bids Table
CREATE TABLE IF NOT EXISTS capacity_bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  window_id uuid REFERENCES capacity_windows(id) NOT NULL,
  vendor_id uuid REFERENCES users(id) NOT NULL,
  bid_amount numeric NOT NULL,
  submitted_at timestamp with time zone DEFAULT now(),
  status text NOT NULL DEFAULT 'pending', -- pending, won, lost, expired
  eway_bill_ref text
);

-- Add cyclic foreign key for winning bid (Only run this if it fails because it doesn't exist yet)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_winning_bid') THEN
    ALTER TABLE capacity_windows 
    ADD CONSTRAINT fk_winning_bid 
    FOREIGN KEY (winning_bid_id) REFERENCES capacity_bids(id);
  END IF;
END $$;

-- 4. Create Driver Confirmations Table (Trust Safety Valve)
CREATE TABLE IF NOT EXISTS driver_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_stop_id uuid REFERENCES route_stops(id) NOT NULL,
  vehicle_id uuid REFERENCES vehicles(id) NOT NULL,
  prompted_at timestamp with time zone NOT NULL DEFAULT now(),
  delivered_at timestamp with time zone,
  responded_at timestamp with time zone,
  action text -- auto_accepted, auto_accepted_offline, confirmed, flagged
);

-- Enable RLS (Assuming existing tables use RLS, set default policies)
ALTER TABLE capacity_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE capacity_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_confirmations ENABLE ROW LEVEL SECURITY;

-- Basic admin policies for now
DROP POLICY IF EXISTS "Enable all for admins on capacity_windows" ON capacity_windows;
CREATE POLICY "Enable all for admins on capacity_windows" ON capacity_windows FOR ALL USING (true);

DROP POLICY IF EXISTS "Enable all for admins on capacity_bids" ON capacity_bids;
CREATE POLICY "Enable all for admins on capacity_bids" ON capacity_bids FOR ALL USING (true);

DROP POLICY IF EXISTS "Enable all for admins on driver_confirmations" ON driver_confirmations;
CREATE POLICY "Enable all for admins on driver_confirmations" ON driver_confirmations FOR ALL USING (true);

-- Vendor RLS for capacity_bids (can insert and view their own)
DROP POLICY IF EXISTS "Vendors can insert their own bids" ON capacity_bids;
CREATE POLICY "Vendors can insert their own bids" ON capacity_bids FOR INSERT WITH CHECK (auth.uid() = vendor_id);

DROP POLICY IF EXISTS "Vendors can view their own bids" ON capacity_bids;
CREATE POLICY "Vendors can view their own bids" ON capacity_bids FOR SELECT USING (auth.uid() = vendor_id);

