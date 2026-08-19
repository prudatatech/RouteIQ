const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgresql://postgres:postgres@localhost:5432/margixindia'
});
client.connect().then(() => {
  return client.query(`ALTER TABLE cargo_manifest ADD COLUMN IF NOT EXISTS route_type VARCHAR(50) DEFAULT 'forward';`);
}).then(() => {
  console.log('Added column route_type');
  return client.query(`NOTIFY pgrst, 'reload schema';`);
}).then(() => {
  console.log('Reloaded schema');
  process.exit(0);
}).catch(e => {
  console.error(e);
  process.exit(1);
});
