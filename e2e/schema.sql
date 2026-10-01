--
-- PostgreSQL database dump
--

\restrict TXAYtZHXkRkOu2a7WZpksa7UuYs5ngqgaouhE3eM4b0jtbo1O8bsjFLix11jiMk

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: alert_severity; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.alert_severity AS ENUM (
    'low',
    'medium',
    'high',
    'critical'
);


--
-- Name: maintenance_job_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.maintenance_job_status AS ENUM (
    'open',
    'closed'
);


--
-- Name: maintenance_reason_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.maintenance_reason_type AS ENUM (
    'scheduled_service',
    'breakdown',
    'accident',
    'tyre',
    'other'
);


--
-- Name: route_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.route_status AS ENUM (
    'pending',
    'optimizing',
    'active',
    'completed',
    'cancelled'
);


--
-- Name: service_attachment_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.service_attachment_kind AS ENUM (
    'invoice',
    'job_card',
    'photo',
    'other'
);


--
-- Name: shipment_priority; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.shipment_priority AS ENUM (
    'low',
    'medium',
    'high',
    'critical'
);


--
-- Name: shipment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.shipment_status AS ENUM (
    'created',
    'picked_up',
    'in_transit',
    'delivered',
    'cancelled',
    'assigned',
    'exception',
    'out_for_delivery',
    'at_hub',
    'partially_delivered',
    'on_hold',
    'returning',
    'returned',
    'lost'
);


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'superadmin',
    'admin',
    'manager',
    'driver',
    'vendor'
);


--
-- Name: vehicle_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.vehicle_status AS ENUM (
    'available',
    'on_route',
    'idle',
    'maintenance',
    'offline',
    'archived',
    'pending_approval'
);


--
-- Name: vehicle_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.vehicle_type AS ENUM (
    'truck',
    'van',
    'bike',
    'car'
);


--
-- Name: calculate_distance(double precision, double precision, double precision, double precision); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_distance(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision) RETURNS double precision
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
  x double precision = 69.1 * (lat2 - lat1);
  y double precision = 69.1 * (lon2 - lon1) * cos(lat1 / 57.3);
BEGIN
  -- Approximation based on equirectangular projection (good enough for 50km radius)
  -- 1 degree of latitude is ~69.1 miles, converting to kilometers (* 1.60934)
  RETURN sqrt(x * x + y * y) * 1.60934;
END;
$$;


--
-- Name: can_read_kyc_object(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_read_kyc_object(object_name text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: current_app_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_app_role() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: guard_tpl_partner_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_tpl_partner_update() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
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


--
-- Name: guard_vendor_profile_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_vendor_profile_update() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  identity_fields constant text[] := ARRAY['company_name', 'gst_number', 'address', 'kyc_data'];
BEGIN
  IF coalesce(auth.role(), '') <> 'authenticated' OR public.is_staff() THEN
    IF NEW.kyc_status IS DISTINCT FROM OLD.kyc_status AND NEW.kyc_status IN ('approved', 'rejected') THEN
      NEW.kyc_reviewed_at := now();
      NEW.kyc_reviewed_by := auth.uid();
    END IF;
    IF NEW.kyc_status IS DISTINCT FROM OLD.kyc_status AND NEW.kyc_status <> 'rejected' THEN
      NEW.kyc_rejection_reason := NULL;
    END IF;
    RETURN NEW;
  END IF;

  -- Only staff can verify a vendor or approve/reject KYC (or set why)
  IF NEW.is_verified IS DISTINCT FROM OLD.is_verified
     OR NEW.kyc_reviewed_at IS DISTINCT FROM OLD.kyc_reviewed_at
     OR NEW.kyc_reviewed_by IS DISTINCT FROM OLD.kyc_reviewed_by
     OR NEW.kyc_rejection_reason IS DISTINCT FROM OLD.kyc_rejection_reason
     OR (NEW.kyc_status IS DISTINCT FROM OLD.kyc_status AND NEW.kyc_status <> 'submitted') THEN
    RAISE EXCEPTION 'Only staff can verify vendors or review KYC' USING ERRCODE = '42501';
  END IF;

  -- Changing legal identity on an approved profile needs a new review
  IF OLD.kyc_status = 'approved' AND EXISTS (
    SELECT 1 FROM unnest(identity_fields) AS f
    WHERE to_jsonb(NEW) -> f IS DISTINCT FROM to_jsonb(OLD) -> f
  ) THEN
    NEW.kyc_status := 'submitted';
    NEW.kyc_reviewed_at := NULL;
    NEW.kyc_reviewed_by := NULL;
  END IF;

  -- Resubmitting after a rejection (the vendor's own edit sets kyc_status
  -- back to 'submitted') always clears the old reason.
  IF OLD.kyc_status = 'rejected' AND NEW.kyc_status = 'submitted' THEN
    NEW.kyc_rejection_reason := NULL;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  granted_role text := NEW.raw_app_meta_data->>'role';
  new_role user_role;
BEGIN
  IF granted_role = 'customer' THEN
    RETURN NEW;
  END IF;

  new_role := CASE
    WHEN granted_role IN ('superadmin', 'admin', 'manager', 'driver', 'vendor') THEN granted_role::user_role
    WHEN NEW.raw_user_meta_data->>'role' = 'vendor' THEN 'vendor'::user_role
    ELSE 'driver'::user_role
  END;

  INSERT INTO public.users (id, email, full_name, role, phone)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    new_role,
    NEW.raw_user_meta_data->>'phone'
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, public.users.full_name);
  RETURN NEW;
END;
$$;


--
-- Name: is_staff(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_staff() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT coalesce(public.current_app_role() IN ('superadmin', 'admin', 'manager'), false)
$$;


--
-- Name: match_vendors_to_route(jsonb, double precision); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_vendors_to_route(route_points jsonb, radius_km double precision DEFAULT 50.0) RETURNS TABLE(vendor_id uuid, min_distance_km double precision)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  WITH points AS (
    SELECT 
      (value->>'lat')::double precision as point_lat,
      (value->>'lng')::double precision as point_lng
    FROM jsonb_array_elements(route_points)
  ),
  distances AS (
    SELECT 
      v.id as v_id,
      calculate_distance(p.point_lat, p.point_lng, v.latitude, v.longitude) as dist
    FROM vendor_profiles v
    CROSS JOIN points p
  )
  SELECT 
    v_id as vendor_id,
    MIN(dist) as min_distance_km
  FROM distances
  WHERE dist <= radius_km
  GROUP BY v_id;
END;
$$;


--
-- Name: my_manifest_ids(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_manifest_ids() RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT id FROM cargo_manifest WHERE vehicle_id IN (SELECT id FROM vehicles WHERE driver_id = auth.uid())
$$;


--
-- Name: my_route_ids(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_route_ids() RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT r.id FROM routes r JOIN vehicles v ON v.id = r.vehicle_id WHERE v.driver_id = auth.uid()
$$;


--
-- Name: my_shipment_ids(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_shipment_ids() RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT dp.shipment_id
    FROM delivery_points dp
    JOIN route_stops rs ON rs.delivery_point_id = dp.id
    JOIN routes r ON r.id = rs.route_id
    JOIN vehicles v ON v.id = r.vehicle_id
   WHERE v.driver_id = auth.uid() AND dp.shipment_id IS NOT NULL
$$;


--
-- Name: my_tpl_partner_ids(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_tpl_partner_ids() RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT id FROM tpl_partners WHERE user_id = auth.uid()
$$;


--
-- Name: my_vehicle_ids(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_vehicle_ids() RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT id FROM vehicles WHERE driver_id = auth.uid()
$$;


--
-- Name: restrict_client_update_columns(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.restrict_client_update_columns() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
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


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: hsn_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hsn_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    hsn_code text NOT NULL,
    description text NOT NULL,
    gst_rate numeric(5,2) DEFAULT 0 NOT NULL,
    category text DEFAULT 'General'::text NOT NULL,
    keywords text[] DEFAULT '{}'::text[],
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: search_hsn(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_hsn(search_term text) RETURNS SETOF public.hsn_codes
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM hsn_codes
  WHERE
    hsn_code ILIKE search_term || '%'
    OR description ILIKE '%' || search_term || '%'
    OR search_term = ANY(keywords)
    OR EXISTS (
      SELECT 1 FROM unnest(keywords) k WHERE k ILIKE '%' || search_term || '%'
    )
  ORDER BY
    CASE WHEN hsn_code ILIKE search_term || '%' THEN 0 ELSE 1 END,
    CASE WHEN search_term = ANY(keywords) THEN 0 ELSE 1 END,
    hsn_code
  LIMIT 10;
END;
$$;


--
-- Name: track_driver_vehicle_assignment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.track_driver_vehicle_assignment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.driver_id IS NOT DISTINCT FROM OLD.driver_id THEN
      RETURN NEW;
    END IF;
    UPDATE public.driver_vehicle_assignments
       SET unassigned_at = now()
     WHERE vehicle_id = NEW.id AND unassigned_at IS NULL;
  END IF;
  IF NEW.driver_id IS NOT NULL THEN
    INSERT INTO public.driver_vehicle_assignments (driver_id, vehicle_id, assigned_by)
    VALUES (NEW.driver_id, NEW.id, NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid);
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: update_hsn_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_hsn_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: update_modified_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_modified_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW; 
END;
$$;


--
-- Name: vehicles_driver_status_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.vehicles_driver_status_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND OLD.driver_id = auth.uid()
     AND NEW.status IS DISTINCT FROM OLD.status
     AND (OLD.status::text NOT IN ('available', 'on_route', 'idle', 'offline')
          OR NEW.status::text NOT IN ('available', 'on_route', 'idle', 'offline')) THEN
    NEW.status := OLD.status;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: vendor_visible_window_ids(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.vendor_visible_window_ids() RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT id FROM capacity_windows WHERE closes_at > now() AND winning_bid_id IS NULL
  UNION
  SELECT window_id FROM capacity_bids WHERE vendor_id = auth.uid()
$$;


--
-- Name: ai_agent_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_agent_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_name character varying NOT NULL,
    action character varying NOT NULL,
    input_data json DEFAULT '{}'::json,
    output_data json DEFAULT '{}'::json,
    status character varying DEFAULT 'success'::character varying,
    duration_ms integer DEFAULT 0,
    vehicle_id uuid,
    route_id uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: capacity_bids; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.capacity_bids (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    window_id uuid NOT NULL,
    vendor_id uuid NOT NULL,
    bid_amount numeric NOT NULL,
    submitted_at timestamp with time zone DEFAULT now(),
    status text DEFAULT 'pending'::text NOT NULL,
    eway_bill_ref text,
    dropoff_point_id uuid,
    weight_kg numeric,
    load_configuration text,
    rejection_reason text
);


--
-- Name: capacity_windows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.capacity_windows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_id uuid NOT NULL,
    opens_at timestamp with time zone NOT NULL,
    closes_at timestamp with time zone NOT NULL,
    floor_price numeric,
    winning_bid_id uuid,
    fallback_used boolean DEFAULT false,
    fallback_shipment_id uuid,
    trigger_type text DEFAULT 'return_trip'::text,
    status text DEFAULT 'open'::text NOT NULL,
    resolved_at timestamp with time zone,
    created_by uuid,
    CONSTRAINT capacity_windows_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text, 'cancelled'::text]))),
    CONSTRAINT capacity_windows_trigger_type_check CHECK ((trigger_type = ANY (ARRAY['mid_route'::text, 'return_trip'::text, 'superadmin_dispatch'::text])))
);


--
-- Name: cargo_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cargo_claims (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    exception_id uuid,
    shipment_id uuid,
    manifest_id uuid,
    claim_type text NOT NULL,
    declared_value numeric,
    claimed_amount numeric,
    approved_amount numeric,
    settled_amount numeric,
    status text DEFAULT 'draft'::text NOT NULL,
    raised_by_role text NOT NULL,
    raised_by uuid,
    insurer text,
    policy_number text,
    fir_number text,
    surveyor_name text,
    survey_date date,
    document_paths text[] DEFAULT '{}'::text[] NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    settled_at timestamp with time zone,
    CONSTRAINT cargo_claims_approved_amount_check CHECK (((approved_amount IS NULL) OR (approved_amount >= (0)::numeric))),
    CONSTRAINT cargo_claims_claim_type_check CHECK ((claim_type = ANY (ARRAY['damage'::text, 'shortage'::text, 'loss'::text, 'theft'::text, 'delay'::text]))),
    CONSTRAINT cargo_claims_claimed_amount_check CHECK (((claimed_amount IS NULL) OR (claimed_amount >= (0)::numeric))),
    CONSTRAINT cargo_claims_declared_value_check CHECK (((declared_value IS NULL) OR (declared_value >= (0)::numeric))),
    CONSTRAINT cargo_claims_one_ref CHECK (((shipment_id IS NULL) <> (manifest_id IS NULL))),
    CONSTRAINT cargo_claims_raised_by_role_check CHECK ((raised_by_role = ANY (ARRAY['staff'::text, 'customer'::text, 'vendor'::text]))),
    CONSTRAINT cargo_claims_settled_amount_check CHECK (((settled_amount IS NULL) OR (settled_amount >= (0)::numeric))),
    CONSTRAINT cargo_claims_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'filed'::text, 'surveyed'::text, 'approved'::text, 'rejected'::text, 'settled'::text, 'withdrawn'::text])))
);


--
-- Name: cargo_custody_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cargo_custody_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shipment_id uuid,
    manifest_id uuid,
    kind text NOT NULL,
    from_holder text,
    from_vehicle_id uuid,
    from_depot_id uuid,
    to_holder text,
    to_vehicle_id uuid,
    to_depot_id uuid,
    driver_id uuid,
    pieces integer,
    weight_kg numeric,
    condition text,
    seal_number text,
    seal_ok boolean,
    photo_paths text[] DEFAULT '{}'::text[] NOT NULL,
    signature_path text,
    otp_verified boolean,
    receiver_name text,
    lat double precision,
    lng double precision,
    notes text,
    exception_id uuid,
    transfer_id uuid,
    recorded_by uuid,
    recorded_role text,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cargo_custody_events_condition_check CHECK (((condition IS NULL) OR (condition = ANY (ARRAY['good'::text, 'damaged_packaging'::text, 'damaged_goods'::text, 'wet'::text, 'seal_tampered'::text, 'shortage'::text, 'excess'::text])))),
    CONSTRAINT cargo_custody_events_from_holder_check CHECK (((from_holder IS NULL) OR (from_holder = ANY (ARRAY['consignor'::text, 'vehicle'::text, 'hub'::text, 'consignee'::text])))),
    CONSTRAINT cargo_custody_events_kind_check CHECK ((kind = ANY (ARRAY['booked'::text, 'accepted'::text, 'arrived_pickup'::text, 'pickup'::text, 'departed'::text, 'arrived_drop'::text, 'delivery'::text, 'partial_delivery'::text, 'refused'::text, 'undelivered'::text, 'handover_out'::text, 'handover_in'::text, 'hub_in'::text, 'hub_out'::text, 'return_pickup'::text, 'return_delivery'::text, 'inspection'::text, 'hold'::text, 'release_hold'::text, 'lost'::text, 'split'::text, 'merge'::text]))),
    CONSTRAINT cargo_custody_events_one_ref CHECK (((shipment_id IS NULL) <> (manifest_id IS NULL))),
    CONSTRAINT cargo_custody_events_pieces_check CHECK (((pieces IS NULL) OR (pieces >= 0))),
    CONSTRAINT cargo_custody_events_to_holder_check CHECK (((to_holder IS NULL) OR (to_holder = ANY (ARRAY['consignor'::text, 'vehicle'::text, 'hub'::text, 'consignee'::text])))),
    CONSTRAINT cargo_custody_events_weight_kg_check CHECK (((weight_kg IS NULL) OR (weight_kg >= (0)::numeric)))
);


--
-- Name: cargo_exception_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cargo_exception_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    exception_id uuid NOT NULL,
    shipment_id uuid,
    manifest_id uuid,
    pieces_affected integer,
    weight_affected_kg numeric,
    condition text,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cargo_exception_items_condition_check CHECK (((condition IS NULL) OR (condition = ANY (ARRAY['good'::text, 'damaged_packaging'::text, 'damaged_goods'::text, 'wet'::text, 'seal_tampered'::text, 'shortage'::text, 'excess'::text])))),
    CONSTRAINT cargo_exception_items_one_ref CHECK (((shipment_id IS NULL) <> (manifest_id IS NULL))),
    CONSTRAINT cargo_exception_items_pieces_affected_check CHECK (((pieces_affected IS NULL) OR (pieces_affected >= 0))),
    CONSTRAINT cargo_exception_items_weight_affected_kg_check CHECK (((weight_affected_kg IS NULL) OR (weight_affected_kg >= (0)::numeric)))
);


--
-- Name: cargo_exceptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cargo_exceptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    type text NOT NULL,
    severity text DEFAULT 'medium'::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    sos_alert_id uuid,
    maintenance_job_id uuid,
    vehicle_id uuid,
    route_id uuid,
    lat double precision,
    lng double precision,
    description text,
    owner_id uuid,
    sla_due_at timestamp with time zone,
    escalation_count integer DEFAULT 0 NOT NULL,
    last_escalated_at timestamp with time zone,
    resolution text,
    resolution_note text,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    notes jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cargo_exceptions_resolution_check CHECK (((resolution IS NULL) OR (resolution = ANY (ARRAY['transshipped'::text, 'repaired_continue'::text, 'moved_to_hub'::text, 'returned'::text, 'delivered_with_remarks'::text, 'redelivered'::text, 'written_off'::text, 'claim_settled'::text, 'no_action'::text])))),
    CONSTRAINT cargo_exceptions_severity_check CHECK ((severity = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))),
    CONSTRAINT cargo_exceptions_source_check CHECK ((source = ANY (ARRAY['sos'::text, 'maintenance'::text, 'stop_failed'::text, 'custody'::text, 'eta'::text, 'manual'::text, 'driver'::text]))),
    CONSTRAINT cargo_exceptions_status_check CHECK ((status = ANY (ARRAY['open'::text, 'investigating'::text, 'action_planned'::text, 'resolved'::text, 'closed'::text]))),
    CONSTRAINT cargo_exceptions_type_check CHECK ((type = ANY (ARRAY['vehicle_accident'::text, 'vehicle_breakdown'::text, 'damage'::text, 'shortage'::text, 'excess'::text, 'theft'::text, 'refused'::text, 'undeliverable'::text, 'delay'::text, 'seal_tamper'::text, 'weather'::text, 'other'::text])))
);


--
-- Name: cargo_manifest; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cargo_manifest (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_id uuid,
    vendor_request_id uuid,
    pickup_location text,
    pickup_lat double precision,
    pickup_lng double precision,
    drop_location text,
    drop_lat double precision,
    drop_lng double precision,
    capacity_kg double precision,
    status text DEFAULT 'scheduled'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    received_by text,
    photo_url text,
    signature_url text,
    current_holder text DEFAULT 'consignor'::text NOT NULL,
    current_vehicle_id uuid,
    current_depot_id uuid,
    pieces_total integer,
    pieces_delivered integer DEFAULT 0 NOT NULL,
    pieces_damaged integer DEFAULT 0 NOT NULL,
    pieces_short integer DEFAULT 0 NOT NULL,
    pieces_returned integer DEFAULT 0 NOT NULL,
    seal_number text,
    delivery_attempts integer DEFAULT 0 NOT NULL,
    max_delivery_attempts integer DEFAULT 3 NOT NULL,
    rto boolean DEFAULT false NOT NULL,
    on_hold_reason text,
    parent_manifest_id uuid,
    lot_seq integer,
    lot_label text,
    is_master boolean DEFAULT false NOT NULL,
    declared_value numeric,
    freight_share numeric,
    consignee_name text,
    consignee_phone text,
    consignee_gstin text,
    split_reason text,
    eway_bill_ref text,
    eway_part_b_required boolean DEFAULT false NOT NULL,
    CONSTRAINT cargo_manifest_current_holder_check CHECK ((current_holder = ANY (ARRAY['consignor'::text, 'vehicle'::text, 'hub'::text, 'consignee'::text]))),
    CONSTRAINT cargo_manifest_lot_check CHECK ((((parent_manifest_id IS NULL) OR ((lot_seq IS NOT NULL) AND (lot_seq >= 1) AND (lot_label IS NOT NULL) AND (NOT is_master))) AND ((parent_manifest_id IS NULL) OR (parent_manifest_id <> id)) AND ((declared_value IS NULL) OR (declared_value >= (0)::numeric)) AND ((freight_share IS NULL) OR (freight_share >= (0)::numeric)))),
    CONSTRAINT cargo_manifest_pieces_check CHECK (((pieces_delivered >= 0) AND (pieces_damaged >= 0) AND (pieces_short >= 0) AND (pieces_returned >= 0) AND (delivery_attempts >= 0) AND (max_delivery_attempts >= 1) AND ((pieces_total IS NULL) OR ((pieces_total >= 0) AND (((pieces_delivered + pieces_short) + pieces_returned) <= pieces_total))))),
    CONSTRAINT cargo_manifest_split_reason_check CHECK (((split_reason IS NULL) OR (split_reason = ANY (ARRAY['multi_drop'::text, 'partial_transfer'::text, 'hub_crossdock'::text, 'partial_delivery_remainder'::text, 'manual'::text]))))
);


