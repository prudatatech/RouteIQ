const { Client } = require('pg');
const client = new Client({
  user: 'postgres',
  password: 'password', // standard windows postgres password often is postgres or admin or password
  host: 'localhost',
  port: 5432,
  database: 'margixindia'
});

async function run() {
  try {
    await client.connect();
    console.log('Connected!');
    await client.query(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS vehicle_type text;`);
    console.log('Done.');
  } catch (e) {
    console.error(e);
  } finally {
    await client.end();
  }
}
run();
