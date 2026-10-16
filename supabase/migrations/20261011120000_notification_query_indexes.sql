-- Notification scans were occupying the REST pool on staging (PGRST003).
-- Filter by type before reading the recipient's history; cover head-only unread counts.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    SET LOCAL ROLE app_owner;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notifications_user_type_created
  ON public.notifications (user_id, type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_type_unread
  ON public.notifications (user_id, type) INCLUDE (id) WHERE is_read = false;
