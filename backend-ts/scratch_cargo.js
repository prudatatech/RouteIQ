const { Client } = require('pg');
const c = new Client('postgres://postgres:postgres@localhost:5432/margixindia');
c.connect().then(() => {
  return c.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'cargo_manifest';");
}).then(r => {
  console.log(r.rows.map(row => row.column_name).join(', '));
  process.exit(0);
});
