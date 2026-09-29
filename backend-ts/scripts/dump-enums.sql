-- Allowed values of every enum-typed column in public tables, as JSON
-- ("table.column" -> [labels]), for backend-ts/test/support/db-enums.json.
-- Run: psql "$DB_URL" -At -f backend-ts/scripts/dump-enums.sql > backend-ts/test/support/db-enums.json
SELECT jsonb_pretty(COALESCE(jsonb_object_agg(key, labels ORDER BY key), '{}'::jsonb))
FROM (
  SELECT c.table_name || '.' || c.column_name AS key,
         (SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)
            FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
           WHERE t.typname = c.udt_name) AS labels
  FROM information_schema.columns c
  JOIN pg_type t ON t.typname = c.udt_name AND t.typtype = 'e'
  WHERE c.table_schema = 'public'
) s;
