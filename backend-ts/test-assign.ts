import { supabase } from './src/core/supabase';
import { vendorService } from './src/services/vendor.service';

async function run() {
  console.log('Testing assignVehicleToRequest...');
  // 1. Create a dummy vendor request
  const { data: user } = await supabase.from('users').select('id').eq('role', 'vendor').limit(1).single();
  const { data: vehicle } = await supabase.from('vehicles').select('id').limit(1).single();
  
  if (!user || !vehicle) {
    console.error('No vendor or vehicle found');
    return;
  }
  
  console.log(`Using Vendor: ${user.id}, Vehicle: ${vehicle.id}`);
  
  const req = await vendorService.createShipmentRequest(
    user.id,
    { address: 'Delhi', lat: 28.7041, lng: 77.1025 },
    { address: 'Gurgaon', lat: 28.4595, lng: 77.0266 },
    100
  );
  
  console.log(`Created request: ${req.id}`);
  
  // 2. Assign the vehicle
  const result = await vendorService.assignVehicleToRequest(req.id, vehicle.id, 1000, 18);
  console.log('Assign result:', result);
  
  // 3. Verify cargo_manifest
  const { data: manifest } = await supabase.from('cargo_manifest').select('*').eq('vendor_request_id', req.id);
  console.log('Cargo manifest:', manifest);
  
  // 4. Verify notifications
  const { data: notif } = await supabase.from('notifications').select('*').eq('data->>request_id', req.id).order('created_at', { ascending: false });
  console.log('Notifications generated:', notif?.length);
}

run().catch(console.error);
