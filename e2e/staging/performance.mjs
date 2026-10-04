// Read-only staging performance walk. Uses an existing account; creates no accounts and sends no messages.
// UAT_USER_EMAIL=<existing staging staff email> node e2e/staging/performance.mjs
// Optional PERFORMANCE_OUTPUT=<local JSON path>. No credentials, response bodies or account identifiers are saved.
import { readFileSync, writeFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import { API, DATA, env } from './actors.mjs'

const email = process.env.UAT_USER_EMAIL
if (!email) throw new Error('Set UAT_USER_EMAIL to an existing staging staff account')
const localEnv = Object.fromEntries(readFileSync(new URL('../../infra/platform.test.env', import.meta.url), 'utf8').split('\n')
  .map(line => line.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].replace(/^["']|["']$/g, '')]))
const usersResponse = await fetch(`${DATA}/auth/v1/admin/users?page=1&per_page=100`, {
  headers: { apikey: env.SERVICE, Authorization: `Bearer ${env.SERVICE}` }, signal: AbortSignal.timeout(20_000),
})
if (!usersResponse.ok) throw new Error(`Staging account lookup: HTTP ${usersResponse.status}`)
const account = (await usersResponse.json()).users.find(user => user.email === email)
if (!account) throw new Error('Account not found in the first staging account page')
const now = Math.floor(Date.now() / 1000)
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: account.id, role: 'authenticated', iss: `${DATA}/auth/v1`, aud: 'authenticated', iat: now, exp: now + 600 })}`
const token = `${unsigned}.${createHmac('sha256', localEnv.JWT_SECRET).update(unsigned).digest('base64url')}`
const probes = [
  ...['/orgs/mine', '/ops/today', '/messages/unread', '/bookings', '/company/loads/market?tab=new', '/vehicles?limit=50', '/shipments?limit=50', '/routes?limit=50', '/dashboard/kpis', '/dashboard/shipment-counts']
    .map(path => ({ name: path, url: `${API}${path}`, method: 'GET', headers: {} })),
  { name: 'notifications badge', url: `${DATA}/rest/v1/notifications?select=id&user_id=eq.${account.id}&is_read=eq.false`, method: 'HEAD', headers: { apikey: env.ANON, Prefer: 'count=exact' } },
  { name: 'notifications list', url: `${DATA}/rest/v1/notifications?select=*&user_id=eq.${account.id}&order=created_at.desc&limit=20`, method: 'GET', headers: { apikey: env.ANON } },
]
const report = { stage: 'test', measuredAt: new Date().toISOString(), probes: [] }
for (const probe of probes) {
  const samples = []
  for (let round = 0; round < 3; round++) {
    const start = performance.now()
    const response = await fetch(probe.url, { method: probe.method, headers: { ...probe.headers, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) })
    const bytes = (await response.arrayBuffer()).byteLength
    samples.push({ status: response.status, ms: Math.round(performance.now() - start), bytes, serverTiming: response.headers.get('server-timing') })
    if (response.status !== 200) process.exitCode = 1
  }
  const medianMs = samples.map(s => s.ms).sort((a, b) => a - b)[1]
  const result = { name: probe.name, medianMs, samples }
  report.probes.push(result)
  console.log(JSON.stringify(result))
}
if (process.env.PERFORMANCE_OUTPUT) writeFileSync(process.env.PERFORMANCE_OUTPUT, JSON.stringify(report, null, 2) + '\n')
