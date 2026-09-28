-- Row-level security for direct client access.
--
-- backend-ts uses the service role, which bypasses RLS; these policies govern
-- what the web app (anon key + user session) and the driver app (after the
-- Phase 3 release) can read and write directly.
--
-- Production policies had drifted from the repo and several were open to
-- everyone (USING (true), GRANT ALL TO anon). This migration therefore:
--   1. drops every existing policy in the public schema,
--   2. enables RLS on every public table (deny by default),
--   3. creates only the policies the clients' actual queries need.
-- Roles come from public.users via SECURITY DEFINER helpers, never from
-- user-editable JWT metadata.
--
-- Rollout: deploy the frontend changes from the same branch first (signed KYC
-- document URLs, KYC columns), then apply this migration.

-- ─────────────────────────────────────────────────────────────
-- 1. Helper functions (SECURITY DEFINER: they bypass RLS, which also
--    keeps policies on related tables from recursing into each other)
-- ─────────────────────────────────────────────────────────────

-- App role of the current user, matching backend-ts: users.role, except a
-- non-admin with a vendor profile or 3PL partner record acts as a vendor.
-- Inactive accounts have no role.
CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN u.is_active = false THEN NULL
    WHEN u.role::text IN ('admin', 'superadmin') THEN u.role::text
    WHEN EXISTS (SELECT 1 FROM vendor_profiles vp WHERE vp.id = me.id)
      OR EXISTS (SELECT 1 FROM tpl_partners tp WHERE tp.user_id = me.id) THEN 'vendor'
    ELSE u.role::text
  END
  FROM (SELECT auth.uid() AS id) me
  LEFT JOIN users u ON u.id = me.id
$$;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(public.current_app_role() IN ('superadmin', 'admin', 'manager'), false)
$$;

CREATE OR REPLACE FUNCTION public.my_vehicle_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM vehicles WHERE driver_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.my_route_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id FROM routes r JOIN vehicles v ON v.id = r.vehicle_id WHERE v.driver_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.my_tpl_partner_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM tpl_partners WHERE user_id = auth.uid()
$$;

-- Windows a vendor may see: open ones, and any they have bid on.
CREATE OR REPLACE FUNCTION public.vendor_visible_window_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM capacity_windows WHERE closes_at > now() AND winning_bid_id IS NULL
  UNION
  SELECT window_id FROM capacity_bids WHERE vendor_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.vendor_visible_vehicle_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cw.vehicle_id FROM capacity_windows cw WHERE cw.id IN (SELECT public.vendor_visible_window_ids())
$$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'current_app_role()', 'is_staff()', 'my_vehicle_ids()', 'my_route_ids()',
    'my_tpl_partner_ids()', 'vendor_visible_window_ids()', 'vendor_visible_vehicle_ids()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 2. Deny by default
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE p record; t record;
BEGIN
  FOR p IN SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

-- Earlier migrations granted anon full DML on vendor tables. TRUNCATE is not
-- subject to RLS, so no client role gets it.
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- Backend-only RPCs (every overload, whatever its signature in production)
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('calculate_distance', 'match_vendors_to_route')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 3. Policies (authenticated users unless noted)
-- ─────────────────────────────────────────────────────────────

-- users: own row; staff read everyone (SOS screen shows driver name/phone).
-- Writes are limited to push_token by column grants (20260928000000).
CREATE POLICY users_select ON public.users FOR SELECT TO authenticated
  USING (id = auth.uid() OR (SELECT public.is_staff()));
CREATE POLICY users_update_own ON public.users FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- vendor_profiles: vendors read/update their own; staff read/update all (KYC review)
CREATE POLICY vendor_profiles_select ON public.vendor_profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR (SELECT public.is_staff()));
CREATE POLICY vendor_profiles_update ON public.vendor_profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR (SELECT public.is_staff()))
  WITH CHECK (id = auth.uid() OR (SELECT public.is_staff()));

