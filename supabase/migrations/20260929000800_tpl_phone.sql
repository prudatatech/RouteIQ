-- The 3PL onboarding wizard (TplOnboardingPage.tsx) needs a required mobile
-- phone field for the partner, but tpl_partners has no phone column yet
-- (see backend-ts/test/support/db-schema.json). Additive and safe to re-run.
--
-- Applied to the live project on 2026-09-29. tplService.onboard and
-- updateApplication validate and store req.body.phone in this column.

ALTER TABLE public.tpl_partners ADD COLUMN IF NOT EXISTS phone text;

NOTIFY pgrst, 'reload schema';
