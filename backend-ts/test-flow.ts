import { supabase } from './src/core/supabase';

async function run() {
  const { data, error } = await supabase.rpc('pgrst_source_query', { query: "SELECT conname, pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_class t ON c.conrelid = t.oid WHERE t.relname = 'vendor_profiles';" });
  console.log(error);
}
run();
