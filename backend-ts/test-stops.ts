import { supabase } from './src/core/supabase';

async function run() {
  const { data: stops } = await supabase.from('route_stops').select('id, sequence, delivery_point_id, delivery_points(name, latitude, longitude)').order('created_at', { ascending: false }).limit(5);
  console.log('Stops:', JSON.stringify(stops, null, 2));
}
run();