--
-- Name: cargo_transfer_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cargo_transfer_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transfer_id uuid NOT NULL,
    shipment_id uuid,
    manifest_id uuid,
    pieces_planned integer NOT NULL,
    pieces_out integer,
    pieces_in integer,
    condition_in text,
    CONSTRAINT cargo_transfer_items_condition_in_check CHECK (((condition_in IS NULL) OR (condition_in = ANY (ARRAY['good'::text, 'damaged_packaging'::text, 'damaged_goods'::text, 'wet'::text, 'seal_tampered'::text, 'shortage'::text, 'excess'::text])))),
    CONSTRAINT cargo_transfer_items_one_ref CHECK (((shipment_id IS NULL) <> (manifest_id IS NULL))),
    CONSTRAINT cargo_transfer_items_pieces_in_check CHECK (((pieces_in IS NULL) OR (pieces_in >= 0))),
    CONSTRAINT cargo_transfer_items_pieces_out_check CHECK (((pieces_out IS NULL) OR (pieces_out >= 0))),
    CONSTRAINT cargo_transfer_items_pieces_planned_check CHECK ((pieces_planned >= 0))
);


--
-- Name: cargo_transfers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cargo_transfers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    exception_id uuid,
    from_vehicle_id uuid NOT NULL,
    to_vehicle_id uuid,
    to_depot_id uuid,
    status text DEFAULT 'planned'::text NOT NULL,
    meet_lat double precision,
    meet_lng double precision,
    meet_address text,
    planned_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    new_route_id uuid,
    eway_part_b_required boolean DEFAULT false NOT NULL,
    eway_part_b_updated_at timestamp with time zone,
    eway_part_b_ref text,
    created_by uuid,
    note text,
    CONSTRAINT cargo_transfers_one_target CHECK (((to_vehicle_id IS NULL) <> (to_depot_id IS NULL))),
    CONSTRAINT cargo_transfers_other_vehicle CHECK (((to_vehicle_id IS NULL) OR (to_vehicle_id <> from_vehicle_id))),
    CONSTRAINT cargo_transfers_status_check CHECK ((status = ANY (ARRAY['planned'::text, 'in_progress'::text, 'completed'::text, 'cancelled'::text])))
);


--
-- Name: customer_bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    pickup_name text NOT NULL,
    pickup_address text NOT NULL,
    pickup_lat double precision NOT NULL,
    pickup_lng double precision NOT NULL,
    drop_name text NOT NULL,
    drop_address text NOT NULL,
    drop_lat double precision NOT NULL,
    drop_lng double precision NOT NULL,
    weight_kg numeric(10,2) NOT NULL,
    load_type text DEFAULT 'full'::text NOT NULL,
    vehicle_type text,
    pickup_date date NOT NULL,
    quoted_price numeric(12,2),
    quote_details jsonb,
    status text DEFAULT 'requested'::text NOT NULL,
    shipment_id uuid,
    tracking_id text,
    vehicle_id uuid,
    cancelled_by text,
    cancel_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    drops jsonb,
    CONSTRAINT customer_bookings_cancelled_by_check CHECK (((cancelled_by IS NULL) OR (cancelled_by = ANY (ARRAY['customer'::text, 'staff'::text])))),
    CONSTRAINT customer_bookings_load_type_check CHECK ((load_type = ANY (ARRAY['full'::text, 'part'::text]))),
    CONSTRAINT customer_bookings_quoted_price_check CHECK (((quoted_price IS NULL) OR (quoted_price >= (0)::numeric))),
    CONSTRAINT customer_bookings_status_check CHECK ((status = ANY (ARRAY['requested'::text, 'confirmed'::text, 'assigned'::text, 'in_transit'::text, 'delivered'::text, 'cancelled'::text]))),
    CONSTRAINT customer_bookings_weight_kg_check CHECK ((weight_kg > (0)::numeric))
);


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid NOT NULL,
    phone text NOT NULL,
    full_name text,
    company_name text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    push_token text
);


--
-- Name: delivery_points; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_points (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    address text NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    speed_kmph double precision DEFAULT 0.0,
    heading double precision DEFAULT 0.0,
    fuel_level_pct double precision DEFAULT 100.0,
    engine_temp double precision,
    odometer_km double precision,
    cargo_types json DEFAULT '[]'::json,
    demand_kg double precision DEFAULT 0.0,
    service_time_minutes integer DEFAULT 10,
    required_cargo_types json DEFAULT '[]'::json,
    status character varying(20) DEFAULT 'pending'::character varying,
    shipment_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    pieces integer,
    consignee_name text,
    consignee_phone text,
    lot_shipment_id uuid,
    CONSTRAINT delivery_points_pieces_check CHECK (((pieces IS NULL) OR (pieces >= 0)))
);


--
-- Name: depots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.depots (
    id uuid NOT NULL,
    name character varying(255) NOT NULL,
    address text NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    speed_kmph double precision DEFAULT 0.0,
    heading double precision DEFAULT 0.0,
    fuel_level_pct double precision DEFAULT 100.0,
    engine_temp double precision,
    odometer_km double precision,
    cargo_types json DEFAULT '[]'::json,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: driver_confirmations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.driver_confirmations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    route_stop_id uuid NOT NULL,
    vehicle_id uuid NOT NULL,
    prompted_at timestamp with time zone DEFAULT now() NOT NULL,
    delivered_at timestamp with time zone,
    responded_at timestamp with time zone,
    action text
);


--
-- Name: driver_pay_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.driver_pay_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    driver_id uuid NOT NULL,
    vehicle_id uuid,
    vehicle_type text,
    route_id uuid,
    manifest_id uuid,
    trip_date date NOT NULL,
    km numeric(10,1) DEFAULT 0 NOT NULL,
    km_source text DEFAULT 'none'::text NOT NULL,
    rate_id uuid,
    per_trip_amount numeric(12,2) DEFAULT 0 NOT NULL,
    per_km_amount numeric(12,2) DEFAULT 0 NOT NULL,
    adjustments jsonb DEFAULT '[]'::jsonb NOT NULL,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    rate_missing boolean DEFAULT false NOT NULL,
    status text DEFAULT 'earned'::text NOT NULL,
    approved_at timestamp with time zone,
    approved_by uuid,
    void_reason text,
    voided_at timestamp with time zone,
    voided_by uuid,
    payout_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT driver_pay_entries_km_check CHECK ((km >= (0)::numeric)),
    CONSTRAINT driver_pay_entries_km_source_check CHECK ((km_source = ANY (ARRAY['gps'::text, 'planned'::text, 'estimated'::text, 'none'::text]))),
    CONSTRAINT driver_pay_entries_one_trip CHECK (((route_id IS NULL) OR (manifest_id IS NULL))),
    CONSTRAINT driver_pay_entries_paid_has_payout CHECK (((status <> 'paid'::text) OR (payout_id IS NOT NULL))),
    CONSTRAINT driver_pay_entries_status_check CHECK ((status = ANY (ARRAY['earned'::text, 'approved'::text, 'paid'::text, 'void'::text])))
);


--
-- Name: driver_pay_rates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.driver_pay_rates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_type text NOT NULL,
    per_trip_amount numeric(12,2) DEFAULT 0 NOT NULL,
    per_km_amount numeric(12,2) DEFAULT 0 NOT NULL,
    effective_from date NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT driver_pay_rates_per_km_amount_check CHECK ((per_km_amount >= (0)::numeric)),
    CONSTRAINT driver_pay_rates_per_trip_amount_check CHECK ((per_trip_amount >= (0)::numeric)),
    CONSTRAINT driver_pay_rates_vehicle_type_check CHECK ((vehicle_type = ANY (ARRAY['truck'::text, 'van'::text, 'bike'::text, 'car'::text])))
);


--
-- Name: driver_payouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.driver_payouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    driver_id uuid NOT NULL,
    period_from date,
    period_to date,
    amount numeric(12,2) NOT NULL,
    method text NOT NULL,
    reference text,
    note text,
    paid_at timestamp with time zone DEFAULT now() NOT NULL,
    paid_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT driver_payouts_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT driver_payouts_method_check CHECK ((method = ANY (ARRAY['cash'::text, 'bank'::text, 'upi'::text])))
);


--
-- Name: driver_vehicle_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.driver_vehicle_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    driver_id uuid NOT NULL,
    vehicle_id uuid NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    unassigned_at timestamp with time zone,
    assigned_by uuid
);


--
-- Name: expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_id uuid,
    route_id uuid,
    category text NOT NULL,
    amount numeric(12,2) NOT NULL,
    expense_date date DEFAULT CURRENT_DATE NOT NULL,
    litres numeric(10,2),
    note text,
    receipt_path text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT expenses_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT expenses_category_check CHECK ((category = ANY (ARRAY['fuel'::text, 'maintenance'::text, 'toll'::text, 'driver'::text, 'other'::text])))
);


--
-- Name: gps_points; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gps_points (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_id uuid NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    accuracy double precision,
    recorded_at timestamp with time zone DEFAULT now(),
    speed_kmph double precision,
    heading double precision,
    source text
);


--
-- Name: idempotency_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.idempotency_keys (
    user_id uuid NOT NULL,
    key text NOT NULL,
    action text NOT NULL,
    status_code integer DEFAULT 200 NOT NULL,
    response jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shipment_id uuid,
    invoice_number character varying NOT NULL,
    amount numeric(12,2) DEFAULT 0.0 NOT NULL,
    currency character varying DEFAULT 'INR'::character varying,
    status character varying DEFAULT 'issued'::character varying,
    issued_at timestamp with time zone DEFAULT now(),
    paid_at timestamp with time zone,
    due_date timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    manifest_id uuid,
    vendor_id uuid,
    gst_rate numeric(5,2) DEFAULT 0 NOT NULL,
    gst_amount numeric(12,2) DEFAULT 0 NOT NULL,
    total numeric(12,2),
    price_source text,
    voided_at timestamp with time zone,
    vendor_request_id uuid,
    payment_method text,
    payment_reference text,
    void_reason text,
    notes text,
    CONSTRAINT invoices_payment_method_check CHECK (((payment_method IS NULL) OR (payment_method = ANY (ARRAY['bank'::text, 'upi'::text, 'cash'::text, 'cheque'::text])))),
    CONSTRAINT invoices_status_check CHECK (((status)::text = ANY (ARRAY[('issued'::character varying)::text, ('paid'::character varying)::text, ('void'::character varying)::text])))
);


--
-- Name: kyc_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kyc_profiles (
    id uuid NOT NULL,
    partner_type text NOT NULL,
    kyc_status text DEFAULT 'pending'::text NOT NULL,
    kyc_data jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT kyc_profiles_kyc_status_check CHECK ((kyc_status = ANY (ARRAY['pending'::text, 'submitted'::text, 'approved'::text, 'rejected'::text]))),
    CONSTRAINT kyc_profiles_partner_type_check CHECK ((partner_type = ANY (ARRAY['vendor'::text, 'customer'::text])))
);


--
-- Name: maintenance_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.maintenance_alerts (
    id uuid NOT NULL,
    vehicle_id uuid,
    alert_type character varying(50) NOT NULL,
    severity public.alert_severity DEFAULT 'medium'::public.alert_severity,
    description text NOT NULL,
    is_resolved boolean DEFAULT false,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    status text DEFAULT 'open'::text NOT NULL,
    source text,
    is_test boolean DEFAULT false NOT NULL,
    details jsonb,
    occurrences integer DEFAULT 1 NOT NULL,
    last_seen_at timestamp with time zone,
    acknowledged_at timestamp with time zone,
    acknowledged_by uuid,
    resolved_by uuid
);


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    route_id uuid,
    shipment_id uuid,
    sender_id uuid,
    sender_role text NOT NULL,
    sender_name text,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    read_at timestamp with time zone,
    CONSTRAINT messages_body_check CHECK (((char_length(btrim(body)) >= 1) AND (char_length(btrim(body)) <= 2000))),
    CONSTRAINT messages_has_thread CHECK (((route_id IS NOT NULL) OR (shipment_id IS NOT NULL)))
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    title text NOT NULL,
    body text NOT NULL,
    type text NOT NULL,
    is_read boolean DEFAULT false,
    data jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: parcel_scans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parcel_scans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shipment_id uuid,
    manifest_id uuid,
    stop_id text,
    driver_id uuid,
    purpose text NOT NULL,
    method text DEFAULT 'camera'::text NOT NULL,
    latitude double precision,
    longitude double precision,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT parcel_scans_method_check CHECK ((method = ANY (ARRAY['camera'::text, 'manual'::text]))),
    CONSTRAINT parcel_scans_one_target CHECK (((shipment_id IS NOT NULL) OR (manifest_id IS NOT NULL))),
    CONSTRAINT parcel_scans_purpose_check CHECK ((purpose = ANY (ARRAY['pickup'::text, 'delivery'::text])))
);


--
-- Name: parcels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parcels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shipment_id uuid,
    weight_kg double precision NOT NULL,
    length_cm double precision NOT NULL,
    width_cm double precision NOT NULL,
    height_cm double precision NOT NULL,
    category character varying(50) NOT NULL,
    is_hazardous boolean DEFAULT false,
    is_fragile boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid,
    amount double precision DEFAULT 0.0 NOT NULL,
    method character varying DEFAULT 'upi'::character varying,
    transaction_id character varying,
    status character varying DEFAULT 'pending'::character varying,
    paid_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: price_quotes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.price_quotes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
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
    factors jsonb DEFAULT '[]'::jsonb NOT NULL,
    accepted_inr numeric(12,2),
    accepted_at timestamp with time zone,
    request_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: route_stops; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.route_stops (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    route_id uuid,
    delivery_point_id uuid,
    sequence integer NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    planned_arrival_at timestamp with time zone,
    actual_arrival_at timestamp with time zone,
    photo_url text,
    signature_url text
);


--
-- Name: routes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.routes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_id uuid,
    depot_id uuid,
    status public.route_status DEFAULT 'pending'::public.route_status,
    total_distance_km double precision DEFAULT 0.0,
    total_duration_minutes double precision DEFAULT 0.0,
    estimated_fuel_liters double precision DEFAULT 0.0,
    weather_condition character varying(50) DEFAULT 'clear'::character varying,
    traffic_delay_minutes integer DEFAULT 0,
    waypoints json DEFAULT '[]'::json,
    optimization_score double precision DEFAULT 0.0,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    plan jsonb
);


--
-- Name: COLUMN routes.plan; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.routes.plan IS 'Route planner details: source, provider, truck_aware, origin, departure_at, toll_km, avoid, created_by. Null for routes not made in the planner.';


--
-- Name: service_plan_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_plan_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item text NOT NULL,
    interval_km integer,
    interval_days integer,
    sort_order integer DEFAULT 100 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT service_plan_templates_has_interval CHECK (((interval_km IS NOT NULL) OR (interval_days IS NOT NULL))),
    CONSTRAINT service_plan_templates_interval_days_check CHECK (((interval_days IS NULL) OR (interval_days > 0))),
    CONSTRAINT service_plan_templates_interval_km_check CHECK (((interval_km IS NULL) OR (interval_km > 0)))
);


--
-- Name: shipment_hsn; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipment_hsn (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shipment_id uuid,
    hsn_code text NOT NULL,
    description text,
    gst_rate numeric(5,2),
    declared_value numeric(14,2),
    taxable_amount numeric(14,2),
    cgst numeric(14,2),
    sgst numeric(14,2),
    igst numeric(14,2),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: shipment_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipment_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shipment_id uuid,
    status character varying(50) NOT NULL,
    location_lat double precision,
    location_lng double precision,
    "timestamp" timestamp with time zone DEFAULT now(),
    index integer NOT NULL,
    previous_hash character varying(64) NOT NULL,
    log_hash character varying(64) NOT NULL,
    metadata_json json DEFAULT '{}'::json
);


--
-- Name: shipments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tracking_id character varying(50) NOT NULL,
    status public.shipment_status DEFAULT 'created'::public.shipment_status,
    priority public.shipment_priority DEFAULT 'medium'::public.shipment_priority,
    origin_name character varying(255),
    origin_address text,
    origin_lat double precision,
    origin_lng double precision,
    total_items integer DEFAULT 1,
    total_weight_kg double precision DEFAULT 0.0,
    received_by character varying(100),
    signature_data text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    bid_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb,
    required_vehicle_type text,
    driver_rating smallint,
    driver_rating_note text,
    driver_rated_at timestamp with time zone,
    driver_rated_by uuid,
    rated_vehicle_id uuid,
    rated_driver_id uuid,
    freight_charge numeric(12,2),
    photo_url text,
    signature_url text,
    current_holder text DEFAULT 'consignor'::text NOT NULL,
    current_vehicle_id uuid,
    current_depot_id uuid,
    pieces_total integer,
    pieces_delivered integer DEFAULT 0 NOT NULL,
    pieces_damaged integer DEFAULT 0 NOT NULL,
    pieces_short integer DEFAULT 0 NOT NULL,
    pieces_returned integer DEFAULT 0 NOT NULL,
    seal_number text,
    delivery_attempts integer DEFAULT 0 NOT NULL,
    max_delivery_attempts integer DEFAULT 3 NOT NULL,
    delivery_otp_required boolean DEFAULT false NOT NULL,
    delivery_otp_hash text,
    delivery_otp_expires_at timestamp with time zone,
    rto boolean DEFAULT false NOT NULL,
    on_hold_reason text,
    parent_shipment_id uuid,
    lot_seq integer,
    lot_label text,
    is_master boolean DEFAULT false NOT NULL,
    declared_value numeric,
    freight_share numeric,
    consignee_name text,
    consignee_phone text,
    consignee_gstin text,
    split_reason text,
    eway_bill_ref text,
    eway_part_b_required boolean DEFAULT false NOT NULL,
    CONSTRAINT shipments_current_holder_check CHECK ((current_holder = ANY (ARRAY['consignor'::text, 'vehicle'::text, 'hub'::text, 'consignee'::text]))),
    CONSTRAINT shipments_driver_rating_check CHECK (((driver_rating IS NULL) OR ((driver_rating >= 1) AND (driver_rating <= 5)))),
    CONSTRAINT shipments_freight_charge_check CHECK (((freight_charge IS NULL) OR (freight_charge >= (0)::numeric))),
    CONSTRAINT shipments_lot_check CHECK ((((parent_shipment_id IS NULL) OR ((lot_seq IS NOT NULL) AND (lot_seq >= 1) AND (lot_label IS NOT NULL) AND (NOT is_master))) AND ((parent_shipment_id IS NULL) OR (parent_shipment_id <> id)) AND ((declared_value IS NULL) OR (declared_value >= (0)::numeric)) AND ((freight_share IS NULL) OR (freight_share >= (0)::numeric)))),
    CONSTRAINT shipments_pieces_check CHECK (((pieces_delivered >= 0) AND (pieces_damaged >= 0) AND (pieces_short >= 0) AND (pieces_returned >= 0) AND (delivery_attempts >= 0) AND (max_delivery_attempts >= 1) AND ((pieces_total IS NULL) OR ((pieces_total >= 0) AND (((pieces_delivered + pieces_short) + pieces_returned) <= pieces_total))))),
    CONSTRAINT shipments_split_reason_check CHECK (((split_reason IS NULL) OR (split_reason = ANY (ARRAY['multi_drop'::text, 'partial_transfer'::text, 'hub_crossdock'::text, 'partial_delivery_remainder'::text, 'manual'::text]))))
);


