// Azure parity sweep: everything that passes on the runner's local Supabase but may fail on Azure PostgreSQL + the
// self-hosted platform. Re-runnable (fresh @margix.test accounts and a fresh company each run). Test stage only.
//
//   node e2e/staging/parity.mjs                  all sections
//   node e2e/staging/parity.mjs tables rpc ws    only those sections  (tables | routes | rpc | storage | ws | perf)
//   PARITY_OUT=/some/dir node e2e/staging/parity.mjs   also writes crawl.md (the full route table) and raw.json there
//
// Sections: 1 routes (every GET as every actor, every mutating route with an empty body), 2 tables (service role,
// company-admin JWT and anon through the data gateway), 3 rpc (every supabase.rpc() the API makes, through the API),
// 4 storage (every signed-upload route, read back, and who may read what), 5 ws (API feed + realtime gateway),
// 6 perf (latency of the most used GET endpoints).
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  API, DATA, env, api, db, check, results, sleep, tag, makeCompany, makeCompanyAdmin, makeDriver, makePlatformAdmin, makeVendor,
  makeUser, login, putSigned, readObject, PNG,
} from './actors.mjs'
import { enumerateRoutes } from './parity-routes.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const want = new Set(process.argv.slice(2).filter(a => !a.startsWith('-')))
const run = name => want.size === 0 || want.has(name)
const OUT = process.env.PARITY_OUT
const raw = { routes: [], tables: [], rpc: [], storage: [], ws: [], perf: [] }
const bugs = []
const bug = (area, what, detail = '') => { bugs.push({ area, what, detail }); console.log(`BUG   [${area}] ${what}  ${String(detail).slice(0, 220)}`) }

