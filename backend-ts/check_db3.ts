import { supabase } from './src/core/supabase';

async function run() {
  const req = {
    pickup_location: "No Jharia-Dhanbad Rd Opposite Bus ، 828309 Jharia، India",
    pickup_lat: 23.737735,
    pickup_lng: 86.417065,
    drop_location: "Sandalpur Rd ، 800007 Patna، India",
    drop_lat: 25.604039,
    drop_lng: 85.187298,
    required_capacity_kg: 5000,
  };
  const vehicleId = "40713a3c-ce26-4051-a1e7-20bfc4d315ba";
  const requestId = "cd694b68-aaf3-4911-b347-755e35069db5";

  console.log('Inserting into cargo_manifest...');
  const { data, error } = await supabase.from('cargo_manifest').insert({
    vehicle_id: vehicleId,
    vendor_request_id: requestId,
    pickup_location: req.pickup_location,
    pickup_lat: req.pickup_lat,
    pickup_lng: req.pickup_lng,
    drop_location: req.drop_location,
    drop_lat: req.drop_lat,
    drop_lng: req.drop_lng,
    capacity_kg: req.required_capacity_kg,
    cost: 0,
    cost_per_km: 0,
    status: 'scheduled',
    created_at: new Date().toISOString()
  });
  
  if (error) {
    console.error('Insert Error:', JSON.stringify(error, null, 2));
  } else {
    console.log('Insert Success:', data);
  }
}

run();
