import { supabase } from '../src/core/supabase';
import crypto from 'crypto';

async function run() {
  const driverId = 'a7b38f7f-214d-4c18-bd0e-98ac21ab10c3'; // ID of Driver 5009

  const { data: existing, error: existErr } = await supabase.from('vehicles').select('*').eq('plate_number', 'TRUCK-5009');
  if (existing && existing.length > 0) {
    console.log('Vehicle already exists, updating driver_id...');
    await supabase.from('vehicles').update({ driver_id: driverId }).eq('plate_number', 'TRUCK-5009');
    console.log('Done!');
    return;
  }

  const { data: newV, error } = await supabase.from('vehicles').insert({
    id: crypto.randomUUID(),
    plate_number: 'TRUCK-5009',
    vehicle_type: 'truck',
    status: 'idle',
    driver_id: driverId,
    capacity_kg: 5000
  }).select();
  
  if (error) {
    console.error('Insert error:', error);
  } else {
    console.log('Assigned new vehicle:', newV);
  }
}
run();