// A response is a parity bug when it is a 5xx, or its body shows a database/gateway error that a user must never see.
const LEAK = /permission denied|(relation|column|function|table|schema|policy|bucket) ["'\w.]+ does not exist|schema cache|violates|relation ["']|at .*\.(ts|js):\d+|\bstack\b|ECONNREFUSED|\bPGRST\d+|\b42501\b|\b42P01\b|\b23502\b|invalid input syntax|ENOTFOUND/i
const leak = text => { const m = LEAK.exec(text); return m ? text.slice(Math.max(0, m.index - 40), m.index + 120).replace(/\s+/g, ' ') : null }

async function pool(items, size, fn) {
  const out = new Array(items.length); let i = 0
  await Promise.all(Array.from({ length: size }, async () => { while (i < items.length) { const n = i++; out[n] = await fn(items[n], n) } }))
  return out
}
async function call(token, method, path, body, org, tries = 3) {
  for (let t = 0; t < tries; t++) {
    const t0 = performance.now()
    let res
    try {
      res = await fetch(`${API}${path}`, {
        method, headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(org ? { 'X-Org-Id': org } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000),
      })
    } catch (e) { return { status: 0, text: String(e), ms: performance.now() - t0, timing: '' } }
    const text = await res.text()
    const ms = performance.now() - t0
    if (res.status === 429 && t < tries - 1) { await sleep(2000 * (t + 1)); continue }
    return { status: res.status, text, ms, timing: res.headers.get('server-timing') || '' }
  }
}

// ── The world: one company with its people, a vendor, a few rows ───────────────────────────────────────────────────
let W
async function world() {
  if (W) return W
  const t0 = Date.now()
  const company = await makeCompany(`Parity Co ${tag()}`)
  const other = await makeCompany(`Parity Other ${tag()}`)
  const [admin, manager, driver, platform, adminB] = await Promise.all([
    makeCompanyAdmin(company.id), makeCompanyAdmin(company.id, 'manager'), makeDriver(company.id), makePlatformAdmin(), makeCompanyAdmin(other.id),
  ])
  const vendor = await makeVendor({ admin })
  let customer = null
  try { const u = await makeUser(`${tag()}-customer`, 'customer'); customer = { ...u, token: await login(u.email), role: 'customer' } } catch { /* optional */ }
  W = { company, other, admin, manager, driver, platform, adminB, vendor: { ...vendor, role: 'vendor' }, customer, ids: {} }
  // rows the param routes need
  const veh = await api(admin.token, 'POST', '/vehicles', { plate_number: `MH${Math.floor(1000 + Math.random() * 8999)}PR${Math.floor(10 + Math.random() * 89)}`, vehicle_type: 'truck', capacity_kg: 9000, fuel_type: 'diesel', fuel_capacity_liters: 200, fuel_efficiency_kmpl: 6, status: 'available' }, { org: company.id })
  W.vehicle = veh.body?.id ? veh.body : null
  if (!W.vehicle) bug('world', 'could not create a vehicle', JSON.stringify(veh.body).slice(0, 200))
  const load = await api(vendor.token, 'POST', '/vendor/loads', loadDraft())
  W.load = load.body?.id ? load.body : null
  if (!W.load) bug('world', 'could not post a load', `${load.status} ${JSON.stringify(load.body).slice(0, 200)}`)
  console.log(`world ready in ${Math.round((Date.now() - t0) / 1000)}s: company ${company.id}`)
  return W
}
const tomorrow = () => new Date(Date.now() + 86_400_000 + 5.5 * 3600e3).toISOString().slice(0, 10)
function loadDraft() {
  return {
    client_request_id: randomUUID(),
    items: [{ product_name: 'Cement bags', hsn_code: '2523', gst_rate: 18, quantity: 400, unit: 'bags', weight_kg: 20000, declared_value: 700000 }],
    pickup_city: 'Mumbai', pickup_address: 'Plot 4, MIDC Andheri', pickup_pincode: '400093', pickup_lat: 19.1197, pickup_lng: 72.8464,
    pickup_date: tomorrow(), pickup_slot: 'morning', pickup_contact_name: 'Ravi', pickup_contact_phone: '+919800000000',
    delivery_city: 'Delhi', delivery_address: 'Warehouse 2, Okhla', delivery_pincode: '110020', delivery_lat: 28.5355, delivery_lng: 77.275,
    vehicle_class: 'sxl_32', load_type: 'ftl',
  }
}

// ── 1. Endpoint crawl ───────────────────────────────────────────────────────────────────────────────────────────────
const SEGMENT_TABLE = {
  vehicles: 'vehicles', vehicle: 'vehicles', shipments: 'shipments', routes: 'routes', loads: 'vendor_shipment_requests', invoices: 'invoices',
  bookings: 'customer_bookings', depots: 'depots', claims: 'cargo_claims', exceptions: 'cargo_exceptions', transfers: 'cargo_transfers',
  partners: 'tpl_partners', windows: 'capacity_windows', bids: 'capacity_bids', users: 'users', people: 'users', members: 'users',
  orgs: 'organizations', documents: 'load_documents', stops: 'route_stops', notifications: 'notifications', messages: 'messages', jobs: 'vehicle_maintenance_jobs',
  plans: 'vehicle_service_plans', 'service-plans': 'vehicle_service_plans', 'fuel-logs': 'vehicle_fuel_logs', 'share-links': 'vehicle_share_links', alerts: 'maintenance_alerts',
  quotes: 'load_quotes', sos: 'sos_alerts', parcels: 'parcels', payouts: 'driver_payouts', entries: 'driver_pay_entries', expenses: 'expenses',
  statements: 'tpl_partner_statements', offers: 'tpl_offers', orders: 'tpl_orders', 'service-log': 'vehicle_service_log', 'service-items': 'vehicle_service_items',
  'service-attachments': 'vehicle_service_attachments', custody: 'cargo_custody_events', manifests: 'cargo_manifest', capacity: 'capacity_windows', stoppages: 'vehicle_stoppages',
  affiliations: 'organizations', 'tpl-affiliations': 'organizations', opportunities: 'vendor_route_opportunities', requests: 'vendor_shipment_requests', kyc: 'users', settlements: 'trip_settlements',
}
const PARAM_TABLE = { vehicle_id: 'vehicles', route_id: 'routes', user_id: 'users', userId: 'users', tplId: 'organizations', linkId: 'vehicle_share_links', planId: 'vehicle_service_plans', logId: 'vehicle_fuel_logs', quoteId: 'load_quotes', stop_id: 'route_stops', shipment_id: 'shipments', window_id: 'capacity_windows', bid_id: 'capacity_bids' }
const STATIC_PARAM = { token: 'parity-token', code: '2523', pin: '400093', pincode: '400093', sid: randomUUID(), slot: 'morning', kind: 'photo' }
const idCache = {}
async function anyId(table, orgId) {
  const key = `${table}|${orgId || ''}`
  if (key in idCache) return idCache[key]
  let id = null
  for (const q of [orgId ? `select=id&carrier_org_id=eq.${orgId}&limit=1` : null, orgId ? `select=id&vendor_org_id=eq.${orgId}&limit=1` : null, 'select=id&limit=1'].filter(Boolean)) {
    const r = await db('GET', table, { query: q })
    if (r.status === 200 && r.body?.[0]?.id) { id = r.body[0].id; break }
  }
  return (idCache[key] = id)
}
async function fill(path, w) {
  const parts = path.split('/')
  const out = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (!p.startsWith(':')) { out.push(p); continue }
    const name = p.slice(1)
    if (name in STATIC_PARAM) { out.push(STATIC_PARAM[name]); continue }
    const table = PARAM_TABLE[name] || SEGMENT_TABLE[parts[i - 1]]
    let id = null
    if (table === 'vehicles' && w.vehicle) id = w.vehicle.id
    else if (table === 'vendor_shipment_requests' && w.load) id = w.load.id
    else if (table === 'users') id = w.driver.id
    else if (table === 'organizations') id = w.other.id
    else if (table) id = await anyId(table, w.company.id)
    out.push(id || randomUUID())
  }
  return out.join('/').replace(/\$\{\w+\}/g, 'approve')
}

