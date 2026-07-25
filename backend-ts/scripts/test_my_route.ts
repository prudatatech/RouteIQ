import { supabase } from '../src/core/supabase';

async function testMyRoute() {
  const { data: route, error } = await supabase
    .from('routes')
    .select('*, route_stops(*, delivery_points(*)), depots(*)')
    .eq('vehicle_id', '40713a3c-ce26-4051-a1e7-20bfc4d315ba')
    .in('status', ['active', 'pending'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  console.log("ERROR:", error);
  console.log("ROUTE:", JSON.stringify(route, null, 2));
}
testMyRoute();
