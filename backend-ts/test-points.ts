import { supabase } from './src/core/supabase';

async function run() {
  const { data, error } = await supabase.from('delivery_points').select('id, name').eq('id', '6dfb8790-f58b-49c8-8ebe-760fd747557d');
  console.log('Points:', data);
  if (error) console.error(error);
}
run();
