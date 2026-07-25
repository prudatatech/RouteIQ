const fs = require('fs');
const content = fs.readFileSync('schema.json', 'utf16le');
const schema = JSON.parse(content);
console.log(Object.keys(schema.tables.routes.columns));
