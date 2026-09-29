-- Fleet fuel: the fuel fill-up log behind the mileage (km per litre) engine.
--
-- One row per fill-up. litres, price_per_litre and total_amount are all stored
-- (the API derives the third from any two). odometer_km is the reading at the
-- fill. is_full_tank marks a fill to the brim: mileage is worked out from full
-- fill to full fill, with partial fills in between added up.
--
-- bill_status is 'with_bill' when a bill photo or PDF is attached (bill_path, in
-- the private storage bucket under expenses/<id>/...) and 'no_bill' otherwise;
-- a no-bill entry is allowed but is shown for review (reviewed_at / reviewed_by).
--
-- distance_km, litres_used, mileage_kmpl and flags are written by the backend's
-- calculation engine each time a vehicle's log changes. They are derived, so they
-- can always be rebuilt from the fills. flags is a JSON list of codes:
-- no_bill, low_mileage, over_tank_capacity, odometer_backwards, duplicate,
-- far_from_gps.
--
-- expense_id links the fill to the `expenses` row (category fuel) that the backend
-- writes for it, so finance sees the real fuel cost instead of an estimate.
--
-- Additive and safe to re-run. NOT yet applied to the live project.

CREATE TABLE IF NOT EXISTS public.vehicle_fuel_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  filled_at timestamptz NOT NULL DEFAULT now(),
  litres numeric(10,2) NOT NULL CHECK (litres > 0),
  price_per_litre numeric(10,2) NOT NULL CHECK (price_per_litre > 0),
  total_amount numeric(12,2) NOT NULL CHECK (total_amount > 0),
  odometer_km numeric(12,1) CHECK (odometer_km IS NULL OR odometer_km >= 0),
  is_full_tank boolean NOT NULL DEFAULT true,
  station_name text,
  payment_mode text NOT NULL DEFAULT 'cash'
    CHECK (payment_mode IN ('cash', 'card', 'upi', 'fuel_card', 'credit', 'other')),
  fill_latitude numeric(9,6),
  fill_longitude numeric(9,6),
  bill_status text NOT NULL DEFAULT 'no_bill' CHECK (bill_status IN ('with_bill', 'no_bill')),
  bill_path text,
  logged_by uuid,
  logged_by_role text,
  reviewed_at timestamptz,
  reviewed_by uuid,
  expense_id uuid REFERENCES public.expenses(id) ON DELETE SET NULL,
  distance_km numeric(12,1),
  litres_used numeric(10,2),
  mileage_kmpl numeric(6,2),
  flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_fuel_logs_vehicle ON public.vehicle_fuel_logs (vehicle_id, filled_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_fuel_logs_filled_at ON public.vehicle_fuel_logs (filled_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_fuel_logs_no_bill ON public.vehicle_fuel_logs (bill_status) WHERE bill_status = 'no_bill';

ALTER TABLE public.vehicle_fuel_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vehicle_fuel_logs_staff ON public.vehicle_fuel_logs;
CREATE POLICY vehicle_fuel_logs_staff ON public.vehicle_fuel_logs FOR ALL TO authenticated
  USING ((SELECT public.is_staff()))
  WITH CHECK ((SELECT public.is_staff()));

NOTIFY pgrst, 'reload schema';
