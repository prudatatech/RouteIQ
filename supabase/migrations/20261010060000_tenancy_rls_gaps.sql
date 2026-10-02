-- Tenancy audit (area 6): row-level security gaps and company-wide uniqueness.
--
-- 20261002010000 put the organisation condition on the tables that carry an owner column. The tables below carry none
-- of their own (they hang off a vehicle, trip or shipment, or they are people) and kept the old "any staff reads
-- everything" policy, so one company's admin could read another company's fuel logs, telemetry, stops, custody events,
-- messages and people straight through PostgREST. This migration:
--
--  1. users_select / messages_select: staff see the people of their own organisations (and a platform admin everyone),
--     and the messages of their own trips and shipments.
--  2. A RESTRICTIVE policy `tenant_scope` on every child table: it is ANDed with the policies already there, lets
--     everyone who is not company staff through to their own policies (a driver, a vendor), and limits staff to rows
--     whose parent (vehicle, trip, shipment) the caller can already see through the parent's own policy.
--  3. driver_pay_rates: one live rate per company, vehicle type and start date (it was one per platform, so the
--     second company setting the same day's rate failed with a 500).
--  4. user_profiles.employee_code: unique per company, not platform-wide (the service checks it inside the company).
--
-- Idempotent. Every step skips a table or column that is not there.

-- ── helpers ────────────────────────────────────────────────────────────────────────────────────────────
-- The users who share an active organisation with the caller (SECURITY DEFINER: reads org_members without its policy).
CREATE OR REPLACE FUNCTION app.peer_user_ids() RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(array_agg(DISTINCT m.user_id), '{}'::uuid[])
  FROM public.org_members m
  WHERE m.status = 'active' AND m.org_id = ANY (SELECT unnest(app.user_org_ids())) $$;
GRANT EXECUTE ON FUNCTION app.peer_user_ids() TO authenticated, service_role;

-- The tables belong to app_owner where that role exists (Azure), so the policies and indexes below are made as it
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    SET LOCAL ROLE app_owner;
  END IF;
END $$;

-- ── 1. users and messages ─────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS users_select ON public.users;
CREATE POLICY users_select ON public.users FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR (SELECT app.is_platform_admin())
    OR ((SELECT public.is_staff()) AND id = ANY ((SELECT app.peer_user_ids())::uuid[]))
  );

DROP POLICY IF EXISTS messages_select ON public.messages;
CREATE POLICY messages_select ON public.messages FOR SELECT TO authenticated
  USING (
    (SELECT app.is_platform_admin())
    OR ((SELECT public.is_staff())
        AND (route_id IN (SELECT r.id FROM public.routes r)
             OR route_id IN (SELECT m.id FROM public.cargo_manifest m)
             OR shipment_id IN (SELECT s.id FROM public.shipments s)))
    OR route_id IN (SELECT public.my_route_ids())
    OR route_id IN (SELECT public.my_manifest_ids())
    OR shipment_id IN (SELECT public.my_shipment_ids())
  );

-- ── 2. a restrictive policy on the child tables ──────────────────────────────────────────────────────
DO $$
DECLARE
  spec record;
  cond text;
  parts text[];
  c text;
