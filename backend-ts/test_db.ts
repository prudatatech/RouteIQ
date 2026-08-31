import { supabase } from './src/core/supabase';
async function run() {
  const {data: s} = await supabase.from('shipments').select('*').eq('status', 'created');
  console.log('Shipments:', JSON.stringify(s, null, 2));
}
run();