async function sectionRoutes() {
  console.log('\n== 1. endpoint crawl ==')
  const w = await world()
  const routes = enumerateRoutes()
  const actors = [
    ['platform', w.platform.token, undefined], ['admin', w.admin.token, w.company.id], ['manager', w.manager.token, w.company.id],
    ['driver', w.driver.token, w.company.id], ['vendor', w.vendor.token, undefined], ['guest', null, undefined],
    ...(w.customer ? [['customer', w.customer.token, undefined]] : []),
  ]
  const SKIP = new Set(['POST /auth/logout'])
  const jobs = []
  for (const r of routes) {
    if (SKIP.has(`${r.method} ${r.path}`)) continue
    const mutating = r.method !== 'GET'
    // a mutating route with no :param in its path would act on the actor itself or a singleton: only validation-test those as POST/PUT
    if (r.method === 'DELETE' && !r.path.includes(':')) continue
    for (const [name, token, org] of actors) jobs.push({ r, mutating, name, token, org })
  }
  console.log(`${routes.length} routes (${routes.filter(r => r.method === 'GET').length} GET), ${jobs.length} calls`)
  const pathCache = new Map()
  const filled = async path => { if (!pathCache.has(path)) pathCache.set(path, await fill(path, w)); return pathCache.get(path) }
  await pool(jobs, 8, async ({ r, mutating, name, token, org }) => {
    const path = await filled(r.path)
    const res = await call(token, r.method, path + (r.method === 'GET' ? '' : ''), mutating && r.method !== 'DELETE' ? {} : undefined, org)
    const l = leak(res.text)
    const row = { method: r.method, path: r.path, actor: name, status: res.status, ms: Math.round(res.ms), file: r.file, leak: l, timing: res.timing }
    raw.routes.push(row)
    if (res.status >= 500 || res.status === 0 || (l && res.status !== 401)) bug('routes', `${r.method} ${r.path} as ${name} -> ${res.status}`, l || res.text.slice(0, 160))
  })
  // an id that is not a uuid must be a 400/404, never a 500
  const badId = routes.filter(r => r.method === 'GET' && r.path.includes(':'))
  await pool(badId, 8, async r => {
    const path = r.path.replace(/:(\w+)/g, (m, n) => (n in STATIC_PARAM ? STATIC_PARAM[n] : 'not-a-uuid'))
    const res = await call(w.admin.token, 'GET', path, undefined, w.company.id)
    raw.routes.push({ method: 'GET', path: r.path, actor: 'admin(bad-id)', status: res.status, ms: Math.round(res.ms), file: r.file, leak: leak(res.text) })
    if (res.status >= 500 || res.status === 0 || leak(res.text)) bug('routes', `GET ${r.path} with a malformed id -> ${res.status}`, leak(res.text) || res.text.slice(0, 160))
  })
  const five = raw.routes.filter(r => r.status >= 500).length
  check('crawl: no 5xx and no database text in any response', bugs.filter(b => b.area === 'routes').length === 0, `${bugs.filter(b => b.area === 'routes').length} problem(s)`)
  console.log(`crawl calls ${raw.routes.length}, 5xx ${five}`)
}

