-- Stream P: pricing quotes and traffic incidents. Additive and safe to re-run.
--
-- price_quotes     every quote from POST /pricing/quote, kept for audit; accepted_inr
--                  is filled in when a price is agreed so later quotes can learn.
-- traffic_incidents  incidents from TomTom found along active routes.
--
-- Rate card settings (rate_per_km, rate_per_km_<vehicle type>, min_charge,
-- per_kg_surcharge, fuel_price_per_litre, ...) live in system_settings and are
-- edited by staff from the Backhaul page; nothing is seeded here on purpose.
--
-- Applied to the live project on 2026-09-29.

CREATE TABLE IF NOT EXISTS public.price_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  role text,
  source text,
  pickup_lat double precision NOT NULL,
  pickup_lng double precision NOT NULL,
  pickup_label text,
  drop_lat double precision NOT NULL,
  drop_lng double precision NOT NULL,
  drop_label text,
  weight_kg numeric(12,2) NOT NULL,
  vehicle_type text,
  load_type text,
  pickup_date text,
  distance_km numeric(10,1) NOT NULL,
  distance_source text NOT NULL,
  low_inr numeric(12,2) NOT NULL,
  suggested_inr numeric(12,2) NOT NULL,
  high_inr numeric(12,2) NOT NULL,
  factors jsonb NOT NULL DEFAULT '[]'::jsonb,
  accepted_inr numeric(12,2),
  accepted_at timestamptz,
  request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS price_quotes_created_at_idx ON public.price_quotes (created_at DESC);
CREATE INDEX IF NOT EXISTS price_quotes_user_idx ON public.price_quotes (user_id);

CREATE TABLE IF NOT EXISTS public.traffic_incidents (
  id text PRIMARY KEY,
  type text NOT NULL,
  severity smallint NOT NULL DEFAULT 0,
  description text,
  road text,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  geometry jsonb,
  delay_seconds integer,
  starts_at timestamptz,
  ends_at timestamptz,
  affected_route_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS traffic_incidents_active_idx ON public.traffic_incidents (active, last_seen_at DESC);

-- Staff read both tables; the backend (service role) writes them.
ALTER TABLE public.price_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.traffic_incidents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS price_quotes_select_staff ON public.price_quotes;
CREATE POLICY price_quotes_select_staff ON public.price_quotes FOR SELECT TO authenticated
  USING ((SELECT public.is_staff()));

DROP POLICY IF EXISTS traffic_incidents_select_staff ON public.traffic_incidents;
CREATE POLICY traffic_incidents_select_staff ON public.traffic_incidents FOR SELECT TO authenticated
  USING ((SELECT public.is_staff()));

NOTIFY pgrst, 'reload schema';