-- kyc_profiles: read-only for the owner and staff
CREATE POLICY kyc_profiles_select ON public.kyc_profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR (SELECT public.is_staff()));

-- vehicles: staff all; drivers their own; vendors those behind windows they can see
CREATE POLICY vehicles_select ON public.vehicles FOR SELECT TO authenticated
  USING (
    (SELECT public.is_staff())
    OR driver_id = auth.uid()
    OR ((SELECT public.current_app_role()) = 'vendor' AND id IN (SELECT public.vendor_visible_vehicle_ids()))
  );
CREATE POLICY vehicles_update_driver ON public.vehicles FOR UPDATE TO authenticated
  USING (driver_id = auth.uid())
  WITH CHECK (driver_id = auth.uid() AND status::text IN ('available', 'on_route', 'idle', 'offline'));

-- telemetry: drivers insert for their own vehicle; staff read
CREATE POLICY telemetry_insert_driver ON public.telemetry FOR INSERT TO authenticated
  WITH CHECK (vehicle_id IN (SELECT public.my_vehicle_ids()));
CREATE POLICY telemetry_select_staff ON public.telemetry FOR SELECT TO authenticated
  USING ((SELECT public.is_staff()));

-- routes / stops / delivery points: staff all; drivers their own routes
CREATE POLICY routes_select ON public.routes FOR SELECT TO authenticated
  USING ((SELECT public.is_staff()) OR vehicle_id IN (SELECT public.my_vehicle_ids()));
CREATE POLICY route_stops_select ON public.route_stops FOR SELECT TO authenticated
  USING ((SELECT public.is_staff()) OR route_id IN (SELECT public.my_route_ids()));
CREATE POLICY delivery_points_select ON public.delivery_points FOR SELECT TO authenticated
  USING (
    (SELECT public.is_staff())
    OR id IN (SELECT rs.delivery_point_id FROM public.route_stops rs WHERE rs.route_id IN (SELECT public.my_route_ids()))
  );

-- shipments: staff (dashboards and realtime)
CREATE POLICY shipments_select_staff ON public.shipments FOR SELECT TO authenticated
  USING ((SELECT public.is_staff()));

-- vendor shipment requests: the requesting vendor and staff
CREATE POLICY vendor_shipment_requests_select ON public.vendor_shipment_requests FOR SELECT TO authenticated
  USING (vendor_id = auth.uid() OR (SELECT public.is_staff()));

-- cargo manifests: staff; the assigned driver; the vendor whose request it fulfils
CREATE POLICY cargo_manifest_select ON public.cargo_manifest FOR SELECT TO authenticated
  USING (
    (SELECT public.is_staff())
    OR vehicle_id IN (SELECT public.my_vehicle_ids())
    OR vendor_request_id IN (SELECT id FROM public.vendor_shipment_requests WHERE vendor_id = auth.uid())
  );

-- capacity windows: staff; the vehicle's driver; vendors (open windows and ones they bid on)
CREATE POLICY capacity_windows_select ON public.capacity_windows FOR SELECT TO authenticated
  USING (
    (SELECT public.is_staff())
    OR vehicle_id IN (SELECT public.my_vehicle_ids())
    OR ((SELECT public.current_app_role()) = 'vendor' AND id IN (SELECT public.vendor_visible_window_ids()))
  );

-- capacity bids: staff; the bidding vendor; the driver whose window it is. Bids are placed via the backend.
CREATE POLICY capacity_bids_select ON public.capacity_bids FOR SELECT TO authenticated
  USING (
    (SELECT public.is_staff())
    OR vendor_id = auth.uid()
    OR window_id IN (SELECT cw.id FROM public.capacity_windows cw WHERE cw.vehicle_id IN (SELECT public.my_vehicle_ids()))
  );

