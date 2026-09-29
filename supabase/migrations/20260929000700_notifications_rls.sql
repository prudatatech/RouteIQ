-- Restore the notifications RLS policies dropped by 20260928000200.
--
-- That migration drops every existing policy in the public schema before
-- recreating only the ones each client's actual queries need, but it only
-- recreated a SELECT policy for `notifications` (notifications_select_own).
-- The UPDATE policy that let a signed-in user mark their own notification
-- read (originally added by 009_vendor_ecosystem.sql) was dropped and never
-- reinstated, so direct client access to notifications (D2 in
-- docs/ux-plan-2.md — the bell's realtime subscription and "mark as read")
-- currently has no way to write back is_read.
--
-- Idempotent: safe to re-run.

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
CREATE POLICY notifications_select_own ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
