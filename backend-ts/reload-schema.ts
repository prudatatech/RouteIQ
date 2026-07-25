import { supabase } from './src/core/supabase';

async function run() {
  const { data, error } = await supabase.from('vendor_profiles').select('*');
  console.log('Profiles:', data);
}
run();
