import { supabase } from '../src/core/supabase';

async function testUpdate() {
  const finalShipmentId = '911d03a6-6951-47f3-a334-7b0e4c0a578d'; // From test_dp.ts output
  const vendorDpId = 'b4eff70d-a754-4dc9-a21f-433d2fb74503'; // Vendor DP from test_dp.ts output (Kolkata)

  console.log("Fetching vendor DP...");
  const { data: vendorDp, error: vErr } = await supabase.from('delivery_points').select('*').eq('id', vendorDpId).single();
  if (vErr) console.log("vErr", vErr);
  
  if (vendorDp) {
    console.log("Overwriting dummy DP...");
    const { data: updData, error: updErr } = await supabase.from('delivery_points')
      .update({
        name: vendorDp.name,
        address: vendorDp.address,
        latitude: vendorDp.latitude,
        longitude: vendorDp.longitude,
        demand_kg: vendorDp.demand_kg
      })
      .eq('shipment_id', finalShipmentId)
      .select();
      
    if (updErr) console.log("updErr", updErr);
    console.log("Update result:", updData);
    
    // Now delete vendor DP
    console.log("Deleting vendor DP...");
    const { error: delErr } = await supabase.from('delivery_points').delete().eq('id', vendorDpId);
    if (delErr) console.log("delErr", delErr);
    
    console.log("Fetching dummy DP id...");
    const { data: dummyDp, error: dErr } = await supabase.from('delivery_points').select('id').eq('shipment_id', finalShipmentId).limit(1);
    if (dErr) console.log("dErr", dErr);
    console.log("dummyDp:", dummyDp);
  }
}
testUpdate();
