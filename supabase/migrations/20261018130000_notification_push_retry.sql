-- Push notification delivery tracking and retry net for notifications table.
-- Runs as app_owner where that role exists (Azure). Idempotent.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    SET LOCAL ROLE app_owner;
  END IF;
END $$;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS push_status text NOT NULL DEFAULT 'pending'
    CHECK (push_status IN ('pending', 'sent', 'failed', 'not_applicable')),
  ADD COLUMN IF NOT EXISTS push_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS push_error text,
  ADD COLUMN IF NOT EXISTS push_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_notifications_push_pending
  ON public.notifications (created_at)
  WHERE push_status = 'pending';
