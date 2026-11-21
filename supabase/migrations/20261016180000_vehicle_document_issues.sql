-- Per-document vehicle review (docs/vehicle-onboarding.md would live here).
--
-- Today, rejecting a vehicle request archives the whole thing with one free-text reason, even when only
-- one document (say, an expired PUC) is the actual problem - the driver has to redo the entire
-- registration. document_issues lets staff flag specific documents (rc, insurance, fitness, permit, puc)
-- with their own reasons while the vehicle stays pending_approval and everything else the driver already
-- got right is kept. Resubmitting clears the flags (vehicle-approval.service.ts), exactly like a full
-- rejection already resets the row today.
--
-- Shape: { "<slot>": { "reason": text, "flagged_at": timestamptz, "flagged_by": uuid } }, slot one of
-- rc | insurance | fitness | permit | puc. Null/empty means no outstanding issues.
--
-- Runs as app_owner where that role exists (Azure). Idempotent.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    SET LOCAL ROLE app_owner;
  END IF;
END $$;

ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS document_issues jsonb;
