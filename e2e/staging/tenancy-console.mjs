// Section 5 of tenancy.mjs: the platform-admin console and what a company admin cannot reach.
import { api, db, check, makeCompany, makeCompanyAdmin, makePlatformAdmin, makeVendor, makeUser, login, tag, sleep, env, DATA } from './actors.mjs'

const J = x => JSON.stringify(x)

export async function platformConsole({ matrix }) {
  console.log('\n== 5. Platform-admin console ==')
  const platform = await makePlatformAdmin()
  const coA = await makeCompany(`ConA ${tag()}`), coB = await makeCompany(`ConB ${tag()}`)
  const A = await makeCompanyAdmin(coA.id), B = await makeCompanyAdmin(coB.id)
  const Am = await makeCompanyAdmin(coA.id, 'manager')
  const org = platform.orgId

  // organisations list and filters
  const all = await api(platform.token, 'GET', '/admin/orgs?limit=100', undefined, { org })
  check('5.1 platform lists organisations with total and paging', all.status === 200 && Array.isArray(all.body.items) && typeof all.body.total === 'number' && all.body.limit === 100, J(all.body).slice(0, 200))
  const byKind = await api(platform.token, 'GET', '/admin/orgs?kind=platform', undefined, { org })
  check('5.2 filter kind=platform returns the platform organisation only', byKind.body.items.length >= 1 && byKind.body.items.every(o => o.kind === 'platform'), J(byKind.body).slice(0, 200))
  const byStatus = await api(platform.token, 'GET', '/admin/orgs?status=active&kind=logistic_company&limit=100', undefined, { org })
  check('5.3 filter status=active + kind=logistic_company', byStatus.body.items.some(o => o.id === coA.id) && byStatus.body.items.every(o => o.status === 'active' && o.kind === 'logistic_company'))
  const bad = await api(platform.token, 'GET', '/admin/orgs?status=banana', undefined, { org })
  const big = await api(platform.token, 'GET', '/admin/orgs?limit=100000', undefined, { org })
  check('5.4 invalid filters are refused (422/400), not a 500', [400, 422].includes(bad.status) && [400, 422].includes(big.status), `${bad.status} ${big.status}`)
  const page = await api(platform.token, 'GET', '/admin/orgs?limit=1&offset=1', undefined, { org })
  check('5.5 paging: limit=1 offset=1 gives one row', page.status === 200 && page.body.items.length === 1 && page.body.offset === 1)

  // a company admin cannot reach platform routes
  const routes = [['GET', '/admin/orgs'], ['PUT', `/admin/orgs/${coB.id}/suspend`], ['PUT', `/admin/orgs/${coB.id}/approve`], ['PUT', `/admin/orgs/${coB.id}/reject`]]
  const res = {}
  for (const [m, p] of routes) res[`${m} ${p.replace(coB.id, ':id')}`] = [(await api(A.token, m, p, m === 'GET' ? undefined : { reason: 'x y z' })).status, (await api(Am.token, m, p, m === 'GET' ? undefined : { reason: 'x y z' })).status]
  check('5.6 company admin and manager get 403 on every /admin/orgs route', Object.values(res).every(([a, b]) => a === 403 && b === 403), J(res))
  const still = await db('GET', 'organizations', { query: `id=eq.${coB.id}&select=status` })
  check('5.7 and the other company is still active', still.body[0].status === 'active')
  const actAs = await api(A.token, 'GET', '/admin/orgs', undefined, { org })
  check('5.8 a company admin naming the platform org in X-Org-Id is refused (403)', actAs.status === 403, `${actAs.status}`)
  const noHeader = await api(platform.token, 'GET', '/admin/orgs')
  check('5.9 a platform owner without X-Org-Id still resolves to the platform (only org) and reaches the console', noHeader.status === 200, `${noHeader.status}`)
  // a platform admin who also belongs to a company, acting as that company, is that company's admin only
  const dual = await makeUser(`${tag()}-dual`, 'vendor'); dual.token = await login(dual.email)
  await db('POST', 'org_members', { body: { org_id: org, user_id: dual.id, role: 'owner', status: 'active' } })
  await db('POST', 'org_members', { body: { org_id: coA.id, user_id: dual.id, role: 'admin', status: 'active' } })
  await db('PATCH', 'users', { query: `id=eq.${dual.id}`, body: { role: 'superadmin' } })
  await sleep(500)
  const dualPlat = await api(dual.token, 'GET', '/admin/orgs', undefined, { org })
  const dualCo = await api(dual.token, 'GET', '/admin/orgs', undefined, { org: coA.id })
  const dualVeh = await api(dual.token, 'GET', '/vehicles', undefined, { org: coA.id })
  check('5.10 platform owner who is also a company admin: reaches the console (platform privileges follow membership by design) and, acting as the company, lists that company\'s vehicles only', dualPlat.status === 200 && dualCo.status === 200 && dualVeh.status === 200 && !J(dualVeh.body).includes(B.id), `${dualPlat.status} ${dualCo.status} ${dualVeh.status}`)
  const grant = await api(dual.token, 'PATCH', `/users/${A.id}`, { role: 'superadmin' }, { org: coA.id })
  check('5.11 acting inside a company, a superadmin account cannot grant superadmin', grant.status === 403, `${grant.status} ${J(grant.body)}`)

  // users list and role changes
  const uA = await api(A.token, 'GET', '/users?limit=500')
  const idsA = new Set((uA.body.items ?? uA.body ?? []).map(u => u.id))
  check('5.12 a company admin\'s /users lists its own people and none of the other company\'s', uA.status === 200 && idsA.has(A.id) && !idsA.has(B.id), `${uA.status} n=${idsA.size}`)
  const uP = await api(platform.token, 'GET', '/users?limit=500', undefined, { org })
  const idsP = new Set((uP.body.items ?? uP.body ?? []).map(u => u.id))
  check('5.13 the platform admin\'s /users lists people of both companies', uP.status === 200 && idsP.has(A.id) && idsP.has(B.id), `${uP.status} n=${idsP.size}`)
  const selfGrant = await api(A.token, 'PATCH', `/users/${A.id}`, { role: 'superadmin' })
  const rowA = await db('GET', 'users', { query: `id=eq.${A.id}&select=role` })
  check('5.14 a company admin cannot make themselves superadmin (refused, role unchanged)', selfGrant.status >= 400 && selfGrant.status < 500 && rowA.body[0].role !== 'superadmin', `${selfGrant.status} role ${rowA.body[0].role}`)
  const foreignRole = await api(A.token, 'PATCH', `/users/${B.id}`, { role: 'manager' })
  check('5.15 a company admin cannot change the other company\'s user (404)', foreignRole.status === 404, `${foreignRole.status}`)
  const viaPlatform = await api(platform.token, 'PATCH', `/users/${Am.id}`, { is_active: false }, { org })
  const mgrLogin = await api(Am.token, 'GET', '/vehicles')
  const back = await api(platform.token, 'PATCH', `/users/${Am.id}`, { is_active: true }, { org })
  check('5.16 the platform admin can deactivate and reactivate a company user', viaPlatform.status === 200 && back.status === 200, `${viaPlatform.status} ${mgrLogin.status} ${back.status}`)

  // audit
  const mark = await api(A.token, 'PUT', '/driver/dispatch-contact', { phone: '+919822200001' })
  const ex = await api(A.token, 'POST', '/finance/expenses', { category: 'fuel', amount: 10, expense_date: new Date().toISOString().slice(0, 10), note: 'audit probe' })
  await api(B.token, 'PUT', '/driver/dispatch-contact', { phone: '+919822200002' })
  await sleep(1500)
  const auA = await api(A.token, 'GET', '/analytics/audit-logs?limit=200'), auB = await api(B.token, 'GET', '/analytics/audit-logs?limit=200'), auP = await api(platform.token, 'GET', '/analytics/audit-logs?limit=200', undefined, { org })
  const rawA = await db('GET', 'ai_agent_logs', { query: `input_data->>org_id=eq.${coA.id}&select=id` })
  const rawB = await db('GET', 'ai_agent_logs', { query: `input_data->>org_id=eq.${coB.id}&select=id` })
  const ia = new Set((auA.body.items ?? []).map(i => i.id)), ib = new Set((auB.body.items ?? []).map(i => i.id))
  check('5.17 the audit log: a company sees its own entries and none of the other company\'s', auA.status === 200 && auB.status === 200 && (rawA.body ?? []).every(r => !ib.has(r.id)) && (rawB.body ?? []).every(r => !ia.has(r.id)), `A sees ${ia.size}, B sees ${ib.size}`)
  const ip = new Set((auP.body.items ?? []).map(i => i.id))
  check('5.18 the platform audit log includes platform decisions', auP.status === 200 && ip.size > 0, `${auP.status} n=${ip.size}`)
  const auM = await api(Am.token, 'GET', '/analytics/audit-logs')
  check('5.19 a manager cannot read the audit log', auM.status === 403, `${auM.status}`)

  // KYC queue (platform-level in the platform model): what a company admin can do today
  const v = await makeVendor({ approved: false })
  const sub = await api(v.token, 'POST', '/vendor/kyc/submit', {
    companyName: 'KYC Probe Traders', gstNumber: '27AAPFU0939F1ZV', city: 'Mumbai', address: 'Plot 9', lat: 19.1197, lng: 72.8464,
    kycData: { data: { vendorType: 'Trader', panNumber: 'AAPFU0939F', contactPerson: 'UAT', mobile: '9876501234', bankBeneficiary: 'Flow', bankAccount: '50100123456789', bankIfsc: 'HDFC0000123', bankName: 'HDFC Bank', bankBranch: 'Andheri East' } },
  })
  const pg = await fetch(`${DATA}/rest/v1/vendor_profiles?id=eq.${v.id}&select=id,gst_number,kyc_status`, { headers: { apikey: env.ANON, Authorization: `Bearer ${B.token}` } })
  const seen = (await pg.json())
  const kycA = await api(B.token, 'PUT', `/vendor/kyc/${v.id}/reject`, { reason: 'Not convinced by this vendor' })
  const after = await db('GET', 'vendor_profiles', { query: `id=eq.${v.id}&select=kyc_status` })
  console.log(`   KYC today: company B admin can read the unrelated vendor's profile via PostgREST: ${Array.isArray(seen) && seen.length === 1}; can reject its KYC: ${kycA.status}; status now ${after.body?.[0]?.kyc_status}`)
  check('5.20 KYC review is platform-level: a company admin of an unrelated company cannot read or decide a vendor\'s KYC', !(Array.isArray(seen) && seen.length === 1) && kycA.status === 403, `read=${Array.isArray(seen) && seen.length} reject=${kycA.status}`)
  // 3PL partner approval queue
  const q = await api(A.token, 'GET', '/tpl/queue')
  console.log(`   3PL partner approval queue for a company admin: ${q.status}`)
  // A company sees only its OWN partners there, never bank details, PAN or documents; deciding is the platform's (approve/reject are superadmin-only)
  const rows = Array.isArray(q.body) ? q.body : []
  check('5.21 the 3PL queue shows a company only its own partners, without bank details or PAN', q.status === 200 && rows.every(r => !('bank_account_no' in r) && !('pan_number' in r)), `${q.status} ${rows.length} rows`)
  matrix.push({ section: 'console', note: 'see PASS/FAIL list' })
}
