// Audit area 6 — PLATFORM AND TENANCY, walked on the TEST stage.
//   node e2e/staging/tenancy.mjs [registration] [members] [isolation] [settings] [console]   (no argument: all)
// Fresh throw-away accounts and companies every run. Prints PASS/FAIL per step and writes the matrix rows to
// e2e/staging/.tenancy-matrix.json (ignored) for docs/uat/findings/TENANCY.md.
import { writeFileSync } from 'node:fs'
import { api, db, check, makeUser, login, makeCompany, makeCompanyAdmin, makePlatformAdmin, makeVendor, makeDriver, sleep, tag, env, DATA } from './actors.mjs'

const want = new Set(process.argv.slice(2))
const run = name => want.size === 0 || want.has(name)
const matrix = []
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const idsIn = body => new Set((JSON.stringify(body ?? '').match(UUID) ?? []).map(s => s.toLowerCase()))
const rows = body => Array.isArray(body) ? body : (body?.items ?? body?.data ?? body?.rows ?? [])

async function notificationsOf(userId, type) {
  const r = await db('GET', 'notifications', { query: `user_id=eq.${userId}&type=eq.${type}&select=title,body,type,data&order=created_at.desc` })
  return r.body || []
}
async function auditOf(action, orgId) {
  const r = await db('GET', 'ai_agent_logs', { query: `action=eq.${action}&order=created_at.desc&limit=50&select=action,input_data,output_data` })
  return (r.body || []).filter(x => x.input_data?.org_id === orgId || x.input_data?.org_id === undefined)
}

const orgPayload = n => ({ kind: 'logistic_company', name: n, legal_name: `${n} Pvt Ltd`, gstin: '27AAHCM1234A1Z5', state: 'Maharashtra', city: 'Pune', address: '12 Transport Nagar', pincode: '411001', phone: '9876500011', email: `${tag()}@margix.test` })

