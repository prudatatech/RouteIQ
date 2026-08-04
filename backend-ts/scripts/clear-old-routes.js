require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  realtime: { transport: ws }
});

(async () => {
  // Mark all old routes for driver 5009 as completed so they don't block cargo_manifest
  const { data, error } = await s
    .from('routes')
    .update({ status: 'completed' })
    .eq('vehicle_id', '40713a3c-ce26-4051-a1e7-20bfc4d315ba')
    .in('status', ['active', 'pending'])
    .select();
    
  console.log('Marked old routes as completed:', data?.length);
  if (error) console.error(error);
  process.exit(0);
})();