--
-- Name: sos_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sos_alerts (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    driver_id uuid,
    vehicle_id uuid,
    alert_type text NOT NULL,
    description text,
    latitude numeric,
    longitude numeric,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    severity text
);


--
-- Name: system_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_settings (
    key text NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: telemetry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.telemetry (
    id uuid NOT NULL,
    vehicle_id uuid,
    "timestamp" timestamp with time zone DEFAULT now(),
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    speed_kmph double precision DEFAULT 0.0,
    heading double precision DEFAULT 0.0,
    fuel_level_pct double precision DEFAULT 100.0,
    engine_temp double precision,
    odometer_km double precision,
    cargo_types json DEFAULT '[]'::json
);


--
-- Name: tpl_corridors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tpl_corridors (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    partner_id uuid,
    corridor_name text NOT NULL,
    vehicle_types text[],
    proposed_rate text,
    priority text DEFAULT 'Priority 1'::text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    rate_amount numeric(12,2),
    rate_unit text,
    CONSTRAINT tpl_corridors_rate_check CHECK ((((rate_amount IS NULL) AND (rate_unit IS NULL)) OR ((rate_amount > (0)::numeric) AND (rate_unit = ANY (ARRAY['per_trip'::text, 'per_km'::text])))))
);


--
-- Name: tpl_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tpl_documents (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    partner_id uuid,
    doc_type text NOT NULL,
    file_url text NOT NULL,
    uploaded_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);


--
-- Name: tpl_offers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tpl_offers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    partner_id uuid NOT NULL,
    source_type text NOT NULL,
    request_id uuid,
    shipment_id uuid,
    corridor_id uuid,
    corridor_name text,
    pickup_location text,
    drop_location text,
    weight_kg numeric,
    proposed_price numeric(12,2),
    status text DEFAULT 'offered'::text NOT NULL,
    pickup_eta timestamp with time zone,
    decline_reason text,
    offered_at timestamp with time zone DEFAULT now() NOT NULL,
    responded_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tpl_offers_one_source CHECK ((((source_type = 'request'::text) AND (request_id IS NOT NULL) AND (shipment_id IS NULL)) OR ((source_type = 'shipment'::text) AND (shipment_id IS NOT NULL) AND (request_id IS NULL)))),
    CONSTRAINT tpl_offers_proposed_price_check CHECK (((proposed_price IS NULL) OR (proposed_price > (0)::numeric))),
    CONSTRAINT tpl_offers_source_type_check CHECK ((source_type = ANY (ARRAY['request'::text, 'shipment'::text]))),
    CONSTRAINT tpl_offers_status_check CHECK ((status = ANY (ARRAY['offered'::text, 'accepted'::text, 'declined'::text, 'taken'::text, 'withdrawn'::text])))
);


--
-- Name: tpl_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tpl_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    offer_id uuid NOT NULL,
    partner_id uuid NOT NULL,
    source_type text NOT NULL,
    request_id uuid,
    shipment_id uuid,
    pickup_location text,
    drop_location text,
    weight_kg numeric,
    agreed_amount numeric(12,2) NOT NULL,
    status text DEFAULT 'accepted'::text NOT NULL,
    pickup_eta timestamp with time zone,
    due_by timestamp with time zone,
    accepted_at timestamp with time zone DEFAULT now() NOT NULL,
    picked_up_at timestamp with time zone,
    delivered_at timestamp with time zone,
    pod_note text,
    paid_at timestamp with time zone,
    paid_reference text,
    rating smallint,
    rating_note text,
    rated_at timestamp with time zone,
    rated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tpl_orders_agreed_amount_check CHECK ((agreed_amount > (0)::numeric)),
    CONSTRAINT tpl_orders_rating_check CHECK (((rating IS NULL) OR ((rating >= 1) AND (rating <= 5)))),
    CONSTRAINT tpl_orders_source_type_check CHECK ((source_type = ANY (ARRAY['request'::text, 'shipment'::text]))),
    CONSTRAINT tpl_orders_status_check CHECK ((status = ANY (ARRAY['accepted'::text, 'picked_up'::text, 'in_transit'::text, 'delivered'::text, 'cancelled'::text])))
);


--
-- Name: tpl_partners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tpl_partners (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    company_name text NOT NULL,
    pan_number text NOT NULL,
    gstin text NOT NULL,
    msme_status text DEFAULT 'Not Registered'::text,
    bank_account_no text,
    bank_ifsc text,
    sla_commitment text DEFAULT '2 Hours'::text,
    tax_treatment text,
    status text DEFAULT 'pending'::text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
    custom_id text,
    email text,
    pending_updates jsonb,
    rejection_reason text,
    phone text,
    bank_name text,
    bank_branch text,
    bank_ifsc_details jsonb,
    bank_ifsc_verified_at timestamp with time zone,
    CONSTRAINT tpl_partners_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'provisioning'::text, 'invite_sent'::text, 'active'::text, 'paused'::text, 'rejected'::text])))
);


--
-- Name: traffic_incidents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.traffic_incidents (
    id text NOT NULL,
    type text NOT NULL,
    severity smallint DEFAULT 0 NOT NULL,
    description text,
    road text,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    geometry jsonb,
    delay_seconds integer,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    affected_route_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    active boolean DEFAULT true NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_activity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_activity (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    actor_id uuid,
    action text NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_bank_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_bank_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    account_holder text NOT NULL,
    account_number text NOT NULL,
    ifsc text NOT NULL,
    bank_name text,
    upi_id text,
    is_primary boolean DEFAULT false NOT NULL,
    is_verified boolean DEFAULT false NOT NULL,
    effective_from timestamp with time zone DEFAULT now() NOT NULL,
    proof_document_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    branch_name text,
    bank_address text,
    bank_city text,
    bank_state text,
    micr text,
    ifsc_details jsonb,
    ifsc_verified_at timestamp with time zone
);


--
-- Name: user_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    doc_type text NOT NULL,
    doc_number text,
    number_last4 text,
    number_hash text,
    name_on_document text,
    extra_file_paths text[],
    review_by date,
    verification_method text DEFAULT 'manual'::text NOT NULL,
    resubmission_count integer DEFAULT 0 NOT NULL,
    issued_on date,
    expires_on date,
    file_path text,
    status text DEFAULT 'pending'::text NOT NULL,
    rejection_reason text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    uploaded_by uuid,
    verified_by uuid,
    verified_at timestamp with time zone,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_documents_doc_type_check CHECK ((doc_type = ANY (ARRAY['driving_licence'::text, 'aadhaar'::text, 'pan'::text, 'photo'::text, 'police_verification'::text, 'medical_fitness'::text, 'address_proof'::text, 'offer_letter'::text, 'voter_id'::text, 'passport'::text, 'bank_proof'::text, 'other'::text]))),
    CONSTRAINT user_documents_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'verified'::text, 'rejected'::text, 'expired'::text]))),
    CONSTRAINT user_documents_verification_method_check CHECK ((verification_method = ANY (ARRAY['manual'::text, 'digilocker'::text, 'parivahan'::text])))
);


--
-- Name: user_emergency_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_emergency_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    relation text,
    phone text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    body text NOT NULL,
    author_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_phone_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_phone_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    phone text NOT NULL,
    from_at timestamp with time zone DEFAULT now() NOT NULL,
    to_at timestamp with time zone
);


--
-- Name: user_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_profiles (
    user_id uuid NOT NULL,
    employee_code text,
    designation text,
    department text,
    employment_type text,
    date_of_joining date,
    date_of_birth date,
    gender text,
    blood_group text,
    alternate_phone text,
    personal_email text,
    address_line text,
    city text,
    state text,
    pincode text,
    latitude double precision,
    longitude double precision,
    base_depot_id uuid,
    reporting_manager_id uuid,
    photo_path text,
    employer_type text DEFAULT 'company'::text NOT NULL,
    employer_partner_id uuid,
    no_pan_reason text,
    suspended_until date,
    leave_from date,
    leave_until date,
    consent_at timestamp with time zone,
    consent_by uuid,
    consent_method text,
    invite_sent_at timestamp with time zone,
    anonymised_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT user_profiles_employer_type_check CHECK ((employer_type = ANY (ARRAY['company'::text, 'partner'::text]))),
    CONSTRAINT user_profiles_employment_type_check CHECK ((employment_type = ANY (ARRAY['permanent'::text, 'contract'::text, 'on_call'::text])))
);


--
-- Name: user_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_status_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    from_status text,
    to_status text NOT NULL,
    reason text,
    changed_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    email character varying(255),
    full_name character varying(255) NOT NULL,
    role public.user_role DEFAULT 'driver'::public.user_role,
    is_active boolean DEFAULT true,
    last_login timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    phone text,
    vehicle_type text,
    push_token text,
    status text DEFAULT 'active'::text NOT NULL,
    CONSTRAINT users_status_check CHECK ((status = ANY (ARRAY['onboarding'::text, 'active'::text, 'on_leave'::text, 'suspended'::text, 'inactive'::text])))
);


--
-- Name: vehicle_fuel_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicle_fuel_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_id uuid NOT NULL,
    filled_at timestamp with time zone DEFAULT now() NOT NULL,
    litres numeric(10,2) NOT NULL,
    price_per_litre numeric(10,2) NOT NULL,
    total_amount numeric(12,2) NOT NULL,
    odometer_km numeric(12,1),
    is_full_tank boolean DEFAULT true NOT NULL,
    station_name text,
    payment_mode text DEFAULT 'cash'::text NOT NULL,
    fill_latitude numeric(9,6),
    fill_longitude numeric(9,6),
    bill_status text DEFAULT 'no_bill'::text NOT NULL,
    bill_path text,
    logged_by uuid,
    logged_by_role text,
    reviewed_at timestamp with time zone,
    reviewed_by uuid,
    expense_id uuid,
    distance_km numeric(12,1),
    litres_used numeric(10,2),
    mileage_kmpl numeric(6,2),
    flags jsonb DEFAULT '[]'::jsonb NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vehicle_fuel_logs_bill_status_check CHECK ((bill_status = ANY (ARRAY['with_bill'::text, 'no_bill'::text]))),
    CONSTRAINT vehicle_fuel_logs_litres_check CHECK ((litres > (0)::numeric)),
    CONSTRAINT vehicle_fuel_logs_odometer_km_check CHECK (((odometer_km IS NULL) OR (odometer_km >= (0)::numeric))),
    CONSTRAINT vehicle_fuel_logs_payment_mode_check CHECK ((payment_mode = ANY (ARRAY['cash'::text, 'card'::text, 'upi'::text, 'fuel_card'::text, 'credit'::text, 'other'::text]))),
    CONSTRAINT vehicle_fuel_logs_price_per_litre_check CHECK ((price_per_litre > (0)::numeric)),
    CONSTRAINT vehicle_fuel_logs_total_amount_check CHECK ((total_amount > (0)::numeric))
);


--
-- Name: vehicle_maintenance_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicle_maintenance_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_id uuid NOT NULL,
    status public.maintenance_job_status DEFAULT 'open'::public.maintenance_job_status NOT NULL,
    reason_type public.maintenance_reason_type NOT NULL,
    workshop text,
    expected_return_date date,
    note text,
    sos_alert_id uuid,
    released_work jsonb,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    opened_by uuid,
    opened_odometer_km numeric(12,1),
    closed_at timestamp with time zone,
    closed_by uuid,
    final_odometer_km numeric(12,1),
    total_cost numeric(12,2),
    close_note text,
    service_log_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vehicle_maintenance_jobs_closed_has_time CHECK (((status <> 'closed'::public.maintenance_job_status) OR (closed_at IS NOT NULL))),
    CONSTRAINT vehicle_maintenance_jobs_final_odometer_km_check CHECK (((final_odometer_km IS NULL) OR (final_odometer_km >= (0)::numeric))),
    CONSTRAINT vehicle_maintenance_jobs_opened_odometer_km_check CHECK (((opened_odometer_km IS NULL) OR (opened_odometer_km >= (0)::numeric))),
    CONSTRAINT vehicle_maintenance_jobs_total_cost_check CHECK (((total_cost IS NULL) OR (total_cost >= (0)::numeric)))
);


--
-- Name: vehicle_odometer_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicle_odometer_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_id uuid NOT NULL,
    kind text NOT NULL,
    before_km numeric(12,1),
    after_km numeric(12,1) NOT NULL,
    source text,
    reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vehicle_odometer_events_kind_check CHECK ((kind = ANY (ARRAY['manual'::text, 'correction'::text, 'auto_sync'::text])))
);


--
-- Name: vehicle_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicle_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_id uuid NOT NULL,
    slot text NOT NULL,
    file_path text NOT NULL,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vehicle_photos_slot_check CHECK ((slot = ANY (ARRAY['front'::text, 'side'::text, 'back'::text, 'interior'::text, 'cargo'::text])))
);


--
-- Name: vehicle_service_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicle_service_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_id uuid NOT NULL,
    service_log_id uuid,
    job_id uuid,
    kind public.service_attachment_kind DEFAULT 'other'::public.service_attachment_kind NOT NULL,
    file_path text NOT NULL,
    file_name text,
    content_type text,
    size_bytes bigint,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vehicle_service_attachments_has_parent CHECK (((service_log_id IS NOT NULL) OR (job_id IS NOT NULL))),
    CONSTRAINT vehicle_service_attachments_size_bytes_check CHECK (((size_bytes IS NULL) OR (size_bytes >= 0)))
);


--
-- Name: vehicle_service_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicle_service_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_log_id uuid NOT NULL,
    vehicle_id uuid NOT NULL,
    description text NOT NULL,
    kind text DEFAULT 'part'::text NOT NULL,
    quantity numeric(10,2) DEFAULT 1 NOT NULL,
    unit_cost numeric(12,2) DEFAULT 0 NOT NULL,
    total_cost numeric(12,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vehicle_service_items_kind_check CHECK ((kind = ANY (ARRAY['part'::text, 'repair'::text]))),
    CONSTRAINT vehicle_service_items_quantity_check CHECK ((quantity > (0)::numeric)),
    CONSTRAINT vehicle_service_items_total_cost_check CHECK ((total_cost >= (0)::numeric)),
    CONSTRAINT vehicle_service_items_unit_cost_check CHECK ((unit_cost >= (0)::numeric))
);


--
-- Name: vehicle_service_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicle_service_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_id uuid NOT NULL,
    item text NOT NULL,
    done_at date DEFAULT CURRENT_DATE NOT NULL,
    odometer_km numeric(12,1),
    cost numeric(12,2),
    note text,
    expense_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    workshop text,
    labour_cost numeric(12,2),
    invoice_number text,
    job_id uuid,
    CONSTRAINT vehicle_service_log_cost_check CHECK (((cost IS NULL) OR (cost >= (0)::numeric))),
    CONSTRAINT vehicle_service_log_labour_cost_check CHECK (((labour_cost IS NULL) OR (labour_cost >= (0)::numeric))),
    CONSTRAINT vehicle_service_log_odometer_km_check CHECK (((odometer_km IS NULL) OR (odometer_km >= (0)::numeric)))
);


--
-- Name: vehicle_service_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicle_service_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_id uuid NOT NULL,
    item text NOT NULL,
    interval_km integer,
    interval_days integer,
    last_done_km numeric(12,1),
    last_done_at date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vehicle_service_plans_has_interval CHECK (((interval_km IS NOT NULL) OR (interval_days IS NOT NULL))),
    CONSTRAINT vehicle_service_plans_interval_days_check CHECK (((interval_days IS NULL) OR (interval_days > 0))),
    CONSTRAINT vehicle_service_plans_interval_km_check CHECK (((interval_km IS NULL) OR (interval_km > 0))),
    CONSTRAINT vehicle_service_plans_last_done_km_check CHECK (((last_done_km IS NULL) OR (last_done_km >= (0)::numeric)))
);


--
-- Name: vehicle_share_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicle_share_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_id uuid NOT NULL,
    token_hash text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    last_viewed_at timestamp with time zone,
    view_count integer DEFAULT 0 NOT NULL
);


--
-- Name: vehicle_stoppages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicle_stoppages (
    id uuid NOT NULL,
    vehicle_id uuid,
    start_time timestamp with time zone DEFAULT now(),
    end_time timestamp with time zone,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    speed_kmph double precision DEFAULT 0.0,
    heading double precision DEFAULT 0.0,
    fuel_level_pct double precision DEFAULT 100.0,
    engine_temp double precision,
    odometer_km double precision,
    cargo_types json DEFAULT '[]'::json,
    reason character varying(255) DEFAULT 'unknown'::character varying,
    duration_minutes integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: vehicles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vehicles (
    id uuid NOT NULL,
    plate_number character varying(20) NOT NULL,
    vehicle_type public.vehicle_type DEFAULT 'truck'::public.vehicle_type,
    capacity_kg double precision DEFAULT 1000,
    fuel_type character varying(20) DEFAULT 'diesel'::character varying,
    fuel_capacity_liters double precision DEFAULT 60.0,
    fuel_efficiency_kmpl double precision DEFAULT 12.0,
    current_fuel_liters double precision DEFAULT 60.0,
    status public.vehicle_status DEFAULT 'available'::public.vehicle_status,
    latitude double precision,
    longitude double precision,
    last_heartbeat timestamp with time zone,
    spark_id character varying(50),
    last_sync timestamp with time zone,
    driver_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    available_capacity_kg numeric DEFAULT 0,
    capacity_confirmed_at timestamp with time zone,
    capacity_updated_at timestamp with time zone,
    bidding_window_open boolean DEFAULT false,
    bidding_window_closes_at timestamp with time zone,
    last_known_connectivity_zone text,
    declared_load_percentage numeric DEFAULT 0,
    driver_name text,
    driver_phone text,
    container_length_ft double precision DEFAULT 0,
    container_width_ft double precision DEFAULT 0,
    container_height_ft double precision DEFAULT 0,
    current_load_kg double precision DEFAULT 0,
    vehicle_model text,
    rc_number character varying(50),
    rc_expiry date,
    rc_document_url text,
    insurance_number character varying(50),
    insurance_expiry date,
    insurance_document_url text,
    fitness_certificate_number character varying(50),
    fitness_expiry date,
    fitness_document_url text,
    permit_number character varying(50),
    permit_expiry date,
    permit_document_url text,
    puc_number character varying(50),
    puc_expiry date,
    puc_document_url text,
    cargo_types jsonb,
    current_location_name text,
    odometer_km numeric(12,3),
    odometer_updated_at timestamp with time zone,
    fuel_level_pct numeric(5,1),
    fuel_reported_at timestamp with time zone,
    submitted_at timestamp with time zone,
    submitted_by uuid,
    reviewed_at timestamp with time zone,
    reviewed_by uuid,
    review_decision text,
    rejection_reason text,
    odometer_synced_at timestamp with time zone,
    odometer_source text,
    CONSTRAINT vehicles_odometer_km_check CHECK (((odometer_km IS NULL) OR (odometer_km >= (0)::numeric))),
    CONSTRAINT vehicles_review_decision_check CHECK (((review_decision IS NULL) OR (review_decision = ANY (ARRAY['approved'::text, 'rejected'::text]))))
);


--
-- Name: vendor_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_profiles (
    id uuid NOT NULL,
    company_name text NOT NULL,
    gst_number text NOT NULL,
    city text NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    is_verified boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    address text,
    dummy2 text,
    company_logo text,
    kyc_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    kyc_status text DEFAULT 'pending'::text NOT NULL,
    kyc_reviewed_at timestamp with time zone,
    kyc_reviewed_by uuid,
    kyc_rejection_reason text,
    CONSTRAINT vendor_profiles_kyc_status_check CHECK ((kyc_status = ANY (ARRAY['pending'::text, 'submitted'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: vendor_route_opportunities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_route_opportunities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    route_id uuid,
    vendor_id uuid,
    status text DEFAULT 'notified'::text,
    eta_minutes integer,
    available_capacity_kg numeric,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT vendor_route_opportunities_status_check CHECK ((status = ANY (ARRAY['notified'::text, 'ignored'::text, 'bidded'::text])))
);


--
-- Name: vendor_shipment_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendor_shipment_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vendor_id uuid,
    pickup_location text NOT NULL,
    pickup_lat double precision NOT NULL,
    pickup_lng double precision NOT NULL,
    drop_location text NOT NULL,
    drop_lat double precision NOT NULL,
    drop_lng double precision NOT NULL,
    required_capacity_kg numeric NOT NULL,
    status text DEFAULT 'pending'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    assigned_vehicle_id uuid,
    cost numeric DEFAULT 0,
    cost_per_km numeric DEFAULT 0,
    metadata jsonb DEFAULT '{}'::jsonb,
    rejection_reason text,
    CONSTRAINT vendor_shipment_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'escalated'::text, 'assigned_to_partner'::text, 'assigned'::text, 'completed'::text, 'cancelled'::text, 'rejected'::text, 'fulfilled'::text])))
);


