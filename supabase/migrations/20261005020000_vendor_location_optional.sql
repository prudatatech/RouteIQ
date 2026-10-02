-- A vendor who signs up while posting a load gives a business address and pin code (load-posting PRD §9), not a map
-- point. vendor_profiles.latitude/longitude were NOT NULL, so saving that profile failed ("null value in column
-- latitude"). Every reader already skips a vendor without a location (return-trip matching, nearby vendors), so the
-- point becomes optional; the vendor's warehouse pin (company page) still sets it. Idempotent.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    SET LOCAL ROLE app_owner;
  END IF;
END $$;

ALTER TABLE public.vendor_profiles ALTER COLUMN latitude DROP NOT NULL;
ALTER TABLE public.vendor_profiles ALTER COLUMN longitude DROP NOT NULL;
