-- Fleet GPS: track history, live-location sharing.
-- Idempotent: safe to run more than once.

-- 1. gps_points carries what the device reported with the position, and where it came from
ALTER TABLE public.gps_points ADD COLUMN IF NOT EXISTS speed_kmph double precision;
ALTER TABLE public.gps_points ADD COLUMN IF NOT EXISTS heading double precision;
ALTER TABLE public.gps_points ADD COLUMN IF NOT EXISTS source text;

-- Track reads are "one vehicle, a time window" (already indexed as idx_gps_points_vehicle_time)
-- and retention sweeps are "everything older than X"
CREATE INDEX IF NOT EXISTS idx_gps_points_recorded_at ON public.gps_points(recorded_at);

-- Vehicle activity (carrying / idle / offline) looks up a vehicle's open manifests
CREATE INDEX IF NOT EXISTS idx_cargo_manifest_vehicle_status ON public.cargo_manifest(vehicle_id, status);

-- 2. Live-location links staff share. Only the SHA-256 of the token is stored.
CREATE TABLE IF NOT EXISTS public.vehicle_share_links (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL,
  token_hash text NOT NULL,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  revoked_at timestamp with time zone,
  last_viewed_at timestamp with time zone,
  view_count integer NOT NULL DEFAULT 0,
  CONSTRAINT vehicle_share_links_pkey PRIMARY KEY (id),
  CONSTRAINT vehicle_share_links_token_hash_key UNIQUE (token_hash),
  CONSTRAINT vehicle_share_links_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE,
  CONSTRAINT vehicle_share_links_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_vehicle_share_links_vehicle ON public.vehicle_share_links(vehicle_id, created_at DESC);

ALTER TABLE public.vehicle_share_links ENABLE ROW LEVEL SECURITY;
-- The API uses the service role; no client role reads or writes these rows directly.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vehicle_share_links' AND policyname = 'Service role full access vehicle_share_links'
  ) THEN
    CREATE POLICY "Service role full access vehicle_share_links" ON public.vehicle_share_links
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
