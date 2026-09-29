-- Customer app stream: bookings made by customers in the mobile app.
--
-- A booking is a request with a pickup, a drop, a weight and a pickup date.
-- Staff confirm it (which creates a real shipment and stores its tracking id
-- here), assign a vehicle, or cancel it. The customer sees it under "My
-- bookings". Money is rupees, numeric(12,2). `quoted_price` is null when no
-- price could be given at booking time.
--
-- Access: the backend writes with the service role. A customer can read only
-- their own bookings; staff can read and change all of them.
--
-- Additive and safe to re-run. Applied to the live project on 2026-09-29.

CREATE TABLE IF NOT EXISTS public.customer_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pickup_name text NOT NULL,
  pickup_address text NOT NULL,
  pickup_lat double precision NOT NULL,
  pickup_lng double precision NOT NULL,
  drop_name text NOT NULL,
  drop_address text NOT NULL,
  drop_lat double precision NOT NULL,
  drop_lng double precision NOT NULL,
  weight_kg numeric(10,2) NOT NULL CHECK (weight_kg > 0),
  load_type text NOT NULL DEFAULT 'full' CHECK (load_type IN ('full', 'part')),
  vehicle_type text,
  pickup_date date NOT NULL,
  quoted_price numeric(12,2) CHECK (quoted_price IS NULL OR quoted_price >= 0),
  quote_details jsonb,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'confirmed', 'assigned', 'in_transit', 'delivered', 'cancelled')),
  shipment_id uuid REFERENCES public.shipments(id) ON DELETE SET NULL,
  tracking_id text,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  cancelled_by text CHECK (cancelled_by IS NULL OR cancelled_by IN ('customer', 'staff')),
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_bookings_customer ON public.customer_bookings (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_bookings_status ON public.customer_bookings (status, pickup_date);
CREATE INDEX IF NOT EXISTS idx_customer_bookings_shipment ON public.customer_bookings (shipment_id);

ALTER TABLE public.customer_bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_bookings_own_read ON public.customer_bookings;
CREATE POLICY customer_bookings_own_read ON public.customer_bookings FOR SELECT TO authenticated
  USING (customer_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS customer_bookings_staff ON public.customer_bookings;
CREATE POLICY customer_bookings_staff ON public.customer_bookings FOR ALL TO authenticated
  USING ((SELECT public.is_staff()))
  WITH CHECK ((SELECT public.is_staff()));

NOTIFY pgrst, 'reload schema';