--
-- Name: ai_agent_logs ai_agent_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_agent_logs
    ADD CONSTRAINT ai_agent_logs_pkey PRIMARY KEY (id);


--
-- Name: capacity_bids capacity_bids_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capacity_bids
    ADD CONSTRAINT capacity_bids_pkey PRIMARY KEY (id);


--
-- Name: capacity_windows capacity_windows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capacity_windows
    ADD CONSTRAINT capacity_windows_pkey PRIMARY KEY (id);


--
-- Name: cargo_claims cargo_claims_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_claims
    ADD CONSTRAINT cargo_claims_code_key UNIQUE (code);


--
-- Name: cargo_claims cargo_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_claims
    ADD CONSTRAINT cargo_claims_pkey PRIMARY KEY (id);


--
-- Name: cargo_custody_events cargo_custody_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_custody_events
    ADD CONSTRAINT cargo_custody_events_pkey PRIMARY KEY (id);


--
-- Name: cargo_exception_items cargo_exception_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_exception_items
    ADD CONSTRAINT cargo_exception_items_pkey PRIMARY KEY (id);


--
-- Name: cargo_exceptions cargo_exceptions_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_exceptions
    ADD CONSTRAINT cargo_exceptions_code_key UNIQUE (code);


--
-- Name: cargo_exceptions cargo_exceptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_exceptions
    ADD CONSTRAINT cargo_exceptions_pkey PRIMARY KEY (id);


--
-- Name: cargo_manifest cargo_manifest_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_manifest
    ADD CONSTRAINT cargo_manifest_pkey PRIMARY KEY (id);


--
-- Name: cargo_manifest cargo_manifest_status_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.cargo_manifest
    ADD CONSTRAINT cargo_manifest_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'in_transit'::text, 'delivered'::text, 'completed'::text, 'cancelled'::text, 'exception'::text, 'on_hold'::text, 'returning'::text, 'returned'::text]))) NOT VALID;


--
-- Name: cargo_transfer_items cargo_transfer_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_transfer_items
    ADD CONSTRAINT cargo_transfer_items_pkey PRIMARY KEY (id);


--
-- Name: cargo_transfers cargo_transfers_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_transfers
    ADD CONSTRAINT cargo_transfers_code_key UNIQUE (code);


--
-- Name: cargo_transfers cargo_transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_transfers
    ADD CONSTRAINT cargo_transfers_pkey PRIMARY KEY (id);


--
-- Name: customer_bookings customer_bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_bookings
    ADD CONSTRAINT customer_bookings_pkey PRIMARY KEY (id);


--
-- Name: customers customers_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_phone_key UNIQUE (phone);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: customers customers_push_token_length; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.customers
    ADD CONSTRAINT customers_push_token_length CHECK (((push_token IS NULL) OR (length(push_token) <= 200))) NOT VALID;


--
-- Name: delivery_points delivery_points_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_points
    ADD CONSTRAINT delivery_points_pkey PRIMARY KEY (id);


--
-- Name: depots depots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.depots
    ADD CONSTRAINT depots_pkey PRIMARY KEY (id);


--
-- Name: driver_confirmations driver_confirmations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_confirmations
    ADD CONSTRAINT driver_confirmations_pkey PRIMARY KEY (id);


--
-- Name: driver_pay_entries driver_pay_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_pay_entries
    ADD CONSTRAINT driver_pay_entries_pkey PRIMARY KEY (id);


--
-- Name: driver_pay_rates driver_pay_rates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_pay_rates
    ADD CONSTRAINT driver_pay_rates_pkey PRIMARY KEY (id);


--
-- Name: driver_payouts driver_payouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_payouts
    ADD CONSTRAINT driver_payouts_pkey PRIMARY KEY (id);


--
-- Name: driver_vehicle_assignments driver_vehicle_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_vehicle_assignments
    ADD CONSTRAINT driver_vehicle_assignments_pkey PRIMARY KEY (id);


--
-- Name: expenses expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);


--
-- Name: gps_points gps_points_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gps_points
    ADD CONSTRAINT gps_points_pkey PRIMARY KEY (id);


--
-- Name: hsn_codes hsn_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hsn_codes
    ADD CONSTRAINT hsn_codes_pkey PRIMARY KEY (id);


--
-- Name: idempotency_keys idempotency_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency_keys
    ADD CONSTRAINT idempotency_keys_pkey PRIMARY KEY (user_id, key);


--
-- Name: invoices invoices_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_invoice_number_key UNIQUE (invoice_number);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: kyc_profiles kyc_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kyc_profiles
    ADD CONSTRAINT kyc_profiles_pkey PRIMARY KEY (id);


--
-- Name: maintenance_alerts maintenance_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_alerts
    ADD CONSTRAINT maintenance_alerts_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: parcel_scans parcel_scans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parcel_scans
    ADD CONSTRAINT parcel_scans_pkey PRIMARY KEY (id);


--
-- Name: parcels parcels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parcels
    ADD CONSTRAINT parcels_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: price_quotes price_quotes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_quotes
    ADD CONSTRAINT price_quotes_pkey PRIMARY KEY (id);


--
-- Name: route_stops route_stops_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_stops
    ADD CONSTRAINT route_stops_pkey PRIMARY KEY (id);


--
-- Name: routes routes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routes
    ADD CONSTRAINT routes_pkey PRIMARY KEY (id);


--
-- Name: service_plan_templates service_plan_templates_item_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_plan_templates
    ADD CONSTRAINT service_plan_templates_item_key UNIQUE (item);


--
-- Name: service_plan_templates service_plan_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_plan_templates
    ADD CONSTRAINT service_plan_templates_pkey PRIMARY KEY (id);


--
-- Name: shipment_hsn shipment_hsn_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_hsn
    ADD CONSTRAINT shipment_hsn_pkey PRIMARY KEY (id);


--
-- Name: shipment_logs shipment_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_logs
    ADD CONSTRAINT shipment_logs_pkey PRIMARY KEY (id);


--
-- Name: shipments shipments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_pkey PRIMARY KEY (id);


--
-- Name: shipments shipments_tracking_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_tracking_id_key UNIQUE (tracking_id);


--
-- Name: sos_alerts sos_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sos_alerts
    ADD CONSTRAINT sos_alerts_pkey PRIMARY KEY (id);


--
-- Name: sos_alerts sos_alerts_status_check; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.sos_alerts
    ADD CONSTRAINT sos_alerts_status_check CHECK ((status = ANY (ARRAY['active'::text, 'acknowledged'::text, 'resolved'::text, 'cancelled'::text]))) NOT VALID;


--
-- Name: system_settings system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (key);


--
-- Name: telemetry telemetry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry
    ADD CONSTRAINT telemetry_pkey PRIMARY KEY (id);


--
-- Name: tpl_corridors tpl_corridors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tpl_corridors
    ADD CONSTRAINT tpl_corridors_pkey PRIMARY KEY (id);


--
-- Name: tpl_documents tpl_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tpl_documents
    ADD CONSTRAINT tpl_documents_pkey PRIMARY KEY (id);


--
-- Name: tpl_offers tpl_offers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tpl_offers
    ADD CONSTRAINT tpl_offers_pkey PRIMARY KEY (id);


--
-- Name: tpl_orders tpl_orders_offer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tpl_orders
    ADD CONSTRAINT tpl_orders_offer_id_key UNIQUE (offer_id);


--
-- Name: tpl_orders tpl_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tpl_orders
    ADD CONSTRAINT tpl_orders_pkey PRIMARY KEY (id);


--
-- Name: tpl_partners tpl_partners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tpl_partners
    ADD CONSTRAINT tpl_partners_pkey PRIMARY KEY (id);


--
-- Name: traffic_incidents traffic_incidents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.traffic_incidents
    ADD CONSTRAINT traffic_incidents_pkey PRIMARY KEY (id);


--
-- Name: user_activity user_activity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_activity
    ADD CONSTRAINT user_activity_pkey PRIMARY KEY (id);


--
-- Name: user_bank_accounts user_bank_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_bank_accounts
    ADD CONSTRAINT user_bank_accounts_pkey PRIMARY KEY (id);


--
-- Name: user_documents user_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_documents
    ADD CONSTRAINT user_documents_pkey PRIMARY KEY (id);


--
-- Name: user_emergency_contacts user_emergency_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_emergency_contacts
    ADD CONSTRAINT user_emergency_contacts_pkey PRIMARY KEY (id);


--
-- Name: user_notes user_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_notes
    ADD CONSTRAINT user_notes_pkey PRIMARY KEY (id);


--
-- Name: user_phone_history user_phone_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_phone_history
    ADD CONSTRAINT user_phone_history_pkey PRIMARY KEY (id);


--
-- Name: user_profiles user_profiles_employee_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_employee_code_key UNIQUE (employee_code);


--
-- Name: user_profiles user_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_pkey PRIMARY KEY (user_id);


--
-- Name: user_status_history user_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_status_history
    ADD CONSTRAINT user_status_history_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_push_token_length; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.users
    ADD CONSTRAINT users_push_token_length CHECK (((push_token IS NULL) OR (length(push_token) <= 200))) NOT VALID;


--
-- Name: vehicle_fuel_logs vehicle_fuel_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_fuel_logs
    ADD CONSTRAINT vehicle_fuel_logs_pkey PRIMARY KEY (id);


--
-- Name: vehicle_maintenance_jobs vehicle_maintenance_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_maintenance_jobs
    ADD CONSTRAINT vehicle_maintenance_jobs_pkey PRIMARY KEY (id);


--
-- Name: vehicle_odometer_events vehicle_odometer_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_odometer_events
    ADD CONSTRAINT vehicle_odometer_events_pkey PRIMARY KEY (id);


--
-- Name: vehicle_photos vehicle_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_photos
    ADD CONSTRAINT vehicle_photos_pkey PRIMARY KEY (id);


--
-- Name: vehicle_photos vehicle_photos_vehicle_id_slot_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_photos
    ADD CONSTRAINT vehicle_photos_vehicle_id_slot_key UNIQUE (vehicle_id, slot);


--
-- Name: vehicle_service_attachments vehicle_service_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_service_attachments
    ADD CONSTRAINT vehicle_service_attachments_pkey PRIMARY KEY (id);


--
-- Name: vehicle_service_items vehicle_service_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_service_items
    ADD CONSTRAINT vehicle_service_items_pkey PRIMARY KEY (id);


--
-- Name: vehicle_service_log vehicle_service_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_service_log
    ADD CONSTRAINT vehicle_service_log_pkey PRIMARY KEY (id);


--
-- Name: vehicle_service_plans vehicle_service_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_service_plans
    ADD CONSTRAINT vehicle_service_plans_pkey PRIMARY KEY (id);


--
-- Name: vehicle_service_plans vehicle_service_plans_unique_item; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_service_plans
    ADD CONSTRAINT vehicle_service_plans_unique_item UNIQUE (vehicle_id, item);


--
-- Name: vehicle_share_links vehicle_share_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_share_links
    ADD CONSTRAINT vehicle_share_links_pkey PRIMARY KEY (id);


--
-- Name: vehicle_share_links vehicle_share_links_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_share_links
    ADD CONSTRAINT vehicle_share_links_token_hash_key UNIQUE (token_hash);


--
-- Name: vehicle_stoppages vehicle_stoppages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_stoppages
    ADD CONSTRAINT vehicle_stoppages_pkey PRIMARY KEY (id);


--
-- Name: vehicles vehicles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_pkey PRIMARY KEY (id);


--
-- Name: vehicles vehicles_plate_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_plate_number_key UNIQUE (plate_number);


--
-- Name: vendor_profiles vendor_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_profiles
    ADD CONSTRAINT vendor_profiles_pkey PRIMARY KEY (id);


--
-- Name: vendor_route_opportunities vendor_route_opportunities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_route_opportunities
    ADD CONSTRAINT vendor_route_opportunities_pkey PRIMARY KEY (id);


--
-- Name: vendor_route_opportunities vendor_route_opportunities_route_id_vendor_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_route_opportunities
    ADD CONSTRAINT vendor_route_opportunities_route_id_vendor_id_key UNIQUE (route_id, vendor_id);


--
-- Name: vendor_shipment_requests vendor_shipment_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_shipment_requests
    ADD CONSTRAINT vendor_shipment_requests_pkey PRIMARY KEY (id);


--
-- Name: cargo_manifest_lot_label_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX cargo_manifest_lot_label_unique ON public.cargo_manifest USING btree (parent_manifest_id, lot_label) WHERE (parent_manifest_id IS NOT NULL);


--
-- Name: cargo_manifest_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cargo_manifest_status_idx ON public.cargo_manifest USING btree (status);


--
-- Name: cargo_manifest_vehicle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cargo_manifest_vehicle_idx ON public.cargo_manifest USING btree (vehicle_id);


--
-- Name: driver_pay_entries_manifest_vehicle_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX driver_pay_entries_manifest_vehicle_unique ON public.driver_pay_entries USING btree (manifest_id, vehicle_id) WHERE (manifest_id IS NOT NULL);


--
-- Name: driver_pay_entries_route_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX driver_pay_entries_route_unique ON public.driver_pay_entries USING btree (route_id) WHERE (route_id IS NOT NULL);


--
-- Name: driver_pay_rates_type_from_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX driver_pay_rates_type_from_unique ON public.driver_pay_rates USING btree (vehicle_type, effective_from) WHERE active;


--
-- Name: driver_vehicle_assignments_driver_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX driver_vehicle_assignments_driver_idx ON public.driver_vehicle_assignments USING btree (driver_id);


--
-- Name: driver_vehicle_assignments_vehicle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX driver_vehicle_assignments_vehicle_idx ON public.driver_vehicle_assignments USING btree (vehicle_id);


--
-- Name: idx_ai_logs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_logs_created ON public.ai_agent_logs USING btree (created_at DESC);


--
-- Name: idx_capacity_windows_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_capacity_windows_open ON public.capacity_windows USING btree (closes_at) WHERE (status = 'open'::text);


--
-- Name: idx_cargo_claims_manifest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cargo_claims_manifest ON public.cargo_claims USING btree (manifest_id) WHERE (manifest_id IS NOT NULL);


--
-- Name: idx_cargo_claims_raised_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cargo_claims_raised_by ON public.cargo_claims USING btree (raised_by) WHERE (raised_by IS NOT NULL);


--
-- Name: idx_cargo_claims_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cargo_claims_shipment ON public.cargo_claims USING btree (shipment_id) WHERE (shipment_id IS NOT NULL);


--
-- Name: idx_cargo_claims_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cargo_claims_status ON public.cargo_claims USING btree (status, created_at);


--
-- Name: idx_cargo_custody_events_exception; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cargo_custody_events_exception ON public.cargo_custody_events USING btree (exception_id) WHERE (exception_id IS NOT NULL);


--
-- Name: idx_cargo_custody_events_manifest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cargo_custody_events_manifest ON public.cargo_custody_events USING btree (manifest_id, recorded_at) WHERE (manifest_id IS NOT NULL);


--
-- Name: idx_cargo_custody_events_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cargo_custody_events_shipment ON public.cargo_custody_events USING btree (shipment_id, recorded_at) WHERE (shipment_id IS NOT NULL);


--
-- Name: idx_cargo_custody_events_transfer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cargo_custody_events_transfer ON public.cargo_custody_events USING btree (transfer_id) WHERE (transfer_id IS NOT NULL);


--
-- Name: idx_cargo_exception_items_exception; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cargo_exception_items_exception ON public.cargo_exception_items USING btree (exception_id);


--
-- Name: idx_cargo_exception_items_manifest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cargo_exception_items_manifest ON public.cargo_exception_items USING btree (manifest_id) WHERE (manifest_id IS NOT NULL);


--
-- Name: idx_cargo_exception_items_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cargo_exception_items_shipment ON public.cargo_exception_items USING btree (shipment_id) WHERE (shipment_id IS NOT NULL);


--
-- Name: idx_cargo_exceptions_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cargo_exceptions_job ON public.cargo_exceptions USING btree (maintenance_job_id) WHERE (maintenance_job_id IS NOT NULL);


--
-- Name: idx_cargo_exceptions_sos; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cargo_exceptions_sos ON public.cargo_exceptions USING btree (sos_alert_id) WHERE (sos_alert_id IS NOT NULL);


--
-- Name: idx_cargo_exceptions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cargo_exceptions_status ON public.cargo_exceptions USING btree (status, sla_due_at);


--
-- Name: idx_cargo_exceptions_vehicle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cargo_exceptions_vehicle ON public.cargo_exceptions USING btree (vehicle_id) WHERE (vehicle_id IS NOT NULL);


--
-- Name: idx_cargo_manifest_current_depot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cargo_manifest_current_depot ON public.cargo_manifest USING btree (current_depot_id) WHERE (current_depot_id IS NOT NULL);


--
-- Name: idx_cargo_manifest_current_vehicle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cargo_manifest_current_vehicle ON public.cargo_manifest USING btree (current_vehicle_id) WHERE (current_vehicle_id IS NOT NULL);


--
-- Name: idx_cargo_manifest_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cargo_manifest_parent ON public.cargo_manifest USING btree (parent_manifest_id) WHERE (parent_manifest_id IS NOT NULL);


--
-- Name: idx_cargo_manifest_vehicle_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cargo_manifest_vehicle_status ON public.cargo_manifest USING btree (vehicle_id, status);


--
-- Name: idx_cargo_transfer_items_manifest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cargo_transfer_items_manifest ON public.cargo_transfer_items USING btree (manifest_id) WHERE (manifest_id IS NOT NULL);


--
-- Name: idx_cargo_transfer_items_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cargo_transfer_items_shipment ON public.cargo_transfer_items USING btree (shipment_id) WHERE (shipment_id IS NOT NULL);


--
-- Name: idx_cargo_transfer_items_transfer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cargo_transfer_items_transfer ON public.cargo_transfer_items USING btree (transfer_id);


--
-- Name: idx_cargo_transfers_exception; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cargo_transfers_exception ON public.cargo_transfers USING btree (exception_id) WHERE (exception_id IS NOT NULL);


--
-- Name: idx_cargo_transfers_from; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cargo_transfers_from ON public.cargo_transfers USING btree (from_vehicle_id);


--
-- Name: idx_cargo_transfers_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cargo_transfers_status ON public.cargo_transfers USING btree (status, planned_at);


--
-- Name: idx_cargo_transfers_to; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cargo_transfers_to ON public.cargo_transfers USING btree (to_vehicle_id) WHERE (to_vehicle_id IS NOT NULL);


--
-- Name: idx_customer_bookings_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_bookings_customer ON public.customer_bookings USING btree (customer_id, created_at DESC);


--
-- Name: idx_customer_bookings_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_bookings_shipment ON public.customer_bookings USING btree (shipment_id);


