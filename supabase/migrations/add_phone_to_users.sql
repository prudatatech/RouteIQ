-- ═══════════════════════════════════════════════════════════
-- RouteIQ — Supabase Schema Sync Migration
-- Run this ONCE in your Supabase SQL Editor (SQL → New Query)
-- ═══════════════════════════════════════════════════════════

-- ── 1. Users: Add phone column for driver OTP auth ──────────
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone TEXT UNIQUE;

-- Make email nullable (drivers authenticate via phone, not email)
ALTER TABLE public.users ALTER COLUMN email DROP NOT NULL;

-- Index for fast phone lookups during OTP verification
CREATE INDEX IF NOT EXISTS idx_users_phone ON public.users(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role);


-- ── 2. GPS Points: Driver app location history ──────────────
CREATE TABLE IF NOT EXISTS public.gps_points (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  accuracy double precision,
  recorded_at timestamp with time zone DEFAULT now(),
  CONSTRAINT gps_points_pkey PRIMARY KEY (id),
  CONSTRAINT gps_points_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE
);

-- Index for fast time-range queries (GET /gps/vehicle/:id?minutes=5)
CREATE INDEX IF NOT EXISTS idx_gps_points_vehicle_time ON public.gps_points(vehicle_id, recorded_at DESC);


-- ── 3. AI Agent Logs: Analytics audit trail ─────────────────
CREATE TABLE IF NOT EXISTS public.ai_agent_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agent_name character varying NOT NULL,
  action character varying NOT NULL,
  input_data json DEFAULT '{}'::json,
  output_data json DEFAULT '{}'::json,
  status character varying DEFAULT 'success',
  duration_ms integer DEFAULT 0,
  vehicle_id uuid,
  route_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT ai_agent_logs_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_ai_logs_created ON public.ai_agent_logs(created_at DESC);


-- ── 4. Invoices: Shipment billing ───────────────────────────
CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  shipment_id uuid,
  invoice_number character varying NOT NULL UNIQUE,
  amount double precision NOT NULL DEFAULT 0.0,
  currency character varying DEFAULT 'INR',
  status character varying DEFAULT 'pending',
  issued_at timestamp with time zone DEFAULT now(),
  paid_at timestamp with time zone,
  due_date timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT invoices_pkey PRIMARY KEY (id),
  CONSTRAINT invoices_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_invoices_shipment ON public.invoices(shipment_id);


-- ── 5. Payments: Invoice payments ───────────────────────────
CREATE TABLE IF NOT EXISTS public.payments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  invoice_id uuid,
  amount double precision NOT NULL DEFAULT 0.0,
  method character varying DEFAULT 'upi',
  transaction_id character varying,
  status character varying DEFAULT 'pending',
  paid_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT payments_pkey PRIMARY KEY (id),
  CONSTRAINT payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_payments_invoice ON public.payments(invoice_id);


-- ── 6. Performance Indexes (on existing tables) ─────────────

-- Telemetry: fast lookups for latest telemetry by vehicle
CREATE INDEX IF NOT EXISTS idx_telemetry_vehicle_time ON public.telemetry(vehicle_id, timestamp DESC);

-- Routes: active route lookup by vehicle
CREATE INDEX IF NOT EXISTS idx_routes_vehicle_status ON public.routes(vehicle_id, status);

-- Route Stops: stops by route, ordered by sequence
CREATE INDEX IF NOT EXISTS idx_route_stops_route ON public.route_stops(route_id, sequence);

-- Shipment Logs: hash chain verification
CREATE INDEX IF NOT EXISTS idx_shipment_logs_shipment ON public.shipment_logs(shipment_id, index);

-- Vehicles: status filter (dashboard queries)
CREATE INDEX IF NOT EXISTS idx_vehicles_status ON public.vehicles(status);

-- Vehicle Stoppages: time-range queries
CREATE INDEX IF NOT EXISTS idx_stoppages_vehicle_time ON public.vehicle_stoppages(vehicle_id, start_time DESC);


-- ── 7. Cleanup: Remove SQLAlchemy artifact ──────────────────
DROP TABLE IF EXISTS public.alembic_version;


-- ── 8. Enable RLS (Row Level Security) on new tables ────────
ALTER TABLE public.gps_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_agent_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Allow service_role full access (our backend uses service_role key)
CREATE POLICY "Service role full access gps" ON public.gps_points FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access ai" ON public.ai_agent_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access inv" ON public.invoices FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access pay" ON public.payments FOR ALL USING (true) WITH CHECK (true);


-- ═══════════════════════════════════════════════════════════
-- DONE. Your schema now has all 16 tables:
--
--  ✅ users (+ phone column)
--  ✅ vehicles
--  ✅ depots
--  ✅ shipments
--  ✅ delivery_points
--  ✅ routes
--  ✅ route_stops
--  ✅ telemetry
--  ✅ vehicle_stoppages
--  ✅ maintenance_alerts
--  ✅ parcels
--  ✅ shipment_logs
--  ✅ gps_points          ← NEW
--  ✅ ai_agent_logs       ← NEW
--  ✅ invoices            ← NEW
--  ✅ payments            ← NEW
-- ═══════════════════════════════════════════════════════════
