-- The 3PL onboarding wizard (TplOnboardingPage.tsx) needs a required mobile
-- phone field for the partner, but tpl_partners has no phone column yet
-- (see backend-ts/test/support/db-schema.json). Additive and safe to re-run.
--
-- NOTE: this migration is intentionally NOT applied yet. Once it is run, wire
-- tplService.onboard/updateApplication (backend-ts/src/services/tpl.service.ts)
-- to persist req.body.phone into this column.

ALTER TABLE public.tpl_partners ADD COLUMN IF NOT EXISTS phone text;

NOTIFY pgrst, 'reload schema';