--
-- Name: idx_customer_bookings_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_bookings_status ON public.customer_bookings USING btree (status, pickup_date);


--
-- Name: idx_delivery_points_lot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_delivery_points_lot ON public.delivery_points USING btree (lot_shipment_id) WHERE (lot_shipment_id IS NOT NULL);


--
-- Name: idx_driver_pay_entries_driver; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_driver_pay_entries_driver ON public.driver_pay_entries USING btree (driver_id, trip_date DESC);


--
-- Name: idx_driver_pay_entries_payout; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_driver_pay_entries_payout ON public.driver_pay_entries USING btree (payout_id) WHERE (payout_id IS NOT NULL);


--
-- Name: idx_driver_pay_entries_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_driver_pay_entries_status ON public.driver_pay_entries USING btree (status, trip_date DESC);


--
-- Name: idx_driver_pay_rates_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_driver_pay_rates_type ON public.driver_pay_rates USING btree (vehicle_type, effective_from DESC);


--
-- Name: idx_driver_payouts_driver; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_driver_payouts_driver ON public.driver_payouts USING btree (driver_id, paid_at DESC);


--
-- Name: idx_expenses_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_date ON public.expenses USING btree (expense_date DESC);


--
-- Name: idx_expenses_route; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_route ON public.expenses USING btree (route_id);


--
-- Name: idx_expenses_vehicle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_vehicle ON public.expenses USING btree (vehicle_id);


--
-- Name: idx_gps_points_recorded_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gps_points_recorded_at ON public.gps_points USING btree (recorded_at);


--
-- Name: idx_gps_points_vehicle_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gps_points_vehicle_time ON public.gps_points USING btree (vehicle_id, recorded_at DESC);


--
-- Name: idx_hsn_codes_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hsn_codes_category ON public.hsn_codes USING btree (category);


--
-- Name: idx_hsn_codes_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_hsn_codes_code ON public.hsn_codes USING btree (hsn_code);


--
-- Name: idx_hsn_codes_description; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hsn_codes_description ON public.hsn_codes USING gin (to_tsvector('english'::regconfig, description));


--
-- Name: idx_hsn_codes_keywords; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hsn_codes_keywords ON public.hsn_codes USING gin (keywords);


--
-- Name: idx_idempotency_keys_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_idempotency_keys_created ON public.idempotency_keys USING btree (created_at);


--
-- Name: idx_invoices_due_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_due_date ON public.invoices USING btree (due_date) WHERE ((status)::text = 'issued'::text);


--
-- Name: idx_invoices_issued_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_issued_at ON public.invoices USING btree (issued_at DESC);


--
-- Name: idx_invoices_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_shipment ON public.invoices USING btree (shipment_id);


--
-- Name: idx_invoices_vendor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_vendor ON public.invoices USING btree (vendor_id);


--
-- Name: idx_maintenance_alerts_vehicle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_maintenance_alerts_vehicle ON public.maintenance_alerts USING btree (vehicle_id, created_at DESC);


--
-- Name: idx_messages_route; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_route ON public.messages USING btree (route_id, created_at);


--
-- Name: idx_messages_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_shipment ON public.messages USING btree (shipment_id, created_at);


--
-- Name: idx_messages_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_unread ON public.messages USING btree (sender_role, created_at) WHERE (read_at IS NULL);


--
-- Name: idx_parcel_scans_driver; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parcel_scans_driver ON public.parcel_scans USING btree (driver_id, created_at DESC);


--
-- Name: idx_parcel_scans_manifest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parcel_scans_manifest ON public.parcel_scans USING btree (manifest_id, purpose);


--
-- Name: idx_parcel_scans_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_parcel_scans_shipment ON public.parcel_scans USING btree (shipment_id, purpose);


--
-- Name: idx_payments_invoice; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_invoice ON public.payments USING btree (invoice_id);


--
-- Name: idx_route_stops_completed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_route_stops_completed ON public.route_stops USING btree (route_id) WHERE (actual_arrival_at IS NOT NULL);


--
-- Name: idx_route_stops_route; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_route_stops_route ON public.route_stops USING btree (route_id, sequence);


--
-- Name: idx_routes_vehicle_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_routes_vehicle_created ON public.routes USING btree (vehicle_id, created_at DESC);


--
-- Name: idx_routes_vehicle_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_routes_vehicle_status ON public.routes USING btree (vehicle_id, status);


--
-- Name: idx_shipment_hsn_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipment_hsn_code ON public.shipment_hsn USING btree (hsn_code);


--
-- Name: idx_shipment_hsn_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipment_hsn_shipment ON public.shipment_hsn USING btree (shipment_id);


--
-- Name: idx_shipment_logs_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipment_logs_shipment ON public.shipment_logs USING btree (shipment_id, index);


--
-- Name: idx_shipments_current_depot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipments_current_depot ON public.shipments USING btree (current_depot_id) WHERE (current_depot_id IS NOT NULL);


--
-- Name: idx_shipments_current_vehicle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipments_current_vehicle ON public.shipments USING btree (current_vehicle_id) WHERE (current_vehicle_id IS NOT NULL);


--
-- Name: idx_shipments_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipments_parent ON public.shipments USING btree (parent_shipment_id) WHERE (parent_shipment_id IS NOT NULL);


--
-- Name: idx_shipments_rated_vehicle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipments_rated_vehicle ON public.shipments USING btree (rated_vehicle_id) WHERE (driver_rating IS NOT NULL);


--
-- Name: idx_spark_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spark_id ON public.vehicles USING btree (spark_id);


--
-- Name: idx_stoppages_vehicle_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stoppages_vehicle_time ON public.vehicle_stoppages USING btree (vehicle_id, start_time DESC);


--
-- Name: idx_telemetry_vehicle_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_telemetry_vehicle_time ON public.telemetry USING btree (vehicle_id, "timestamp" DESC);


--
-- Name: idx_tracking_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tracking_id ON public.shipments USING btree (tracking_id);


--
-- Name: idx_user_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_email ON public.users USING btree (email);


--
-- Name: idx_users_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_phone ON public.users USING btree (phone) WHERE (phone IS NOT NULL);


--
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


--
-- Name: idx_vehicle_fuel_logs_filled_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicle_fuel_logs_filled_at ON public.vehicle_fuel_logs USING btree (filled_at DESC);


--
-- Name: idx_vehicle_fuel_logs_no_bill; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicle_fuel_logs_no_bill ON public.vehicle_fuel_logs USING btree (bill_status) WHERE (bill_status = 'no_bill'::text);


--
-- Name: idx_vehicle_fuel_logs_vehicle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicle_fuel_logs_vehicle ON public.vehicle_fuel_logs USING btree (vehicle_id, filled_at DESC);


--
-- Name: idx_vehicle_maintenance_jobs_vehicle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicle_maintenance_jobs_vehicle ON public.vehicle_maintenance_jobs USING btree (vehicle_id, opened_at DESC);


--
-- Name: idx_vehicle_odometer_events_vehicle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicle_odometer_events_vehicle ON public.vehicle_odometer_events USING btree (vehicle_id, created_at DESC);


--
-- Name: idx_vehicle_photos_vehicle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicle_photos_vehicle ON public.vehicle_photos USING btree (vehicle_id);


--
-- Name: idx_vehicle_service_attachments_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicle_service_attachments_job ON public.vehicle_service_attachments USING btree (job_id);


--
-- Name: idx_vehicle_service_attachments_log; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicle_service_attachments_log ON public.vehicle_service_attachments USING btree (service_log_id);


--
-- Name: idx_vehicle_service_items_log; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicle_service_items_log ON public.vehicle_service_items USING btree (service_log_id);


--
-- Name: idx_vehicle_service_log_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicle_service_log_job ON public.vehicle_service_log USING btree (job_id);


--
-- Name: idx_vehicle_service_log_vehicle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicle_service_log_vehicle ON public.vehicle_service_log USING btree (vehicle_id, done_at DESC);


--
-- Name: idx_vehicle_service_plans_vehicle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicle_service_plans_vehicle ON public.vehicle_service_plans USING btree (vehicle_id);


--
-- Name: idx_vehicle_share_links_vehicle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicle_share_links_vehicle ON public.vehicle_share_links USING btree (vehicle_id, created_at DESC);


--
-- Name: idx_vehicles_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicles_status ON public.vehicles USING btree (status);


--
-- Name: idx_vehicles_submitted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicles_submitted_at ON public.vehicles USING btree (submitted_at DESC) WHERE (submitted_at IS NOT NULL);


--
-- Name: idx_vehicles_submitted_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vehicles_submitted_by ON public.vehicles USING btree (submitted_by) WHERE (submitted_by IS NOT NULL);


--
-- Name: invoices_one_per_manifest; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX invoices_one_per_manifest ON public.invoices USING btree (manifest_id) WHERE ((manifest_id IS NOT NULL) AND ((status)::text <> 'void'::text));


--
-- Name: invoices_one_per_request; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX invoices_one_per_request ON public.invoices USING btree (vendor_request_id) WHERE ((vendor_request_id IS NOT NULL) AND ((status)::text <> 'void'::text));


--
-- Name: invoices_one_per_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX invoices_one_per_shipment ON public.invoices USING btree (shipment_id) WHERE ((shipment_id IS NOT NULL) AND ((status)::text <> 'void'::text));


--
-- Name: price_quotes_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX price_quotes_created_at_idx ON public.price_quotes USING btree (created_at DESC);


--
-- Name: price_quotes_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX price_quotes_user_idx ON public.price_quotes USING btree (user_id);


--
-- Name: shipments_lot_label_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX shipments_lot_label_unique ON public.shipments USING btree (parent_shipment_id, lot_label) WHERE (parent_shipment_id IS NOT NULL);


--
-- Name: sos_alerts_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sos_alerts_open_idx ON public.sos_alerts USING btree (created_at) WHERE (status = ANY (ARRAY['active'::text, 'acknowledged'::text]));


--
-- Name: sos_alerts_vehicle_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sos_alerts_vehicle_created_idx ON public.sos_alerts USING btree (vehicle_id, created_at DESC);


--
-- Name: tpl_offers_open_request_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tpl_offers_open_request_idx ON public.tpl_offers USING btree (partner_id, request_id) WHERE ((status = 'offered'::text) AND (request_id IS NOT NULL));


--
-- Name: tpl_offers_open_shipment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tpl_offers_open_shipment_idx ON public.tpl_offers USING btree (partner_id, shipment_id) WHERE ((status = 'offered'::text) AND (shipment_id IS NOT NULL));


--
-- Name: tpl_offers_partner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tpl_offers_partner_idx ON public.tpl_offers USING btree (partner_id, status);


--
-- Name: tpl_offers_request_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tpl_offers_request_idx ON public.tpl_offers USING btree (request_id);


--
-- Name: tpl_offers_shipment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tpl_offers_shipment_idx ON public.tpl_offers USING btree (shipment_id);


--
-- Name: tpl_orders_live_request_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tpl_orders_live_request_idx ON public.tpl_orders USING btree (request_id) WHERE ((status <> 'cancelled'::text) AND (request_id IS NOT NULL));


--
-- Name: tpl_orders_live_shipment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tpl_orders_live_shipment_idx ON public.tpl_orders USING btree (shipment_id) WHERE ((status <> 'cancelled'::text) AND (shipment_id IS NOT NULL));


--
-- Name: tpl_orders_partner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tpl_orders_partner_idx ON public.tpl_orders USING btree (partner_id, status);


--
-- Name: tpl_partners_custom_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tpl_partners_custom_id_key ON public.tpl_partners USING btree (custom_id) WHERE (custom_id IS NOT NULL);


--
-- Name: traffic_incidents_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX traffic_incidents_active_idx ON public.traffic_incidents USING btree (active, last_seen_at DESC);


--
-- Name: traffic_incidents_active_pos_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX traffic_incidents_active_pos_idx ON public.traffic_incidents USING btree (lat, lng) WHERE active;


--
-- Name: uniq_open_maintenance_alert; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_open_maintenance_alert ON public.maintenance_alerts USING btree (vehicle_id, alert_type, is_test) WHERE (is_resolved = false);


--
-- Name: uniq_vehicle_maintenance_open_job; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_vehicle_maintenance_open_job ON public.vehicle_maintenance_jobs USING btree (vehicle_id) WHERE (status = 'open'::public.maintenance_job_status);


--
-- Name: user_activity_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_activity_user_idx ON public.user_activity USING btree (user_id, created_at DESC);


--
-- Name: user_bank_accounts_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_bank_accounts_user_idx ON public.user_bank_accounts USING btree (user_id);


--
-- Name: user_documents_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_documents_expiry_idx ON public.user_documents USING btree (expires_on) WHERE (archived_at IS NULL);


--
-- Name: user_documents_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_documents_hash_idx ON public.user_documents USING btree (doc_type, number_hash) WHERE (number_hash IS NOT NULL);


--
-- Name: user_documents_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_documents_user_idx ON public.user_documents USING btree (user_id);


--
-- Name: user_emergency_contacts_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_emergency_contacts_user_idx ON public.user_emergency_contacts USING btree (user_id);


--
-- Name: user_notes_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_notes_user_idx ON public.user_notes USING btree (user_id, created_at DESC);


--
-- Name: user_phone_history_phone_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_phone_history_phone_idx ON public.user_phone_history USING btree (phone);


--
-- Name: user_phone_history_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_phone_history_user_idx ON public.user_phone_history USING btree (user_id);


--
-- Name: user_status_history_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_status_history_user_idx ON public.user_status_history USING btree (user_id, created_at DESC);


--
-- Name: vehicles_one_live_vehicle_per_driver; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX vehicles_one_live_vehicle_per_driver ON public.vehicles USING btree (driver_id) WHERE ((driver_id IS NOT NULL) AND (status <> 'archived'::public.vehicle_status));


--
-- Name: driver_confirmations driver_confirmations_client_update_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER driver_confirmations_client_update_guard BEFORE UPDATE ON public.driver_confirmations FOR EACH ROW EXECUTE FUNCTION public.restrict_client_update_columns('action', 'responded_at');


--
-- Name: customers handle_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime('updated_at');


--
-- Name: tpl_documents tpl_documents_client_update_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tpl_documents_client_update_guard BEFORE UPDATE ON public.tpl_documents FOR EACH ROW EXECUTE FUNCTION public.restrict_client_update_columns('file_url', 'uploaded_at');


--
-- Name: tpl_partners tpl_partners_client_update_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tpl_partners_client_update_guard BEFORE UPDATE ON public.tpl_partners FOR EACH ROW EXECUTE FUNCTION public.guard_tpl_partner_update();


--
-- Name: vehicles track_driver_vehicle_assignment; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER track_driver_vehicle_assignment AFTER INSERT OR UPDATE OF driver_id ON public.vehicles FOR EACH ROW EXECUTE FUNCTION public.track_driver_vehicle_assignment();


--
-- Name: hsn_codes trg_hsn_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_hsn_updated_at BEFORE UPDATE ON public.hsn_codes FOR EACH ROW EXECUTE FUNCTION public.update_hsn_updated_at();


--
-- Name: tpl_partners update_tpl_partners_modtime; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_tpl_partners_modtime BEFORE UPDATE ON public.tpl_partners FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();


--
-- Name: vehicles vehicles_client_update_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER vehicles_client_update_guard BEFORE UPDATE ON public.vehicles FOR EACH ROW EXECUTE FUNCTION public.restrict_client_update_columns('latitude', 'longitude', 'last_heartbeat', 'status');


--
-- Name: vehicles vehicles_driver_status_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER vehicles_driver_status_guard BEFORE UPDATE ON public.vehicles FOR EACH ROW EXECUTE FUNCTION public.vehicles_driver_status_guard();


--
-- Name: vendor_profiles vendor_profiles_client_update_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER vendor_profiles_client_update_guard BEFORE UPDATE ON public.vendor_profiles FOR EACH ROW EXECUTE FUNCTION public.guard_vendor_profile_update();


--
-- Name: capacity_bids capacity_bids_dropoff_point_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capacity_bids
    ADD CONSTRAINT capacity_bids_dropoff_point_id_fkey FOREIGN KEY (dropoff_point_id) REFERENCES public.delivery_points(id);


--
-- Name: capacity_bids capacity_bids_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capacity_bids
    ADD CONSTRAINT capacity_bids_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendor_profiles(id) ON DELETE CASCADE;


--
-- Name: capacity_bids capacity_bids_window_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capacity_bids
    ADD CONSTRAINT capacity_bids_window_id_fkey FOREIGN KEY (window_id) REFERENCES public.capacity_windows(id);


--
-- Name: capacity_windows capacity_windows_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capacity_windows
    ADD CONSTRAINT capacity_windows_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: capacity_windows capacity_windows_fallback_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capacity_windows
    ADD CONSTRAINT capacity_windows_fallback_shipment_id_fkey FOREIGN KEY (fallback_shipment_id) REFERENCES public.shipments(id) ON DELETE SET NULL;


--
-- Name: capacity_windows capacity_windows_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capacity_windows
    ADD CONSTRAINT capacity_windows_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id);


--
-- Name: cargo_claims cargo_claims_exception_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_claims
    ADD CONSTRAINT cargo_claims_exception_id_fkey FOREIGN KEY (exception_id) REFERENCES public.cargo_exceptions(id) ON DELETE SET NULL;


--
-- Name: cargo_claims cargo_claims_manifest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_claims
    ADD CONSTRAINT cargo_claims_manifest_id_fkey FOREIGN KEY (manifest_id) REFERENCES public.cargo_manifest(id) ON DELETE CASCADE;


--
-- Name: cargo_claims cargo_claims_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_claims
    ADD CONSTRAINT cargo_claims_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE CASCADE;


--
-- Name: cargo_custody_events cargo_custody_events_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_custody_events
    ADD CONSTRAINT cargo_custody_events_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: cargo_custody_events cargo_custody_events_exception_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_custody_events
    ADD CONSTRAINT cargo_custody_events_exception_id_fkey FOREIGN KEY (exception_id) REFERENCES public.cargo_exceptions(id) ON DELETE SET NULL;


--
-- Name: cargo_custody_events cargo_custody_events_from_depot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_custody_events
    ADD CONSTRAINT cargo_custody_events_from_depot_id_fkey FOREIGN KEY (from_depot_id) REFERENCES public.depots(id) ON DELETE SET NULL;


--
-- Name: cargo_custody_events cargo_custody_events_from_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_custody_events
    ADD CONSTRAINT cargo_custody_events_from_vehicle_id_fkey FOREIGN KEY (from_vehicle_id) REFERENCES public.vehicles(id) ON DELETE SET NULL;


--
-- Name: cargo_custody_events cargo_custody_events_manifest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_custody_events
    ADD CONSTRAINT cargo_custody_events_manifest_id_fkey FOREIGN KEY (manifest_id) REFERENCES public.cargo_manifest(id) ON DELETE CASCADE;


--
-- Name: cargo_custody_events cargo_custody_events_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_custody_events
    ADD CONSTRAINT cargo_custody_events_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: cargo_custody_events cargo_custody_events_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_custody_events
    ADD CONSTRAINT cargo_custody_events_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE CASCADE;


--
-- Name: cargo_custody_events cargo_custody_events_to_depot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_custody_events
    ADD CONSTRAINT cargo_custody_events_to_depot_id_fkey FOREIGN KEY (to_depot_id) REFERENCES public.depots(id) ON DELETE SET NULL;


--
-- Name: cargo_custody_events cargo_custody_events_to_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_custody_events
    ADD CONSTRAINT cargo_custody_events_to_vehicle_id_fkey FOREIGN KEY (to_vehicle_id) REFERENCES public.vehicles(id) ON DELETE SET NULL;


--
-- Name: cargo_custody_events cargo_custody_events_transfer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_custody_events
    ADD CONSTRAINT cargo_custody_events_transfer_id_fkey FOREIGN KEY (transfer_id) REFERENCES public.cargo_transfers(id) ON DELETE SET NULL;


--
-- Name: cargo_exception_items cargo_exception_items_exception_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_exception_items
    ADD CONSTRAINT cargo_exception_items_exception_id_fkey FOREIGN KEY (exception_id) REFERENCES public.cargo_exceptions(id) ON DELETE CASCADE;


