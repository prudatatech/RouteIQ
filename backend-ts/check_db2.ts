import { supabase } from './src/core/supabase';

async function run() {
  console.log('Querying vendor_shipment_requests...');
  const { data, error } = await supabase.from('vendor_shipment_requests').select('*').limit(1);
  console.log('Data:', JSON.stringify(data, null, 2));
  if (error) console.error('Error:', error);
}

run();