-- driver confirmations: staff read; drivers read and answer their own
CREATE POLICY driver_confirmations_select ON public.driver_confirmations FOR SELECT TO authenticated
  USING ((SELECT public.is_staff()) OR vehicle_id IN (SELECT public.my_vehicle_ids()));
CREATE POLICY driver_confirmations_update_driver ON public.driver_confirmations FOR UPDATE TO authenticated
  USING (vehicle_id IN (SELECT public.my_vehicle_ids()))
  WITH CHECK (vehicle_id IN (SELECT public.my_vehicle_ids()));

-- notifications: recipients read their own
CREATE POLICY notifications_select_own ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- SOS alerts: staff (alerts are raised through the backend)
CREATE POLICY sos_alerts_select_staff ON public.sos_alerts FOR SELECT TO authenticated
  USING ((SELECT public.is_staff()));

-- system settings: public rate card; superadmins edit
CREATE POLICY system_settings_select ON public.system_settings FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY system_settings_update_superadmin ON public.system_settings FOR UPDATE TO authenticated
  USING ((SELECT public.current_app_role()) = 'superadmin')
  WITH CHECK ((SELECT public.current_app_role()) = 'superadmin');

-- 3PL partners: staff; the partner's own record (dashboard can request re-review)
CREATE POLICY tpl_partners_select ON public.tpl_partners FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR (SELECT public.is_staff()));
CREATE POLICY tpl_partners_update_own ON public.tpl_partners FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY tpl_corridors_select ON public.tpl_corridors FOR SELECT TO authenticated
  USING (partner_id IN (SELECT public.my_tpl_partner_ids()) OR (SELECT public.is_staff()));

CREATE POLICY tpl_documents_select ON public.tpl_documents FOR SELECT TO authenticated
  USING (partner_id IN (SELECT public.my_tpl_partner_ids()) OR (SELECT public.is_staff()));
CREATE POLICY tpl_documents_update_own ON public.tpl_documents FOR UPDATE TO authenticated
  USING (partner_id IN (SELECT public.my_tpl_partner_ids()))
  WITH CHECK (partner_id IN (SELECT public.my_tpl_partner_ids()));

-- ─────────────────────────────────────────────────────────────
-- 4. Field guards: non-staff users may only change specific fields.
--    The backend (service role) and staff are not restricted.
-- ─────────────────────────────────────────────────────────────

-- Generic: reject changes outside the columns passed as trigger arguments.
-- updated_at is always allowed: timestamp triggers that fire earlier set it.
CREATE OR REPLACE FUNCTION public.restrict_client_update_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  allowed text[] := TG_ARGV || ARRAY['updated_at'];
BEGIN
  IF coalesce(auth.role(), '') <> 'authenticated' OR public.is_staff() THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
    RAISE EXCEPTION 'Not allowed to change these fields on %', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vehicles_client_update_guard ON public.vehicles;
CREATE TRIGGER vehicles_client_update_guard BEFORE UPDATE ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.restrict_client_update_columns('latitude', 'longitude', 'last_heartbeat', 'status');

DROP TRIGGER IF EXISTS driver_confirmations_client_update_guard ON public.driver_confirmations;
CREATE TRIGGER driver_confirmations_client_update_guard BEFORE UPDATE ON public.driver_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.restrict_client_update_columns('action', 'responded_at');

DROP TRIGGER IF EXISTS tpl_documents_client_update_guard ON public.tpl_documents;
CREATE TRIGGER tpl_documents_client_update_guard BEFORE UPDATE ON public.tpl_documents
  FOR EACH ROW EXECUTE FUNCTION public.restrict_client_update_columns('file_url', 'uploaded_at');

