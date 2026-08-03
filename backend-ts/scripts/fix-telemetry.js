const { Client } = require('pg');
require('dotenv').config({ path: '../.env' });

const client = new Client({
  connectionString: 'postgresql://postgres:postgres@localhost:54322/postgres' // fallback to local
});

async function run() {
  await client.connect();
  console.log('Connected to pg.');
  await client.query(`
    ALTER TABLE public.telemetry ALTER COLUMN id SET DEFAULT gen_random_uuid();
    NOTIFY pgrst, 'reload schema';
  `);
  console.log('Telemetry id default fixed.');
  await client.end();
}

run().catch(console.error);
