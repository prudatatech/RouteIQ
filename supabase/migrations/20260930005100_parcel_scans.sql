-- Driver app stream, part 1: parcel scans.
--
-- A driver scans a parcel's QR code or barcode (its tracking ID) at pickup
-- and again at delivery. The backend checks the parcel belongs to the driver's
-- active route and the right stop, then records the scan here. The delivery
-- scan is what the shipment log later reports as "parcel verified".
--
-- `manifest_id` covers vendor loads (cargo manifests); their stop IDs are
-- synthetic ("<manifest id>_pickup" / "<manifest id>_drop"), so `stop_id` is
-- text rather than a foreign key.
--
-- Written only by the backend (service role). Staff can read; a driver reads
-- their own scans. Additive and safe to re-run. Applied to the live project on 2026-09-29.

CREATE TABLE IF NOT EXISTS public.parcel_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid REFERENCES public.shipments(id) ON DELETE CASCADE,
  manifest_id uuid REFERENCES public.cargo_manifest(id) ON DELETE CASCADE,
  stop_id text,
  driver_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  purpose text NOT NULL CHECK (purpose IN ('pickup', 'delivery')),
  method text NOT NULL DEFAULT 'camera' CHECK (method IN ('camera', 'manual')),
  latitude double precision,
  longitude double precision,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parcel_scans_one_target CHECK (shipment_id IS NOT NULL OR manifest_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_parcel_scans_shipment ON public.parcel_scans (shipment_id, purpose);
CREATE INDEX IF NOT EXISTS idx_parcel_scans_manifest ON public.parcel_scans (manifest_id, purpose);
CREATE INDEX IF NOT EXISTS idx_parcel_scans_driver ON public.parcel_scans (driver_id, created_at DESC);

ALTER TABLE public.parcel_scans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS parcel_scans_staff ON public.parcel_scans;
CREATE POLICY parcel_scans_staff ON public.parcel_scans FOR SELECT TO authenticated
  USING ((SELECT public.is_staff()));

DROP POLICY IF EXISTS parcel_scans_driver_own ON public.parcel_scans;
CREATE POLICY parcel_scans_driver_own ON public.parcel_scans FOR SELECT TO authenticated
  USING (driver_id = auth.uid());

NOTIFY pgrst, 'reload schema';
