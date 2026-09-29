-- Driver app stream, part 2: messages between a driver and dispatch.
--
-- Text only. A message belongs to a route (a vendor load counts as a route, so
-- `route_id` may hold a cargo manifest id, which is why it has no foreign key)
-- and, when staff write from a shipment, also to that shipment. The backend
-- stores both when it can, so the driver sees one conversation per route.
--
-- `sender_role` is the sender's app role ('driver', 'manager', 'admin',
-- 'superadmin'); `read_at` is set when the other side has read it.
--
-- Access (same helpers as 20260928000200_row_level_security.sql):
--   staff   read everything
--   drivers read messages on their own routes, vendor loads and shipments
-- Nobody writes from a client. Messages are sent and marked read through the
-- backend, which checks the caller owns the route. Drivers and the console
-- still subscribe to inserts over Realtime (RLS applies to those too).
--
-- Additive and safe to re-run. NOT YET APPLIED to the live project.

CREATE OR REPLACE FUNCTION public.my_manifest_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM cargo_manifest WHERE vehicle_id IN (SELECT id FROM vehicles WHERE driver_id = auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.my_shipment_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT dp.shipment_id
    FROM delivery_points dp
    JOIN route_stops rs ON rs.delivery_point_id = dp.id
    JOIN routes r ON r.id = rs.route_id
    JOIN vehicles v ON v.id = r.vehicle_id
   WHERE v.driver_id = auth.uid() AND dp.shipment_id IS NOT NULL
$$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['my_manifest_ids()', 'my_shipment_ids()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid,
  shipment_id uuid REFERENCES public.shipments(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  sender_role text NOT NULL,
  sender_name text,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  CONSTRAINT messages_has_thread CHECK (route_id IS NOT NULL OR shipment_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_messages_route ON public.messages (route_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_shipment ON public.messages (shipment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_unread ON public.messages (sender_role, created_at) WHERE read_at IS NULL;

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS messages_select ON public.messages;
CREATE POLICY messages_select ON public.messages FOR SELECT TO authenticated
  USING (
    (SELECT public.is_staff())
    OR route_id IN (SELECT public.my_route_ids())
    OR route_id IN (SELECT public.my_manifest_ids())
    OR shipment_id IN (SELECT public.my_shipment_ids())
  );

-- Live updates in the driver app and the console
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
