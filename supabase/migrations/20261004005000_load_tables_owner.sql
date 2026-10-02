-- The load-posting (20261003020000) and shipment-documents (20261003030000) migrations ran as the server's admin
-- login instead of app_owner, so on Azure their tables and functions belong to the admin. Every other app table
-- belongs to app_owner, and later migrations run as app_owner, so they could not change these ("must be owner of
-- relation load_items"). This hands them to app_owner. Runs as the admin (it owns them now). Where app_owner doesn't
-- exist (the CI database) there is nothing to do. Idempotent.

DO $$
DECLARE
  t text;
  f text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') THEN
    RETURN;
  END IF;

  FOREACH t IN ARRAY ARRAY['load_items', 'load_counters', 'load_bulk_batches',
                           'load_documents', 'load_document_events', 'lr_counters', 'trip_settlements'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I OWNER TO app_owner', t);
    END IF;
  END LOOP;

  FOREACH f IN ARRAY ARRAY['public.next_load_number()', 'public.create_vendor_load(jsonb)',
                           'public.next_lr_number(uuid, text, integer)', 'public.can_read_load_object(text)'] LOOP
    IF to_regprocedure(f) IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION %s OWNER TO app_owner', f);
    END IF;
  END LOOP;
END $$;
