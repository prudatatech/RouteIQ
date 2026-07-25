import { supabase } from './src/core/supabase';
async function run() {
  const sql = `
    ALTER TABLE vendor_profiles DROP CONSTRAINT IF EXISTS vendor_profiles_id_fkey CASCADE;
    ALTER TABLE vendor_profiles ADD CONSTRAINT vendor_profiles_id_fkey FOREIGN KEY (id) REFERENCES public.users(id) ON DELETE CASCADE;
    NOTIFY pgrst, 'reload schema';
  `;
  const { error } = await supabase.rpc('exec_sql', { query: sql });
  if (error) {
    console.log('RPC failed, trying raw PG query...');
    const { Client } = require('pg');
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query(sql);
    await client.end();
    console.log('Ran via pg');
  } else {
    console.log('Ran via RPC');
  }
}
run().catch(console.error);