// ───────────────────────── 1. registration and approval ─────────────────────────
async function registration() {
  console.log('\n== 1. Company registration and platform decisions ==')
  const platform = await makePlatformAdmin()
  const owner = await makeUser(`${tag()}-reg`, 'vendor'); owner.token = await login(owner.email)
  const name = `Reg Co ${tag()}`
  const c = await api(owner.token, 'POST', '/orgs', orgPayload(name))
  check('1.1 register logistic_company -> 201 pending', c.status === 201 && c.body.status === 'pending' && c.body.kind === 'logistic_company', JSON.stringify(c))
  const orgId = c.body.id
  const bad = await api(owner.token, 'POST', '/orgs', { kind: 'platform', name: 'Sneaky' })
  check('1.2 cannot register kind platform', bad.status === 422 || bad.status === 400, JSON.stringify(bad))
  const bad2 = await api(owner.token, 'POST', '/orgs', { ...orgPayload('X Co'), status: 'active' })
  check('1.3 cannot self-set status active on register (strict schema)', bad2.status === 422, JSON.stringify(bad2))

  const mine = await api(owner.token, 'GET', '/orgs/mine')
  check('1.4 /orgs/mine shows the pending company, owner role, app_role not staff', mine.status === 200 && mine.body.some(m => m.org.id === orgId && m.org.status === 'pending' && m.role === 'owner' && !['admin', 'manager', 'superadmin'].includes(m.app_role)), JSON.stringify(mine.body))
  const own = await api(owner.token, 'GET', '/org')
  check('1.5 pending owner can read its own organisation (waiting screen)', own.status === 200 && own.body.status === 'pending', JSON.stringify(own))

  // a pending company cannot operate
  const pend = {}
  for (const [m, p] of [['GET', '/vehicles'], ['GET', '/shipments'], ['GET', '/routes'], ['GET', '/finance/invoices'], ['GET', '/finance/expenses'], ['GET', '/people'], ['GET', '/depots'], ['GET', '/fleet/alerts'], ['GET', '/dashboard/kpis'], ['GET', '/driver-pay/entries'], ['GET', '/analytics/audit-logs'], ['GET', '/users']]) {
    pend[p] = (await api(owner.token, m, p)).status
  }
  check('1.6 pending company: operational endpoints answer 403 (no data)', Object.values(pend).every(s => s === 403), JSON.stringify(pend))
  const pw = await api(owner.token, 'POST', '/vehicles', { plate_number: `MH12${tag().toUpperCase().slice(0, 6)}`, vehicle_type: 'truck', capacity_kg: 1000 })
  check('1.7 pending company cannot create a vehicle', pw.status === 403, JSON.stringify(pw))
  const selfApprove = await api(owner.token, 'PUT', `/admin/orgs/${orgId}/approve`, {})
  check('1.8 owner cannot approve itself (platform admins only)', selfApprove.status === 403, JSON.stringify(selfApprove))
  const selfPatch = await api(owner.token, 'PATCH', '/org', { status: 'active' })
  check('1.9 owner cannot PATCH status', selfPatch.status === 422 || selfPatch.status === 400, JSON.stringify(selfPatch))

  // platform: list, filter, reject with reason
  const list = await api(platform.token, 'GET', '/admin/orgs?status=pending&kind=logistic_company&limit=100', undefined, { org: platform.orgId })
  check('1.10 platform lists pending logistic companies incl. the new one', list.status === 200 && list.body.items.some(o => o.id === orgId), JSON.stringify(list.body).slice(0, 200))
  check('1.11 filter only returns the asked status/kind', list.body.items.every(o => o.status === 'pending' && o.kind === 'logistic_company'))
  const noReason = await api(platform.token, 'PUT', `/admin/orgs/${orgId}/reject`, {})
  check('1.12 reject without a reason -> 422', noReason.status === 422, JSON.stringify(noReason))
  const rej = await api(platform.token, 'PUT', `/admin/orgs/${orgId}/reject`, { reason: 'GSTIN does not match the legal name' })
  check('1.13 reject with reason -> rejected', rej.status === 200 && rej.body.status === 'rejected' && rej.body.profile?.reject_reason, JSON.stringify(rej.body).slice(0, 200))
  const n1 = await notificationsOf(owner.id, 'org_reject')
  check('1.14 owner notified of the rejection with the reason', n1.length >= 1 && /GSTIN/.test(n1[0].body), JSON.stringify(n1))
  const a1 = await db('GET', 'ai_agent_logs', { query: `action=eq.org.reject&order=created_at.desc&limit=20&select=input_data` })
  check('1.15 rejection audited (actor, org, reason)', (a1.body || []).some(x => x.input_data?.org_id === orgId && x.input_data?.actor_id === platform.id && x.input_data?.reason), JSON.stringify(a1.body).slice(0, 200))
  const rejAgain = await api(platform.token, 'PUT', `/admin/orgs/${orgId}/approve`, {})
  check('1.16 a rejected company cannot be approved straight away (409)', rejAgain.status === 409, JSON.stringify(rejAgain))
  await sleep(1500)
  const rv = await api(owner.token, 'GET', '/vehicles')
  check('1.17 rejected company: operational endpoint 403 with a clear message', rv.status === 403 && /rejected/i.test(rv.body.detail || ''), JSON.stringify(rv))
  const rown = await api(owner.token, 'GET', '/org')
  check('1.18 rejected company can still read /org (to show the reason)', rown.status === 200 && rown.body.status === 'rejected', JSON.stringify(rown).slice(0, 200))

  // a second registration is approved, then suspended, reinstated
  const name2 = `Reg Co2 ${tag()}`
  const owner2 = await makeUser(`${tag()}-reg2`, 'vendor'); owner2.token = await login(owner2.email)
  const c2 = await api(owner2.token, 'POST', '/orgs', orgPayload(name2))
  const id2 = c2.body.id
  const ap = await api(platform.token, 'PUT', `/admin/orgs/${id2}/approve`, {})
  check('1.19 approve -> active, approved_by and approved_at set', ap.status === 200 && ap.body.status === 'active' && ap.body.approved_by === platform.id && ap.body.approved_at, JSON.stringify(ap.body).slice(0, 200))
  const apAgain = await api(platform.token, 'PUT', `/admin/orgs/${id2}/approve`, {})
  check('1.20 approving an active company again -> 409', apAgain.status === 409, JSON.stringify(apAgain))
  const n2 = await notificationsOf(owner2.id, 'org_approve')
  check('1.21 owner notified of the approval', n2.length >= 1, JSON.stringify(n2))
  await sleep(500)
  const mine2 = await api(owner2.token, 'GET', '/orgs/mine')
  check('1.22 approved company: effective app role admin', mine2.body.some(m => m.org.id === id2 && m.app_role === 'admin'), JSON.stringify(mine2.body))
  const ov = await api(owner2.token, 'GET', '/vehicles')
  check('1.23 approved company operates (GET /vehicles 200, empty)', ov.status === 200 && rows(ov.body).length === 0, JSON.stringify(ov).slice(0, 200))
  const sus = await api(platform.token, 'PUT', `/admin/orgs/${id2}/suspend`, { reason: 'KYC lapsed' })
  check('1.24 suspend -> suspended with reason', sus.status === 200 && sus.body.status === 'suspended' && sus.body.profile?.suspend_reason === 'KYC lapsed', JSON.stringify(sus.body).slice(0, 200))
  const sv = {}
  for (const p of ['/vehicles', '/shipments', '/finance/invoices', '/people', '/dashboard/kpis']) sv[p] = (await api(owner2.token, 'GET', p)).status
  check('1.25 suspended company: every operational endpoint 403 immediately', Object.values(sv).every(s => s === 403), JSON.stringify(sv))
  const sw = await api(owner2.token, 'POST', '/vehicles', { plate_number: `MH14${tag().toUpperCase().slice(0, 6)}`, vehicle_type: 'truck', capacity_kg: 1000 })
  check('1.26 suspended company cannot write', sw.status === 403, JSON.stringify(sw))
  check('1.27 owner notified of the suspension', (await notificationsOf(owner2.id, 'org_suspend')).length >= 1)
  const ap2 = await api(platform.token, 'PUT', `/admin/orgs/${id2}/approve`, {})
  check('1.28 re-approve a suspended company -> active', ap2.status === 200 && ap2.body.status === 'active', JSON.stringify(ap2.body).slice(0, 200))
  const ov2 = await api(owner2.token, 'GET', '/vehicles')
  check('1.29 re-approved company works again at once', ov2.status === 200, JSON.stringify(ov2).slice(0, 200))
  const suspPlat = await api(platform.token, 'PUT', `/admin/orgs/${platform.orgId}/suspend`, {})
  check('1.30 the platform organisation cannot be suspended', suspPlat.status === 400 || suspPlat.status === 409, JSON.stringify(suspPlat))
  const acts = await db('GET', 'ai_agent_logs', { query: `action=in.(org.approve,org.suspend,org.created)&order=created_at.desc&limit=60&select=action,input_data` })
  const mineAct = new Set((acts.body || []).filter(x => x.input_data?.org_id === id2).map(x => x.action))
  check('1.31 created/approve/suspend all audited for the company', ['org.created', 'org.approve', 'org.suspend'].every(a => mineAct.has(a)), JSON.stringify([...mineAct]))
  const bogus = await api(platform.token, 'PUT', `/admin/orgs/00000000-0000-4000-8000-000000000001/approve`, {})
  check('1.32 approving an unknown organisation -> 404', bogus.status === 404, JSON.stringify(bogus))
  // company admin on a pending company's id cannot act
  const staff = await makeCompanyAdmin(id2)
  const cannotDecide = await api(staff.token, 'PUT', `/admin/orgs/${id2}/suspend`, {})
  check('1.33 a company admin cannot suspend (own or other) organisation', cannotDecide.status === 403, JSON.stringify(cannotDecide))
  const cannotList = await api(staff.token, 'GET', '/admin/orgs')
  check('1.34 a company admin cannot list organisations', cannotList.status === 403, JSON.stringify(cannotList))
  const rate = await api(owner2.token, 'POST', '/orgs', { ...orgPayload('More') })
  check('1.35 a user may register a further company (201) and it starts pending', rate.status === 201 && rate.body.status === 'pending', JSON.stringify(rate).slice(0, 160))
  const anon = await api(null, 'POST', '/orgs', orgPayload('Anon Co'))
  check('1.37 anonymous cannot register (401)', anon.status === 401)
  return { platform, orgId, id2, owner2 }
}

