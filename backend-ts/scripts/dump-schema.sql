-- Dumps the public schema's tables/views and their columns as TSV:
-- table_name<TAB>column_name<TAB>data_type
-- Read-only: information_schema only. Used to regenerate
-- backend-ts/test/support/db-schema.json (see scripts/check-queries.ts header).
select c.table_name, c.column_name, c.data_type
from information_schema.columns c
join information_schema.tables t
  on t.table_schema = c.table_schema and t.table_name = c.table_name
where c.table_schema = 'public'
  and t.table_type in ('BASE TABLE', 'VIEW')
order by c.table_name, c.ordinal_position;
