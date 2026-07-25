import { supabase } from './src/core/supabase';
async function run() {
  const { data: shipments } = await supabase.from('shipments').select('id, tracking_id, delivery_points(id, name)').eq('cargo_type', 'backhaul_bidding').eq('open_bidding', false);
  if (!shipments) return;
  for (const s of shipments) {
    if (s.delivery_points && s.delivery_points.length > 1) {
      const dummyDp = s.delivery_points.find((dp: any) => dp.name === 'New Location' || dp.name === 'Unknown Address');
      if (dummyDp) {
        await supabase.from('delivery_points').delete().eq('id', dummyDp.id);
        console.log(`Cleaned up dummy destination for ${s.tracking_id}`);
      }
    }
  }
}
run();
