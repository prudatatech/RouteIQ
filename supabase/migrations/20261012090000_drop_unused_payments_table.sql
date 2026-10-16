-- Runs as app_owner where that role exists (Azure); elsewhere (CI, local) as the connecting login. Idempotent.
--
-- public.payments was created for invoice payments (add_phone_to_users.sql) but no code path ever inserted
-- into it: payment is recorded by setting invoices.status directly (invoice-payment.service.ts). The only
-- code reference was a redundant cascade-delete cleanup (the invoice FK already has ON DELETE CASCADE),
-- now removed. Confirmed empty on both test and live before dropping.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    SET LOCAL ROLE app_owner;
  END IF;
END $$;

DROP TABLE IF EXISTS public.payments;
