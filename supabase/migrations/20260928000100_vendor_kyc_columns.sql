-- Move vendor KYC out of the `dummy2` text column.
--
-- `vendor_profiles.dummy2` was added as a PostgREST schema-reload trick
-- (013_vendor_address.sql) and later reused to hold a JSON string:
--   { "status": "...", "data": { ...form fields, docUrls }, "otherDocs": [...] }
-- Status now lives in a constrained column that only staff can change to
-- approved/rejected (enforced in the row-level security migration), and the
-- form data in a jsonb column. `dummy2` is kept until the frontend no longer
-- reads it, then dropped in a follow-up migration.

-- Columns and backfill run once: only when kyc_status does not exist yet, so a
-- re-run never overwrites later edits or reviews.
DO $$
DECLARE
  r record;
  parsed jsonb;
  status text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vendor_profiles' AND column_name = 'kyc_status'
  ) THEN
    RETURN;
  END IF;

  ALTER TABLE public.vendor_profiles
    ADD COLUMN kyc_data jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN kyc_status text NOT NULL DEFAULT 'pending'
      CONSTRAINT vendor_profiles_kyc_status_check CHECK (kyc_status IN ('pending', 'submitted', 'approved', 'rejected')),
    ADD COLUMN kyc_reviewed_at timestamptz,
    ADD COLUMN kyc_reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

  -- Backfill from dummy2, skipping rows whose JSON does not parse
  FOR r IN SELECT id, dummy2 FROM public.vendor_profiles WHERE dummy2 IS NOT NULL AND btrim(dummy2) <> '' LOOP
    BEGIN
      parsed := r.dummy2::jsonb;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'vendor_profiles %: dummy2 is not valid JSON, left for manual review', r.id;
      CONTINUE;
    END;

    status := lower(coalesce(parsed->>'status', 'pending'));
    IF status NOT IN ('pending', 'submitted', 'approved', 'rejected') THEN
      status := 'pending';
    END IF;

    UPDATE public.vendor_profiles
       SET kyc_data = jsonb_build_object(
             'data', coalesce(parsed->'data', '{}'::jsonb),
             'otherDocs', coalesce(parsed->'otherDocs', '[]'::jsonb)
           ),
           kyc_status = status
     WHERE id = r.id;
  END LOOP;

  -- The vendor documents page let a status in kyc_profiles override dummy2;
  -- keep that precedence.
  IF to_regclass('public.kyc_profiles') IS NOT NULL THEN
    UPDATE public.vendor_profiles vp
       SET kyc_status = lower(kp.kyc_status)
      FROM public.kyc_profiles kp
     WHERE kp.id = vp.id
       AND lower(kp.kyc_status) IN ('pending', 'submitted', 'approved', 'rejected');
  END IF;
END $$;
