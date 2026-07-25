import { supabase } from './src/core/supabase';

async function run() {
  console.log('Fetching shipments...');
  const { data: shipments, error: err1 } = await supabase
    .from('shipments')
    .select('id, tracking_id')
    .not('bid_id', 'is', null);

  if (err1) {
    console.error('Error fetching shipments:', err1);
    return;
  }

  for (const s of shipments || []) {
    const { data: dps, error: err2 } = await supabase
      .from('delivery_points')
      .select('id, name')
      .eq('shipment_id', s.id);
      
    if (dps && dps.length > 1) {
      console.log(`Shipment ${s.tracking_id} has ${dps.length} delivery points. Cleaning up dummy...`);
      const dummyDp = dps.find(dp => dp.name === 'New Location' || dp.name === 'Unknown Address');
      if (dummyDp) {
        await supabase.from('delivery_points').delete().eq('id', dummyDp.id);
        console.log(`Deleted dummy point for ${s.tracking_id}`);
      }
    }
  }
  console.log('Done!');
}
run();
