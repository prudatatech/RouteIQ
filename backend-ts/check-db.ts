import { supabase } from './src/core/supabase';
async function run() {
  const { data, error } = await supabase.from('shipments').select('id').eq('tracking_id', 'RTX-NT8FVV2');
  console.log('Shipment:', data, error);
}
run();
