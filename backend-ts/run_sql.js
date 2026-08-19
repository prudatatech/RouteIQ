const fs = require('fs');
const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/margixindia',
});

async function run() {
  await client.connect();
  const sql = fs.readFileSync('scripts/create_sos_alerts.sql', 'utf8');
  await client.query(sql);
  console.log('SQL executed successfully');
  await client.end();
}
run().catch(console.error);