--
-- Name: cargo_exception_items cargo_exception_items_manifest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_exception_items
    ADD CONSTRAINT cargo_exception_items_manifest_id_fkey FOREIGN KEY (manifest_id) REFERENCES public.cargo_manifest(id) ON DELETE CASCADE;


--
-- Name: cargo_exception_items cargo_exception_items_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_exception_items
    ADD CONSTRAINT cargo_exception_items_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE CASCADE;


--
-- Name: cargo_exceptions cargo_exceptions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_exceptions
    ADD CONSTRAINT cargo_exceptions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: cargo_exceptions cargo_exceptions_maintenance_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_exceptions
    ADD CONSTRAINT cargo_exceptions_maintenance_job_id_fkey FOREIGN KEY (maintenance_job_id) REFERENCES public.vehicle_maintenance_jobs(id) ON DELETE SET NULL;


--
-- Name: cargo_exceptions cargo_exceptions_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_exceptions
    ADD CONSTRAINT cargo_exceptions_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: cargo_exceptions cargo_exceptions_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_exceptions
    ADD CONSTRAINT cargo_exceptions_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: cargo_exceptions cargo_exceptions_route_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_exceptions
    ADD CONSTRAINT cargo_exceptions_route_id_fkey FOREIGN KEY (route_id) REFERENCES public.routes(id) ON DELETE SET NULL;


--
-- Name: cargo_exceptions cargo_exceptions_sos_alert_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_exceptions
    ADD CONSTRAINT cargo_exceptions_sos_alert_id_fkey FOREIGN KEY (sos_alert_id) REFERENCES public.sos_alerts(id) ON DELETE SET NULL;


--
-- Name: cargo_exceptions cargo_exceptions_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_exceptions
    ADD CONSTRAINT cargo_exceptions_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE SET NULL;


--
-- Name: cargo_manifest cargo_manifest_current_depot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_manifest
    ADD CONSTRAINT cargo_manifest_current_depot_id_fkey FOREIGN KEY (current_depot_id) REFERENCES public.depots(id) ON DELETE SET NULL;


--
-- Name: cargo_manifest cargo_manifest_parent_manifest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_manifest
    ADD CONSTRAINT cargo_manifest_parent_manifest_id_fkey FOREIGN KEY (parent_manifest_id) REFERENCES public.cargo_manifest(id) ON DELETE CASCADE;


--
-- Name: cargo_manifest cargo_manifest_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_manifest
    ADD CONSTRAINT cargo_manifest_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE SET NULL;


--
-- Name: cargo_manifest cargo_manifest_vendor_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_manifest
    ADD CONSTRAINT cargo_manifest_vendor_request_id_fkey FOREIGN KEY (vendor_request_id) REFERENCES public.vendor_shipment_requests(id) ON DELETE CASCADE;


--
-- Name: cargo_transfer_items cargo_transfer_items_manifest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_transfer_items
    ADD CONSTRAINT cargo_transfer_items_manifest_id_fkey FOREIGN KEY (manifest_id) REFERENCES public.cargo_manifest(id) ON DELETE CASCADE;


--
-- Name: cargo_transfer_items cargo_transfer_items_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_transfer_items
    ADD CONSTRAINT cargo_transfer_items_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE CASCADE;


--
-- Name: cargo_transfer_items cargo_transfer_items_transfer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_transfer_items
    ADD CONSTRAINT cargo_transfer_items_transfer_id_fkey FOREIGN KEY (transfer_id) REFERENCES public.cargo_transfers(id) ON DELETE CASCADE;


--
-- Name: cargo_transfers cargo_transfers_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_transfers
    ADD CONSTRAINT cargo_transfers_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: cargo_transfers cargo_transfers_exception_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_transfers
    ADD CONSTRAINT cargo_transfers_exception_id_fkey FOREIGN KEY (exception_id) REFERENCES public.cargo_exceptions(id) ON DELETE SET NULL;


--
-- Name: cargo_transfers cargo_transfers_from_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_transfers
    ADD CONSTRAINT cargo_transfers_from_vehicle_id_fkey FOREIGN KEY (from_vehicle_id) REFERENCES public.vehicles(id) ON DELETE RESTRICT;


--
-- Name: cargo_transfers cargo_transfers_new_route_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_transfers
    ADD CONSTRAINT cargo_transfers_new_route_id_fkey FOREIGN KEY (new_route_id) REFERENCES public.routes(id) ON DELETE SET NULL;


--
-- Name: cargo_transfers cargo_transfers_to_depot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_transfers
    ADD CONSTRAINT cargo_transfers_to_depot_id_fkey FOREIGN KEY (to_depot_id) REFERENCES public.depots(id) ON DELETE RESTRICT;


--
-- Name: cargo_transfers cargo_transfers_to_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cargo_transfers
    ADD CONSTRAINT cargo_transfers_to_vehicle_id_fkey FOREIGN KEY (to_vehicle_id) REFERENCES public.vehicles(id) ON DELETE RESTRICT;


--
-- Name: customer_bookings customer_bookings_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_bookings
    ADD CONSTRAINT customer_bookings_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: customer_bookings customer_bookings_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_bookings
    ADD CONSTRAINT customer_bookings_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE SET NULL;


--
-- Name: customer_bookings customer_bookings_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_bookings
    ADD CONSTRAINT customer_bookings_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE SET NULL;


--
-- Name: customers customers_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: delivery_points delivery_points_lot_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_points
    ADD CONSTRAINT delivery_points_lot_shipment_id_fkey FOREIGN KEY (lot_shipment_id) REFERENCES public.shipments(id) ON DELETE SET NULL;


--
-- Name: delivery_points delivery_points_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_points
    ADD CONSTRAINT delivery_points_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.shipments(id);


--
-- Name: driver_confirmations driver_confirmations_route_stop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_confirmations
    ADD CONSTRAINT driver_confirmations_route_stop_id_fkey FOREIGN KEY (route_stop_id) REFERENCES public.route_stops(id);


--
-- Name: driver_confirmations driver_confirmations_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_confirmations
    ADD CONSTRAINT driver_confirmations_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id);


--
-- Name: driver_pay_entries driver_pay_entries_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_pay_entries
    ADD CONSTRAINT driver_pay_entries_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: driver_pay_entries driver_pay_entries_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_pay_entries
    ADD CONSTRAINT driver_pay_entries_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: driver_pay_entries driver_pay_entries_manifest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_pay_entries
    ADD CONSTRAINT driver_pay_entries_manifest_id_fkey FOREIGN KEY (manifest_id) REFERENCES public.cargo_manifest(id) ON DELETE SET NULL;


--
-- Name: driver_pay_entries driver_pay_entries_payout_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_pay_entries
    ADD CONSTRAINT driver_pay_entries_payout_id_fkey FOREIGN KEY (payout_id) REFERENCES public.driver_payouts(id) ON DELETE SET NULL;


--
-- Name: driver_pay_entries driver_pay_entries_rate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_pay_entries
    ADD CONSTRAINT driver_pay_entries_rate_id_fkey FOREIGN KEY (rate_id) REFERENCES public.driver_pay_rates(id) ON DELETE SET NULL;


--
-- Name: driver_pay_entries driver_pay_entries_route_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_pay_entries
    ADD CONSTRAINT driver_pay_entries_route_id_fkey FOREIGN KEY (route_id) REFERENCES public.routes(id) ON DELETE SET NULL;


--
-- Name: driver_pay_entries driver_pay_entries_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_pay_entries
    ADD CONSTRAINT driver_pay_entries_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE SET NULL;


--
-- Name: driver_pay_entries driver_pay_entries_voided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_pay_entries
    ADD CONSTRAINT driver_pay_entries_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: driver_pay_rates driver_pay_rates_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_pay_rates
    ADD CONSTRAINT driver_pay_rates_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: driver_payouts driver_payouts_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_payouts
    ADD CONSTRAINT driver_payouts_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: driver_payouts driver_payouts_paid_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_payouts
    ADD CONSTRAINT driver_payouts_paid_by_fkey FOREIGN KEY (paid_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: driver_vehicle_assignments driver_vehicle_assignments_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_vehicle_assignments
    ADD CONSTRAINT driver_vehicle_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: driver_vehicle_assignments driver_vehicle_assignments_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_vehicle_assignments
    ADD CONSTRAINT driver_vehicle_assignments_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: driver_vehicle_assignments driver_vehicle_assignments_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.driver_vehicle_assignments
    ADD CONSTRAINT driver_vehicle_assignments_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: expenses expenses_route_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_route_id_fkey FOREIGN KEY (route_id) REFERENCES public.routes(id) ON DELETE SET NULL;


--
-- Name: expenses expenses_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE SET NULL;


--
-- Name: capacity_windows fk_winning_bid; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.capacity_windows
    ADD CONSTRAINT fk_winning_bid FOREIGN KEY (winning_bid_id) REFERENCES public.capacity_bids(id);


--
-- Name: gps_points gps_points_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gps_points
    ADD CONSTRAINT gps_points_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: invoices invoices_manifest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_manifest_id_fkey FOREIGN KEY (manifest_id) REFERENCES public.cargo_manifest(id) ON DELETE SET NULL;


--
-- Name: invoices invoices_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE CASCADE;


--
-- Name: invoices invoices_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendor_profiles(id) ON DELETE SET NULL;


--
-- Name: invoices invoices_vendor_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_vendor_request_id_fkey FOREIGN KEY (vendor_request_id) REFERENCES public.vendor_shipment_requests(id) ON DELETE SET NULL;


--
-- Name: kyc_profiles kyc_profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kyc_profiles
    ADD CONSTRAINT kyc_profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: maintenance_alerts maintenance_alerts_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_alerts
    ADD CONSTRAINT maintenance_alerts_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id);


--
-- Name: messages messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: messages messages_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: parcel_scans parcel_scans_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parcel_scans
    ADD CONSTRAINT parcel_scans_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: parcel_scans parcel_scans_manifest_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parcel_scans
    ADD CONSTRAINT parcel_scans_manifest_id_fkey FOREIGN KEY (manifest_id) REFERENCES public.cargo_manifest(id) ON DELETE CASCADE;


--
-- Name: parcel_scans parcel_scans_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parcel_scans
    ADD CONSTRAINT parcel_scans_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE CASCADE;


--
-- Name: parcels parcels_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parcels
    ADD CONSTRAINT parcels_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.shipments(id);


--
-- Name: payments payments_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: route_stops route_stops_delivery_point_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_stops
    ADD CONSTRAINT route_stops_delivery_point_id_fkey FOREIGN KEY (delivery_point_id) REFERENCES public.delivery_points(id);


--
-- Name: route_stops route_stops_route_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.route_stops
    ADD CONSTRAINT route_stops_route_id_fkey FOREIGN KEY (route_id) REFERENCES public.routes(id);


--
-- Name: routes routes_depot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routes
    ADD CONSTRAINT routes_depot_id_fkey FOREIGN KEY (depot_id) REFERENCES public.depots(id);


--
-- Name: routes routes_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routes
    ADD CONSTRAINT routes_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id);


--
-- Name: shipment_hsn shipment_hsn_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_hsn
    ADD CONSTRAINT shipment_hsn_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE CASCADE;


--
-- Name: shipment_logs shipment_logs_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_logs
    ADD CONSTRAINT shipment_logs_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.shipments(id);


--
-- Name: shipments shipments_bid_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_bid_id_fkey FOREIGN KEY (bid_id) REFERENCES public.capacity_bids(id);


--
-- Name: shipments shipments_current_depot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_current_depot_id_fkey FOREIGN KEY (current_depot_id) REFERENCES public.depots(id) ON DELETE SET NULL;


--
-- Name: shipments shipments_current_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_current_vehicle_id_fkey FOREIGN KEY (current_vehicle_id) REFERENCES public.vehicles(id) ON DELETE SET NULL;


--
-- Name: shipments shipments_driver_rated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_driver_rated_by_fkey FOREIGN KEY (driver_rated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: shipments shipments_parent_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_parent_shipment_id_fkey FOREIGN KEY (parent_shipment_id) REFERENCES public.shipments(id) ON DELETE CASCADE;


--
-- Name: shipments shipments_rated_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_rated_driver_id_fkey FOREIGN KEY (rated_driver_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: shipments shipments_rated_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_rated_vehicle_id_fkey FOREIGN KEY (rated_vehicle_id) REFERENCES public.vehicles(id) ON DELETE SET NULL;


--
-- Name: sos_alerts sos_alerts_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sos_alerts
    ADD CONSTRAINT sos_alerts_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES auth.users(id);


--
-- Name: sos_alerts sos_alerts_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sos_alerts
    ADD CONSTRAINT sos_alerts_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id);


--
-- Name: telemetry telemetry_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.telemetry
    ADD CONSTRAINT telemetry_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id);


--
-- Name: tpl_corridors tpl_corridors_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tpl_corridors
    ADD CONSTRAINT tpl_corridors_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.tpl_partners(id) ON DELETE CASCADE;


--
-- Name: tpl_documents tpl_documents_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tpl_documents
    ADD CONSTRAINT tpl_documents_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.tpl_partners(id) ON DELETE CASCADE;


--
-- Name: tpl_offers tpl_offers_corridor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tpl_offers
    ADD CONSTRAINT tpl_offers_corridor_id_fkey FOREIGN KEY (corridor_id) REFERENCES public.tpl_corridors(id) ON DELETE SET NULL;


--
-- Name: tpl_offers tpl_offers_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tpl_offers
    ADD CONSTRAINT tpl_offers_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.tpl_partners(id) ON DELETE CASCADE;


--
-- Name: tpl_offers tpl_offers_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tpl_offers
    ADD CONSTRAINT tpl_offers_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.vendor_shipment_requests(id) ON DELETE CASCADE;


--
-- Name: tpl_offers tpl_offers_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tpl_offers
    ADD CONSTRAINT tpl_offers_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE CASCADE;


--
-- Name: tpl_orders tpl_orders_offer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tpl_orders
    ADD CONSTRAINT tpl_orders_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES public.tpl_offers(id) ON DELETE CASCADE;


--
-- Name: tpl_orders tpl_orders_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tpl_orders
    ADD CONSTRAINT tpl_orders_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.tpl_partners(id) ON DELETE CASCADE;


--
-- Name: tpl_orders tpl_orders_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tpl_orders
    ADD CONSTRAINT tpl_orders_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.vendor_shipment_requests(id) ON DELETE SET NULL;


--
-- Name: tpl_orders tpl_orders_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tpl_orders
    ADD CONSTRAINT tpl_orders_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE SET NULL;


--
-- Name: tpl_partners tpl_partners_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tpl_partners
    ADD CONSTRAINT tpl_partners_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_activity user_activity_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_activity
    ADD CONSTRAINT user_activity_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_activity user_activity_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_activity
    ADD CONSTRAINT user_activity_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_bank_accounts user_bank_accounts_proof_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_bank_accounts
    ADD CONSTRAINT user_bank_accounts_proof_document_id_fkey FOREIGN KEY (proof_document_id) REFERENCES public.user_documents(id) ON DELETE SET NULL;


--
-- Name: user_bank_accounts user_bank_accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_bank_accounts
    ADD CONSTRAINT user_bank_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_documents user_documents_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_documents
    ADD CONSTRAINT user_documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_documents user_documents_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_documents
    ADD CONSTRAINT user_documents_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_documents user_documents_verified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_documents
    ADD CONSTRAINT user_documents_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_emergency_contacts user_emergency_contacts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_emergency_contacts
    ADD CONSTRAINT user_emergency_contacts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_notes user_notes_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_notes
    ADD CONSTRAINT user_notes_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_notes user_notes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_notes
    ADD CONSTRAINT user_notes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_phone_history user_phone_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_phone_history
    ADD CONSTRAINT user_phone_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_profiles user_profiles_base_depot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_base_depot_id_fkey FOREIGN KEY (base_depot_id) REFERENCES public.depots(id) ON DELETE SET NULL;


