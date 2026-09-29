-- Finance stream, part 2: the expense log (fuel, maintenance, tolls, driver pay, other).
--
-- Entered by staff. A receipt is optional and lives in the existing private
-- storage bucket under expenses/<expense id>/..., uploaded with a signed URL
-- from the backend. Money is rupees, numeric(12,2). `litres` is optional and,
-- on a fuel expense, lets the fuel cost of a route be shown as actual instead
-- of estimated.
--
-- Additive and safe to re-run. Applied to the live project on 2026-09-29.

CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  route_id uuid REFERENCES public.routes(id) ON DELETE SET NULL,
  category text NOT NULL CHECK (category IN ('fuel', 'maintenance', 'toll', 'driver', 'other')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  litres numeric(10,2),
  note text,
  receipt_path text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expenses_date ON public.expenses (expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_vehicle ON public.expenses (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_expenses_route ON public.expenses (route_id);

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS expenses_staff ON public.expenses;
CREATE POLICY expenses_staff ON public.expenses FOR ALL TO authenticated
  USING ((SELECT public.is_staff()))
  WITH CHECK ((SELECT public.is_staff()));

NOTIFY pgrst, 'reload schema';
