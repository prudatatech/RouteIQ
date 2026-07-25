import { supabase } from './src/core/supabase';

async function run() {
  const { data: vehicle } = await supabase.from('vehicles').select('*').eq('plate_number', 'TRUCK-5009').single();
  console.log('Vehicle:', vehicle);
  if (vehicle) {
    const { data: wins } = await supabase.from('capacity_windows').select('*').eq('vehicle_id', vehicle.id).order('created_at', { ascending: false });
    console.log('Windows:', wins);
  }
}
run();
