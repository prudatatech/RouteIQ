import { supabase } from './src/core/supabase';

async function run() {
  const { data: wins } = await supabase.from('capacity_windows').select('*, vehicles(plate_number)');
  console.log('Windows:', wins);
}
run();
