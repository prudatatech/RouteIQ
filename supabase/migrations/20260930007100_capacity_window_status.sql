-- Stream B, part 1: bidding windows opened and closed from the console.
--
-- A window is 'open' until it is closed (by staff, or by the scheduler once its
-- end time has passed) or cancelled by staff. Existing windows start as 'open';
-- the scheduler closes the ones already past their end time on its first run.
-- Bids stay as they are when a window closes; staff can still approve or reject
-- pending bids.
--
-- Additive and safe to re-run. Applied to the live project on 2026-09-29.

ALTER TABLE public.capacity_windows ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open';
ALTER TABLE public.capacity_windows ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
ALTER TABLE public.capacity_windows ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.capacity_windows DROP CONSTRAINT IF EXISTS capacity_windows_status_check;
ALTER TABLE public.capacity_windows ADD CONSTRAINT capacity_windows_status_check CHECK (status IN ('open', 'closed', 'cancelled'));

-- The scheduler looks for open windows past their end time
CREATE INDEX IF NOT EXISTS idx_capacity_windows_open ON public.capacity_windows (closes_at) WHERE status = 'open';

NOTIFY pgrst, 'reload schema';
