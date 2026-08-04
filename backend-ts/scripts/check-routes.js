require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  realtime: { transport: ws }
});

(async () => {
  // Let's see if there are any `routes` for this vehicle
  const { data: routes } = await s
    .from('routes')
    .select('id, status, created_at')
    .eq('vehicle_id', '40713a3c-ce26-4051-a1e7-20bfc4d315ba')
    .in('status', ['active', 'pending']);
    
  console.log('Active/pending routes for vehicle:', JSON.stringify(routes, null, 2));
  
  // Try to update one of the manifests to in_transit to test if there's any other error
  const { error } = await s
    .from('cargo_manifest')
    .update({ status: 'in_transit' })
    .eq('id', '2c810b4b-042b-449b-9e26-f349bffba4ed');
    
  console.log('Update to in_transit error:', error?.message || 'OK');
  process.exit(0);
})();