-- 3PL partners may submit changes for review, never activate themselves or edit approved data.
CREATE OR REPLACE FUNCTION public.guard_tpl_partner_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'authenticated' OR public.is_staff() THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - ARRAY['pending_updates', 'status', 'updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['pending_updates', 'status', 'updated_at'])
     OR (NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'pending') THEN
    RAISE EXCEPTION 'Partners can only submit changes for review' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tpl_partners_client_update_guard ON public.tpl_partners;
CREATE TRIGGER tpl_partners_client_update_guard BEFORE UPDATE ON public.tpl_partners
  FOR EACH ROW EXECUTE FUNCTION public.guard_tpl_partner_update();

-- Vendors may edit their profile and KYC data and submit it for review;
-- only staff can verify a vendor or approve/reject KYC.
CREATE OR REPLACE FUNCTION public.guard_vendor_profile_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'authenticated' OR public.is_staff() THEN
    IF NEW.kyc_status IS DISTINCT FROM OLD.kyc_status AND NEW.kyc_status IN ('approved', 'rejected') THEN
      NEW.kyc_reviewed_at := now();
      NEW.kyc_reviewed_by := auth.uid();
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.is_verified IS DISTINCT FROM OLD.is_verified
     OR NEW.kyc_reviewed_at IS DISTINCT FROM OLD.kyc_reviewed_at
     OR NEW.kyc_reviewed_by IS DISTINCT FROM OLD.kyc_reviewed_by
     OR (NEW.kyc_status IS DISTINCT FROM OLD.kyc_status AND NEW.kyc_status <> 'submitted') THEN
    RAISE EXCEPTION 'Only staff can verify vendors or review KYC' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vendor_profiles_client_update_guard ON public.vendor_profiles;
CREATE TRIGGER vendor_profiles_client_update_guard BEFORE UPDATE ON public.vendor_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_vendor_profile_update();

-- ─────────────────────────────────────────────────────────────
-- 5. Realtime: the driver app subscribes to its confirmations
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'driver_confirmations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_confirmations;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 6. KYC document storage: private bucket, folder-scoped access.
--    Folder layout (first path segment):
--      <vendor user id>/...            vendor KYC documents
--      <tpl partner id>/...            documents a 3PL partner uploads from its dashboard
--      <tpl custom id>/...             documents from older 3PL applications
--      tpl-applications/<custom id>/...  documents uploaded while applying (no account yet)
--    Documents are shown through short-lived signed URLs.
-- ─────────────────────────────────────────────────────────────
UPDATE storage.buckets SET public = false WHERE id = 'kyc_documents';

DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND (
        coalesce(qual, '') ILIKE '%kyc_documents%' OR coalesce(with_check, '') ILIKE '%kyc_documents%'
        -- a policy not scoped to any bucket also applies to kyc_documents
        OR (coalesce(qual, '') NOT ILIKE '%bucket_id%' AND coalesce(with_check, '') NOT ILIKE '%bucket_id%')
      )
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', p.policyname);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.can_read_kyc_object(object_name text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_staff()
    OR split_part(object_name, '/', 1) = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM tpl_partners tp
      WHERE tp.user_id = auth.uid()
        AND (split_part(object_name, '/', 1) IN (tp.id::text, tp.custom_id)
             OR (split_part(object_name, '/', 1) = 'tpl-applications' AND split_part(object_name, '/', 2) = tp.custom_id))
    )
$$;
REVOKE ALL ON FUNCTION public.can_read_kyc_object(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_kyc_object(text) TO authenticated, service_role;

CREATE POLICY kyc_documents_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'kyc_documents' AND public.can_read_kyc_object(name));

-- Vendors upload into their own folder; partners into their partner folder
CREATE POLICY kyc_documents_upload_own ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'kyc_documents'
    AND (SELECT public.current_app_role()) = 'vendor'
    AND (split_part(name, '/', 1) = auth.uid()::text
         OR split_part(name, '/', 1) IN (SELECT id::text FROM public.tpl_partners WHERE user_id = auth.uid()))
  );

-- 3PL applicants have no account yet; they may only add new files under tpl-applications/
CREATE POLICY kyc_documents_upload_application ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'kyc_documents' AND split_part(name, '/', 1) = 'tpl-applications');
