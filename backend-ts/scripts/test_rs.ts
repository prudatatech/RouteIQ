import { supabase } from '../src/core/supabase';

async function checkRouteStops() {
  const { data: rs } = await supabase.from('route_stops').select('*').eq('route_id', 'b1368bad-eb63-4c0b-9a16-f2f7bdd9c33e');
  console.log("ROUTE STOPS:", JSON.stringify(rs, null, 2));
}
checkRouteStops();
