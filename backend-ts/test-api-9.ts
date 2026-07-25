import { supabase } from './src/core/supabase';

async function run() {
  const { data, error } = await supabase.rpc('execute_sql', { sql_string: `SELECT conname, pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE conname = 'capacity_bids_vendor_id_fkey'` });
  console.log(data, error);
}
run();
