-- Driver pay rates belong to a company: one live rate per COMPANY, vehicle type and start date.
--
-- driver_pay_rates_type_from_unique (20260930015100_driver_pay.sql) was written before companies existed, so it allowed
-- one live rate per vehicle type and start date for the whole platform. The second company to set a truck rate for a
-- date another company already had got a 500 ("duplicate key value violates unique constraint"), and could not price
-- its drivers at all. The index now includes the company (rows from before companies have no company: they share the
-- all-zero key, as before).
--
-- Runs as app_owner where that role exists (Azure: the tables belong to it). Idempotent; safe to run again.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    SET LOCAL ROLE app_owner;
  END IF;
END $$;

DROP INDEX IF EXISTS public.driver_pay_rates_type_from_unique;

CREATE UNIQUE INDEX IF NOT EXISTS driver_pay_rates_company_type_from_unique
  ON public.driver_pay_rates (coalesce(carrier_org_id, '00000000-0000-0000-0000-000000000000'::uuid), vehicle_type, effective_from)
  WHERE active;

NOTIFY pgrst, 'reload schema';
