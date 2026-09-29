-- 3PL network: offers sent to partners, and the orders created when one accepts.
--
-- Staff escalate a vendor request or an unassigned shipment. That creates one
-- tpl_offers row for every active partner whose corridor matches. The first
-- partner to accept wins: the accept creates a tpl_orders row, and the unique
-- indexes below allow only one live order per request or shipment.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.tpl_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.tpl_partners(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('request', 'shipment')),
  request_id uuid REFERENCES public.vendor_shipment_requests(id) ON DELETE CASCADE,
  shipment_id uuid REFERENCES public.shipments(id) ON DELETE CASCADE,
  corridor_id uuid REFERENCES public.tpl_corridors(id) ON DELETE SET NULL,
  corridor_name text,
  pickup_location text,
  drop_location text,
  weight_kg numeric,
  -- The partner's own corridor rate; null when the rate on file is not a number
  proposed_price numeric(12,2) CHECK (proposed_price IS NULL OR proposed_price > 0),
  status text NOT NULL DEFAULT 'offered'
    CHECK (status IN ('offered', 'accepted', 'declined', 'taken', 'withdrawn')),
  pickup_eta timestamptz,
  decline_reason text,
  offered_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tpl_offers_one_source CHECK (
    (source_type = 'request' AND request_id IS NOT NULL AND shipment_id IS NULL)
    OR (source_type = 'shipment' AND shipment_id IS NOT NULL AND request_id IS NULL)
  )
);

-- A partner has at most one open offer per load
CREATE UNIQUE INDEX IF NOT EXISTS tpl_offers_open_request_idx
  ON public.tpl_offers (partner_id, request_id) WHERE status = 'offered' AND request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tpl_offers_open_shipment_idx
  ON public.tpl_offers (partner_id, shipment_id) WHERE status = 'offered' AND shipment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tpl_offers_partner_idx ON public.tpl_offers (partner_id, status);
CREATE INDEX IF NOT EXISTS tpl_offers_request_idx ON public.tpl_offers (request_id);
CREATE INDEX IF NOT EXISTS tpl_offers_shipment_idx ON public.tpl_offers (shipment_id);

CREATE TABLE IF NOT EXISTS public.tpl_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL UNIQUE REFERENCES public.tpl_offers(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES public.tpl_partners(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('request', 'shipment')),
  request_id uuid REFERENCES public.vendor_shipment_requests(id) ON DELETE SET NULL,
  shipment_id uuid REFERENCES public.shipments(id) ON DELETE SET NULL,
  pickup_location text,
  drop_location text,
  weight_kg numeric,
  agreed_amount numeric(12,2) NOT NULL CHECK (agreed_amount > 0),
  status text NOT NULL DEFAULT 'accepted'
    CHECK (status IN ('accepted', 'picked_up', 'in_transit', 'delivered', 'cancelled')),
  pickup_eta timestamptz,
  -- Delivery is late after this: the delivery time the partner promised, else
  -- accepted time plus their SLA commitment. Null when neither is known.
  due_by timestamptz,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  picked_up_at timestamptz,
  delivered_at timestamptz,
  pod_note text,
  -- Payout to the partner, set by staff. Unpaid while null.
  paid_at timestamptz,
  paid_reference text,
  -- Staff rating after delivery, 1 to 5
  rating smallint CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  rating_note text,
  rated_at timestamptz,
  rated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One live order per request or shipment: the second partner to accept is refused
CREATE UNIQUE INDEX IF NOT EXISTS tpl_orders_live_request_idx
  ON public.tpl_orders (request_id) WHERE status <> 'cancelled' AND request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tpl_orders_live_shipment_idx
  ON public.tpl_orders (shipment_id) WHERE status <> 'cancelled' AND shipment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tpl_orders_partner_idx ON public.tpl_orders (partner_id, status);

-- Row-level security: staff everything; a partner reads only what is addressed to them.
-- Writes go through the backend (service role).
ALTER TABLE public.tpl_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tpl_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tpl_offers_staff_all ON public.tpl_offers;
CREATE POLICY tpl_offers_staff_all ON public.tpl_offers FOR ALL TO authenticated
  USING ((SELECT public.is_staff())) WITH CHECK ((SELECT public.is_staff()));
DROP POLICY IF EXISTS tpl_offers_partner_select ON public.tpl_offers;
CREATE POLICY tpl_offers_partner_select ON public.tpl_offers FOR SELECT TO authenticated
  USING (partner_id IN (SELECT public.my_tpl_partner_ids()));

DROP POLICY IF EXISTS tpl_orders_staff_all ON public.tpl_orders;
CREATE POLICY tpl_orders_staff_all ON public.tpl_orders FOR ALL TO authenticated
  USING ((SELECT public.is_staff())) WITH CHECK ((SELECT public.is_staff()));
DROP POLICY IF EXISTS tpl_orders_partner_select ON public.tpl_orders;
CREATE POLICY tpl_orders_partner_select ON public.tpl_orders FOR SELECT TO authenticated
  USING (partner_id IN (SELECT public.my_tpl_partner_ids()));

-- Live updates for the partner dashboard and the request drawer
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'tpl_offers') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.tpl_offers;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'tpl_orders') THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.tpl_orders;
    END IF;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
