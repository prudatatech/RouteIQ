-- A 3PL order is the company's (the one that made the offer), not the partner's. Accepting stamped it with the
-- ACCEPTING organisation, the partner, so the company's own lists, statements and payments (scoped by carrier_org_id)
-- could not find it and the partner portal grouped its work under itself. Point existing orders at their offer's
-- company. Idempotent.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    SET LOCAL ROLE app_owner;
  END IF;
END $$;

UPDATE public.tpl_orders o
SET carrier_org_id = f.carrier_org_id
FROM public.tpl_offers f
WHERE f.id = o.offer_id
  AND f.carrier_org_id IS NOT NULL
  AND o.carrier_org_id IS DISTINCT FROM f.carrier_org_id;
