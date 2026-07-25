-- Migration: 016_shipment_bid_link
-- Adds bid_id to shipments to trace back cargo manifests to vendor bids

ALTER TABLE public.shipments 
ADD COLUMN IF NOT EXISTS bid_id uuid REFERENCES public.capacity_bids(id);

NOTIFY pgrst, 'reload schema';
