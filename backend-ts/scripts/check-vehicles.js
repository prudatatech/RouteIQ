const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
globalThis.WebSocket = WebSocket;
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  try {
    const { data: users } = await supabase.from('users').select('id, phone').eq('role', 'driver');
    console.log('Drivers:', users);

    const { data: vehicles } = await supabase.from('vehicles').select('*');
    console.log('Vehicles:', vehicles);

    const { data: manifest } = await supabase.from('cargo_manifest').select('*');
    console.log('Cargo Manifest:', manifest);
    
    const { data: routes } = await supabase.from('routes').select('*');
    console.log('Routes:', routes);
    
  } catch (e) {
    console.error(e);
  }
}
main();
