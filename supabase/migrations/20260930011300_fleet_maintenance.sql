-- Fleet maintenance workflow.
--
--  * vehicle_maintenance_jobs   a vehicle's stay in maintenance: opened when staff move it there
--                               (reason, workshop, expected return), closed on "Return to service".
--  * vehicle_service_items      parts replaced / repairs on a service record (item, qty, unit cost, total).
--  * vehicle_service_attachments invoices, job cards and photos on a service record or job. The files live
--                               in the private storage bucket (path kept here), like expense receipts.
--  * vehicle_odometer_events    every odometer change: manual entry, correction, or auto sync.
--  * service_plan_templates     EDITABLE default service intervals offered by "Add default plans".
--                               Change, add or deactivate rows here to change the defaults.
--  * vehicle_service_log        gains the workshop, labour cost, invoice number and its maintenance job.
--  * vehicles                   gains when/how the odometer was last auto-synced.
--
-- Additive and safe to re-run. NOT yet applied to the live project.

-- ── Enums ─────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.maintenance_job_status AS ENUM ('open', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.maintenance_reason_type AS ENUM ('scheduled_service', 'breakdown', 'accident', 'tyre', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.service_attachment_kind AS ENUM ('invoice', 'job_card', 'photo', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Maintenance jobs ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.vehicle_maintenance_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  status public.maintenance_job_status NOT NULL DEFAULT 'open',
  reason_type public.maintenance_reason_type NOT NULL,
  workshop text,
  expected_return_date date,
  note text,
  sos_alert_id uuid REFERENCES public.sos_alerts(id) ON DELETE SET NULL,
  -- Routes and loads cancelled to free the vehicle: {"routes": [ids], "manifests": [ids]}
  released_work jsonb,
  opened_at timestamptz NOT NULL DEFAULT now(),
  opened_by uuid,
  opened_odometer_km numeric(12,1) CHECK (opened_odometer_km IS NULL OR opened_odometer_km >= 0),
  closed_at timestamptz,
  closed_by uuid,
  final_odometer_km numeric(12,1) CHECK (final_odometer_km IS NULL OR final_odometer_km >= 0),
  total_cost numeric(12,2) CHECK (total_cost IS NULL OR total_cost >= 0),
  close_note text,
  service_log_id uuid REFERENCES public.vehicle_service_log(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_maintenance_jobs_closed_has_time CHECK (status <> 'closed' OR closed_at IS NOT NULL)
);

-- One open job per vehicle
CREATE UNIQUE INDEX IF NOT EXISTS uniq_vehicle_maintenance_open_job
  ON public.vehicle_maintenance_jobs (vehicle_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_jobs_vehicle
  ON public.vehicle_maintenance_jobs (vehicle_id, opened_at DESC);

-- ── Service log: workshop, labour, invoice, job ───────────
ALTER TABLE public.vehicle_service_log
  ADD COLUMN IF NOT EXISTS workshop text,
  ADD COLUMN IF NOT EXISTS labour_cost numeric(12,2) CHECK (labour_cost IS NULL OR labour_cost >= 0),
  ADD COLUMN IF NOT EXISTS invoice_number text,
  ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES public.vehicle_maintenance_jobs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vehicle_service_log_job ON public.vehicle_service_log (job_id);

-- ── Parts replaced / repairs on a service record ──────────
-- The record's cost is the sum of these totals plus labour_cost (kept in step by the backend).
CREATE TABLE IF NOT EXISTS public.vehicle_service_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_log_id uuid NOT NULL REFERENCES public.vehicle_service_log(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  description text NOT NULL,
  kind text NOT NULL DEFAULT 'part' CHECK (kind IN ('part', 'repair')),
  quantity numeric(10,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_cost numeric(12,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  total_cost numeric(12,2) NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vehicle_service_items_log ON public.vehicle_service_items (service_log_id);

-- ── Attachments: invoices, job cards, photos ──────────────
CREATE TABLE IF NOT EXISTS public.vehicle_service_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  service_log_id uuid REFERENCES public.vehicle_service_log(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.vehicle_maintenance_jobs(id) ON DELETE CASCADE,
  kind public.service_attachment_kind NOT NULL DEFAULT 'other',
  file_path text NOT NULL,
  file_name text,
  content_type text,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_service_attachments_has_parent CHECK (service_log_id IS NOT NULL OR job_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_vehicle_service_attachments_log ON public.vehicle_service_attachments (service_log_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_service_attachments_job ON public.vehicle_service_attachments (job_id);

-- ── Odometer: audit trail and last auto sync ──────────────
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS odometer_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS odometer_source text;

CREATE TABLE IF NOT EXISTS public.vehicle_odometer_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('manual', 'correction', 'auto_sync')),
  before_km numeric(12,1),
  after_km numeric(12,1) NOT NULL,
  source text,
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vehicle_odometer_events_vehicle ON public.vehicle_odometer_events (vehicle_id, created_at DESC);

-- ── EDITABLE default service intervals ────────────────────
-- "Add default plans" copies the active rows below onto a vehicle that has no plans. Edit freely;
-- each vehicle's own plan can then be changed on its own.
CREATE TABLE IF NOT EXISTS public.service_plan_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item text NOT NULL UNIQUE,
  interval_km integer CHECK (interval_km IS NULL OR interval_km > 0),
  interval_days integer CHECK (interval_days IS NULL OR interval_days > 0),
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_plan_templates_has_interval CHECK (interval_km IS NOT NULL OR interval_days IS NOT NULL)
);

INSERT INTO public.service_plan_templates (item, interval_km, interval_days, sort_order) VALUES
  ('Engine oil',      10000, 180, 10),
  ('Brake pads',      40000, 365, 20),
  ('Tyres',           50000, 730, 30),
  ('Air filter',      20000, 365, 40),
  ('Coolant',         40000, 730, 50),
  ('Battery',          NULL, 1095, 60),
  ('Clutch',          80000, NULL, 70),
  ('Fuel filter',     20000, 365, 80),
  ('General service', 15000, 180, 90)
ON CONFLICT (item) DO NOTHING;

-- ── Row level security: staff only (the backend uses the service role) ──
ALTER TABLE public.vehicle_maintenance_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_service_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_service_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_odometer_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_plan_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vehicle_maintenance_jobs_staff ON public.vehicle_maintenance_jobs;
CREATE POLICY vehicle_maintenance_jobs_staff ON public.vehicle_maintenance_jobs FOR ALL TO authenticated
  USING ((SELECT public.is_staff())) WITH CHECK ((SELECT public.is_staff()));

DROP POLICY IF EXISTS vehicle_service_items_staff ON public.vehicle_service_items;
CREATE POLICY vehicle_service_items_staff ON public.vehicle_service_items FOR ALL TO authenticated
  USING ((SELECT public.is_staff())) WITH CHECK ((SELECT public.is_staff()));

DROP POLICY IF EXISTS vehicle_service_attachments_staff ON public.vehicle_service_attachments;
CREATE POLICY vehicle_service_attachments_staff ON public.vehicle_service_attachments FOR ALL TO authenticated
  USING ((SELECT public.is_staff())) WITH CHECK ((SELECT public.is_staff()));

DROP POLICY IF EXISTS vehicle_odometer_events_staff ON public.vehicle_odometer_events;
CREATE POLICY vehicle_odometer_events_staff ON public.vehicle_odometer_events FOR ALL TO authenticated
  USING ((SELECT public.is_staff())) WITH CHECK ((SELECT public.is_staff()));

DROP POLICY IF EXISTS service_plan_templates_staff ON public.service_plan_templates;
CREATE POLICY service_plan_templates_staff ON public.service_plan_templates FOR ALL TO authenticated
  USING ((SELECT public.is_staff())) WITH CHECK ((SELECT public.is_staff()));

NOTIFY pgrst, 'reload schema';
