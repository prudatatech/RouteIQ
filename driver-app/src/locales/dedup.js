const fs = require('fs');

const content = fs.readFileSync('index.ts', 'utf-8');

// Match the large translations object
const match = content.match(/export const translations = \{([\s\S]*?)\n\};/);
if (!match) {
  console.log('No match');
  process.exit(1);
}

const body = match[1];
const langBlocks = body.split(/^  ([a-z]{2}): \{/m);

let newBody = '';
for (let i = 1; i < langBlocks.length; i += 2) {
  const lang = langBlocks[i];
  const blockBody = langBlocks[i + 1].split(/^\s*\}(,?)/m)[0];
  
  const lines = blockBody.split('\n');
  const seenKeys = new Set();
  const newLines = [];
  
  for (const line of lines) {
    const keyMatch = line.match(/^\s*([a-zA-Z0-9_]+):/);
    if (keyMatch) {
      const key = keyMatch[1];
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        newLines.push(line);
      }
    } else {
      newLines.push(line);
    }
  }
  
  newBody += `  ${lang}: {${newLines.join('\n')}\n  },`;
}

const newContent = content.replace(match[0], `export const translations = {\n${newBody}\n};`);
fs.writeFileSync('index.ts', newContent);
console.log('Done!');
