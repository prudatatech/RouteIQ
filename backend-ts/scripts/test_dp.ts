import { supabase } from '../src/core/supabase';

async function checkDp() {
  const { data: dps } = await supabase.from('delivery_points').select('*').order('created_at', { ascending: false }).limit(5);
  console.log(JSON.stringify(dps, null, 2));
  
  const { data: stops } = await supabase.from('route_stops').select('*, delivery_points(*)').order('created_at', { ascending: false }).limit(2);
  console.log(JSON.stringify(stops, null, 2));
}

checkDp();