BEGIN
  -- table, then the (column, parent table) links; a row passes when ANY link passes
  FOR spec IN
    SELECT * FROM (VALUES
      ('telemetry',                  ARRAY['vehicle_id:vehicles']),
      ('gps_points',                 ARRAY['vehicle_id:vehicles']),
      ('vehicle_fuel_logs',          ARRAY['vehicle_id:vehicles']),
      ('vehicle_service_log',        ARRAY['vehicle_id:vehicles']),
      ('vehicle_service_items',      ARRAY['vehicle_id:vehicles']),
      ('vehicle_service_plans',      ARRAY['vehicle_id:vehicles']),
      ('vehicle_service_attachments',ARRAY['vehicle_id:vehicles']),
      ('vehicle_share_links',        ARRAY['vehicle_id:vehicles']),
      ('vehicle_odometer_events',    ARRAY['vehicle_id:vehicles']),
      ('vehicle_photos',             ARRAY['vehicle_id:vehicles']),
      ('vehicle_stoppages',          ARRAY['vehicle_id:vehicles']),
      ('driver_confirmations',       ARRAY['vehicle_id:vehicles']),
      ('driver_vehicle_assignments', ARRAY['vehicle_id:vehicles']),
      ('route_stops',                ARRAY['route_id:routes']),
      ('delivery_points',            ARRAY['shipment_id:shipments', 'id:route_stops.delivery_point_id']),
      ('cargo_custody_events',       ARRAY['shipment_id:shipments', 'manifest_id:cargo_manifest']),
      ('cargo_exception_items',      ARRAY['shipment_id:shipments', 'manifest_id:cargo_manifest']),
      ('cargo_transfer_items',       ARRAY['shipment_id:shipments', 'manifest_id:cargo_manifest']),
      ('parcel_scans',               ARRAY['shipment_id:shipments', 'manifest_id:cargo_manifest']),
      ('shipment_hsn',               ARRAY['shipment_id:shipments', 'manifest_id:cargo_manifest']),
      ('shipment_logs',              ARRAY['shipment_id:shipments']),
      ('parcels',                    ARRAY['shipment_id:shipments']),
      ('capacity_bids',              ARRAY['window_id:capacity_windows']),
      ('user_documents',             ARRAY['user_id:users']),
      ('user_bank_accounts',         ARRAY['user_id:users']),
      ('user_notes',                 ARRAY['user_id:users']),
      ('user_emergency_contacts',    ARRAY['user_id:users']),
      ('user_profiles',              ARRAY['user_id:users']),
      ('user_activity',              ARRAY['user_id:users']),
      ('user_status_history',        ARRAY['user_id:users']),
      ('user_phone_history',         ARRAY['user_id:users'])
    ) AS t(tbl, links)
  LOOP
    IF to_regclass('public.' || spec.tbl) IS NULL THEN CONTINUE; END IF;
    parts := ARRAY[]::text[];
    FOREACH c IN ARRAY spec.links LOOP
      -- 'col:parent' (the parent's id) or 'col:parent.column' (the parent's own column)
      IF position('.' IN split_part(c, ':', 2)) > 0 THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = spec.tbl AND column_name = split_part(c, ':', 1)) THEN
          parts := parts || format('%I IN (SELECT x.%I FROM public.%I x)', split_part(c, ':', 1), split_part(split_part(c, ':', 2), '.', 2), split_part(split_part(c, ':', 2), '.', 1));
        END IF;
      ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = spec.tbl AND column_name = split_part(c, ':', 1)) THEN
        parts := parts || format('%I IN (SELECT x.id FROM public.%I x)', split_part(c, ':', 1), split_part(c, ':', 2));
      END IF;
    END LOOP;
    IF array_length(parts, 1) IS NULL THEN CONTINUE; END IF;
    cond := format('(NOT (SELECT public.is_staff())) OR (SELECT app.is_platform_admin()) OR (%s)', array_to_string(parts, ' OR '));
    EXECUTE format('DROP POLICY IF EXISTS tenant_scope ON public.%I', spec.tbl);
    EXECUTE format('CREATE POLICY tenant_scope ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (%s) WITH CHECK (%s)', spec.tbl, cond, cond);
  END LOOP;

  -- tables with their own owner column that never got the organisation condition
  FOREACH c IN ARRAY ARRAY['depots', 'maintenance_alerts', 'load_bulk_batches'] LOOP
    IF to_regclass('public.' || c) IS NULL THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = c AND column_name = 'carrier_org_id') THEN
      cond := '(NOT (SELECT public.is_staff())) OR (SELECT app.is_platform_admin()) OR carrier_org_id = ANY ((SELECT app.user_org_ids())::uuid[])';
    ELSE
      CONTINUE;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS tenant_scope ON public.%I', c);
    EXECUTE format('CREATE POLICY tenant_scope ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (%s) WITH CHECK (%s)', c, cond, cond);
  END LOOP;
END $$;

-- ── 3. one live driver-pay rate per company, vehicle type and start date ────────────────────────────
DROP INDEX IF EXISTS public.driver_pay_rates_type_from_unique;
CREATE UNIQUE INDEX IF NOT EXISTS driver_pay_rates_org_type_from_unique
  ON public.driver_pay_rates (coalesce(carrier_org_id, '00000000-0000-0000-0000-000000000000'::uuid), vehicle_type, effective_from) WHERE active;

-- ── 4. an employee code is unique within a company ───────────────────────────────────────────────────
DO $$
DECLARE k record;
BEGIN
  IF to_regclass('public.user_profiles') IS NULL THEN RETURN; END IF;
  FOR k IN
    SELECT con.conname FROM pg_constraint con
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
    WHERE con.conrelid = 'public.user_profiles'::regclass AND con.contype = 'u' AND a.attname = 'employee_code' AND array_length(con.conkey, 1) = 1
  LOOP
    EXECUTE format('ALTER TABLE public.user_profiles DROP CONSTRAINT %I', k.conname);
  END LOOP;
  CREATE INDEX IF NOT EXISTS idx_user_profiles_employee_code ON public.user_profiles (employee_code) WHERE employee_code IS NOT NULL;
END $$;

RESET ROLE;
NOTIFY pgrst, 'reload schema';
