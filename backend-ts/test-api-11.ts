import { supabase } from './src/core/supabase';

async function run() {
  const { data, error } = await supabase.from('capacity_bids').select('*, vendor_profiles(company_name)');
  console.log('Bids:', data);
  if (error) console.error(error);
}
run();
