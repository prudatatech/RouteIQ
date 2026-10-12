const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgres://authenticator:71fd729d623389fdadec861279a190889f57833c12349c7c@margix-test-pg.postgres.database.azure.com:5432/postgres?sslmode=require'
});
client.connect()
  .then(() => client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'tpl_partners';"))
  .then(res => {
    console.log(res.rows.map(r => r.column_name).join(', '));
    client.end();
  })
  .catch(err => console.error(err));
