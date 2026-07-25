import { supabase } from './src/core/supabase';

async function run() {
  const { data, error } = await supabase.rpc('get_schema');
  // Just query information_schema directly
}
run();
