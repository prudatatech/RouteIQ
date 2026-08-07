-- Add JSONB metadata columns to store extensive form fields like Cargo Type, Consignee Details, etc.

ALTER TABLE public.vendor_shipment_requests 
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

ALTER TABLE public.shipments 
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.cargo_manifest 
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;  
 