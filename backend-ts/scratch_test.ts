import { capacityService } from './src/services/capacity.service';
import { supabase } from './src/core/supabase';

async function test() {
  try {
    const { data: vehicle } = await supabase.from('vehicles').select('id, available_capacity_kg').limit(1).single();
    if (!vehicle) {
      console.log('No vehicle found');
      return;
    }
    
    console.log(`Trying to open window for vehicle ${vehicle.id} with ${vehicle.available_capacity_kg}kg`);
    const window = await capacityService.openBackhaulWindow(vehicle.id, vehicle.available_capacity_kg || 1000, 'mid_route');
    console.log('Success:', window);
  } catch (error: any) {
    console.error('Error:', error.message);
  }
}

test();
