-- Customer app push notifications: the device's Expo push token.
--
-- Customers live in public.customers (no public.users row) and sign in through the backend, so the
-- app cannot write this column itself. The backend saves it (PUT /customer/push-token) and clears it
-- on sign-out; push.service.ts falls back to it when the recipient has no users row.
--
-- Additive and safe to re-run.

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS push_token text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_push_token_length') THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_push_token_length CHECK (push_token IS NULL OR length(push_token) <= 200) NOT VALID;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
