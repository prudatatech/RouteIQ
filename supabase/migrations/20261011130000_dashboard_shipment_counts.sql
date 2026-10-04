-- Replace 22 per-status REST counts with one grouped query.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    SET LOCAL ROLE app_owner;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.dashboard_shipment_counts(p_carrier_org_id uuid DEFAULT NULL)
RETURNS TABLE(source text, status text, total bigint)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT 'shipment'::text, s.status::text, count(*)
  FROM public.shipments s
  WHERE s.is_master <> true
    AND (p_carrier_org_id IS NULL OR s.carrier_org_id = p_carrier_org_id)
  GROUP BY s.status
  UNION ALL
  SELECT 'manifest'::text, m.status::text, count(*)
  FROM public.cargo_manifest m
  WHERE m.is_master <> true
    AND (p_carrier_org_id IS NULL OR m.carrier_org_id = p_carrier_org_id)
  GROUP BY m.status;
$$;

-- Scope is resolved by the authenticated backend, never by a browser-supplied organisation.
REVOKE ALL ON FUNCTION public.dashboard_shipment_counts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_shipment_counts(uuid) TO service_role;
