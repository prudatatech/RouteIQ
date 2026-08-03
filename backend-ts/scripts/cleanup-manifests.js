require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  realtime: { transport: ws }
});

(async () => {
  // Delete duplicate manifests for vehicle 40713a3c, keep only the latest one (88a10a2c)
  const { data: dupes, error: delErr } = await s
    .from('cargo_manifest')
    .delete()
    .eq('vehicle_id', '40713a3c-ce26-4051-a1e7-20bfc4d315ba')
    .neq('id', '88a10a2c-d4c6-45d2-9a9c-ed3b950d2827')
    .select();
  
  console.log('Deleted duplicates:', dupes?.length, delErr?.message || 'OK');

  // Verify remaining
  const { data } = await s
    .from('cargo_manifest')
    .select('id, status, pickup_location')
    .eq('vehicle_id', '40713a3c-ce26-4051-a1e7-20bfc4d315ba');
  console.log('Remaining manifests:', JSON.stringify(data, null, 2));
  
  process.exit(0);
})();
