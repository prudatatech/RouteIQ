#!/usr/bin/env node
/**
 * Generates platform theme files from design/tokens.json.
 *
 *   node design/generate-tokens.mjs          write the generated files
 *   node design/generate-tokens.mjs --check  exit 1 if any generated file is stale
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tokens = JSON.parse(readFileSync(join(root, 'design/tokens.json'), 'utf8'))
const banner = 'Generated from design/tokens.json by design/generate-tokens.mjs. Do not edit.'

const kebab = s => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()

function webCss() {
  const lines = [`/* ${banner} */`, ':root {']
  for (const [name, value] of Object.entries(tokens.color)) lines.push(`  --color-${kebab(name)}: ${value};`)
  lines.push(`  --font-sans: '${tokens.font.sans}', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;`)
  lines.push(`  --font-mono: '${tokens.font.mono}', ui-monospace, SFMono-Regular, Menlo, monospace;`)
  for (const [name, value] of Object.entries(tokens.radius)) lines.push(`  --radius-${kebab(name)}: ${value}px;`)
  for (const [name, value] of Object.entries(tokens.size)) lines.push(`  --size-${kebab(name)}: ${value}px;`)
  lines.push('}', '')
  return lines.join('\n')
}

function mobileTs() {
  const { $description: _unused, ...rest } = tokens
  return `// ${banner}\nexport const tokens = ${JSON.stringify(rest, null, 2)} as const\n\nexport type ColorToken = keyof typeof tokens.color\n`
}

const outputs = {
  'frontend/src/theme/tokens.css': webCss(),
  // Copy inside the frontend package so tailwind.config.js never reads outside its project root.
  'frontend/src/theme/tokens.json': JSON.stringify(tokens, null, 2) + '\n',
  'driver-app/src/theme/tokens.ts': mobileTs(),
  'customer-app/src/theme/tokens.ts': mobileTs(),
}

const check = process.argv.includes('--check')
let stale = []
for (const [path, content] of Object.entries(outputs)) {
  const abs = join(root, path)
  const current = existsSync(abs) ? readFileSync(abs, 'utf8') : null
  if (current === content) continue
  if (check) { stale.push(path); continue }
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content)
  console.log(`wrote ${relative(root, abs)}`)
}
if (stale.length) {
  console.error(`Stale generated theme files (run node design/generate-tokens.mjs):\n  ${stale.join('\n  ')}`)
  process.exit(1)
}
