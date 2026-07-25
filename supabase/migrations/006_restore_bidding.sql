-- Migration: Restore Capacity Bidding System

-- 1. Create Capacity Windows Table
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

-- 2. Create Capacity Bids Table
CREATE TABLE IF NOT EXISTS capacity_bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  window_id uuid REFERENCES capacity_windows(id) NOT NULL,
  vendor_id uuid REFERENCES users(id) NOT NULL,
  bid_amount numeric NOT NULL,
  submitted_at timestamp with time zone DEFAULT now(),
  status text NOT NULL DEFAULT 'pending', -- pending, won, lost, expired
  eway_bill_ref text
);

-- Add cyclic foreign key for winning bid
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_winning_bid') THEN
    ALTER TABLE capacity_windows 
    ADD CONSTRAINT fk_winning_bid 
    FOREIGN KEY (winning_bid_id) REFERENCES capacity_bids(id);
  END IF;
END $$;

-- Enable RLS
ALTER TABLE capacity_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE capacity_bids ENABLE ROW LEVEL SECURITY;

-- Basic admin policies
DROP POLICY IF EXISTS "Enable all for admins on capacity_windows" ON capacity_windows;
CREATE POLICY "Enable all for admins on capacity_windows" ON capacity_windows FOR ALL USING (true);

DROP POLICY IF EXISTS "Enable all for admins on capacity_bids" ON capacity_bids;
CREATE POLICY "Enable all for admins on capacity_bids" ON capacity_bids FOR ALL USING (true);

-- Vendor RLS for capacity_bids
DROP POLICY IF EXISTS "Vendors can insert their own bids" ON capacity_bids;
CREATE POLICY "Vendors can insert their own bids" ON capacity_bids FOR INSERT WITH CHECK (auth.uid() = vendor_id);

DROP POLICY IF EXISTS "Vendors can view their own bids" ON capacity_bids;
CREATE POLICY "Vendors can view their own bids" ON capacity_bids FOR SELECT USING (auth.uid() = vendor_id);
