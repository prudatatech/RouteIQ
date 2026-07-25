const { Client } = require('pg');

async function migrate() {
  const client = new Client({
    user: 'postgres',
    password: 'password', // Standard fallback, though often not needed for local postgres on windows if configured to trust
    host: 'localhost',
    port: 5432,
    database: 'routeiq'
  });

  try {
    await client.connect();
    
    // Add cost to routes
    await client.query(`ALTER TABLE public.routes ADD COLUMN IF NOT EXISTS cost numeric;`);
    
    // Add cost to cargo_manifest
    await client.query(`ALTER TABLE public.cargo_manifest ADD COLUMN IF NOT EXISTS cost numeric;`);
    
    // Populate routes
    await client.query(`UPDATE public.routes SET cost = FLOOR(RANDOM() * 3000 + 1500) WHERE cost IS NULL;`);
    
    // Populate cargo_manifest
    await client.query(`UPDATE public.cargo_manifest SET cost = FLOOR(RANDOM() * 3000 + 1500) WHERE cost IS NULL;`);
    
    console.log("Migration successful!");
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    await client.end();
  }
}

migrate();
