import { supabase } from './src/core/supabase';
async function fix() {
  const { data, error } = await supabase.from('cargo_manifest').select('id, vehicle_id').is('pickup_lat', null);
  for (const row of data || []) {
    const { data: v } = await supabase.from('vehicles').select('latitude, longitude').eq('id', row.vehicle_id).single();
    if (v) await supabase.from('cargo_manifest').update({ pickup_lat: v.latitude, pickup_lng: v.longitude }).eq('id', row.id);
    console.log('Fixed:', row.id);
  }
  
  const { data: d2 } = await supabase.from('cargo_manifest').select('id').is('drop_lat', null);
  for (const row of d2 || []) {
     await supabase.from('cargo_manifest').update({ drop_lat: 12.9716, drop_lng: 77.5946 }).eq('id', row.id);
     console.log('Fixed drop:', row.id);
  }
  console.log('Done');
}
fix();
