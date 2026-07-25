-- Migration: 015_capacity_bids_payload
-- Adds weight_kg and load_configuration to capacity_bids

ALTER TABLE public.capacity_bids 
ADD COLUMN IF NOT EXISTS weight_kg numeric,
ADD COLUMN IF NOT EXISTS load_configuration text;

NOTIFY pgrst, 'reload schema';
