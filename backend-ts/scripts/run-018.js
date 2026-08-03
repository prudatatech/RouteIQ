const fs = require('fs');
const { Client } = require('pg');

async function run() {
  const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:54322/postgres'
  });
  await client.connect();
  console.log('Connected to pg. Running migration...');
  
  const sql = fs.readFileSync('../supabase/migrations/018_fix_vendor_driver_flow.sql', 'utf8');
  await client.query(sql);
  
  console.log('Migration completed.');
  await client.end();
}

run().catch(console.error);
