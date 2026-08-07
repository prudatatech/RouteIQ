import { supabase } from './core/supabase';

async function fetchColumns() {
  const { data, error } = await supabase.rpc('get_shipment_columns');
  
  if (error) {
    console.log("RPC failed, trying raw query via REST if possible, or fallback.");
    // Supabase JS client cannot query information_schema directly.
    // Let's just fetch one shipment and print its keys.
    const { data: ship, error: e2 } = await supabase.from('shipments').select('*').limit(1);
    if (ship && ship.length > 0) {
      console.log(Object.keys(ship[0]));
    } else {
      console.log('No shipments found or error:', e2);
    }
  } else {
    console.log(data);
  }
  
  process.exit(0);
}

fetchColumns().catch(console.error);