--
-- Name: user_profiles user_profiles_consent_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_consent_by_fkey FOREIGN KEY (consent_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_profiles user_profiles_employer_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_employer_partner_id_fkey FOREIGN KEY (employer_partner_id) REFERENCES public.tpl_partners(id) ON DELETE SET NULL;


--
-- Name: user_profiles user_profiles_reporting_manager_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_reporting_manager_id_fkey FOREIGN KEY (reporting_manager_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_profiles user_profiles_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_profiles user_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_status_history user_status_history_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_status_history
    ADD CONSTRAINT user_status_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_status_history user_status_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_status_history
    ADD CONSTRAINT user_status_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: vehicle_fuel_logs vehicle_fuel_logs_expense_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_fuel_logs
    ADD CONSTRAINT vehicle_fuel_logs_expense_id_fkey FOREIGN KEY (expense_id) REFERENCES public.expenses(id) ON DELETE SET NULL;


--
-- Name: vehicle_fuel_logs vehicle_fuel_logs_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_fuel_logs
    ADD CONSTRAINT vehicle_fuel_logs_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: vehicle_maintenance_jobs vehicle_maintenance_jobs_service_log_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_maintenance_jobs
    ADD CONSTRAINT vehicle_maintenance_jobs_service_log_id_fkey FOREIGN KEY (service_log_id) REFERENCES public.vehicle_service_log(id) ON DELETE SET NULL;


--
-- Name: vehicle_maintenance_jobs vehicle_maintenance_jobs_sos_alert_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_maintenance_jobs
    ADD CONSTRAINT vehicle_maintenance_jobs_sos_alert_id_fkey FOREIGN KEY (sos_alert_id) REFERENCES public.sos_alerts(id) ON DELETE SET NULL;


--
-- Name: vehicle_maintenance_jobs vehicle_maintenance_jobs_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_maintenance_jobs
    ADD CONSTRAINT vehicle_maintenance_jobs_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: vehicle_odometer_events vehicle_odometer_events_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_odometer_events
    ADD CONSTRAINT vehicle_odometer_events_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: vehicle_photos vehicle_photos_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_photos
    ADD CONSTRAINT vehicle_photos_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: vehicle_photos vehicle_photos_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_photos
    ADD CONSTRAINT vehicle_photos_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: vehicle_service_attachments vehicle_service_attachments_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_service_attachments
    ADD CONSTRAINT vehicle_service_attachments_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.vehicle_maintenance_jobs(id) ON DELETE CASCADE;


--
-- Name: vehicle_service_attachments vehicle_service_attachments_service_log_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_service_attachments
    ADD CONSTRAINT vehicle_service_attachments_service_log_id_fkey FOREIGN KEY (service_log_id) REFERENCES public.vehicle_service_log(id) ON DELETE CASCADE;


--
-- Name: vehicle_service_attachments vehicle_service_attachments_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_service_attachments
    ADD CONSTRAINT vehicle_service_attachments_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: vehicle_service_items vehicle_service_items_service_log_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_service_items
    ADD CONSTRAINT vehicle_service_items_service_log_id_fkey FOREIGN KEY (service_log_id) REFERENCES public.vehicle_service_log(id) ON DELETE CASCADE;


--
-- Name: vehicle_service_items vehicle_service_items_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_service_items
    ADD CONSTRAINT vehicle_service_items_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: vehicle_service_log vehicle_service_log_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_service_log
    ADD CONSTRAINT vehicle_service_log_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.vehicle_maintenance_jobs(id) ON DELETE SET NULL;


--
-- Name: vehicle_service_log vehicle_service_log_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_service_log
    ADD CONSTRAINT vehicle_service_log_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: vehicle_service_plans vehicle_service_plans_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_service_plans
    ADD CONSTRAINT vehicle_service_plans_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: vehicle_share_links vehicle_share_links_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_share_links
    ADD CONSTRAINT vehicle_share_links_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: vehicle_share_links vehicle_share_links_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_share_links
    ADD CONSTRAINT vehicle_share_links_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE CASCADE;


--
-- Name: vehicle_stoppages vehicle_stoppages_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicle_stoppages
    ADD CONSTRAINT vehicle_stoppages_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id);


--
-- Name: vehicles vehicles_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.users(id);


--
-- Name: vehicles vehicles_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: vehicles vehicles_submitted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: vendor_profiles vendor_profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_profiles
    ADD CONSTRAINT vendor_profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: vendor_profiles vendor_profiles_kyc_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_profiles
    ADD CONSTRAINT vendor_profiles_kyc_reviewed_by_fkey FOREIGN KEY (kyc_reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: vendor_route_opportunities vendor_route_opportunities_route_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_route_opportunities
    ADD CONSTRAINT vendor_route_opportunities_route_id_fkey FOREIGN KEY (route_id) REFERENCES public.routes(id) ON DELETE CASCADE;


--
-- Name: vendor_route_opportunities vendor_route_opportunities_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_route_opportunities
    ADD CONSTRAINT vendor_route_opportunities_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: vendor_shipment_requests vendor_shipment_requests_assigned_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_shipment_requests
    ADD CONSTRAINT vendor_shipment_requests_assigned_vehicle_id_fkey FOREIGN KEY (assigned_vehicle_id) REFERENCES public.vehicles(id) ON DELETE SET NULL;


--
-- Name: vendor_shipment_requests vendor_shipment_requests_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendor_shipment_requests
    ADD CONSTRAINT vendor_shipment_requests_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: vehicle_share_links Service role full access vehicle_share_links; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role full access vehicle_share_links" ON public.vehicle_share_links TO service_role USING (true) WITH CHECK (true);


--
-- Name: ai_agent_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_agent_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: capacity_bids; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.capacity_bids ENABLE ROW LEVEL SECURITY;

--
-- Name: capacity_bids capacity_bids_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY capacity_bids_select ON public.capacity_bids FOR SELECT TO authenticated USING ((( SELECT public.is_staff() AS is_staff) OR (vendor_id = auth.uid()) OR (window_id IN ( SELECT cw.id
   FROM public.capacity_windows cw
  WHERE (cw.vehicle_id IN ( SELECT public.my_vehicle_ids() AS my_vehicle_ids))))));


--
-- Name: capacity_windows; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.capacity_windows ENABLE ROW LEVEL SECURITY;

--
-- Name: capacity_windows capacity_windows_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY capacity_windows_select ON public.capacity_windows FOR SELECT TO authenticated USING ((( SELECT public.is_staff() AS is_staff) OR (vehicle_id IN ( SELECT public.my_vehicle_ids() AS my_vehicle_ids)) OR ((( SELECT public.current_app_role() AS current_app_role) = 'vendor'::text) AND (id IN ( SELECT public.vendor_visible_window_ids() AS vendor_visible_window_ids)))));


--
-- Name: cargo_claims; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cargo_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: cargo_claims cargo_claims_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cargo_claims_staff ON public.cargo_claims TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: cargo_custody_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cargo_custody_events ENABLE ROW LEVEL SECURITY;

--
-- Name: cargo_custody_events cargo_custody_events_staff_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cargo_custody_events_staff_insert ON public.cargo_custody_events FOR INSERT TO authenticated WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: cargo_custody_events cargo_custody_events_staff_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cargo_custody_events_staff_select ON public.cargo_custody_events FOR SELECT TO authenticated USING (( SELECT public.is_staff() AS is_staff));


--
-- Name: cargo_exception_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cargo_exception_items ENABLE ROW LEVEL SECURITY;

--
-- Name: cargo_exception_items cargo_exception_items_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cargo_exception_items_staff ON public.cargo_exception_items TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: cargo_exceptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cargo_exceptions ENABLE ROW LEVEL SECURITY;

--
-- Name: cargo_exceptions cargo_exceptions_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cargo_exceptions_staff ON public.cargo_exceptions TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: cargo_manifest; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cargo_manifest ENABLE ROW LEVEL SECURITY;

--
-- Name: cargo_manifest cargo_manifest_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cargo_manifest_select ON public.cargo_manifest FOR SELECT TO authenticated USING ((( SELECT public.is_staff() AS is_staff) OR (vehicle_id IN ( SELECT public.my_vehicle_ids() AS my_vehicle_ids)) OR (vendor_request_id IN ( SELECT vendor_shipment_requests.id
   FROM public.vendor_shipment_requests
  WHERE (vendor_shipment_requests.vendor_id = auth.uid())))));


--
-- Name: cargo_transfer_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cargo_transfer_items ENABLE ROW LEVEL SECURITY;

--
-- Name: cargo_transfer_items cargo_transfer_items_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cargo_transfer_items_staff ON public.cargo_transfer_items TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: cargo_transfers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cargo_transfers ENABLE ROW LEVEL SECURITY;

--
-- Name: cargo_transfers cargo_transfers_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cargo_transfers_staff ON public.cargo_transfers TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: customer_bookings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customer_bookings ENABLE ROW LEVEL SECURITY;

--
-- Name: customer_bookings customer_bookings_own_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customer_bookings_own_read ON public.customer_bookings FOR SELECT TO authenticated USING ((customer_id = ( SELECT auth.uid() AS uid)));


--
-- Name: customer_bookings customer_bookings_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customer_bookings_staff ON public.customer_bookings TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

--
-- Name: delivery_points; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.delivery_points ENABLE ROW LEVEL SECURITY;

--
-- Name: delivery_points delivery_points_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY delivery_points_select ON public.delivery_points FOR SELECT TO authenticated USING ((( SELECT public.is_staff() AS is_staff) OR (id IN ( SELECT rs.delivery_point_id
   FROM public.route_stops rs
  WHERE (rs.route_id IN ( SELECT public.my_route_ids() AS my_route_ids))))));


--
-- Name: depots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.depots ENABLE ROW LEVEL SECURITY;

--
-- Name: driver_confirmations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.driver_confirmations ENABLE ROW LEVEL SECURITY;

--
-- Name: driver_confirmations driver_confirmations_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY driver_confirmations_select ON public.driver_confirmations FOR SELECT TO authenticated USING ((( SELECT public.is_staff() AS is_staff) OR (vehicle_id IN ( SELECT public.my_vehicle_ids() AS my_vehicle_ids))));


--
-- Name: driver_confirmations driver_confirmations_update_driver; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY driver_confirmations_update_driver ON public.driver_confirmations FOR UPDATE TO authenticated USING (((vehicle_id IN ( SELECT public.my_vehicle_ids() AS my_vehicle_ids)) AND (action IS NULL))) WITH CHECK (((vehicle_id IN ( SELECT public.my_vehicle_ids() AS my_vehicle_ids)) AND (action = 'confirmed'::text)));


--
-- Name: driver_pay_entries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.driver_pay_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: driver_pay_entries driver_pay_entries_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY driver_pay_entries_admin ON public.driver_pay_entries TO authenticated USING (( SELECT COALESCE((public.current_app_role() = ANY (ARRAY['superadmin'::text, 'admin'::text])), false) AS "coalesce")) WITH CHECK (( SELECT COALESCE((public.current_app_role() = ANY (ARRAY['superadmin'::text, 'admin'::text])), false) AS "coalesce"));


--
-- Name: driver_pay_rates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.driver_pay_rates ENABLE ROW LEVEL SECURITY;

--
-- Name: driver_pay_rates driver_pay_rates_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY driver_pay_rates_admin ON public.driver_pay_rates TO authenticated USING (( SELECT COALESCE((public.current_app_role() = ANY (ARRAY['superadmin'::text, 'admin'::text])), false) AS "coalesce")) WITH CHECK (( SELECT COALESCE((public.current_app_role() = ANY (ARRAY['superadmin'::text, 'admin'::text])), false) AS "coalesce"));


--
-- Name: driver_payouts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.driver_payouts ENABLE ROW LEVEL SECURITY;

--
-- Name: driver_payouts driver_payouts_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY driver_payouts_admin ON public.driver_payouts TO authenticated USING (( SELECT COALESCE((public.current_app_role() = ANY (ARRAY['superadmin'::text, 'admin'::text])), false) AS "coalesce")) WITH CHECK (( SELECT COALESCE((public.current_app_role() = ANY (ARRAY['superadmin'::text, 'admin'::text])), false) AS "coalesce"));


--
-- Name: driver_vehicle_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.driver_vehicle_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: expenses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

--
-- Name: expenses expenses_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY expenses_staff ON public.expenses TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: gps_points; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gps_points ENABLE ROW LEVEL SECURITY;

--
-- Name: hsn_codes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hsn_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: idempotency_keys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

--
-- Name: invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: invoices invoices_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY invoices_select ON public.invoices FOR SELECT TO authenticated USING (((vendor_id = auth.uid()) OR ( SELECT public.is_staff() AS is_staff)));


--
-- Name: invoices invoices_write_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY invoices_write_staff ON public.invoices TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: kyc_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kyc_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: kyc_profiles kyc_profiles_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY kyc_profiles_select ON public.kyc_profiles FOR SELECT TO authenticated USING (((id = auth.uid()) OR ( SELECT public.is_staff() AS is_staff)));


--
-- Name: maintenance_alerts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.maintenance_alerts ENABLE ROW LEVEL SECURITY;

--
-- Name: messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: messages messages_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY messages_select ON public.messages FOR SELECT TO authenticated USING ((( SELECT public.is_staff() AS is_staff) OR (route_id IN ( SELECT public.my_route_ids() AS my_route_ids)) OR (route_id IN ( SELECT public.my_manifest_ids() AS my_manifest_ids)) OR (shipment_id IN ( SELECT public.my_shipment_ids() AS my_shipment_ids))));


--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications notifications_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_select_own ON public.notifications FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: notifications notifications_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_update_own ON public.notifications FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: parcel_scans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.parcel_scans ENABLE ROW LEVEL SECURITY;

--
-- Name: parcel_scans parcel_scans_driver_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY parcel_scans_driver_own ON public.parcel_scans FOR SELECT TO authenticated USING ((driver_id = auth.uid()));


--
-- Name: parcel_scans parcel_scans_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY parcel_scans_staff ON public.parcel_scans FOR SELECT TO authenticated USING (( SELECT public.is_staff() AS is_staff));


--
-- Name: parcels; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.parcels ENABLE ROW LEVEL SECURITY;

--
-- Name: payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

--
-- Name: price_quotes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.price_quotes ENABLE ROW LEVEL SECURITY;

--
-- Name: price_quotes price_quotes_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY price_quotes_select_staff ON public.price_quotes FOR SELECT TO authenticated USING (( SELECT public.is_staff() AS is_staff));


--
-- Name: route_stops; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.route_stops ENABLE ROW LEVEL SECURITY;

--
-- Name: route_stops route_stops_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY route_stops_select ON public.route_stops FOR SELECT TO authenticated USING ((( SELECT public.is_staff() AS is_staff) OR (route_id IN ( SELECT public.my_route_ids() AS my_route_ids))));


--
-- Name: routes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.routes ENABLE ROW LEVEL SECURITY;

--
-- Name: routes routes_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY routes_select ON public.routes FOR SELECT TO authenticated USING ((( SELECT public.is_staff() AS is_staff) OR (vehicle_id IN ( SELECT public.my_vehicle_ids() AS my_vehicle_ids))));


--
-- Name: service_plan_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.service_plan_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: service_plan_templates service_plan_templates_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_plan_templates_staff ON public.service_plan_templates TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: shipment_hsn; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shipment_hsn ENABLE ROW LEVEL SECURITY;

--
-- Name: shipment_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shipment_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: shipments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;

--
-- Name: shipments shipments_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY shipments_select_staff ON public.shipments FOR SELECT TO authenticated USING (( SELECT public.is_staff() AS is_staff));


--
-- Name: sos_alerts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sos_alerts ENABLE ROW LEVEL SECURITY;

--
-- Name: sos_alerts sos_alerts_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sos_alerts_select_staff ON public.sos_alerts FOR SELECT TO authenticated USING (( SELECT public.is_staff() AS is_staff));


--
-- Name: system_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: system_settings system_settings_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY system_settings_select ON public.system_settings FOR SELECT TO authenticated, anon USING (true);


--
-- Name: telemetry; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.telemetry ENABLE ROW LEVEL SECURITY;

--
-- Name: telemetry telemetry_insert_driver; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY telemetry_insert_driver ON public.telemetry FOR INSERT TO authenticated WITH CHECK (((vehicle_id IN ( SELECT public.my_vehicle_ids() AS my_vehicle_ids)) AND ((latitude >= ('-90'::integer)::double precision) AND (latitude <= (90)::double precision)) AND ((longitude >= ('-180'::integer)::double precision) AND (longitude <= (180)::double precision)) AND ((speed_kmph IS NULL) OR ((speed_kmph >= (0)::double precision) AND (speed_kmph <= (300)::double precision))) AND ((fuel_level_pct IS NULL) OR ((fuel_level_pct >= (0)::double precision) AND (fuel_level_pct <= (100)::double precision)))));


--
-- Name: telemetry telemetry_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY telemetry_select_staff ON public.telemetry FOR SELECT TO authenticated USING (( SELECT public.is_staff() AS is_staff));


--
-- Name: tpl_corridors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tpl_corridors ENABLE ROW LEVEL SECURITY;

--
-- Name: tpl_corridors tpl_corridors_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tpl_corridors_select ON public.tpl_corridors FOR SELECT TO authenticated USING (((partner_id IN ( SELECT public.my_tpl_partner_ids() AS my_tpl_partner_ids)) OR ( SELECT public.is_staff() AS is_staff)));


--
-- Name: tpl_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tpl_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: tpl_documents tpl_documents_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tpl_documents_select ON public.tpl_documents FOR SELECT TO authenticated USING (((partner_id IN ( SELECT public.my_tpl_partner_ids() AS my_tpl_partner_ids)) OR ( SELECT public.is_staff() AS is_staff)));


--
-- Name: tpl_offers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tpl_offers ENABLE ROW LEVEL SECURITY;

--
-- Name: tpl_offers tpl_offers_partner_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tpl_offers_partner_select ON public.tpl_offers FOR SELECT TO authenticated USING ((partner_id IN ( SELECT public.my_tpl_partner_ids() AS my_tpl_partner_ids)));


--
-- Name: tpl_offers tpl_offers_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tpl_offers_staff_all ON public.tpl_offers TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: tpl_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tpl_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: tpl_orders tpl_orders_partner_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tpl_orders_partner_select ON public.tpl_orders FOR SELECT TO authenticated USING ((partner_id IN ( SELECT public.my_tpl_partner_ids() AS my_tpl_partner_ids)));


--
-- Name: tpl_orders tpl_orders_staff_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tpl_orders_staff_all ON public.tpl_orders TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: tpl_partners; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tpl_partners ENABLE ROW LEVEL SECURITY;

--
-- Name: tpl_partners tpl_partners_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tpl_partners_select ON public.tpl_partners FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR ( SELECT public.is_staff() AS is_staff)));


--
-- Name: traffic_incidents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.traffic_incidents ENABLE ROW LEVEL SECURITY;

--
-- Name: traffic_incidents traffic_incidents_select_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY traffic_incidents_select_staff ON public.traffic_incidents FOR SELECT TO authenticated USING (( SELECT public.is_staff() AS is_staff));


--
-- Name: user_activity; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_activity ENABLE ROW LEVEL SECURITY;

--
-- Name: user_bank_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_bank_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: user_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: user_documents user_documents_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_documents_select_own ON public.user_documents FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: user_emergency_contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_emergency_contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: user_emergency_contacts user_emergency_contacts_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_emergency_contacts_select_own ON public.user_emergency_contacts FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: user_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: user_phone_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_phone_history ENABLE ROW LEVEL SECURITY;

--
-- Name: user_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: user_profiles user_profiles_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_profiles_select_own ON public.user_profiles FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: user_status_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_status_history ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: users users_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_select ON public.users FOR SELECT TO authenticated USING (((id = auth.uid()) OR ( SELECT public.is_staff() AS is_staff)));


--
-- Name: users users_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_update_own ON public.users FOR UPDATE TO authenticated USING ((id = auth.uid())) WITH CHECK ((id = auth.uid()));


--
-- Name: vehicle_fuel_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vehicle_fuel_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: vehicle_fuel_logs vehicle_fuel_logs_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vehicle_fuel_logs_staff ON public.vehicle_fuel_logs TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: vehicle_maintenance_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vehicle_maintenance_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: vehicle_maintenance_jobs vehicle_maintenance_jobs_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vehicle_maintenance_jobs_staff ON public.vehicle_maintenance_jobs TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: vehicle_odometer_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vehicle_odometer_events ENABLE ROW LEVEL SECURITY;

--
-- Name: vehicle_odometer_events vehicle_odometer_events_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vehicle_odometer_events_staff ON public.vehicle_odometer_events TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: vehicle_photos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vehicle_photos ENABLE ROW LEVEL SECURITY;

--
-- Name: vehicle_photos vehicle_photos_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vehicle_photos_select ON public.vehicle_photos FOR SELECT TO authenticated USING ((( SELECT public.is_staff() AS is_staff) OR (vehicle_id IN ( SELECT public.my_vehicle_ids() AS my_vehicle_ids))));


--
-- Name: vehicle_service_attachments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vehicle_service_attachments ENABLE ROW LEVEL SECURITY;

--
-- Name: vehicle_service_attachments vehicle_service_attachments_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vehicle_service_attachments_staff ON public.vehicle_service_attachments TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: vehicle_service_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vehicle_service_items ENABLE ROW LEVEL SECURITY;

--
-- Name: vehicle_service_items vehicle_service_items_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vehicle_service_items_staff ON public.vehicle_service_items TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: vehicle_service_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vehicle_service_log ENABLE ROW LEVEL SECURITY;

--
-- Name: vehicle_service_log vehicle_service_log_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vehicle_service_log_staff ON public.vehicle_service_log TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: vehicle_service_plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vehicle_service_plans ENABLE ROW LEVEL SECURITY;

--
-- Name: vehicle_service_plans vehicle_service_plans_staff; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vehicle_service_plans_staff ON public.vehicle_service_plans TO authenticated USING (( SELECT public.is_staff() AS is_staff)) WITH CHECK (( SELECT public.is_staff() AS is_staff));


--
-- Name: vehicle_share_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vehicle_share_links ENABLE ROW LEVEL SECURITY;

--
-- Name: vehicle_stoppages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vehicle_stoppages ENABLE ROW LEVEL SECURITY;

--
-- Name: vehicles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

--
-- Name: vehicles vehicles_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vehicles_select ON public.vehicles FOR SELECT TO authenticated USING ((( SELECT public.is_staff() AS is_staff) OR (driver_id = auth.uid())));


--
-- Name: vehicles vehicles_update_driver; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vehicles_update_driver ON public.vehicles FOR UPDATE TO authenticated USING ((driver_id = auth.uid())) WITH CHECK (((driver_id = auth.uid()) AND ((latitude IS NULL) OR ((latitude >= ('-90'::integer)::double precision) AND (latitude <= (90)::double precision))) AND ((longitude IS NULL) OR ((longitude >= ('-180'::integer)::double precision) AND (longitude <= (180)::double precision)))));


--
-- Name: vendor_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vendor_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: vendor_profiles vendor_profiles_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vendor_profiles_select ON public.vendor_profiles FOR SELECT TO authenticated USING (((id = auth.uid()) OR ( SELECT public.is_staff() AS is_staff)));


--
-- Name: vendor_route_opportunities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vendor_route_opportunities ENABLE ROW LEVEL SECURITY;

