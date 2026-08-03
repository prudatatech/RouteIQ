require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  realtime: { transport: ws }
});

(async () => {
  const { data, error } = await s
    .from('cargo_manifest')
    .select('id, vehicle_id, status, pickup_location, drop_location, vendor_request_id')
    .order('created_at', { ascending: false })
    .limit(5);
  console.log('cargo_manifest rows:', JSON.stringify(data, null, 2));
  if (error) console.error('Error:', error);
  
  // Also check which vehicle driver 5009 has
  const { data: vehicles } = await s.from('vehicles').select('id, plate_number, driver_id, status').not('driver_id', 'is', null).limit(10);
  console.log('\nVehicles with drivers:', JSON.stringify(vehicles, null, 2));
  
  process.exit(0);
})();
