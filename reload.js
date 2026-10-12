const { Client } = require('pg');
const client = new Client({
  connectionString: 'postgres://authenticator:71fd729d623389fdadec861279a190889f57833c12349c7c@margix-test-pg.postgres.database.azure.com:5432/postgres?sslmode=require'
});
client.connect().then(() => client.query("NOTIFY pgrst, 'reload schema';")).then(() => { console.log('Schema cache reloaded!'); client.end(); }).catch(e => console.error(e));
