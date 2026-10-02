// Test actors for the hosted TEST stage (staging.margixindia.com). Light: node + fetch, no docker.
//
//   import { env, api, makeVendor, makeCompany, makeCompanyAdmin, makePlatformAdmin, makeDriver } from './actors.mjs'
//
// Reads the stage's secrets from infra/platform.test.env (gitignored) and NEVER prints them. Refuses any other
// stage: live data is real. Accounts are named <tag>-<role>-<n>@margix.test with one fixed throw-away password.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const PASSWORD = 'Uat!2026flow'
export const API = process.env.UAT_API || 'https://staging-api.margixindia.com/api/v1'
export const DATA = process.env.UAT_DATA || 'https://staging-data.margixindia.com'
export const WEB = process.env.UAT_WEB || 'https://staging.margixindia.com'

if (!/staging/.test(API + DATA + WEB)) throw new Error('These helpers only run against the test stage (staging.*)')

function loadEnv() {
  const out = {}
  for (const line of readFileSync(join(ROOT, 'infra', 'platform.test.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}
const E = loadEnv()
export const env = { ANON: E.ANON_KEY, SERVICE: E.SERVICE_ROLE_KEY }
const svcHeaders = { apikey: E.SERVICE_ROLE_KEY, Authorization: `Bearer ${E.SERVICE_ROLE_KEY}`, 'content-type': 'application/json' }

export const sleep = ms => new Promise(r => setTimeout(r, ms))
let counter = 0
export const tag = () => `u${Date.now().toString(36).slice(-5)}${(counter++).toString(36)}`

/** The database through PostgREST as the service role (use it to seed or to read what the API hides). */
export async function db(method, table, { query = '', body, prefer } = {}) {
  const res = await fetch(`${DATA}/rest/v1/${table}${query ? `?${query}` : ''}`, {
    method, headers: { ...svcHeaders, ...(prefer ? { Prefer: prefer } : { Prefer: 'return=representation' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, body: json }
}

/** One API call as `token`. `org` sets X-Org-Id. Returns { status, body, headers }. */
export async function api(token, method, path, body, { org, headers = {}, raw = false } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(org ? { 'X-Org-Id': org } : {}), ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (raw) return res
  const text = await res.text()
  let json; try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { status: res.status, body: json, headers: res.headers }
}

async function authAdmin(method, path, body) {
  const res = await fetch(`${DATA}/auth/v1/admin/${path}`, { method, headers: svcHeaders, body: body ? JSON.stringify(body) : undefined })
  return res.json()
}

export async function login(email) {
  for (let i = 0; i < 8; i++) {
    const res = await fetch(`${DATA}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: E.ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }),
    })
    const j = await res.json()
    if (j.access_token) return j.access_token
    await sleep(3000)
  }
  throw new Error(`could not sign in ${email}`)
}

async function platformIds() {
  const rows = (await db('GET', 'system_settings', { query: 'key=in.(platform_org_id,default_company_org_id)&select=key,value' })).body
  const get = k => rows.find(r => r.key === k)?.value?.value
  return { platform: get('platform_org_id'), defaultCompany: get('default_company_org_id') }
}

/** A user in auth + public.users. Privileged roles are NOT taken from the sign-up (by design): see the make* helpers. */
export async function makeUser(label, role = 'vendor') {
  const email = `${label}@margix.test`
  const u = await authAdmin('POST', 'users', { email, password: PASSWORD, email_confirm: true, user_metadata: { role, full_name: `UAT ${label}` } })
  if (!u.id) throw new Error(`could not create ${email}: ${JSON.stringify(u).slice(0, 200)}`)
  return { id: u.id, email }
}

/** Gives a user a role everywhere the API looks: public.users, auth app_metadata and ONE membership. */
async function seat(user, role, orgId, orgRole) {
  await db('PATCH', 'users', { query: `id=eq.${user.id}`, body: { role } })
  await authAdmin('PUT', `users/${user.id}`, { app_metadata: { role } })
  await db('DELETE', 'org_members', { query: `user_id=eq.${user.id}` })
  await db('POST', 'org_members', { body: { org_id: orgId, user_id: user.id, role: orgRole, status: 'active' } })
}

/** A new, ACTIVE logistic company (kind logistic_company) straight in the database. */
export async function makeCompany(name = `Co ${tag()}`, extra = {}) {
  const r = await db('POST', 'organizations', { body: { kind: 'logistic_company', name, legal_name: `${name} Pvt Ltd`, gstin: '27AAHCM1234A1Z5', state: 'Maharashtra', city: 'Mumbai', address: 'Plot 1, Logistics Park', pincode: '400001', status: 'active', ...extra } })
  if (r.status >= 300) throw new Error(`company: ${JSON.stringify(r.body)}`)
  return r.body[0]
}

/** Company staff: role 'admin' (owner/admin membership) or 'manager' ('ops') or 'driver'. Omit orgId for the default company. */
export async function makeCompanyAdmin(orgId, role = 'admin') {
  const { defaultCompany } = await platformIds()
  const org = orgId || defaultCompany
  const user = await makeUser(`${tag()}-${role}`, 'driver')
  await seat(user, role, org, { admin: 'admin', manager: 'ops', driver: 'driver' }[role] || 'admin')
  return { ...user, orgId: org, role, token: await login(user.email) }
}
export const makeDriver = (orgId) => makeCompanyAdmin(orgId, 'driver')

/** Platform owner: effective role superadmin when acting as the platform organisation. */
export async function makePlatformAdmin() {
  const { platform } = await platformIds()
  const user = await makeUser(`${tag()}-platform`, 'driver')
  await seat(user, 'superadmin', platform, 'owner')
  return { ...user, orgId: platform, role: 'superadmin', token: await login(user.email) }
}

/** A vendor with a complete profile. `approved` runs KYC through a company admin so the vendor organisation is active. */
export async function makeVendor({ approved = true, admin } = {}) {
  const label = `${tag()}-vendor`
  const user = await makeUser(label, 'vendor')
  const token = await login(user.email)
  const prof = await api(token, 'PUT', '/vendor/business-profile', {
    full_name: `UAT ${label}`, business_name: `Flow Traders ${label}`, account_type: 'business_partner', gstin: '27AAPFU0939F1ZV',
    address: 'Plot 9, MIDC Andheri East, Mumbai', pincode: '400093', email: user.email, business_type: 'trader', monthly_loads: '6-20',
  })
  if (prof.status >= 300) throw new Error(`profile: ${JSON.stringify(prof.body)}`)
  const out = { ...user, token }
  if (approved) {
    const a = admin || await makeCompanyAdmin()
    const k = await api(token, 'POST', '/vendor/kyc/submit', {
      companyName: `Flow Traders ${label}`, gstNumber: '27AAPFU0939F1ZV', city: 'Mumbai', address: 'Plot 9, MIDC Andheri East', lat: 19.1197, lng: 72.8464,
      kycData: { data: { vendorType: 'Trader', panNumber: 'AAPFU0939F', contactPerson: 'UAT', mobile: '9876501234', bankBeneficiary: 'Flow Traders', bankAccount: '50100123456789', bankIfsc: 'HDFC0000123', bankName: 'HDFC Bank', bankBranch: 'Andheri East' } },
    })
    if (k.status >= 300) throw new Error(`kyc submit: ${JSON.stringify(k.body)}`)
    const ap = await api(a.token, 'PUT', `/vendor/kyc/${user.id}/approve`, {})
    if (ap.status >= 300) throw new Error(`kyc approve: ${JSON.stringify(ap.body)}`)
    out.admin = a
  }
  return out
}

/** A 1x1 PNG, for uploads. */
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

/**
 * Uploads `bytes` through a signed link the API handed out ({ signed_url, path }). Do it right after asking (links last
 * 15 minutes on test) and returns the storage path. Read it back with `readObject`.
 */
export async function putSigned(link, bytes = PNG, type = 'image/png') {
  const res = await fetch(link.signed_url, { method: 'PUT', headers: { 'content-type': type }, body: bytes })
  if (!res.ok) throw new Error(`signed upload ${res.status}: ${(await res.text()).slice(0, 160)}`)
  return link.path
}
export async function readObject(bucket, path) {
  const res = await fetch(`${DATA}/storage/v1/object/${bucket}/${path}`, { headers: { apikey: E.SERVICE_ROLE_KEY, Authorization: `Bearer ${E.SERVICE_ROLE_KEY}` } })
  return res.ok ? Buffer.from(await res.arrayBuffer()) : null
}

/** Tiny step printer: ok('name', condition, detail) */
export const results = []
export function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail })
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  ${detail}`}`)
  return !!cond
}
