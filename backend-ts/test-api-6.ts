import { supabase } from './src/core/supabase';

async function run() {
  const { data: vendor } = await supabase.from('vendor_profiles').select('*').ilike('address', '%Jhariya%').single();
  console.log('Vendor:', vendor);
}
run();
