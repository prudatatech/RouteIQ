// Enumerates every route of the Express app by parsing backend-ts/src/routes/*.ts and the mounts in routes/index.ts.
// Pure file parsing, no network. Used by parity.mjs; `node e2e/staging/parity-routes.mjs` prints the list.
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'backend-ts', 'src', 'routes')

export function enumerateRoutes() {
  const idx = readFileSync(join(DIR, 'index.ts'), 'utf8')
  const imp = {}
  for (const m of idx.matchAll(/import (\w+) from '\.\/([\w.-]+)'/g)) imp[m[1]] = m[2] + '.ts'
  const mounts = [...idx.matchAll(/apiRouter\.use\('([^']+)',\s*(\w+)\)/g)].map(m => [m[1], m[2]])
  const out = []
  for (const [prefix, variable] of mounts) {
    const file = imp[variable] || 'org.routes.ts'
    const router = imp[variable] ? 'router' : variable
    const src = readFileSync(join(DIR, file), 'utf8')
    const re = new RegExp(`\\b${router}\\.(get|post|put|patch|delete)\\(\\s*(['\`])([^'\`]*)\\2`, 'g')
    for (const m of src.matchAll(re)) {
      const sub = m[3] === '/' ? '' : m[3]
      out.push({ method: m[1].toUpperCase(), path: `/api/v1${prefix}${sub}`.replace(/^\/api\/v1/, ''), file })
    }
  }
  // fleet.routes.ts also mounts maintenance routes under the same prefix
  const extra = readdirSync(DIR).includes('fleet-maintenance.routes.ts')
  void extra // (fleet-maintenance and fuel are mounted through index.ts / fleet.routes.ts `router.use(...)`)
  const fm = readFileSync(join(DIR, 'fleet-maintenance.routes.ts'), 'utf8')
  for (const m of fm.matchAll(/\brouter\.(get|post|put|patch|delete)\(\s*(['`])([^'`]*)\2/g)) {
    const p = `/fleet${m[3] === '/' ? '' : m[3]}`
    if (!out.some(o => o.method === m[1].toUpperCase() && o.path === p)) out.push({ method: m[1].toUpperCase(), path: p, file: 'fleet-maintenance.routes.ts' })
  }
  const seen = new Set()
  return out.filter(o => { const k = o.method + ' ' + o.path; if (seen.has(k)) return false; seen.add(k); return true })
}

if (process.argv[1] && process.argv[1].endsWith('parity-routes.mjs')) {
  const r = enumerateRoutes()
  console.log(r.length, 'routes')
  for (const o of r) console.log(o.method.padEnd(6), o.path, ' ', o.file)
}
