import { supabase } from './core/supabase';

async function fetchVendorData() {
  const vendorId = 'a8dfb363-f81f-4770-a62d-e3d24a766a42';
  console.log(`Fetching data for ID: ${vendorId}\n`);

  const { data: user } = await supabase.from('users').select('*').eq('id', vendorId).single();
  console.log('--- User Record ---');
  console.log(user ? JSON.stringify(user, null, 2) : 'Not found in users table');

  const { data: vendorProfile } = await supabase.from('vendor_profiles').select('*').eq('id', vendorId).single();
  console.log('\n--- Vendor Profile ---');
  console.log(vendorProfile ? JSON.stringify(vendorProfile, null, 2) : 'Not found in vendor_profiles table');

  const { data: kycProfile } = await supabase.from('kyc_profiles').select('*').eq('id', vendorId).single();
  console.log('\n--- KYC Profile ---');
  console.log(kycProfile ? JSON.stringify(kycProfile, null, 2) : 'Not found in kyc_profiles table');

  const { data: vehicles } = await supabase.from('vehicles').select('*').eq('vendor_id', vendorId);
  console.log(`\n--- Vehicles Owned (${vehicles?.length || 0}) ---`);
  console.log(vehicles && vehicles.length > 0 ? JSON.stringify(vehicles, null, 2) : 'No vehicles found');

  const { data: requests } = await supabase.from('vendor_shipment_requests').select('*').eq('vendor_id', vendorId);
  console.log(`\n--- Vendor Shipment Requests (${requests?.length || 0}) ---`);
  console.log(requests && requests.length > 0 ? JSON.stringify(requests, null, 2) : 'No requests found');
  
  process.exit(0);
}

fetchVendorData().catch(console.error);