// ───────────────────────── 2. members ─────────────────────────
async function members() {
  console.log('\n== 2. Members, roles, switching ==')
  const platform = await makePlatformAdmin()
  const co = await makeCompany(`Mem Co ${tag()}`); const other = await makeCompany(`Mem Other ${tag()}`)
  const owner = await makeUser(`${tag()}-own`, 'vendor'); owner.token = await login(owner.email)
  await db('POST', 'org_members', { body: { org_id: co.id, user_id: owner.id, role: 'owner', status: 'active' } })
  await sleep(300)
  const ownerTok = owner.token
  const otherAdmin = await makeCompanyAdmin(other.id)
  const roles = ['admin', 'ops', 'finance', 'dispatcher', 'driver', 'member']
  const expectApp = { admin: 'admin', ops: 'manager', finance: 'manager', dispatcher: 'manager', driver: 'driver', member: 'manager' }
  const people = {}
  for (const r of roles) {
    const u = await makeUser(`${tag()}-${r}`, 'vendor'); u.token = await login(u.email); people[r] = u
    const inv = await api(ownerTok, 'POST', '/org/members', r === 'member' ? { phone: '9' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0'), role: r } : { email: u.email, role: r })
    if (r === 'member') {
      check(`2.1 invite by an unknown phone -> 422`, inv.status === 422, JSON.stringify(inv))
      const inv2 = await api(ownerTok, 'POST', '/org/members', { email: u.email, role: r })
      check(`2.1b invite ${r} by email -> 201 active`, inv2.status === 201 && inv2.body.status === 'active' && inv2.body.role === r, JSON.stringify(inv2))
    } else check(`2.2 invite ${r} by email -> 201 active`, inv.status === 201 && inv.body.status === 'active' && inv.body.role === r, JSON.stringify(inv))
  }
  // invite by phone
  const pu = await makeUser(`${tag()}-ph`, 'vendor')
  const phone = '9' + String(Math.floor(Math.random() * 9e8) + 1e8)
  await db('PATCH', 'users', { query: `id=eq.${pu.id}`, body: { phone: '+91' + phone } })
  const byPhone = await api(ownerTok, 'POST', '/org/members', { phone, role: 'dispatcher' })
  check('2.3 invite by phone finds the user', byPhone.status === 201, JSON.stringify(byPhone))
  const dup = await api(ownerTok, 'POST', '/org/members', { email: people.admin.email, role: 'ops' })
  check('2.4 inviting an existing active member -> 409', dup.status === 409, JSON.stringify(dup))
  const both = await api(ownerTok, 'POST', '/org/members', { email: people.admin.email, phone: '9876543210', role: 'ops' })
  check('2.5 email and phone together -> 422', both.status === 422)
  const badRole = await api(ownerTok, 'POST', '/org/members', { email: people.admin.email, role: 'superadmin' })
  check('2.6 role superadmin is not an organisation role -> 422', badRole.status === 422)

  // app role mapping and menu access per role
  await sleep(1000)
  const probe = {}
  for (const r of roles) {
    const m = await api(people[r].token, 'GET', '/orgs/mine', undefined, { org: co.id })
    const mem = (m.body || []).find(x => x.org?.id === co.id)
    probe[r] = mem?.app_role
  }
  check('2.7 org role -> app role (appRoleFor): admin=admin, ops/finance/dispatcher/member=manager, driver=driver', roles.every(r => probe[r] === expectApp[r]), JSON.stringify(probe))
  const access = {}
  for (const r of roles) {
    access[r] = {
      vehicles: (await api(people[r].token, 'GET', '/vehicles', undefined, { org: co.id })).status,
      invoices: (await api(people[r].token, 'GET', '/finance/invoices', undefined, { org: co.id })).status,
      members: (await api(people[r].token, 'GET', '/org/members', undefined, { org: co.id })).status,
      users: (await api(people[r].token, 'GET', '/users', undefined, { org: co.id })).status,
      pay: (await api(people[r].token, 'GET', '/driver-pay/entries', undefined, { org: co.id })).status,
      dash: (await api(people[r].token, 'GET', '/dashboard/kpis', undefined, { org: co.id })).status,
    }
  }
  console.log('   access by role:', JSON.stringify(access))
  matrix.push({ section: 'roles', access })
  check('2.8 only owner/admin can read /org/members', roles.every(r => (access[r].members === 200) === (r === 'admin')) && (await api(ownerTok, 'GET', '/org/members')).status === 200, JSON.stringify(access))
  check('2.9 every staff role reads /vehicles; a driver role is not given staff finance', ['admin', 'ops', 'finance', 'dispatcher', 'member'].every(r => access[r].vehicles === 200) && access.driver.invoices !== 200, JSON.stringify(access))
  check('2.10 /users (all users) is not open to non-admin org roles', ['ops', 'finance', 'dispatcher', 'member', 'driver'].every(r => access[r].users === 403), JSON.stringify(access))

  // change a role
  const ch = await api(ownerTok, 'PATCH', `/org/members/${people.ops.id}`, { role: 'finance' })
  check('2.11 change role ops -> finance', ch.status === 200 && ch.body.role === 'finance', JSON.stringify(ch))
  const lm = await api(ownerTok, 'GET', '/org/members')
  check('2.12 member list shows the new role and names', lm.status === 200 && lm.body.find(m => m.user_id === people.ops.id)?.role === 'finance' && lm.body.every(m => m.email), JSON.stringify(lm).slice(0, 200))

  // admin cannot touch owner, cannot make owner
  const adminTok = people.admin.token
  const aOwner = await api(adminTok, 'PATCH', `/org/members/${owner.id}`, { status: 'removed' }, { org: co.id })
  check('2.13 an admin cannot remove an owner (403)', aOwner.status === 403, JSON.stringify(aOwner))
  const aMake = await api(adminTok, 'PATCH', `/org/members/${people.member.id}`, { role: 'owner' }, { org: co.id })
  check('2.14 an admin cannot promote to owner (403)', aMake.status === 403, JSON.stringify(aMake))
  const aInv = await api(adminTok, 'POST', '/org/members', { email: (await makeUser(`${tag()}-x`, 'vendor')).email, role: 'owner' }, { org: co.id })
  check('2.15 an admin cannot invite an owner (403)', aInv.status === 403, JSON.stringify(aInv))
  const last = await api(ownerTok, 'PATCH', `/org/members/${owner.id}`, { status: 'removed' })
  check('2.16 the last owner cannot remove themselves (409)', last.status === 409, JSON.stringify(last))
  const demote = await api(ownerTok, 'PATCH', `/org/members/${owner.id}`, { role: 'admin' })
  check('2.17 the last owner cannot demote themselves (409)', demote.status === 409, JSON.stringify(demote))
  // a second owner then the first may leave
  const o2 = await api(ownerTok, 'PATCH', `/org/members/${people.admin.id}`, { role: 'owner' })
  check('2.18 an owner can promote another owner', o2.status === 200, JSON.stringify(o2))
  // an organisation member of another company cannot be patched through this company
  const foreign = await api(ownerTok, 'PATCH', `/org/members/${otherAdmin.id}`, { status: 'removed' })
  check('2.19 a member of another company cannot be touched (404)', foreign.status === 404, JSON.stringify(foreign))
  const foreignList = (await api(ownerTok, 'GET', '/org/members')).body
  check('2.20 member list contains only this company\'s people', !foreignList.some(m => m.user_id === otherAdmin.id))

  // removal: loses access fast
  const warm = await api(people.dispatcher.token, 'GET', '/vehicles', undefined, { org: co.id })
  const rm = await api(ownerTok, 'PATCH', `/org/members/${people.dispatcher.id}`, { status: 'removed' })
  check('2.21 remove a member', warm.status === 200 && rm.status === 200 && rm.body.status === 'removed', JSON.stringify(rm))
  const after = await api(people.dispatcher.token, 'GET', '/vehicles', undefined, { org: co.id })
  check('2.22 removed member loses access at once (invalidated cache): X-Org-Id of the company -> 403', after.status === 403, JSON.stringify(after))
  const after2 = await api(people.dispatcher.token, 'GET', '/vehicles')
  check('2.23 removed member with no header: no company data (403, not 200)', after2.status !== 200, JSON.stringify(after2))
  const lm2 = (await api(ownerTok, 'GET', '/org/members')).body
  check('2.24 removed member is not in the list', !lm2.some(m => m.user_id === people.dispatcher.id))
  const back = await api(ownerTok, 'POST', '/org/members', { email: people.dispatcher.email, role: 'ops' })
  check('2.25 restore by inviting again (status active, new role)', back.status === 201 && back.body.role === 'ops', JSON.stringify(back))
  const back2 = await api(people.dispatcher.token, 'GET', '/vehicles', undefined, { org: co.id })
  check('2.26 restored member works again at once', back2.status === 200, JSON.stringify(back2))
  const restore = await api(ownerTok, 'PATCH', `/org/members/${people.driver.id}`, { status: 'removed' })
  const restore2 = await api(ownerTok, 'PATCH', `/org/members/${people.driver.id}`, { status: 'active' })
  check('2.27 restore by PATCH status active', restore.status === 200 && restore2.status === 200 && restore2.body.status === 'active', JSON.stringify(restore2))
  const demoteSelf = await api(adminTok, 'PATCH', `/org/members/${people.admin.id}`, { role: 'ops' }, { org: co.id })
  check('2.28 role change takes effect at once (admin demoted to ops loses /org/members)', demoteSelf.status === 200 && (await api(adminTok, 'GET', '/org/members', undefined, { org: co.id })).status === 403, JSON.stringify(demoteSelf))

  // the 2nd owner (people.admin was promoted then demoted...) — owner of two orgs switching
  const multi = await makeUser(`${tag()}-multi`, 'vendor'); multi.token = await login(multi.email)
  await api(ownerTok, 'POST', '/org/members', { email: multi.email, role: 'admin' })
  await db('POST', 'org_members', { body: { org_id: other.id, user_id: multi.id, role: 'admin', status: 'active' } })
  await sleep(61_000) // the new membership of an already-seen user is picked up after the cache window
  const ms = await api(multi.token, 'GET', '/orgs/mine')
  check('2.29 a user in two companies lists both', ms.body.filter(m => m.org.kind === 'logistic_company').length === 2, JSON.stringify(ms.body))
  const sw1 = await api(multi.token, 'GET', '/org', undefined, { org: co.id }); const sw2 = await api(multi.token, 'GET', '/org', undefined, { org: other.id })
  check('2.30 X-Org-Id switches the active organisation', sw1.body.id === co.id && sw2.body.id === other.id, JSON.stringify([sw1.body.id, sw2.body.id]))
  const foreignOrg = await makeCompany(`Foreign ${tag()}`)
  const f403 = await api(multi.token, 'GET', '/vehicles', undefined, { org: foreignOrg.id })
  check('2.31 an X-Org-Id of a company the user is not in -> 403', f403.status === 403, JSON.stringify(f403))
  const fplat = await api(multi.token, 'GET', '/admin/orgs', undefined, { org: platform.orgId })
  check('2.32 an X-Org-Id of the platform org without membership -> 403', fplat.status === 403, JSON.stringify(fplat))
  const bad = await api(multi.token, 'GET', '/vehicles', undefined, { org: 'not-a-uuid' })
  check('2.33 malformed X-Org-Id -> 400', bad.status === 400, JSON.stringify(bad))
  const vOrg = await api(multi.token, 'GET', '/vehicles')
  check('2.34 two companies, no header -> still resolves to one company (200)', vOrg.status === 200, JSON.stringify(vOrg))
  // data written in A is not visible switching to B
  const vA = await api(multi.token, 'POST', '/vehicles', { plate_number: `MH12${tag().toUpperCase().slice(0, 5)}`, vehicle_type: 'truck', capacity_kg: 1500 }, { org: co.id })
  const lB = await api(multi.token, 'GET', '/vehicles', undefined, { org: other.id })
  const lA = await api(multi.token, 'GET', '/vehicles', undefined, { org: co.id })
  check('2.35 a vehicle created acting as A is in A, not B', vA.status === 201 && lA.body && JSON.stringify(lA.body).includes(vA.body.id ?? vA.body.vehicle?.id ?? 'x') && !JSON.stringify(lB.body).includes(vA.body.id ?? vA.body.vehicle?.id ?? 'x'), JSON.stringify(vA).slice(0, 200))
  // platform admin removing someone from a company via /org? platform acts as platform: /org/members lists the platform's own members
  const pm = await api(platform.token, 'GET', '/org/members', undefined, { org: platform.orgId })
  check('2.36 platform /org/members shows the platform\'s own members only', pm.status === 200 && !pm.body.some(m => m.user_id === owner.id), JSON.stringify(pm).slice(0, 120))
  const audits = await db('GET', 'ai_agent_logs', { query: `action=in.(org.member_added,org.member_updated)&order=created_at.desc&limit=80&select=action,input_data` })
  check('2.37 member changes audited', (audits.body || []).some(a => a.input_data?.org_id === co.id && a.action === 'org.member_updated') && (audits.body || []).some(a => a.input_data?.org_id === co.id && a.action === 'org.member_added'))
}

const wrap = async (name, fn) => { try { return await fn() } catch (e) { check(`${name} crashed`, false, e.stack || String(e)) } }

if (run('registration')) await wrap('registration', registration)
if (run('members')) await wrap('members', members)
if (run('isolation')) { const m = await import('./tenancy-isolation.mjs').catch(() => null); if (m) await wrap('isolation', () => m.isolation({ matrix })) }
if (run('settings')) { const m = await import('./tenancy-settings.mjs').catch(() => null); if (m) await wrap('settings', () => m.settings({ matrix })) }
if (run('console')) { const m = await import('./tenancy-console.mjs').catch(() => null); if (m) await wrap('console', () => m.platformConsole({ matrix })) }

if (process.env.TENANCY_MATRIX) writeFileSync(process.env.TENANCY_MATRIX, JSON.stringify(matrix, null, 1))
import { results } from './actors.mjs'
console.log(`\n${results.filter(r => r.ok).length} PASS, ${results.filter(r => !r.ok).length} FAIL`)
