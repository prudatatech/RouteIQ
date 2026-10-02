-- 3PL orders belong to the company that handed the work over.
--
-- Until now an order a partner accepted was stamped with the partner's own organisation (the organisation the request
-- acted for), so the company that made the offer did not see it in its orders, ratings or payments, and the partner's
-- portal grouped its work under itself. The order takes the carrier of its offer. Rows already stamped with a partner
-- organisation are moved to the company of their offer. Idempotent; safe to run again. Runs as app_owner where it exists.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    SET LOCAL ROLE app_owner;
  END IF;
  UPDATE public.tpl_orders o
     SET carrier_org_id = f.carrier_org_id
    FROM public.tpl_offers f
   WHERE f.id = o.offer_id
     AND f.carrier_org_id IS NOT NULL
     AND o.carrier_org_id IS DISTINCT FROM f.carrier_org_id;
END $$;
