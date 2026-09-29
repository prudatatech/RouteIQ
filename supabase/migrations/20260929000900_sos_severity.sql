-- The driver app's accident report asks "Anyone injured?" and sends the answer
-- as severity ('serious' when someone is hurt, 'minor' when not). The column is
-- read by the web console (EmergencyPage) and written by
-- PATCH /telemetry/sos/:id/details. Additive and safe to re-run.
--
-- NOT YET APPLIED to the live project.

ALTER TABLE public.sos_alerts ADD COLUMN IF NOT EXISTS severity text;

NOTIFY pgrst, 'reload schema';
