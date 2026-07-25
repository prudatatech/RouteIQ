require('dotenv').config();
const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL });
client.connect().then(() => client.query("SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_enum.enumtypid = pg_type.oid WHERE pg_type.typname = 'vehicle_type';"))
  .then(r => { console.log(r.rows); client.end(); })
  .catch(e => { console.error(e); client.end(); });
