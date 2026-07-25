import { supabase } from './src/core/supabase'; 
async function run() { 
  const { data } = await supabase.from('routes').select(`
    id,
    route_stops ( sequence, delivery_points ( name, address ) )
  `).limit(1); 
  console.log(JSON.stringify(data, null, 2));
} 
run();
