import { supabase } from './src/core/supabase';

async function run() {
  const { data, error } = await supabase.from('capacity_bids').select('*');
  console.log('Bids:', data);
  if (error) console.error(error);
}
run();
