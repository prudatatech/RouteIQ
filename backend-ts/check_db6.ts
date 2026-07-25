import { Client } from 'pg';

async function run() {
  const client = new Client({
    connectionString: 'postgresql://postgres:postgres@localhost:54322/postgres'
  });
  await client.connect();
  console.log('Connected to pg. Running migration...');
  
  await client.query(`
    ALTER TABLE public.cargo_manifest ADD COLUMN IF NOT EXISTS cost NUMERIC DEFAULT 0;
    ALTER TABLE public.cargo_manifest ADD COLUMN IF NOT EXISTS cost_per_km NUMERIC DEFAULT 0;
    NOTIFY pgrst, 'reload schema';
  `);
  
  console.log('Migration completed.');
  await client.end();
}

run().catch(console.error);
