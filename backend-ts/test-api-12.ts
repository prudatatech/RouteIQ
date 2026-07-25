import { supabase } from './src/core/supabase';

async function run() {
  const { data, error } = await supabase.from('shipments').select('*').limit(1);
  console.log('Shipments:', data);
  if (error) console.error(error);
}
run();
