const fs = require('fs');
const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres:postgres@localhost:54322/postgres',
});

async function run() {
  try {
    await client.connect();
    const sql = fs.readFileSync('kyc_migration.sql', 'utf8');
    await client.query(sql);
    console.log('KYC SQL migration executed successfully');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await client.end();
  }
}
run();
