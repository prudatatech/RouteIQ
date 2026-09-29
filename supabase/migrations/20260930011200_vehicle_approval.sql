-- Vehicle approval and vehicle photos.
--
-- 1. A vehicle a driver registers from the app (first-login onboarding or
--    "add a vehicle") is not a fleet asset until staff approve it:
--      * it starts in the new status `pending_approval`. Every dispatch, bidding
--        and live-map rule already lists the OPERATING statuses (available,
--        on_route, idle, offline), so a pending vehicle is left out of all of
--        them without further changes;
--      * approving moves it to `available`; rejecting moves it to `archived`
--        with the reason kept on the row, where the Fleet's archived filter
--        shows it. Like any archive it frees the driver link, so the vehicle
--        stays tied to the driver through `submitted_by`; the driver sees the
--        reason in the app, fixes the details and resubmits (the same vehicle goes
--        back to `pending_approval` and is linked to them again);
--      * who reviewed it, when, and the decision are recorded on the vehicle.
--    Vehicles staff create on the web are approved at once: they never enter
--    `pending_approval`, and are recorded as approved by whoever created them.
--
--    The driver status guard (vehicles_driver_status_guard, 20260930008400) needs
--    no change: a driver's own write may only move a vehicle between operating
--    statuses, so it keeps a pending vehicle pending. The client column guard
--    (vehicles_client_update_guard) already stops a driver writing any of the
--    new columns.
--    The one-live-vehicle-per-driver index (20260930009400) already counts a
--    pending vehicle as live (status <> 'archived'), so a driver cannot hold a
--    pending vehicle and an approved one at the same time; a rejected vehicle
--    is archived and does not count.
--
-- 2. Vehicle photos (front, side, back, and optionally interior and cargo
--    area), all optional and replaceable at any time. The files live in the
--    private kyc_documents bucket under vehicles/<vehicle id>/photos/, uploaded
--    with signed URLs from backend-ts and shown through short-lived signed
--    links. One row per vehicle and slot.
--
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction that adds it,
-- so nothing below refers to 'pending_approval'.
--
-- Safe to re-run. NOT applied to the live project yet.

ALTER TYPE public.vehicle_status ADD VALUE IF NOT EXISTS 'pending_approval';

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_decision text,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicles_review_decision_check') THEN
    ALTER TABLE public.vehicles
      ADD CONSTRAINT vehicles_review_decision_check CHECK (review_decision IS NULL OR review_decision IN ('approved', 'rejected'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_vehicles_submitted_at ON public.vehicles (submitted_at DESC) WHERE submitted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vehicles_submitted_by ON public.vehicles (submitted_by) WHERE submitted_by IS NOT NULL;

-- ── Photos ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vehicle_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  slot text NOT NULL CHECK (slot IN ('front', 'side', 'back', 'interior', 'cargo')),
  file_path text NOT NULL,
  uploaded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vehicle_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_photos_vehicle ON public.vehicle_photos (vehicle_id);

-- Written by backend-ts only; staff and the vehicle's driver may read the rows
ALTER TABLE public.vehicle_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vehicle_photos_select ON public.vehicle_photos;
CREATE POLICY vehicle_photos_select ON public.vehicle_photos FOR SELECT TO authenticated
  USING ((SELECT public.is_staff()) OR vehicle_id IN (SELECT public.my_vehicle_ids()));

NOTIFY pgrst, 'reload schema';