// ── 2. Table sweep ──────────────────────────────────────────────────────────────────────────────────────────────────
function allTables() {
  const schema = JSON.parse(readFileSync(join(ROOT, 'backend-ts', 'test', 'support', 'db-schema.json'), 'utf8'))
  const set = new Set(Object.keys(schema))
  const dir = join(ROOT, 'supabase', 'migrations')
  for (const f of readdirSync(dir).filter(f => f.endsWith('.sql'))) {
    for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/create table (?:if not exists )?public\.(\w+)/gi)) set.add(m[1])
  }
  return [...set].sort()
}
/** Tables the web app reads directly (.from('x')) or subscribes to (postgres_changes / useRealtimeRefresh / QUEUE_TABLES). */
export function webTables() {
  const found = new Set()
  const walk = d => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p) } else if (/\.(tsx?|jsx?)$/.test(e.name)) scan(readFileSync(p, 'utf8')) } }
  const scan = s => {
    for (const m of s.matchAll(/\.from\(\s*['"]([a-z_]+)['"]\s*\)/g)) found.add(m[1])
    for (const m of s.matchAll(/table:\s*['"]([a-z_]+)['"]/g)) found.add(m[1])
    for (const m of s.matchAll(/useRealtimeRefresh\([^,]+,\s*\[([^\]]*)\]/g)) for (const t of m[1].matchAll(/['"]([a-z_]+)['"]/g)) found.add(t[1])
    for (const m of s.matchAll(/QUEUE_TABLES\s*=\s*\[([^\]]*)\]/g)) for (const t of m[1].matchAll(/['"]([a-z_]+)['"]/g)) found.add(t[1])
  }
  walk(join(ROOT, 'frontend', 'src'))
  found.delete('storage')
  found.delete('kyc_documents') // a storage bucket (storage.from), not a table
  return [...found].sort()
}
async function rest(token, table, query = 'limit=1') {
  const res = await fetch(`${DATA}/rest/v1/${table}?${query}`, { headers: { apikey: env.ANON, Authorization: `Bearer ${token}` } })
  const text = await res.text()
  let rows = null
  try { const j = JSON.parse(text); if (Array.isArray(j)) rows = j.length } catch { /* */ }
  return { status: res.status, text, rows }
}
async function sectionTables() {
  console.log('\n== 2. table sweep (service role / company admin / anon) ==')
  const w = await world()
  const tables = allTables()
  const web = new Set(webTables())
  console.log(`${tables.length} tables, ${web.size} read by the web app: ${[...web].join(', ')}`)
  const missing = [...web].filter(t => !tables.includes(t))
  if (missing.length) console.log('web tables not in schema/migrations list:', missing.join(', '))
  for (const t of [...new Set([...tables, ...web])]) {
    const [svc, adm, anon, ven, drv] = await Promise.all([rest(env.SERVICE, t), rest(w.admin.token, t), rest(env.ANON, t), rest(w.vendor.token, t), rest(w.driver.token, t)])
    const row = { table: t, web: web.has(t), service: svc.status, admin: adm.status, anon: anon.status, anonRows: anon.rows, admRows: adm.rows, svcRows: svc.rows, vendor: ven.status, driver: drv.status, svcErr: svc.status >= 300 ? svc.text.slice(0, 100) : '', admErr: adm.status >= 300 ? adm.text.slice(0, 100) : '' }
    raw.tables.push(row)
    for (const [who, r] of [['vendor', ven], ['driver', drv], ['company admin', adm]]) if (/permission denied for (function|schema)|42883/i.test(r.text)) bug('tables', `${t} as ${who}: a row-security helper is not executable`, r.text.slice(0, 160))
    if (svc.status !== 200) bug('tables', `service_role cannot read ${t}: ${svc.status}`, svc.text.slice(0, 140))
    if (web.has(t) && adm.status !== 200) bug('tables', `company admin JWT cannot read web-app table ${t}: ${adm.status}`, adm.text.slice(0, 140))
  }
  check('tables: service_role reads every table', raw.tables.every(r => r.service === 200), raw.tables.filter(r => r.service !== 200).map(r => r.table).join(','))
  check('tables: staff JWT reads every table the web app reads', raw.tables.filter(r => r.web).every(r => r.admin === 200), raw.tables.filter(r => r.web && r.admin !== 200).map(r => r.table).join(','))
  const anonOpen = raw.tables.filter(r => r.anon === 200).map(r => r.table)
  console.log('anon is granted SELECT (200):', anonOpen.join(', ') || '(none)')
  const anonSees = raw.tables.filter(r => r.anon === 200 && r.anonRows > 0).map(r => r.table)
  console.log('anon actually receives ROWS from:', anonSees.join(', ') || '(none)')
  const PUBLIC_OK = new Set(['hsn_codes', 'goods_categories', 'pincodes', 'pincode_prefixes', 'vehicle_classes', 'service_plan_templates', 'system_settings'])
  check('tables: anon receives rows only from public reference tables', anonSees.every(t => PUBLIC_OK.has(t)), anonSees.filter(t => !PUBLIC_OK.has(t)).join(','))
  console.log('company admin refused (non-200):', raw.tables.filter(r => r.admin !== 200).map(r => `${r.table}:${r.admin}`).join(', ') || '(none)')
}

/** Every `.from('t') ... .select('a, b(c)')` the API runs with an embedded resource, as { table, select, file }. */
function embeddedSelects() {
  const found = []
  const walk = d => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.ts')) scan(p, readFileSync(p, 'utf8')) } }
  const scan = (file, src) => {
    for (const m of src.matchAll(/\.select\(/g)) {
      // the table is the nearest .from('t') before this select
      const before = src.slice(Math.max(0, m.index - 700), m.index)
      const froms = [...before.matchAll(/\.from\(\s*['"`](\w+)['"`]\s*\)/g)]
      if (!froms.length) continue
      const table = froms[froms.length - 1][1]
      const window = src.slice(m.index, m.index + 2500)
      let depth = 0, end = -1
      for (let i = 7; i < window.length; i++) { const c = window[i]; if (c === '(') depth++; else if (c === ')') { depth--; if (depth === 0) { end = i; break } } }
      if (end < 0) continue
      const arg = window.slice(8, end)
      for (const q of arg.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`$]*)`/g)) {
        const sel = (q[1] ?? q[2] ?? q[3] ?? '').replace(/\s+/g, '')
        if (sel.includes('(') && !sel.includes('${') && !/count|head/.test(sel)) found.push({ table, select: sel, file: file.split('/src/')[1] })
      }
    }
  }
  walk(join(ROOT, 'backend-ts', 'src'))
  const seen = new Set()
  return found.filter(f => { const k = f.table + '|' + f.select; if (seen.has(k)) return false; seen.add(k); return true })
}
async function sectionEmbeds() {
  console.log('\n== 2b. embedded selects (PostgREST relationships, as the API issues them) ==')
  const list = embeddedSelects()
  console.log(`${list.length} distinct embedded selects`)
  const bad = []
  await pool(list, 6, async f => {
    const res = await fetch(`${DATA}/rest/v1/${f.table}?select=${encodeURIComponent(f.select)}&limit=1`, { headers: { apikey: env.SERVICE, Authorization: `Bearer ${env.SERVICE}` } })
    const text = await res.text()
    raw.tables.push({ embed: `${f.table}?select=${f.select}`, status: res.status, file: f.file })
    if (res.status >= 300) { bad.push({ ...f, status: res.status, text: text.slice(0, 160) }); bug('embeds', `${f.file}: ${f.table} select(${f.select.slice(0, 80)}) -> ${res.status}`, text.slice(0, 200)) }
  })
  check('embeds: every relationship the API embeds resolves on the stage', bad.length === 0, bad.map(b => `${b.table}:${b.select.slice(0, 40)}`).join('; '))
}

// ── 3. RPCs, sequences, triggers, functions used by RLS ─────────────────────────────────────────────────────────────
async function sectionRpc() {
  console.log('\n== 3. rpc / sequences / functions ==')
  const w = await world()
  // every supabase.rpc('name') in the API source
  const names = new Set()
  const walk = d => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.ts')) for (const m of readFileSync(p, 'utf8').matchAll(/\.rpc\(\s*['"](\w+)['"]/g)) names.add(m[1]) } }
  walk(join(ROOT, 'backend-ts', 'src'))
  console.log('rpc functions used by the API:', [...names].join(', '))
  // 1) each function is reachable by the API's role with the argument names the API uses (a wrong-name probe would say
  //    "no function matches" even when it exists, so the arguments mirror the source)
  const ARGS = {
    next_lr_number: { p_org: w.company.id, p_prefix: 'PAR', p_year: 2026 },
    next_invoice_number: { p_org: w.company.id, p_prefix: 'PAR', p_period: '2610' },
    match_vendors_to_route: { route_points: [{ lat: 19.1, lng: 72.8 }], radius_km: 50 },
    create_vendor_load: { p: { load: {}, items: [] } }, // an empty load is refused by the function itself (not "does not exist")
    award_load: null, // exercised through the API below (needs a real load)
  }
  const callRpc = (n, args) => fetch(`${DATA}/rest/v1/rpc/${n}`, { method: 'POST', headers: { apikey: env.SERVICE, Authorization: `Bearer ${env.SERVICE}`, 'content-type': 'application/json' }, body: JSON.stringify(args ?? {}) }).then(async r => ({ status: r.status, text: await r.text() }))
  for (const n of names) {
    if (ARGS[n] === null) continue
    const res = await callRpc(n, ARGS[n])
    raw.rpc.push({ fn: n, status: res.status, text: res.text.slice(0, 160) })
    check(`rpc ${n} callable by service_role`, !/permission denied|42501|42883|PGRST202|does not exist/i.test(res.text), `${res.status} ${res.text.slice(0, 200)}`)
  }
  // sequences: two numbers in a row must differ (the counter tables are service-only, on Azure too)
  const n1 = await callRpc('next_lr_number', ARGS.next_lr_number)
  const n2 = await callRpc('next_lr_number', ARGS.next_lr_number)
  check('sequences: next_lr_number advances', n1.status === 200 && n1.text !== n2.text, `${n1.text} ${n2.text}`)
  // 2) through the API paths that use them
  const inv = await api(w.admin.token, 'GET', '/invoices', undefined, { org: w.company.id })
  check('api: invoices list (next_invoice_number path ready)', inv.status < 500, JSON.stringify(inv.body).slice(0, 120))
  const load = await api(w.vendor.token, 'POST', '/vendor/loads', loadDraft())
  check('api: create_vendor_load via POST /vendor/loads', load.status === 201, `${load.status} ${JSON.stringify(load.body).slice(0, 200)}`)
  if (load.body?.id) {
    const q = await api(w.admin.token, 'POST', `/company/loads/${load.body.id}/quote`, { amount: 52000, valid_hours: 24 }, { org: w.company.id })
    raw.rpc.push({ fn: 'quote path', status: q.status, text: JSON.stringify(q.body).slice(0, 160) })
    check('api: company quote on a load (load_quotes)', q.status < 500, `${q.status} ${JSON.stringify(q.body).slice(0, 160)}`)
    const award = await api(w.admin.token, 'POST', `/company/loads/${load.body.id}/accept`, {}, { org: w.company.id })
    check('api: direct accept (award_load)', award.status < 500, `${award.status} ${JSON.stringify(award.body).slice(0, 200)}`)
  }
  const lr = await api(w.admin.token, 'GET', `/loads/${load.body?.id || randomUUID()}/documents`, undefined, { org: w.company.id })
  check('api: load documents list', lr.status < 500, `${lr.status}`)
  const match = await api(w.admin.token, 'GET', '/vendor/opportunities', undefined, { org: w.company.id })
  check('api: vendor opportunities (match_vendors_to_route path)', match.status < 500, `${match.status} ${JSON.stringify(match.body).slice(0, 120)}`)
  // 3) functions used by RLS policies must be callable by a signed-in user
  for (const fn of ['user_org_ids', 'is_platform_admin', 'can_see_load', 'is_staff', 'user_role']) {
    for (const schema of ['app', 'public']) {
      const r = await fetch(`${DATA}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: env.ANON, Authorization: `Bearer ${w.admin.token}`, 'content-type': 'application/json', 'Content-Profile': schema }, body: '{}' })
      const t = await r.text()
      if (r.status === 404 || /PGRST106|PGRST202/.test(t)) continue // not in this schema / not exposed (app is not an exposed schema)
      raw.rpc.push({ fn: `${schema}.${fn} as authenticated`, status: r.status, text: t.slice(0, 120) })
      check(`rls helper ${schema}.${fn} executable by authenticated`, !/permission denied|42501/.test(t), t.slice(0, 120))
    }
  }
  // The real proof an RLS helper is executable: a table whose policy calls it answers 200 for the signed-in user
  for (const t of ['vendor_shipment_requests', 'load_items', 'load_quotes', 'org_members', 'organizations', 'notifications', 'vehicles', 'shipments', 'invoices']) {
    const r = await rest(w.admin.token, t)
    check(`rls policy evaluates for a staff JWT on ${t}`, r.status === 200, `${r.status} ${r.text.slice(0, 120)}`)
  }
}

// ── 4. Storage ──────────────────────────────────────────────────────────────────────────────────────────────────────
async function sectionStorage() {
  console.log('\n== 4. storage ==')
  const w = await world()
  const buckets = { 'load document upload-url': 'load_documents' }
  const OWNER_READS = new Set(['vendor kyc upload-url', 'load document upload-url'])
  const links = []
  const add = async (name, token, method, path, body, org) => {
    const r = await api(token, method, path, body, { org })
    const link = r.body?.signed_url ? r.body : r.body?.upload ?? r.body?.data
    const ok = !!(link?.signed_url || r.body?.upload_url || link?.upload_url)
    raw.storage.push({ route: name, status: r.status, link: ok })
    if (ok) links.push({ name, bucket: buckets[name] || 'kyc_documents', link: link?.signed_url ? link : { signed_url: r.body.upload_url || link.upload_url, path: r.body.path || link.path || r.body.storage_path }, as: token })
    else if (r.status >= 500) bug('storage', `${name} -> ${r.status}`, JSON.stringify(r.body).slice(0, 160))
    if (r.status === 409 && r.body?.code === 'consent_required') { console.log(`SKIP  storage: ${name} needs the person's consent first (409)`); return }
    if (r.status === 429) { console.log(`SKIP  storage: ${name} is rate limited (429)`); return }
    check(`storage: ${name} hands out a signed link`, ok, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`)
  }
  await add('vendor kyc upload-url', w.vendor.token, 'POST', '/vendor/kyc/upload-url', { key: 'gst_certificate', content_type: 'image/png', size: PNG.length })
  if (w.vehicle) {
    await add('vehicle photo upload-url', w.admin.token, 'POST', `/vehicles/${w.vehicle.id}/photos/upload-url`, { slot: 'front', content_type: 'image/png', size: PNG.length }, w.company.id)
    await add('service attachment upload-url', w.admin.token, 'POST', `/fleet/vehicles/${w.vehicle.id}/service-attachments/upload-url`, { content_type: 'image/png', size: PNG.length, filename: 'bill.png' }, w.company.id)
  }
  await add('people document upload-url', w.admin.token, 'POST', `/people/${w.driver.id}/documents/upload-url`, { doc_type: 'driving_licence', file_name: 'licence.png', content_type: 'image/png', size: PNG.length }, w.company.id)
  const trk = `PAR${Date.now().toString(36).toUpperCase()}`
  const shp = await db('POST', 'shipments', { body: { tracking_id: trk, status: 'created', origin_name: 'Parity', origin_address: 'Mumbai', carrier_org_id: w.company.id, priority: 'medium' } })
  if (shp.status < 300) await add('custody upload-url', w.admin.token, 'POST', '/cargo/custody/upload-url', { ref: trk, kind: 'photo', content_type: 'image/png', size: PNG.length }, w.company.id)
  else check('storage: seed a shipment for the custody upload', false, JSON.stringify(shp.body).slice(0, 160))
  await add('tpl application upload-url (guest)', null, 'POST', '/tpl/applications/upload-url', { custom_id: `PAR${tag()}`.toUpperCase(), doc_type: 'GST Certificate', content_type: 'image/png', size: PNG.length })
  await add('expense receipt upload-url', w.admin.token, 'POST', '/finance/expenses/receipt-upload', { content_type: 'image/png', size: PNG.length }, w.company.id)
  if (w.vehicle) await add('fuel bill upload-url', w.admin.token, 'POST', `/fleet/vehicles/${w.vehicle.id}/fuel-logs/bill-upload`, { content_type: 'image/png', size: PNG.length }, w.company.id)
  if (w.load) await add('load document upload-url', w.vendor.token, 'POST', `/loads/${w.load.id}/documents/upload-url`, { kind: 'delivery_challan', content_type: 'image/png', size: PNG.length })
  for (const l of links) {
    try {
      const path = await putSigned(l.link)
      const bucket = l.bucket
      const back = await readObject(bucket, path)
      check(`storage: ${l.name} upload then read back`, back && back.equals(PNG), `path ${path} read back ${back ? back.length : 'null'} bytes`)
      // policy: a signed-in user other than the owner cannot read it with their own JWT; no JWT at all cannot either
      const asOther = await fetch(`${DATA}/storage/v1/object/authenticated/${bucket}/${path}`, { headers: { apikey: env.ANON, Authorization: `Bearer ${w.adminB.token}` } })
      const asAnon = await fetch(`${DATA}/storage/v1/object/${bucket}/${path}`, { headers: { apikey: env.ANON } })
      const asOwner = l.as ? await fetch(`${DATA}/storage/v1/object/authenticated/${bucket}/${path}`, { headers: { apikey: env.ANON, Authorization: `Bearer ${l.as}` } }) : null
      raw.storage.push({ route: l.name, bucket, owner: asOwner?.status, other: asOther.status, anon: asAnon.status })
      if (OWNER_READS.has(l.name)) check(`storage: ${l.name} is readable by its owner with their own session`, asOwner?.status === 200, `status ${asOwner?.status} ${asOwner ? (await asOwner.clone().text()).slice(0, 120) : ''}`)
      check(`storage: ${l.name} is not readable by another company's user`, asOther.status >= 400, `status ${asOther.status}`)
      check(`storage: ${l.name} is not readable anonymously`, asAnon.status >= 400, `status ${asAnon.status}`)
      console.log(`      owner ${asOwner?.status ?? '-'} / other company ${asOther.status} / anon ${asAnon.status}`)
    } catch (e) { check(`storage: ${l.name} upload`, false, String(e).slice(0, 200)); bug('storage', `${l.name} upload failed`, String(e).slice(0, 200)) }
  }
  // the api's own readers of those objects
  const bl = await fetch(`${DATA}/storage/v1/bucket`, { headers: { apikey: env.SERVICE, Authorization: `Bearer ${env.SERVICE}` } })
  const bj = await bl.json().catch(() => [])
  console.log('buckets:', Array.isArray(bj) ? bj.map(b => `${b.name}${b.public ? '(public)' : ''}`).join(', ') : JSON.stringify(bj).slice(0, 120))
  raw.storage.push({ buckets: Array.isArray(bj) ? bj.map(b => ({ name: b.name, public: b.public })) : bj })
}

// ── 5. WebSocket (API feed) and the realtime gateway ────────────────────────────────────────────────────────────────
function wsOpen(url, ms = 10000) {
  return new Promise(resolve => {
    const ws = new WebSocket(url)
    const msgs = []
    const timer = setTimeout(() => resolve({ ws, state: 'timeout', msgs }), ms)
    ws.addEventListener('open', () => { clearTimeout(timer); resolve({ ws, state: 'open', msgs }) })
    ws.addEventListener('error', () => { clearTimeout(timer); resolve({ ws, state: 'error', msgs }) })
    ws.addEventListener('message', e => msgs.push(String(e.data)))
  })
}
async function sectionWs() {
  console.log('\n== 5. websocket / realtime ==')
  const w = await world()
  const base = API.replace(/^http/, 'ws').replace(/\/api\/v1$/, '')
  const feed = (token, org) => wsOpen(`${base}/api/v1/telemetry/ws?token=${encodeURIComponent(token)}${org ? `&org=${org}` : ''}`)
  const a = await feed(w.admin.token, w.company.id)
  const b = await feed(w.adminB.token, w.other.id)
  const p = await feed(w.platform.token)
  const guest = await wsOpen(`${base}/api/v1/telemetry/ws`, 5000)
  const driver = await feed(w.driver.token, w.company.id)
  const foreign = await feed(w.admin.token, w.other.id)
  check('ws: staff token connects', a.state === 'open', a.state)
  check('ws: platform admin connects', p.state === 'open', p.state)
  check('ws: no token is refused', guest.state !== 'open', guest.state)
  check('ws: a driver (not staff) is refused', driver.state !== 'open', driver.state)
  check('ws: staff asking for ANOTHER company is refused', foreign.state !== 'open', foreign.state)
  if (a.state === 'open' && w.vehicle) {
    const g = await api(w.admin.token, 'POST', '/telemetry', { vehicle_id: w.vehicle.id, latitude: 19.12 + Math.random() / 100, longitude: 72.85, speed_kmph: 31, heading: 90 }, { org: w.company.id })
    await sleep(2500)
    raw.ws.push({ gps: g.status, a: a.msgs.length, b: b.msgs.length, platform: p.msgs.length })
    check('ws: a position posted through the API reaches the company feed', a.msgs.length > 0, `POST /telemetry ${g.status}, company feed got ${a.msgs.length}`)
    check('ws: ...and the platform feed', p.msgs.length > 0, `got ${p.msgs.length}`)
    check('ws: ...but not another company\'s feed', b.msgs.length === 0, `other company received ${b.msgs.length}`)
  }
  for (const x of [a, b, p, guest, driver, foreign]) try { x.ws.close() } catch { /* */ }

  // the realtime gateway: Phoenix channel protocol
  const rt = `${DATA.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${env.ANON}&vsn=1.0.0`
  async function subscribe(token, tables) {
    const c = await wsOpen(rt, 12000)
    if (c.state !== 'open') return { state: c.state, replies: [], events: c.msgs, ws: c.ws }
    const events = []; const replies = []
    c.ws.addEventListener('message', e => { try { const m = JSON.parse(String(e.data)); (m.event === 'postgres_changes' ? events : replies).push(m) } catch { /* */ } })
    const topic = `realtime:parity-${tag()}`
    c.ws.send(JSON.stringify({ topic, event: 'phx_join', ref: '1', join_ref: '1', payload: { config: { broadcast: { ack: false, self: false }, presence: { key: '' }, postgres_changes: tables }, access_token: token } }))
    await sleep(3500)
    return { state: 'open', replies, events, ws: c.ws }
  }
  const me = await subscribe(w.admin.token, [{ event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${w.admin.id}` }])
  const joined = me.replies.find(m => m.event === 'phx_reply')
  check('realtime: authenticated JWT connects', me.state === 'open', me.state)
  check('realtime: join to notifications is accepted', joined?.payload?.status === 'ok', JSON.stringify(joined?.payload).slice(0, 220))
  if (me.state === 'open') {
    const ins = await db('POST', 'notifications', { body: { user_id: w.admin.id, title: 'parity', body: 'realtime check', type: 'info' } })
    await sleep(3500)
    const hit = me.events.some(m => JSON.stringify(m).includes('realtime check'))
    raw.ws.push({ realtime: joined?.payload?.status, insert: ins.status, delivered: hit })
    check('realtime: an inserted notification is delivered to its owner', hit, `insert ${ins.status}, events ${me.events.length}`)
  }
  try { me.ws.close() } catch { /* */ }
  // every table the web subscribes to must be subscribable (published) for a staff JWT
  const web = webTables().filter(t => !['notifications'].includes(t))
  const tabs = []
  for (const t of web) {
    const s = await subscribe(w.admin.token, [{ event: '*', schema: 'public', table: t }])
    const reply = s.replies.find(m => m.event === 'phx_reply')
    const ok = reply?.payload?.status === 'ok' && !JSON.stringify(reply.payload).includes('error')
    tabs.push({ table: t, ok, detail: JSON.stringify(reply?.payload).slice(0, 160) })
    try { s.ws.close() } catch { /* */ }
  }
  raw.ws.push({ subscribable: tabs })
  for (const t of tabs.filter(t => !t.ok)) check(`realtime: staff can subscribe to ${t.table}`, false, t.detail)
  check('realtime: staff can subscribe to every table the web app listens on', tabs.every(t => t.ok), tabs.filter(t => !t.ok).map(t => t.table).join(','))
}

// ── 6. Performance ──────────────────────────────────────────────────────────────────────────────────────────────────
async function sectionPerf() {
  console.log('\n== 6. performance (warm) ==')
  const w = await world()
  // the most used GETs: the static-path GET routes ordered by how many times the web app mentions the path
  const fe = []
  const walk = d => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p) } else if (/\.(tsx?)$/.test(e.name)) fe.push(readFileSync(p, 'utf8')) } }
  walk(join(ROOT, 'frontend', 'src'))
  const blob = fe.join('\n')
  const gets = enumerateRoutes().filter(r => r.method === 'GET' && !r.path.includes(':'))
  const used = gets.map(r => ({ ...r, n: blob.split(r.path).length - 1 })).filter(r => r.n > 0).sort((a, b) => b.n - a.n).slice(0, 30)
  const roleFor = p => (/^\/(vendor|loads\/mine)/.test(p) ? [w.vendor.token, undefined] : /^\/driver/.test(p) ? [w.driver.token, w.company.id] : /^\/(admin|org)/.test(p) ? [w.platform.token, undefined] : [w.admin.token, w.company.id])
  for (const r of used) {
    const [token, org] = roleFor(r.path)
    await call(token, 'GET', r.path, undefined, org) // warm
    const samples = []; let timing = ''
    for (let i = 0; i < 5; i++) { const x = await call(token, 'GET', r.path, undefined, org); samples.push(x.ms); timing = x.timing || timing; if (x.status >= 500) bug('perf', `${r.path} -> ${x.status}`, x.text.slice(0, 120)) }
    samples.sort((a, b) => a - b)
    const row = { path: r.path, uses: r.n, median: Math.round(samples[2]), max: Math.round(samples[4]), timing }
    raw.perf.push(row)
    console.log(`${row.median > 500 ? 'SLOW' : 'ok  '} ${String(row.median).padStart(5)}ms (max ${row.max}) ${r.path}  ${timing.slice(0, 90)}`)
  }
  check('perf: no hot GET has a warm median over 500 ms', raw.perf.every(r => r.median <= 500), raw.perf.filter(r => r.median > 500).map(r => `${r.path} ${r.median}ms`).join('; '))
}

// ── run ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const sections = { tables: sectionTables, embeds: sectionEmbeds, routes: sectionRoutes, rpc: sectionRpc, storage: sectionStorage, ws: sectionWs, perf: sectionPerf }
for (const [name, fn] of Object.entries(sections)) {
  if (!run(name)) continue
  try { await fn() } catch (e) { check(`section ${name} ran`, false, String(e.stack || e).slice(0, 300)) }
}
console.log(`\n${results.filter(r => r.ok).length} PASS, ${results.filter(r => !r.ok).length} FAIL, ${bugs.length} bug record(s)`)

if (OUT) {
  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, 'raw.json'), JSON.stringify({ raw, bugs, results }, null, 1))
  // crawl.md: one line per route, the status each actor saw
  const by = new Map()
  for (const r of raw.routes.filter(r => !r.actor.includes('bad-id'))) { const k = `${r.method} ${r.path}`; if (!by.has(k)) by.set(k, { file: r.file, a: {} }); by.get(k).a[r.actor] = r.status }
  const names = ['platform', 'admin', 'manager', 'driver', 'vendor', 'customer', 'guest']
  let md = `| route | ${names.join(' | ')} |\n|---|${names.map(() => '---').join('|')}|\n`
  for (const [k, v] of by) md += `| \`${k}\` | ${names.map(n => v.a[n] ?? '-').join(' | ')} |\n`
  writeFileSync(join(OUT, 'crawl.md'), md)
}
process.exit(results.some(r => !r.ok) ? 1 : 0)
