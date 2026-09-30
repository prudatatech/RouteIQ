-- Driver pay: a fixed amount per trip plus a rate per km, set per vehicle type (decision of
-- 30 Sep 2026, docs/workflow-blueprint.html). What a driver earns is no longer read off the
-- customer's invoice.
--
--   driver_pay_rates     the rate card. A new rate takes over from its effective date; earlier rows
--                        stay as history. A trip is paid at the rate in force on its date: the
--                        active row of its vehicle type with the latest effective_from on or before
--                        that date. `active = false` is a rate withdrawn by mistake (kept, ignored).
--   driver_pay_entries   one row per finished trip (a completed route or a delivered vendor load),
--                        created by the backend when the trip finishes. earned -> approved -> paid,
--                        or void. amount = per_trip_amount + per_km_amount * km + adjustments.
--   driver_payouts       a payment made to a driver outside the app (cash, bank or UPI), covering
--                        approved entries. Marking entries paid links them here.
--
-- Staff with the admin role (and superadmin) do everything; a manager has no access to pay. A
-- driver reads their own pay through the backend (GET /driver/pay), never straight from the tables.
--
-- Idempotent: safe to re-run. NOT applied yet. Apply it before deploying the backend that reads
-- these tables.

-- ── Rate card ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.driver_pay_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_type text NOT NULL CHECK (vehicle_type IN ('truck', 'van', 'bike', 'car')),
  per_trip_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (per_trip_amount >= 0),
  per_km_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (per_km_amount >= 0),
  effective_from date NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One live rate per vehicle type and start date; the one in force on a date is the latest start on or before it
CREATE UNIQUE INDEX IF NOT EXISTS driver_pay_rates_type_from_unique
  ON public.driver_pay_rates (vehicle_type, effective_from) WHERE active;
CREATE INDEX IF NOT EXISTS idx_driver_pay_rates_type ON public.driver_pay_rates (vehicle_type, effective_from DESC);

-- ── Payouts ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.driver_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  -- The trip dates the payout covers (from the earliest to the latest entry in it)
  period_from date,
  period_to date,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  method text NOT NULL CHECK (method IN ('cash', 'bank', 'upi')),
  reference text,
  note text,
  paid_at timestamptz NOT NULL DEFAULT now(),
  paid_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_driver_payouts_driver ON public.driver_payouts (driver_id, paid_at DESC);

-- ── Entries ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.driver_pay_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  vehicle_type text,
  -- The trip: a route, or a vendor load (cargo manifest). Never both.
  route_id uuid REFERENCES public.routes(id) ON DELETE SET NULL,
  manifest_id uuid REFERENCES public.cargo_manifest(id) ON DELETE SET NULL,
  trip_date date NOT NULL,
  km numeric(10,1) NOT NULL DEFAULT 0 CHECK (km >= 0),
  -- gps: driven distance counted from the trip's GPS points; planned: the route's planned distance;
  -- estimated: straight line between pickup and drop; none: no distance known
  km_source text NOT NULL DEFAULT 'none' CHECK (km_source IN ('gps', 'planned', 'estimated', 'none')),
  rate_id uuid REFERENCES public.driver_pay_rates(id) ON DELETE SET NULL,
  per_trip_amount numeric(12,2) NOT NULL DEFAULT 0,
  per_km_amount numeric(12,2) NOT NULL DEFAULT 0,
  -- [{ amount, reason, by, at }]: signed corrections added by staff
  adjustments jsonb NOT NULL DEFAULT '[]'::jsonb,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  -- No rate was set for the vehicle type when the trip finished: the entry is 0 until one is
  rate_missing boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'earned' CHECK (status IN ('earned', 'approved', 'paid', 'void')),
  approved_at timestamptz,
  approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  void_reason text,
  voided_at timestamptz,
  voided_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  payout_id uuid REFERENCES public.driver_payouts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_pay_entries_one_trip CHECK (route_id IS NULL OR manifest_id IS NULL),
  CONSTRAINT driver_pay_entries_paid_has_payout CHECK (status <> 'paid' OR payout_id IS NOT NULL)
);

-- A trip is paid once: the backend creates the entry when the trip finishes and a retry finds it
CREATE UNIQUE INDEX IF NOT EXISTS driver_pay_entries_route_unique ON public.driver_pay_entries (route_id) WHERE route_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS driver_pay_entries_manifest_unique ON public.driver_pay_entries (manifest_id) WHERE manifest_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_driver_pay_entries_driver ON public.driver_pay_entries (driver_id, trip_date DESC);
CREATE INDEX IF NOT EXISTS idx_driver_pay_entries_status ON public.driver_pay_entries (status, trip_date DESC);
CREATE INDEX IF NOT EXISTS idx_driver_pay_entries_payout ON public.driver_pay_entries (payout_id) WHERE payout_id IS NOT NULL;

-- ── Row level security ──────────────────────────────────────
-- Admin and superadmin only. The backend uses the service role; a driver has no policy here.
ALTER TABLE public.driver_pay_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_pay_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_pay_rates_admin ON public.driver_pay_rates;
CREATE POLICY driver_pay_rates_admin ON public.driver_pay_rates FOR ALL TO authenticated
  USING ((SELECT coalesce(public.current_app_role() IN ('superadmin', 'admin'), false)))
  WITH CHECK ((SELECT coalesce(public.current_app_role() IN ('superadmin', 'admin'), false)));

DROP POLICY IF EXISTS driver_pay_entries_admin ON public.driver_pay_entries;
CREATE POLICY driver_pay_entries_admin ON public.driver_pay_entries FOR ALL TO authenticated
  USING ((SELECT coalesce(public.current_app_role() IN ('superadmin', 'admin'), false)))
  WITH CHECK ((SELECT coalesce(public.current_app_role() IN ('superadmin', 'admin'), false)));

DROP POLICY IF EXISTS driver_payouts_admin ON public.driver_payouts;
CREATE POLICY driver_payouts_admin ON public.driver_payouts FOR ALL TO authenticated
  USING ((SELECT coalesce(public.current_app_role() IN ('superadmin', 'admin'), false)))
  WITH CHECK ((SELECT coalesce(public.current_app_role() IN ('superadmin', 'admin'), false)));
