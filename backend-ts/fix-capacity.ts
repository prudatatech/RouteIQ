import { supabase } from './src/core/supabase';

async function run() {
  const { data, error } = await supabase.from('vehicles').update({ available_capacity_kg: 0 }).eq('plate_number', 'TRUCK-5009');
  console.log('Updated:', error ? error : 'Success');
}
run();