--
-- Name: vendor_shipment_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vendor_shipment_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: vendor_shipment_requests vendor_shipment_requests_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vendor_shipment_requests_select ON public.vendor_shipment_requests FOR SELECT TO authenticated USING (((vendor_id = auth.uid()) OR ( SELECT public.is_staff() AS is_staff)));


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION calculate_distance(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.calculate_distance(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision) TO anon;
GRANT ALL ON FUNCTION public.calculate_distance(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision) TO authenticated;
GRANT ALL ON FUNCTION public.calculate_distance(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision) TO service_role;


--
-- Name: FUNCTION can_read_kyc_object(object_name text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.can_read_kyc_object(object_name text) TO anon;
GRANT ALL ON FUNCTION public.can_read_kyc_object(object_name text) TO authenticated;
GRANT ALL ON FUNCTION public.can_read_kyc_object(object_name text) TO service_role;


--
-- Name: FUNCTION current_app_role(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.current_app_role() TO anon;
GRANT ALL ON FUNCTION public.current_app_role() TO authenticated;
GRANT ALL ON FUNCTION public.current_app_role() TO service_role;


--
-- Name: FUNCTION guard_tpl_partner_update(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.guard_tpl_partner_update() TO anon;
GRANT ALL ON FUNCTION public.guard_tpl_partner_update() TO authenticated;
GRANT ALL ON FUNCTION public.guard_tpl_partner_update() TO service_role;


--
-- Name: FUNCTION guard_vendor_profile_update(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.guard_vendor_profile_update() TO anon;
GRANT ALL ON FUNCTION public.guard_vendor_profile_update() TO authenticated;
GRANT ALL ON FUNCTION public.guard_vendor_profile_update() TO service_role;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.handle_new_user() TO anon;
GRANT ALL ON FUNCTION public.handle_new_user() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;


--
-- Name: FUNCTION is_staff(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_staff() TO anon;
GRANT ALL ON FUNCTION public.is_staff() TO authenticated;
GRANT ALL ON FUNCTION public.is_staff() TO service_role;


--
-- Name: FUNCTION match_vendors_to_route(route_points jsonb, radius_km double precision); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.match_vendors_to_route(route_points jsonb, radius_km double precision) TO anon;
GRANT ALL ON FUNCTION public.match_vendors_to_route(route_points jsonb, radius_km double precision) TO authenticated;
GRANT ALL ON FUNCTION public.match_vendors_to_route(route_points jsonb, radius_km double precision) TO service_role;


--
-- Name: FUNCTION my_manifest_ids(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.my_manifest_ids() TO anon;
GRANT ALL ON FUNCTION public.my_manifest_ids() TO authenticated;
GRANT ALL ON FUNCTION public.my_manifest_ids() TO service_role;


--
-- Name: FUNCTION my_route_ids(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.my_route_ids() TO anon;
GRANT ALL ON FUNCTION public.my_route_ids() TO authenticated;
GRANT ALL ON FUNCTION public.my_route_ids() TO service_role;


--
-- Name: FUNCTION my_shipment_ids(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.my_shipment_ids() TO anon;
GRANT ALL ON FUNCTION public.my_shipment_ids() TO authenticated;
GRANT ALL ON FUNCTION public.my_shipment_ids() TO service_role;


--
-- Name: FUNCTION my_tpl_partner_ids(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.my_tpl_partner_ids() TO anon;
GRANT ALL ON FUNCTION public.my_tpl_partner_ids() TO authenticated;
GRANT ALL ON FUNCTION public.my_tpl_partner_ids() TO service_role;


--
-- Name: FUNCTION my_vehicle_ids(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.my_vehicle_ids() TO anon;
GRANT ALL ON FUNCTION public.my_vehicle_ids() TO authenticated;
GRANT ALL ON FUNCTION public.my_vehicle_ids() TO service_role;


--
-- Name: FUNCTION restrict_client_update_columns(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.restrict_client_update_columns() TO anon;
GRANT ALL ON FUNCTION public.restrict_client_update_columns() TO authenticated;
GRANT ALL ON FUNCTION public.restrict_client_update_columns() TO service_role;


--
-- Name: TABLE hsn_codes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.hsn_codes TO anon;
GRANT ALL ON TABLE public.hsn_codes TO authenticated;
GRANT ALL ON TABLE public.hsn_codes TO service_role;


--
-- Name: FUNCTION search_hsn(search_term text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.search_hsn(search_term text) TO anon;
GRANT ALL ON FUNCTION public.search_hsn(search_term text) TO authenticated;
GRANT ALL ON FUNCTION public.search_hsn(search_term text) TO service_role;


--
-- Name: FUNCTION track_driver_vehicle_assignment(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.track_driver_vehicle_assignment() TO anon;
GRANT ALL ON FUNCTION public.track_driver_vehicle_assignment() TO authenticated;
GRANT ALL ON FUNCTION public.track_driver_vehicle_assignment() TO service_role;


--
-- Name: FUNCTION update_hsn_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_hsn_updated_at() TO anon;
GRANT ALL ON FUNCTION public.update_hsn_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.update_hsn_updated_at() TO service_role;


--
-- Name: FUNCTION update_modified_column(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_modified_column() TO anon;
GRANT ALL ON FUNCTION public.update_modified_column() TO authenticated;
GRANT ALL ON FUNCTION public.update_modified_column() TO service_role;


--
-- Name: FUNCTION vehicles_driver_status_guard(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.vehicles_driver_status_guard() TO anon;
GRANT ALL ON FUNCTION public.vehicles_driver_status_guard() TO authenticated;
GRANT ALL ON FUNCTION public.vehicles_driver_status_guard() TO service_role;


--
-- Name: FUNCTION vendor_visible_window_ids(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.vendor_visible_window_ids() TO anon;
GRANT ALL ON FUNCTION public.vendor_visible_window_ids() TO authenticated;
GRANT ALL ON FUNCTION public.vendor_visible_window_ids() TO service_role;


--
-- Name: TABLE ai_agent_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ai_agent_logs TO anon;
GRANT ALL ON TABLE public.ai_agent_logs TO authenticated;
GRANT ALL ON TABLE public.ai_agent_logs TO service_role;


--
-- Name: TABLE capacity_bids; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.capacity_bids TO anon;
GRANT ALL ON TABLE public.capacity_bids TO authenticated;
GRANT ALL ON TABLE public.capacity_bids TO service_role;


--
-- Name: TABLE capacity_windows; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.capacity_windows TO anon;
GRANT ALL ON TABLE public.capacity_windows TO authenticated;
GRANT ALL ON TABLE public.capacity_windows TO service_role;


--
-- Name: TABLE cargo_claims; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cargo_claims TO anon;
GRANT ALL ON TABLE public.cargo_claims TO authenticated;
GRANT ALL ON TABLE public.cargo_claims TO service_role;


--
-- Name: TABLE cargo_custody_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cargo_custody_events TO anon;
GRANT ALL ON TABLE public.cargo_custody_events TO authenticated;
GRANT ALL ON TABLE public.cargo_custody_events TO service_role;


--
-- Name: TABLE cargo_exception_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cargo_exception_items TO anon;
GRANT ALL ON TABLE public.cargo_exception_items TO authenticated;
GRANT ALL ON TABLE public.cargo_exception_items TO service_role;


--
-- Name: TABLE cargo_exceptions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cargo_exceptions TO anon;
GRANT ALL ON TABLE public.cargo_exceptions TO authenticated;
GRANT ALL ON TABLE public.cargo_exceptions TO service_role;


--
-- Name: TABLE cargo_manifest; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cargo_manifest TO anon;
GRANT ALL ON TABLE public.cargo_manifest TO authenticated;
GRANT ALL ON TABLE public.cargo_manifest TO service_role;


--
-- Name: TABLE cargo_transfer_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cargo_transfer_items TO anon;
GRANT ALL ON TABLE public.cargo_transfer_items TO authenticated;
GRANT ALL ON TABLE public.cargo_transfer_items TO service_role;


--
-- Name: TABLE cargo_transfers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cargo_transfers TO anon;
GRANT ALL ON TABLE public.cargo_transfers TO authenticated;
GRANT ALL ON TABLE public.cargo_transfers TO service_role;


--
-- Name: TABLE customer_bookings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.customer_bookings TO anon;
GRANT ALL ON TABLE public.customer_bookings TO authenticated;
GRANT ALL ON TABLE public.customer_bookings TO service_role;


--
-- Name: TABLE customers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.customers TO anon;
GRANT ALL ON TABLE public.customers TO authenticated;
GRANT ALL ON TABLE public.customers TO service_role;


--
-- Name: TABLE delivery_points; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.delivery_points TO anon;
GRANT ALL ON TABLE public.delivery_points TO authenticated;
GRANT ALL ON TABLE public.delivery_points TO service_role;


--
-- Name: TABLE depots; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.depots TO anon;
GRANT ALL ON TABLE public.depots TO authenticated;
GRANT ALL ON TABLE public.depots TO service_role;


--
-- Name: TABLE driver_confirmations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.driver_confirmations TO anon;
GRANT ALL ON TABLE public.driver_confirmations TO authenticated;
GRANT ALL ON TABLE public.driver_confirmations TO service_role;


--
-- Name: TABLE driver_pay_entries; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.driver_pay_entries TO anon;
GRANT ALL ON TABLE public.driver_pay_entries TO authenticated;
GRANT ALL ON TABLE public.driver_pay_entries TO service_role;


--
-- Name: TABLE driver_pay_rates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.driver_pay_rates TO anon;
GRANT ALL ON TABLE public.driver_pay_rates TO authenticated;
GRANT ALL ON TABLE public.driver_pay_rates TO service_role;


--
-- Name: TABLE driver_payouts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.driver_payouts TO anon;
GRANT ALL ON TABLE public.driver_payouts TO authenticated;
GRANT ALL ON TABLE public.driver_payouts TO service_role;


--
-- Name: TABLE driver_vehicle_assignments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.driver_vehicle_assignments TO anon;
GRANT ALL ON TABLE public.driver_vehicle_assignments TO authenticated;
GRANT ALL ON TABLE public.driver_vehicle_assignments TO service_role;


--
-- Name: TABLE expenses; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.expenses TO anon;
GRANT ALL ON TABLE public.expenses TO authenticated;
GRANT ALL ON TABLE public.expenses TO service_role;


--
-- Name: TABLE gps_points; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.gps_points TO anon;
GRANT ALL ON TABLE public.gps_points TO authenticated;
GRANT ALL ON TABLE public.gps_points TO service_role;


--
-- Name: TABLE idempotency_keys; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.idempotency_keys TO anon;
GRANT ALL ON TABLE public.idempotency_keys TO authenticated;
GRANT ALL ON TABLE public.idempotency_keys TO service_role;


--
-- Name: TABLE invoices; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.invoices TO anon;
GRANT ALL ON TABLE public.invoices TO authenticated;
GRANT ALL ON TABLE public.invoices TO service_role;


--
-- Name: TABLE kyc_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.kyc_profiles TO anon;
GRANT ALL ON TABLE public.kyc_profiles TO authenticated;
GRANT ALL ON TABLE public.kyc_profiles TO service_role;


--
-- Name: TABLE maintenance_alerts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.maintenance_alerts TO anon;
GRANT ALL ON TABLE public.maintenance_alerts TO authenticated;
GRANT ALL ON TABLE public.maintenance_alerts TO service_role;


--
-- Name: TABLE messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.messages TO anon;
GRANT ALL ON TABLE public.messages TO authenticated;
GRANT ALL ON TABLE public.messages TO service_role;


--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notifications TO anon;
GRANT ALL ON TABLE public.notifications TO authenticated;
GRANT ALL ON TABLE public.notifications TO service_role;


--
-- Name: TABLE parcel_scans; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.parcel_scans TO anon;
GRANT ALL ON TABLE public.parcel_scans TO authenticated;
GRANT ALL ON TABLE public.parcel_scans TO service_role;


--
-- Name: TABLE parcels; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.parcels TO anon;
GRANT ALL ON TABLE public.parcels TO authenticated;
GRANT ALL ON TABLE public.parcels TO service_role;


--
-- Name: TABLE payments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.payments TO anon;
GRANT ALL ON TABLE public.payments TO authenticated;
GRANT ALL ON TABLE public.payments TO service_role;


--
-- Name: TABLE price_quotes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.price_quotes TO anon;
GRANT ALL ON TABLE public.price_quotes TO authenticated;
GRANT ALL ON TABLE public.price_quotes TO service_role;


--
-- Name: TABLE route_stops; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.route_stops TO anon;
GRANT ALL ON TABLE public.route_stops TO authenticated;
GRANT ALL ON TABLE public.route_stops TO service_role;


--
-- Name: TABLE routes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.routes TO anon;
GRANT ALL ON TABLE public.routes TO authenticated;
GRANT ALL ON TABLE public.routes TO service_role;


--
-- Name: TABLE service_plan_templates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.service_plan_templates TO anon;
GRANT ALL ON TABLE public.service_plan_templates TO authenticated;
GRANT ALL ON TABLE public.service_plan_templates TO service_role;


--
-- Name: TABLE shipment_hsn; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.shipment_hsn TO anon;
GRANT ALL ON TABLE public.shipment_hsn TO authenticated;
GRANT ALL ON TABLE public.shipment_hsn TO service_role;


--
-- Name: TABLE shipment_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.shipment_logs TO anon;
GRANT ALL ON TABLE public.shipment_logs TO authenticated;
GRANT ALL ON TABLE public.shipment_logs TO service_role;


--
-- Name: TABLE shipments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.shipments TO anon;
GRANT ALL ON TABLE public.shipments TO authenticated;
GRANT ALL ON TABLE public.shipments TO service_role;


--
-- Name: TABLE sos_alerts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sos_alerts TO anon;
GRANT ALL ON TABLE public.sos_alerts TO authenticated;
GRANT ALL ON TABLE public.sos_alerts TO service_role;


--
-- Name: TABLE system_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.system_settings TO anon;
GRANT ALL ON TABLE public.system_settings TO authenticated;
GRANT ALL ON TABLE public.system_settings TO service_role;


--
-- Name: TABLE telemetry; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.telemetry TO anon;
GRANT ALL ON TABLE public.telemetry TO authenticated;
GRANT ALL ON TABLE public.telemetry TO service_role;


--
-- Name: TABLE tpl_corridors; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tpl_corridors TO anon;
GRANT ALL ON TABLE public.tpl_corridors TO authenticated;
GRANT ALL ON TABLE public.tpl_corridors TO service_role;


--
-- Name: TABLE tpl_documents; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tpl_documents TO anon;
GRANT ALL ON TABLE public.tpl_documents TO authenticated;
GRANT ALL ON TABLE public.tpl_documents TO service_role;


--
-- Name: TABLE tpl_offers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tpl_offers TO anon;
GRANT ALL ON TABLE public.tpl_offers TO authenticated;
GRANT ALL ON TABLE public.tpl_offers TO service_role;


--
-- Name: TABLE tpl_orders; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tpl_orders TO anon;
GRANT ALL ON TABLE public.tpl_orders TO authenticated;
GRANT ALL ON TABLE public.tpl_orders TO service_role;


--
-- Name: TABLE tpl_partners; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tpl_partners TO anon;
GRANT ALL ON TABLE public.tpl_partners TO authenticated;
GRANT ALL ON TABLE public.tpl_partners TO service_role;


--
-- Name: TABLE traffic_incidents; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.traffic_incidents TO anon;
GRANT ALL ON TABLE public.traffic_incidents TO authenticated;
GRANT ALL ON TABLE public.traffic_incidents TO service_role;


--
-- Name: TABLE user_activity; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_activity TO anon;
GRANT ALL ON TABLE public.user_activity TO authenticated;
GRANT ALL ON TABLE public.user_activity TO service_role;


--
-- Name: TABLE user_bank_accounts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_bank_accounts TO anon;
GRANT ALL ON TABLE public.user_bank_accounts TO authenticated;
GRANT ALL ON TABLE public.user_bank_accounts TO service_role;


--
-- Name: TABLE user_documents; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_documents TO anon;
GRANT ALL ON TABLE public.user_documents TO authenticated;
GRANT ALL ON TABLE public.user_documents TO service_role;


--
-- Name: TABLE user_emergency_contacts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_emergency_contacts TO anon;
GRANT ALL ON TABLE public.user_emergency_contacts TO authenticated;
GRANT ALL ON TABLE public.user_emergency_contacts TO service_role;


--
-- Name: TABLE user_notes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_notes TO anon;
GRANT ALL ON TABLE public.user_notes TO authenticated;
GRANT ALL ON TABLE public.user_notes TO service_role;


--
-- Name: TABLE user_phone_history; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_phone_history TO anon;
GRANT ALL ON TABLE public.user_phone_history TO authenticated;
GRANT ALL ON TABLE public.user_phone_history TO service_role;


--
-- Name: TABLE user_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_profiles TO anon;
GRANT ALL ON TABLE public.user_profiles TO authenticated;
GRANT ALL ON TABLE public.user_profiles TO service_role;


--
-- Name: TABLE user_status_history; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_status_history TO anon;
GRANT ALL ON TABLE public.user_status_history TO authenticated;
GRANT ALL ON TABLE public.user_status_history TO service_role;


--
-- Name: TABLE users; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.users TO anon;
GRANT ALL ON TABLE public.users TO authenticated;
GRANT ALL ON TABLE public.users TO service_role;


--
-- Name: TABLE vehicle_fuel_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vehicle_fuel_logs TO anon;
GRANT ALL ON TABLE public.vehicle_fuel_logs TO authenticated;
GRANT ALL ON TABLE public.vehicle_fuel_logs TO service_role;


--
-- Name: TABLE vehicle_maintenance_jobs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vehicle_maintenance_jobs TO anon;
GRANT ALL ON TABLE public.vehicle_maintenance_jobs TO authenticated;
GRANT ALL ON TABLE public.vehicle_maintenance_jobs TO service_role;


--
-- Name: TABLE vehicle_odometer_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vehicle_odometer_events TO anon;
GRANT ALL ON TABLE public.vehicle_odometer_events TO authenticated;
GRANT ALL ON TABLE public.vehicle_odometer_events TO service_role;


--
-- Name: TABLE vehicle_photos; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vehicle_photos TO anon;
GRANT ALL ON TABLE public.vehicle_photos TO authenticated;
GRANT ALL ON TABLE public.vehicle_photos TO service_role;


--
-- Name: TABLE vehicle_service_attachments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vehicle_service_attachments TO anon;
GRANT ALL ON TABLE public.vehicle_service_attachments TO authenticated;
GRANT ALL ON TABLE public.vehicle_service_attachments TO service_role;


--
-- Name: TABLE vehicle_service_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vehicle_service_items TO anon;
GRANT ALL ON TABLE public.vehicle_service_items TO authenticated;
GRANT ALL ON TABLE public.vehicle_service_items TO service_role;


--
-- Name: TABLE vehicle_service_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vehicle_service_log TO anon;
GRANT ALL ON TABLE public.vehicle_service_log TO authenticated;
GRANT ALL ON TABLE public.vehicle_service_log TO service_role;


--
-- Name: TABLE vehicle_service_plans; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vehicle_service_plans TO anon;
GRANT ALL ON TABLE public.vehicle_service_plans TO authenticated;
GRANT ALL ON TABLE public.vehicle_service_plans TO service_role;


--
-- Name: TABLE vehicle_share_links; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vehicle_share_links TO anon;
GRANT ALL ON TABLE public.vehicle_share_links TO authenticated;
GRANT ALL ON TABLE public.vehicle_share_links TO service_role;


--
-- Name: TABLE vehicle_stoppages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vehicle_stoppages TO anon;
GRANT ALL ON TABLE public.vehicle_stoppages TO authenticated;
GRANT ALL ON TABLE public.vehicle_stoppages TO service_role;


--
-- Name: TABLE vehicles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vehicles TO anon;
GRANT ALL ON TABLE public.vehicles TO authenticated;
GRANT ALL ON TABLE public.vehicles TO service_role;


--
-- Name: TABLE vendor_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vendor_profiles TO anon;
GRANT ALL ON TABLE public.vendor_profiles TO authenticated;
GRANT ALL ON TABLE public.vendor_profiles TO service_role;


--
-- Name: TABLE vendor_route_opportunities; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vendor_route_opportunities TO anon;
GRANT ALL ON TABLE public.vendor_route_opportunities TO authenticated;
GRANT ALL ON TABLE public.vendor_route_opportunities TO service_role;


--
-- Name: TABLE vendor_shipment_requests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vendor_shipment_requests TO anon;
GRANT ALL ON TABLE public.vendor_shipment_requests TO authenticated;
GRANT ALL ON TABLE public.vendor_shipment_requests TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict TXAYtZHXkRkOu2a7WZpksa7UuYs5ngqgaouhE3eM4b0jtbo1O8bsjFLix11jiMk

