-- Superadmins can reject a pending 3PL application with a reason, shown back
-- to the applicant on the tracking page instead of being thrown away.
ALTER TABLE public.tpl_partners ADD COLUMN IF NOT EXISTS rejection_reason text;
