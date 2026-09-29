-- Dispatch can cancel a vendor load (cargo manifest): its request goes back to approved and the
-- vehicle gets its capacity back. Allows 'cancelled' in the manifest status check, whatever
-- constraint the table carries today. NOT VALID keeps rows written before this untouched.
-- Idempotent: safe to re-run.

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.cargo_manifest'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.cargo_manifest DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.cargo_manifest ADD CONSTRAINT cargo_manifest_status_check
  CHECK (status IN ('scheduled', 'in_transit', 'delivered', 'completed', 'cancelled')) NOT VALID;

NOTIFY pgrst, 'reload schema';
