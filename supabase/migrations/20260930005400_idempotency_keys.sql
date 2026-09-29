-- Driver app stream, part 4: idempotency keys for queued actions.
--
-- The driver app keeps stop completions, failed stops, declared loads, SOS
-- details and scans in a queue while there is no signal, and sends them in
-- order when it is back. Each queued action carries an `idempotency_key`. The
-- backend stores the response of the first successful attempt under
-- (user, key) and answers any repeat with that same response without doing the
-- work again, so a request that succeeded but whose reply was lost is safe to
-- send twice.
--
-- Written and read only by the backend (service role); RLS is on with no
-- policies, so no client role can touch it. Rows are only needed for as long as
-- the app may retry; the backend removes those older than 7 days.
--
-- Additive and safe to re-run. Applied to the live project on 2026-09-29.

CREATE TABLE IF NOT EXISTS public.idempotency_keys (
  user_id uuid NOT NULL,
  key text NOT NULL,
  action text NOT NULL,
  status_code integer NOT NULL DEFAULT 200,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created ON public.idempotency_keys (created_at);

ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
