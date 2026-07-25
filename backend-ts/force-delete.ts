import { supabase } from './src/core/supabase';
async function run() {
  const shipmentId = '80c71bc6-d5ba-4771-9c4b-7615a62d75c1';
  
  // 1. Unlink delivery points instead of deleting them to avoid capacity_bids constraint
  await supabase.from('delivery_points').update({ shipment_id: null }).eq('shipment_id', shipmentId);
  console.log('Unlinked delivery points');
  
  // 2. Unlink capacity windows
  await supabase.from('capacity_windows').update({ fallback_shipment_id: null }).eq('fallback_shipment_id', shipmentId);
  console.log('Unlinked capacity windows');
  
  // 3. Delete shipment logs
  await supabase.from('shipment_logs').delete().eq('shipment_id', shipmentId);
  
  // 4. Delete the shipment
  const { error: err } = await supabase.from('shipments').delete().eq('id', shipmentId);
  console.log('Deleted shipment:', err);
}
run();
