import { supabase } from './src/core/supabase';
async function run() {
  const shipmentId = '80c71bc6-d5ba-4771-9c4b-7615a62d75c1';
  const { data: dps } = await supabase.from('delivery_points').select('id').eq('shipment_id', shipmentId);
  console.log('DPs:', dps);
  if (dps && dps.length > 0) {
    const dpIds = dps.map((dp: any) => dp.id);
    const { error: err1 } = await supabase.from('route_stops').delete().in('delivery_point_id', dpIds);
    console.log('Deleted stops:', err1);
    
    const { error: err2 } = await supabase.from('delivery_points').delete().eq('shipment_id', shipmentId);
    console.log('Deleted DP:', err2);
  }
  const { error: err3 } = await supabase.from('capacity_windows').update({ fallback_shipment_id: null }).eq('fallback_shipment_id', shipmentId);
  console.log('Unlinked from capacity_windows:', err3);
  
  const { error: err4 } = await supabase.from('shipments').delete().eq('id', shipmentId);
  console.log('Deleted shipment:', err4);
}
run();
