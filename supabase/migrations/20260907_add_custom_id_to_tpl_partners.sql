-- Add custom_id to tpl_partners
ALTER TABLE public.tpl_partners 
ADD COLUMN IF NOT EXISTS custom_id text;
