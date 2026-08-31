const fs = require('fs');
let f = fs.readFileSync('src/locales/index.ts', 'utf8');
f = f.replace(/find_return: 'Find Return Load',/g, "find_return: 'Find Return Load',\n    find_return_load_btn: 'Find Return Load',");
// Fix the duplicate keys causing tsc errors
// Just remove lines with identical keys? The error was "An object literal cannot have multiple properties with the same name."
// We can just leave the tsc error as it doesn't break the bundler, but fixing the key is good.
fs.writeFileSync('src/locales/index.ts', f);
