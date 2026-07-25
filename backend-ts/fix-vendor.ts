import { supabase } from './src/core/supabase';

async function run() {
  const { data, error } = await supabase.from('vendor_profiles').update({ address: 'Dhanbad Main Hub, Station Road' }).is('address', null).eq('city', 'Dhanbad');
  console.log('Error:', error);
  console.log('Updated address for Dhanbad vendors');
}
run();
