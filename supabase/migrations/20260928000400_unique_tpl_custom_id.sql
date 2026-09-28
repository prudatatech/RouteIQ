-- A 3PL partner's custom_id names its storage folder, which grants read
-- access to that partner's documents, so it must be unique.
-- If production already has duplicates, the index is skipped and they are
-- listed so they can be renamed first; re-run this migration afterwards.
DO $$
DECLARE dup record; found boolean := false;
BEGIN
  FOR dup IN
    SELECT custom_id, count(*) AS n FROM public.tpl_partners
    WHERE custom_id IS NOT NULL GROUP BY custom_id HAVING count(*) > 1
  LOOP
    found := true;
    RAISE NOTICE 'Duplicate tpl_partners.custom_id "%" (% rows) — rename before re-running', dup.custom_id, dup.n;
  END LOOP;

  IF NOT found THEN
    CREATE UNIQUE INDEX IF NOT EXISTS tpl_partners_custom_id_key
      ON public.tpl_partners (custom_id) WHERE custom_id IS NOT NULL;
  END IF;
END $$;
