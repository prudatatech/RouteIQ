-- Table pairs joined by more than one foreign key, as JSON (["a|b", ...], names sorted within
-- each pair), for backend-ts/test/support/db-ambiguous-relations.json. PostgREST refuses an
-- embed between such a pair (PGRST201) unless it names the key: users!vehicles_driver_id_fkey(...).
-- Run: psql "$DB_URL" -At -f backend-ts/scripts/dump-ambiguous-relations.sql > backend-ts/test/support/db-ambiguous-relations.json
SELECT jsonb_pretty(COALESCE(jsonb_agg(pair ORDER BY pair), '[]'::jsonb))
FROM (
  SELECT least(a, b) || '|' || greatest(a, b) AS pair
  FROM (
    SELECT c.conrelid::regclass::text AS a, c.confrelid::regclass::text AS b
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    JOIN pg_namespace fn ON fn.oid = (SELECT relnamespace FROM pg_class WHERE oid = c.confrelid)
    WHERE c.contype = 'f' AND n.nspname = 'public' AND fn.nspname = 'public'
  ) fk
  WHERE a <> b
  GROUP BY least(a, b), greatest(a, b)
  HAVING count(*) > 1
) pairs;
