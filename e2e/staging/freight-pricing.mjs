// Staging only. Uses an existing active company member; creates no accounts or loads.
// Signed-in price calls create normal quote audit rows. Never prints credentials or identifiers.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import { API, DATA, db } from './actors.mjs'

const organisations = await db('GET', 'organizations', { query: 'kind=eq.logistic_company&status=eq.active&select=id' })
assert.equal(organisations.status, 200)
let member
for (const org of organisations.body) {
  const members = await db('GET', 'org_members', { query: `org_id=eq.${org.id}&status=eq.active&role=in.(owner,admin)&select=user_id,org_id&limit=1` })
  assert.equal(members.status, 200)
  if (members.body.length) { member = members.body[0]; break }
}
assert(member, 'An existing active staging company staff account is required')
const localEnv = Object.fromEntries(readFileSync(new URL('../../infra/platform.test.env', import.meta.url), 'utf8').split('\n')
  .map(line => line.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].replace(/^["']|["']$/g, '')]))
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
const now = Math.floor(Date.now() / 1000)
const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: member.user_id, role: 'authenticated', iss: `${DATA}/auth/v1`, aud: 'authenticated', iat: now, exp: now + 600 })}`
const token = `${unsigned}.${createHmac('sha256', localEnv.JWT_SECRET).update(unsigned).digest('base64url')}`
async function post(path, body, signedIn = false) {
  const response = await fetch(`${API}${path}`, { method: 'POST', signal: AbortSignal.timeout(60_000),
    headers: { 'content-type': 'application/json', ...(signedIn ? { Authorization: `Bearer ${token}`, 'X-Org-Id': member.org_id } : {}) }, body: JSON.stringify(body) })
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}`)
  return response.json()
}
const pickup = { city: 'Pune', lat: 18.52, lng: 73.85 }
const drop = { city: 'Mumbai', lat: 19.07, lng: 72.87 }
for (const [vehicle, band, low, high] of [
  ['truck_14ft', 'lcv', 15, 25], ['truck_17_20ft', 'six_wheeler', 20, 30],
  ['flatbed', 'ten_wheeler', 25, 40], ['trailer_40ft', 'multi_axle', 35, 55], ['container_20ft', 'container', 50, 80],
]) {
  const vendor = await post('/public/loads/assist', { items: [{ product_name: 'Rice', hsn_code: '1006', gst_rate: 0, weight_kg: 1000, declared_value: 40000 }],
    pickup, delivery: drop, load_type: 'ftl', vehicle_class: vehicle })
  const company = await post('/pricing/quote', { pickup, drop, weight_kg: 1000, vehicle_type: vehicle, load_type: 'ftl', source: 'api' }, true)
  assert.equal(company.status, 'ok')
  for (const result of [vendor.estimate, company]) {
    assert.equal(result.basis.rate_key, band)
    assert.equal(result.low, Math.round(result.distance_km * low))
    assert.equal(result.high, Math.round(result.distance_km * high))
    assert.equal(result.suggested, Math.round(result.distance_km * (low + high) / 2))
    assert.equal(result.basis.rates.length, 5)
  }
  assert.equal(company.basis.min_per_km, vendor.estimate.basis.min_per_km)
  assert.equal(company.basis.max_per_km, vendor.estimate.basis.max_per_km)
  console.log(`PASS staging company/vendor reference and arithmetic: ${band}`)
}
for (const vehicle of ['reefer', 'tanker']) {
  const company = await post('/pricing/quote', { pickup, drop, weight_kg: 1000, vehicle_type: vehicle }, true)
  assert.equal(company.status, 'unavailable')
}
console.log('PASS staging unsupported specialised trucks have no invented price')
