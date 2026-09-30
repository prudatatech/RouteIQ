// Runs tests/*.test.ts with node:test. TypeScript is compiled on the fly with the
// project's own `typescript`, so no test package is needed.
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
  const out = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  });
  module._compile(out.outputText, filename);
};

const dir = path.join(__dirname, '../tests');
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.test.ts')).sort()) require(path.join(dir, file));
