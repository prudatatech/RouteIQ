// Fails when any locale's key set differs from English.
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const src = fs.readFileSync(path.join(__dirname, '../src/locales/index.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: 'commonjs' } }).outputText;
const m = { exports: {} };
new Function('module', 'exports', js)(m, m.exports);
const tr = m.exports.translations;
let bad = 0;
for (const [lang, dict] of Object.entries(tr)) {
  const keys = Object.keys(dict);
  const missing = Object.keys(tr.en).filter((k) => !(k in dict));
  const extra = keys.filter((k) => !(k in tr.en));
  if (missing.length || extra.length) {
    bad++;
    console.error(`${lang}: missing [${missing}] extra [${extra}]`);
  } else {
    console.log(`${lang}: ${keys.length} keys OK`);
  }
}
process.exit(bad ? 1 : 0);
