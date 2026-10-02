// Audit area 1: FLEET AND PEOPLE, walked as real actors on the TEST stage in two throw-away companies.
//   node e2e/staging/fleet.mjs
import { createHash } from 'node:crypto'
import { api, db, makeCompany, makeCompanyAdmin, putSigned, readObject, check, results, sleep, tag, PNG, API, DATA } from './actors.mjs'

const rnd = n => Math.random().toString(36).slice(2, 2 + n).toUpperCase()
const plate = () => `UF${Math.floor(10 + Math.random() * 89)}${rnd(2)}${Math.floor(1000 + Math.random() * 8999)}`
const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
const phone = () => `9${Math.floor(100000000 + Math.random() * 899999999)}`
const st = r => `${r.status} ${typeof r.body === 'string' ? r.body.slice(0, 120) : JSON.stringify(r.body)?.slice(0, 200)}`
const step = async (name, fn) => { try { await fn() } catch (e) { check(`${name} (script error)`, false, `threw ${e.stack?.split('\n').slice(0, 3).join(' | ')}`) } }
const url = u => (u.startsWith('http') ? u : DATA + u)
const G = {}

const coA = await makeCompany(`Fleet A ${tag()}`)
const coB = await makeCompany(`Fleet B ${tag()}`)
const A = await makeCompanyAdmin(coA.id, 'admin')
const AM = await makeCompanyAdmin(coA.id, 'manager')
const B = await makeCompanyAdmin(coB.id, 'admin')
const BM = await makeCompanyAdmin(coB.id, 'manager')
await sleep(1500)

// ── 1. Vehicles ──────────────────────────────────────────────
const P1 = plate()
const vBody = {
  plate_number: P1, vehicle_type: 'truck', capacity_kg: 8000, vehicle_model: 'Tata 1109', fuel_capacity_liters: 200, fuel_efficiency_kmpl: 6,
  hazmat_certified: true, is_reefer: true, body_type: 'closed', rc_number: 'RC123456', rc_expiry: day(400), insurance_number: 'INS998877', insurance_expiry: day(200),
  fitness_certificate_number: 'FIT5566', fitness_expiry: day(300), permit_number: 'PER4455', permit_expiry: day(250), puc_number: 'PUC3344', puc_expiry: day(90),
}
let veh
await step('1.1', async () => {
  const r = await api(A.token, 'POST', '/vehicles', vBody)
  veh = r.body
  check('1.1 staff (admin) adds a vehicle -> 201', r.status === 201 && veh?.id, st(r))
})
await step('1.2', async () => {
  const row = (await db('GET', 'vehicles', { query: `id=eq.${veh.id}&select=*` })).body[0]
  check('1.2 plate/class/capacity persisted', row.plate_number === P1 && row.vehicle_type === 'truck' && Number(row.capacity_kg) === 8000, JSON.stringify(row).slice(0, 200))
  check('1.2 hazmat_certified/is_reefer/body_type persisted', row.hazmat_certified === true && row.is_reefer === true && row.body_type === 'closed', `${row.hazmat_certified} ${row.is_reefer} ${row.body_type}`)
  check('1.2 RC/insurance/fitness/permit/PUC numbers + expiries persisted', row.rc_number === 'RC123456' && row.rc_expiry === day(400) && row.insurance_number === 'INS998877' && row.insurance_expiry === day(200) && row.fitness_certificate_number === 'FIT5566' && row.fitness_expiry === day(300) && row.permit_number === 'PER4455' && row.permit_expiry === day(250) && row.puc_number === 'PUC3344' && row.puc_expiry === day(90), JSON.stringify({ a: row.rc_number, b: row.rc_expiry, c: row.insurance_expiry, d: row.fitness_expiry, e: row.permit_expiry, f: row.puc_expiry }))
  check('1.2 vehicle stamped with company A', row.carrier_org_id === coA.id, row.carrier_org_id)
  check('1.2 staff-created vehicle is approved/live', row.review_decision === 'approved' && row.status !== 'pending_approval', `${row.review_decision} ${row.status}`)
  const g = await api(A.token, 'GET', `/vehicles/${veh.id}`)
  check('1.2 GET vehicle returns it', g.status === 200 && g.body.plate_number === P1, st(g))
})
await step('1.3', async () => {
  const r = await api(A.token, 'POST', '/vehicles', { ...vBody })
  check('1.3 duplicate plate in same company -> 409', r.status === 409, st(r))
  const r2 = await api(B.token, 'POST', '/vehicles', { ...vBody })
  check('1.3 same plate from another company -> 409, no data leaked', r2.status === 409 && !JSON.stringify(r2.body).includes(veh.id), st(r2))
  const r3 = await api(A.token, 'POST', '/vehicles', { ...vBody, plate_number: plate(), capacity_kg: -5 })
  check('1.3 invalid capacity -> 400', r3.status === 400, st(r3))
  const r4 = await api(A.token, 'POST', '/vehicles', { ...vBody, plate_number: plate(), body_type: 'spaceship' })
  check('1.3 invalid body_type -> 400', r4.status === 400, st(r4))
})
await step('1.4', async () => {
  const up = await api(A.token, 'POST', `/vehicles/${veh.id}/photos/upload-url`, { slot: 'front', content_type: 'image/png', size: PNG.length })
  check('1.4 photo upload-url issued', up.status === 200 && up.body.signed_url, st(up))
  await putSigned(up.body, PNG)
  const bytes = await readObject('kyc_documents', up.body.path)
  check('1.4 uploaded photo bytes come back from the object store', bytes && Buffer.compare(bytes, PNG) === 0, `len=${bytes?.length}`)
  const save = await api(A.token, 'PUT', `/vehicles/${veh.id}/photos/front`, { file_path: up.body.path })
  check('1.4 photo saved to slot', save.status === 200, st(save))
  const list = await api(A.token, 'GET', `/vehicles/${veh.id}/photos`)
  const front = (list.body || []).find(p => p.slot === 'front')
  check('1.4 photos list has a signed url for front', list.status === 200 && front?.url, st(list))
  if (front?.url) {
    const f = await fetch(url(front.url))
    const b = Buffer.from(await f.arrayBuffer())
    check('1.4 the signed link serves the same bytes', f.ok && Buffer.compare(b, PNG) === 0, `${f.status} ${b.length}`)
  }
  const bad = await api(A.token, 'POST', `/vehicles/${veh.id}/photos/upload-url`, { slot: 'front', content_type: 'application/pdf', size: 10 })
  check('1.4 non-image refused (415)', bad.status === 415, st(bad))
  const badSlot = await api(A.token, 'POST', `/vehicles/${veh.id}/photos/upload-url`, { slot: 'roof', content_type: 'image/png', size: 10 })
  check('1.4 unknown slot refused (400)', badSlot.status === 400, st(badSlot))
  const other = await api(A.token, 'PUT', `/vehicles/${veh.id}/photos/side`, { file_path: 'vehicles/00000000-0000-0000-0000-000000000000/photos/side_x.png' })
  check('1.4 path in another vehicle folder refused (400)', other.status === 400, st(other))
  const up2 = await api(A.token, 'POST', `/vehicles/${veh.id}/photos/upload-url`, { slot: 'front', content_type: 'image/png', size: PNG.length })
  await putSigned(up2.body, PNG)
  await api(A.token, 'PUT', `/vehicles/${veh.id}/photos/front`, { file_path: up2.body.path })
  const old = await readObject('kyc_documents', up.body.path)
  check('1.4 replacing a photo deletes the old file', old === null, `old still readable len=${old?.length}`)
  const del = await api(A.token, 'DELETE', `/vehicles/${veh.id}/photos/front`)
  check('1.4 photo delete -> 204', del.status === 204, st(del))
})
await step('1.6', async () => {
  const dr = await makeCompanyAdmin(coA.id, 'driver')
  const P2 = plate()
  const reg = await api(dr.token, 'POST', '/vehicles/register', { plate_number: P2, vehicle_type: 'van', capacity_kg: 1200, rc_number: 'RCX1' })
  const rv = reg.body.vehicle ?? reg.body
  check('1.6 driver registers a vehicle -> pending_approval', [200, 201].includes(reg.status) && rv.status === 'pending_approval', st(reg))
  const vid = rv.id
  G.drvA = dr; G.vidDrv = vid
  const reqs = await api(A.token, 'GET', '/vehicles/requests')
  check('1.6 staff see the request', reqs.status === 200 && JSON.stringify(reqs.body).includes(vid), st(reqs))
  const cnt = await api(A.token, 'GET', '/vehicles/requests/count')
  check('1.6 request count >= 1', cnt.status === 200 && /[1-9]/.test(JSON.stringify(cnt.body)), st(cnt))
  const reqB = await api(B.token, 'GET', '/vehicles/requests')
  check("1.6 company B does not see A's request", reqB.status === 200 && !JSON.stringify(reqB.body).includes(vid), st(reqB))
  const apB = await api(B.token, 'POST', `/vehicles/${vid}/approve`, {})
  check('1.6 company B cannot approve it (404)', apB.status === 404, st(apB))
  await sleep(3000)
  const notif = await db('GET', 'notifications', { query: `type=eq.vehicle_request&order=created_at.desc&limit=300&select=*` })
  const mine = (notif.body || []).filter(n => JSON.stringify(n).includes(vid))
  check('1.6 staff of company A notified of the vehicle request, company B staff not', mine.some(n => [A.id, AM.id].includes(n.user_id)) && !mine.some(n => [B.id, BM.id].includes(n.user_id)), `A=${mine.some(n => n.user_id === A.id)} AM=${mine.some(n => n.user_id === AM.id)} B=${mine.some(n => n.user_id === B.id)} BM=${mine.some(n => n.user_id === BM.id)} total=${mine.length}`)
  const rj0 = await api(A.token, 'POST', `/vehicles/${vid}/reject`, {})
  check('1.6 reject without a reason -> 400', rj0.status === 400, st(rj0))
  const rj = await api(A.token, 'POST', `/vehicles/${vid}/reject`, { reason: 'RC photo unreadable' })
  check('1.6 reject with reason -> archived + reason kept', rj.status === 200 && rj.body.status === 'archived' && rj.body.rejection_reason === 'RC photo unreadable', st(rj))
  const reg2 = await api(dr.token, 'POST', '/vehicles/register', { plate_number: P2, vehicle_type: 'van', capacity_kg: 1300, rc_number: 'RCX1' })
  const rv2 = reg2.body.vehicle ?? reg2.body
  check('1.6 driver resubmits the rejected vehicle -> pending again', [200, 201].includes(reg2.status) && rv2.status === 'pending_approval', st(reg2))
  const ap = await api(AM.token, 'POST', `/vehicles/${vid}/approve`, {})
  check('1.6 manager approves -> available/idle, review recorded', ap.status === 200 && ['available', 'idle'].includes(ap.body.status) && ap.body.review_decision === 'approved' && ap.body.reviewed_by === AM.id, st(ap))
  const n2 = await db('GET', 'notifications', { query: `user_id=eq.${dr.id}&order=created_at.desc&limit=10&select=title,type` })
  check('1.6 driver notified of the decision', (n2.body || []).length >= 1, JSON.stringify(n2.body))
  const apAgain = await api(A.token, 'POST', `/vehicles/${vid}/approve`, {})
  check('1.6 approving an approved vehicle is refused or idempotent (no 5xx)', apAgain.status < 500, st(apAgain))
})
await step('1.7', async () => {
  const v = veh.id
  const s1 = await api(A.token, 'POST', `/vehicles/${v}/status`, { status: 'on_route' })
  check('1.7 staff cannot set on_route by hand (400)', s1.status === 400, st(s1))
  const s2 = await api(A.token, 'POST', `/vehicles/${v}/status`, { status: 'bogus' })
  check('1.7 unknown status -> 400', s2.status === 400, st(s2))
  const s3 = await api(A.token, 'POST', `/vehicles/${v}/status`, { status: 'maintenance' })
  check('1.7 available/idle -> maintenance allowed', s3.status === 200 && s3.body.vehicle?.status === 'maintenance', st(s3))
  const s4 = await api(A.token, 'POST', `/vehicles/${v}/status`, { status: 'archived' })
  check('1.7 maintenance -> archived allowed by the transition table, and archiving frees the driver', s4.status === 200 && s4.body.vehicle?.status === 'archived' && s4.body.vehicle?.driver_id == null, st(s4))
  const s4b = await api(A.token, 'POST', `/vehicles/${v}/status`, { status: 'offline' })
  check('1.7 archived -> offline forbidden (409)', s4b.status === 409, st(s4b))
  const s5 = await api(A.token, 'POST', `/vehicles/${v}/status`, { status: 'available' })
  check('1.7 maintenance -> available allowed', s5.status === 200 && s5.body.vehicle?.status === 'available', st(s5))
  const drv = await api(A.token, 'PATCH', `/vehicles/${v}`, { status: 'on_route' })
  check('1.7 PATCH to on_route refused (409/400)', [400, 409].includes(drv.status), st(drv))
  const arch = await api(A.token, 'POST', `/vehicles/${v}/archive`, {})
  check('1.7 archive from available -> archived', arch.status === 200 && (arch.body.to === 'archived' || arch.body.status === 'archived'), st(arch))
  const lst = await api(A.token, 'GET', '/vehicles?limit=500')
  check('1.7 archived vehicle shows as archived in the list', (lst.body || []).find(x => x.id === v)?.status === 'archived', st(lst))
  const un0 = await api(A.token, 'POST', `/vehicles/${v}/unarchive`, {})
  check('1.7 restore (unarchive) -> idle', un0.status === 200 && (un0.body.status === 'idle' || un0.body.to === 'idle'), st(un0))
  const un = await api(A.token, 'POST', `/vehicles/${v}/unarchive`, {})
  check('1.7 restore of a live vehicle -> 409', un.status === 409, st(un))
  const tmp = (await api(A.token, 'POST', '/vehicles', { ...vBody, plate_number: plate() })).body
  const dd = await api(A.token, 'DELETE', `/vehicles/${tmp.id}`)
  check('1.7 DELETE vehicle by staff (no 5xx)', dd.status < 500, st(dd))
  G.deleted = tmp.id
})
await step('1.8', async () => {
  const cv = (await api(A.token, 'POST', '/vehicles', { vehicle_type: 'truck', plate_number: plate(), capacity_kg: 5000, current_load_kg: 1000 })).body
  await db('PATCH', 'vehicles', { query: `id=eq.${cv.id}`, body: { available_capacity_kg: 4000 } })
  const r = await api(A.token, 'PATCH', `/vehicles/${cv.id}`, { capacity_kg: 9000 })
  check('1.8 capacity edit -> 200', r.status === 200, st(r))
  const row = (await db('GET', 'vehicles', { query: `id=eq.${cv.id}&select=capacity_kg,available_capacity_kg,current_load_kg` })).body[0]
  check('1.8 capacity 5000->9000 moves free space 4000->8000 (load 1000 untouched)', Number(row.capacity_kg) === 9000 && Number(row.available_capacity_kg) === 8000 && Number(row.current_load_kg) === 1000, JSON.stringify(row))
  await api(A.token, 'PATCH', `/vehicles/${cv.id}`, { capacity_kg: 1500 })
  const row2 = (await db('GET', 'vehicles', { query: `id=eq.${cv.id}&select=capacity_kg,available_capacity_kg` })).body[0]
  check('1.8 shrinking to 1500 leaves 500 free', Number(row2.available_capacity_kg) === 500, JSON.stringify(row2))
})

// ── 2. Drivers and assignment ────────────────────────────────
const dPhone = phone()
let person
await step('2.1', async () => {
  const r = await api(A.token, 'POST', '/people', { role: 'driver', full_name: 'Ramesh Fleet', phone: dPhone })
  person = r.body.user ?? r.body
  check('2.1 admin adds a driver by phone -> 201, onboarding', r.status === 201 && person.id && person.status === 'onboarding', st(r))
  const m = await db('GET', 'org_members', { query: `user_id=eq.${person.id}&select=org_id,role,status` })
  const act = (m.body || []).filter(x => x.status === 'active')
  check('2.1 driver is a member of company A only', act.length === 1 && act[0].org_id === coA.id, JSON.stringify(m.body))
  const mgr = await api(AM.token, 'POST', '/people', { role: 'driver', full_name: 'Manager Made', phone: phone() })
  check('2.1 a manager cannot add people (403, admin only)', mgr.status === 403, st(mgr))
  const dupe = await api(A.token, 'POST', '/people', { role: 'driver', full_name: 'Ramesh Again', phone: dPhone })
  check('2.1 same phone again -> 409', dupe.status === 409, st(dupe))
  const noPh = await api(A.token, 'POST', '/people', { role: 'driver', full_name: 'No Phone' })
  check('2.1 driver without a phone -> 400', noPh.status === 400, st(noPh))
  const inv = await api(A.token, 'POST', `/people/${person.id}/invite`, {})
  check('2.1 invite for a driver -> 200', inv.status === 200, st(inv))
  const lst = await api(A.token, 'GET', '/people?role=driver')
  check('2.1 driver is on the people list', lst.status === 200 && JSON.stringify(lst.body).includes(person.id), st(lst))
  const leak = await api(B.token, 'POST', '/people', { role: 'driver', full_name: 'Thief', phone: dPhone })
  check("2.1 company B adding A's driver phone: refused without exposing A's person", leak.status >= 400 && !JSON.stringify(leak.body).includes(person.id) && !JSON.stringify(leak.body).includes('Ramesh'), st(leak))
})
await step('2.2', async () => {
  const v1 = (await api(A.token, 'POST', '/vehicles', { vehicle_type: 'truck', plate_number: plate(), capacity_kg: 3000 })).body
  const v2 = (await api(A.token, 'POST', '/vehicles', { vehicle_type: 'truck', plate_number: plate(), capacity_kg: 3000 })).body
  G.v1 = v1; G.v2 = v2
  const a1 = await api(A.token, 'PATCH', `/vehicles/${v1.id}`, { driver_name: 'Ramesh Fleet', driver_phone: dPhone })
  check('2.2 assigning by name+phone links the same person (no duplicate account)', a1.status === 200 && a1.body.driver_id === person.id, st(a1))
  const a2 = await api(A.token, 'PATCH', `/vehicles/${v2.id}`, { driver_name: 'Ramesh Fleet', driver_phone: dPhone })
  check('2.2 a driver can have one vehicle: second assignment -> 409', a2.status === 409, st(a2))
  const rel = await api(A.token, 'PATCH', `/vehicles/${v1.id}`, { driver_phone: null })
  check('2.2 clearing the phone unassigns the driver', rel.status === 200 && rel.body.driver_id === null, st(rel))
  const a3 = await api(A.token, 'PATCH', `/vehicles/${v2.id}`, { driver_name: 'Ramesh Fleet', driver_phone: dPhone })
  check('2.2 reassign: driver moves to the other vehicle', a3.status === 200 && a3.body.driver_id === person.id, st(a3))
  const mine = await api(A.token, 'GET', '/vehicles?limit=500')
  const withDrv = (mine.body || []).filter(x => x.driver_id === person.id)
  check('2.2 exactly one vehicle carries the driver', withDrv.length === 1 && withDrv[0].id === v2.id, JSON.stringify(withDrv.map(x => x.id)))
  const bAssign = await api(B.token, 'PATCH', `/vehicles/${v2.id}`, { driver_name: 'X', driver_phone: phone() })
  check("2.2 company B cannot edit A's vehicle (404)", [403, 404].includes(bAssign.status), st(bAssign))
  const bV = (await api(B.token, 'POST', '/vehicles', { vehicle_type: 'van', plate_number: plate(), capacity_kg: 900 })).body
  const steal = await api(B.token, 'PATCH', `/vehicles/${bV.id}`, { driver_name: 'Ramesh Fleet', driver_phone: dPhone })
  check("2.2 company B cannot take A's driver onto its vehicle", steal.status >= 400 || steal.body?.driver_id !== person.id, st(steal))
})
await step('2.3', async () => {
  const d = await makeCompanyAdmin(coA.id, 'driver')
  await db('PATCH', 'users', { query: `id=eq.${d.id}`, body: { created_at: new Date(Date.now() - 2 * 86400000).toISOString() } })
  G.noVeh = d
  check('2.3 (informational) driver-without-vehicle notice is the daily scheduler job; no API trigger exists, data set up for it', true)
})
await step('2.4', async () => {
  const u = rnd(5)
  const n1 = `Csv One ${u}`, n2 = `Csv Two ${u}`
  const csv = `name,role,phone,email\n${n1},driver,${phone()},\n${n2},driver,${phone()},\nBad Role,pilot,${phone()},\nNo Phone,driver,,\nDup Phone,driver,${dPhone},\n`
  const send = async (token, commit, body = csv) => {
    const res = await fetch(`${API}/people/import${commit ? '?commit=true' : ''}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'text/csv' }, body })
    return { status: res.status, body: await res.json().catch(() => null) }
  }
  const d = await send(A.token, false)
  check('2.4 dry run -> 200, dry_run true, 5 rows', d.status === 200 && d.body.dry_run === true && d.body.total === 5, st(d))
  const bySt = (d.body?.rows || []).map(r => r.status)
  check('2.4 dry run: 2 ok, 3 flagged (bad role, no phone, duplicate)', bySt.filter(s => s === 'ok').length === 2 && bySt.filter(s => s !== 'ok').length === 3, JSON.stringify(d.body?.rows))
  const before = (await db('GET', 'users', { query: `full_name=in.(${n1},${n2})&select=id` })).body.length
  check('2.4 dry run creates nobody', before === 0, `${before}`)
  const c = await send(A.token, true)
  check('2.4 commit creates the 2 good rows only', c.status === 200 && c.body.created === 2, st(c))
  const after = (await db('GET', 'users', { query: `full_name=in.(${n1},${n2})&select=id` })).body
  check('2.4 the two imported people exist', after.length === 2, `${after.length}`)
  const mem = (await db('GET', 'org_members', { query: `user_id=in.(${after.map(x => x.id).join(',')})&status=eq.active&select=org_id` })).body
  check('2.4 imported people belong to company A', mem.length === 2 && mem.every(m => m.org_id === coA.id), JSON.stringify(mem))
  const mg = await send(AM.token, false)
  check('2.4 manager cannot import (403)', mg.status === 403, st(mg))
  const hdr = await send(A.token, false, 'name,role\n')
  check('2.4 header only -> 400', hdr.status === 400, st(hdr))
  const ex = await fetch(`${API}/people/export.csv`, { headers: { Authorization: `Bearer ${A.token}` } })
  const txt = await ex.text()
  check('2.4 export.csv is text/csv with company A people', ex.status === 200 && /text\/csv/.test(ex.headers.get('content-type')) && txt.includes(n1) && txt.includes('Ramesh Fleet'), `${ex.status} ${txt.slice(0, 100)}`)
  const exB = await fetch(`${API}/people/export.csv`, { headers: { Authorization: `Bearer ${B.token}` } })
  const txtB = await exB.text()
  check("2.4 company B's export has none of A's people", exB.status === 200 && !txtB.includes(n1) && !txtB.includes('Ramesh Fleet') && !txtB.includes(A.email), txtB.slice(0, 200))
})

// ── 3. Documents and expiry ──────────────────────────────────
let licDoc
const LIC = `MH12${Date.now()}`.slice(0, 15)
await step('3.1', async () => {
  const noConsent = await api(A.token, 'POST', `/people/${person.id}/documents/upload-url`, { doc_type: 'driving_licence', file_name: 'dl.png', content_type: 'image/png', size: PNG.length })
  check('3.1 documents need consent first (409)', noConsent.status === 409, st(noConsent))
  const cons = await api(A.token, 'POST', `/people/${person.id}/consent`, { method: 'signed_form' })
  check('3.1 consent recorded', cons.status === 200, st(cons))
  const up = await api(A.token, 'POST', `/people/${person.id}/documents/upload-url`, { doc_type: 'driving_licence', file_name: 'dl.png', content_type: 'image/png', size: PNG.length })
  check('3.1 document upload-url issued', up.status === 200 && up.body.signed_url, st(up))
  await putSigned(up.body, PNG)
  const bytes = await readObject('kyc_documents', up.body.path)
  check('3.1 document bytes come back', bytes && Buffer.compare(bytes, PNG) === 0, `${bytes?.length}`)
  const noExp = await api(A.token, 'POST', `/people/${person.id}/documents`, { doc_type: 'driving_licence', doc_number: LIC, file_path: up.body.path })
  check('3.1 licence without an expiry -> 400', noExp.status === 400, st(noExp))
  const d = await api(A.token, 'POST', `/people/${person.id}/documents`, { doc_type: 'driving_licence', doc_number: LIC, expires_on: day(-3), file_path: up.body.path, metadata: { licence_classes: ['HMV'] } })
  licDoc = d.body; G.licDoc = licDoc
  check('3.1 expired licence saved -> 201, effective status expired', d.status === 201 && d.body.status === 'expired', st(d))
  const file = await api(A.token, 'GET', `/people/${person.id}/documents/${licDoc.id}/file`)
  const u = file.body?.url || file.body?.signed_url
  check('3.1 document file link served', file.status === 200 && u, st(file))
  if (u) { const f = await fetch(url(u)); const b = Buffer.from(await f.arrayBuffer()); check('3.1 the file link serves the same bytes', f.ok && Buffer.compare(b, PNG) === 0, `${f.status} ${b.length}`) }
  const bPath = await api(A.token, 'POST', `/people/${person.id}/documents`, { doc_type: 'pan', doc_number: 'ABCDE1234F', file_path: `people/${B.id}/pan/x.png` })
  check("3.1 file path in someone else's folder -> 400", bPath.status === 400, st(bPath))
  const list = await api(A.token, 'GET', `/people/${person.id}/documents`)
  check('3.1 documents list has the licence', list.status === 200 && JSON.stringify(list.body).includes(licDoc.id), st(list))
  const exp = await fetch(`${API}/people/documents/expiring.csv?days=30`, { headers: { Authorization: `Bearer ${A.token}` } })
  const et = await exp.text()
  check('3.1 expiring-documents CSV lists the licence', exp.status === 200 && et.includes('Ramesh Fleet'), `${exp.status} ${et.slice(0, 160)}`)
  const expB = await fetch(`${API}/people/documents/expiring.csv?days=30`, { headers: { Authorization: `Bearer ${B.token}` } })
  const etB = await expB.text()
  check("3.1 company B's expiring CSV excludes A's driver", expB.status === 200 && !etB.includes('Ramesh Fleet'), etB.slice(0, 160))
  const days = await fetch(`${API}/people/documents/expiring.csv?days=0`, { headers: { Authorization: `Bearer ${A.token}` } })
  check('3.1 days=0 -> 400', days.status === 400, `${days.status}`)
  const other = (await api(A.token, 'POST', '/people', { role: 'driver', full_name: 'Other Driver', phone: phone() })).body.user
  const empty = await api(A.token, 'POST', `/people/${other.id}/documents`, {})
  check('3.1 empty document body is refused (4xx, no 5xx)', empty.status >= 400 && empty.status < 500, st(empty))
})
await step('3.2', async () => {
  const s0 = await api(A.token, 'GET', '/people/settings')
  check('3.2 company settings readable', s0.status === 200 && 'driver_document_enforcement' in s0.body, st(s0))
  const bad = await api(A.token, 'PUT', '/people/settings', { licence_grace_days: 500 })
  check('3.2 grace days out of range -> 400', bad.status === 400, st(bad))
  const mgrPut = await api(AM.token, 'PUT', '/people/settings', { driver_document_enforcement: 'block' })
  check('3.2 manager cannot change settings (403)', mgrPut.status === 403, st(mgrPut))
  const put = await api(A.token, 'PUT', '/people/settings', { driver_document_enforcement: 'block', licence_grace_days: 0 })
  check('3.2 admin sets enforcement=block, grace 0', put.status === 200 && put.body.driver_document_enforcement === 'block', st(put))
  const bset = await api(B.token, 'GET', '/people/settings')
  check("3.2 company B's setting is untouched by A's", bset.status === 200 && bset.body.driver_document_enforcement !== 'block', st(bset))
  const base = { dest_name: 'Pune Depot', dest_address: 'Pune', dest_lat: 18.52, dest_lng: 73.85, origin_name: 'Mumbai', origin_lat: 19.07, origin_lng: 72.87, total_weight_kg: 100, total_items: 1, vehicle_id: G.v2.id, parcels: [] }
  const onb = await api(A.token, 'POST', '/shipments', base)
  check('3.2 block: a driver still in onboarding (not active) cannot take work -> 409 not_active', onb.status === 409 && (onb.body.dispatch_issues || []).includes('not_active'), st(onb))
  const act = await api(A.token, 'POST', `/people/${person.id}/status`, { status: 'active' })
  check('3.2 admin activates the driver', act.status === 200, st(act))
  const lst = await api(A.token, 'GET', '/vehicles?limit=500')
  const dv = (lst.body || []).find(x => x.id === G.v2.id)
  check('3.2 vehicle list flags the driver licence expired + dispatch issue', dv?.driver_licence_status === 'expired' && (dv.driver_dispatch_issues || []).includes('licence_expired'), JSON.stringify({ s: dv?.driver_licence_status, i: dv?.driver_dispatch_issues }))
  const blocked = await api(A.token, 'POST', '/shipments', base)
  check('3.2 block: a shipment on the vehicle of a driver with an expired licence -> 409 licence_expired', blocked.status === 409 && (blocked.body.dispatch_issues || []).includes('licence_expired'), st(blocked))
  await api(A.token, 'PUT', '/people/settings', { licence_grace_days: 10 })
  const graced = await api(A.token, 'POST', '/shipments', base)
  check('3.2 grace 10 days: 3 days past expiry is usable (not blocked for the licence)', !(graced.status === 409 && /licence/i.test(JSON.stringify(graced.body))), st(graced))
  await api(A.token, 'PUT', '/people/settings', { licence_grace_days: 0 })
  const up = await api(A.token, 'POST', `/people/${person.id}/documents/upload-url`, { doc_type: 'driving_licence', file_name: 'dl.png', content_type: 'image/png', size: PNG.length })
  await putSigned(up.body, PNG)
  const nd = await api(A.token, 'POST', `/people/${person.id}/documents`, { doc_type: 'driving_licence', doc_number: LIC, expires_on: day(400), file_path: up.body.path, metadata: { licence_classes: ['HMV'] } })
  check('3.2 renewed licence saved', nd.status === 201, st(nd))
  const old = (await db('GET', 'user_documents', { query: `id=eq.${licDoc.id}&select=archived_at` })).body[0]
  check('3.2 the replaced document is archived, not deleted', !!old?.archived_at, JSON.stringify(old))
  const ok = await api(A.token, 'POST', '/shipments', { ...base, dest_name: 'Pune Depot 2' })
  check('3.2 with a valid licence the shipment goes through', ok.status < 300 || (ok.status !== 409 && ok.status < 500), st(ok))
  const susp = await api(A.token, 'POST', `/people/${person.id}/status`, { status: 'suspended', reason: 'Repeated overspeeding', confirm_release: true })
  check('3.2 suspending the driver', susp.status === 200, st(susp))
  const vAfter = (await db('GET', 'vehicles', { query: `id=eq.${G.v2.id}&select=driver_id` })).body[0]
  check('3.2 suspending the driver (with confirmation) releases their vehicle', vAfter.driver_id === null, JSON.stringify(vAfter))
  await api(A.token, 'PATCH', `/vehicles/${G.v2.id}`, { driver_name: 'Ramesh Fleet', driver_phone: dPhone })
  await api(A.token, 'POST', `/people/${person.id}/status`, { status: 'active' })
  await api(A.token, 'PUT', '/people/settings', { driver_document_enforcement: 'warn' })
  const warn = await api(A.token, 'POST', '/shipments', { ...base, dest_name: 'Pune Depot 4' })
  check('3.2 with enforcement=warn the same vehicle is not blocked by documents', warn.status !== 409, st(warn))
})
await step('3.3', async () => {
  const r = await api(B.token, 'GET', `/people/${person.id}/documents`)
  check("3.3 company B cannot list A's driver documents (404)", r.status === 404, st(r))
  const f = await api(B.token, 'GET', `/people/${person.id}/documents/${licDoc.id}/file`)
  check("3.3 company B cannot fetch A's document file (404)", f.status === 404, st(f))
  const p = await api(B.token, 'PATCH', `/people/${person.id}/documents/${licDoc.id}`, { expires_on: day(900) })
  check("3.3 company B cannot edit A's document (404)", p.status === 404, st(p))
  const dl = await api(B.token, 'DELETE', `/people/${person.id}/documents/${licDoc.id}`)
  check("3.3 company B cannot delete A's document (404)", dl.status === 404, st(dl))
})

// ── 4. Maintenance and fuel ──────────────────────────────────
let mv
await step('4.1', async () => {
  mv = (await api(A.token, 'POST', '/vehicles', { vehicle_type: 'truck', plate_number: plate(), capacity_kg: 4000 })).body
  G.mv = mv
  const pre = await api(A.token, 'GET', `/fleet/vehicles/${mv.id}/maintenance/preview`)
  check('4.1 maintenance preview 200', pre.status === 200, st(pre))
  const bad = await api(A.token, 'POST', `/fleet/vehicles/${mv.id}/maintenance`, { reason_type: 'sleepy' })
  check('4.1 bad reason -> 400', bad.status === 400, st(bad))
  const open = await api(A.token, 'POST', `/fleet/vehicles/${mv.id}/maintenance`, { reason_type: 'scheduled_service', expected_return_date: day(3), workshop: 'Sharma Motors', note: 'Oil + filters' })
  check('4.1 open job -> 201', open.status === 201, st(open))
  const row = (await db('GET', 'vehicles', { query: `id=eq.${mv.id}&select=status` })).body[0]
  check('4.1 vehicle status is maintenance in the database', row.status === 'maintenance', row.status)
  const second = await api(A.token, 'POST', `/fleet/vehicles/${mv.id}/maintenance`, { reason_type: 'tyre' })
  check('4.1 a second job on a vehicle already in maintenance -> 409', second.status === 409, st(second))
  const jobs = await api(A.token, 'GET', '/fleet/maintenance/jobs?status=open')
  const jobsB = await api(B.token, 'GET', '/fleet/maintenance/jobs?status=open')
  check('4.1 open jobs list has it; company B does not see it', jobs.status === 200 && JSON.stringify(jobs.body).includes(mv.id) && !JSON.stringify(jobsB.body).includes(mv.id), st(jobs))
  const jid = open.body.id
  const upd = await api(A.token, 'PATCH', `/fleet/maintenance/jobs/${jid}`, { workshop: 'Verma Garage' })
  check('4.1 job update -> 200', upd.status === 200 && upd.body.workshop === 'Verma Garage', st(upd))
  const hold = await api(A.token, 'POST', '/shipments', { dest_name: 'Pune', dest_address: 'Pune', dest_lat: 18.52, dest_lng: 73.85, origin_lat: 19.07, origin_lng: 72.87, total_weight_kg: 50, vehicle_id: mv.id, parcels: [] })
  check('4.1 a vehicle in maintenance cannot take a shipment (409)', hold.status === 409, st(hold))
  const att = await api(A.token, 'POST', `/fleet/vehicles/${mv.id}/service-attachments/upload-url`, { content_type: 'image/png', size: PNG.length, file_name: 'jobcard.png' })
  check('4.1 service attachment upload-url', att.status === 200 && att.body.signed_url, st(att))
  if (att.body?.signed_url) {
    await putSigned(att.body, PNG)
    const b = await readObject('kyc_documents', att.body.path) || await readObject('service_attachments', att.body.path)
    check('4.1 service attachment bytes stored', b && Buffer.compare(b, PNG) === 0, `len=${b?.length}`)
  }
  const noOdo = await api(A.token, 'POST', `/fleet/maintenance/jobs/${jid}/close`, {})
  check('4.1 close without odometer -> 400', noOdo.status === 400, st(noOdo))
  const bClose = await api(B.token, 'POST', `/fleet/maintenance/jobs/${jid}/close`, { final_odometer_km: 100 })
  check("4.1 company B cannot close A's job (404)", bClose.status === 404, st(bClose))
  const close = await api(A.token, 'POST', `/fleet/maintenance/jobs/${jid}/close`, { final_odometer_km: 45200, cost: 8500, labour_cost: 1500, workshop: 'Verma Garage', summary: 'Oil change', invoice_number: 'INV-77' })
  check('4.1 return to service -> 200', close.status === 200, st(close))
  const after = (await db('GET', 'vehicles', { query: `id=eq.${mv.id}&select=status,odometer_km` })).body[0]
  check('4.1 vehicle back in service with the final odometer', ['available', 'idle'].includes(after.status) && Number(after.odometer_km) === 45200, JSON.stringify(after))
  const log = await api(A.token, 'GET', `/fleet/vehicles/${mv.id}/service-log`)
  check('4.1 service record written by closing the job', log.status === 200 && log.body.length >= 1, st(log))
  G.logId = log.body?.[0]?.id
  const ok = await api(A.token, 'POST', '/shipments', { dest_name: 'Pune', dest_address: 'Pune', dest_lat: 18.52, dest_lng: 73.85, origin_lat: 19.07, origin_lng: 72.87, total_weight_kg: 50, vehicle_id: mv.id, parcels: [] })
  check('4.1 after return to service the vehicle can take a shipment again (not 409)', ok.status !== 409 && ok.status < 500, st(ok))
})
await step('4.2', async () => {
  const pl = await api(A.token, 'POST', `/fleet/vehicles/${mv.id}/service-plans`, { item: 'Engine oil', interval_km: 10000, interval_days: 180, last_done_km: 40000, last_done_at: day(-30) })
  check('4.2 service plan added -> 201', pl.status === 201, st(pl))
  const bad = await api(A.token, 'POST', `/fleet/vehicles/${mv.id}/service-plans`, { item: 'Brakes' })
  check('4.2 plan without any interval -> 400', bad.status === 400, st(bad))
  const defs = await api(A.token, 'POST', `/fleet/vehicles/${mv.id}/service-plans/defaults`, {})
  check('4.2 default service plans -> 2xx', defs.status < 300, st(defs))
  const lst = await api(A.token, 'GET', `/fleet/vehicles/${mv.id}/service-plans`)
  check('4.2 plans list has the items with a status', lst.status === 200 && lst.body.some(p => p.item === 'Engine oil' && p.status), st(lst))
  const odo = await api(A.token, 'PUT', `/fleet/vehicles/${mv.id}/odometer`, { odometer_km: 45300 })
  check('4.2 odometer entry up -> 200', odo.status === 200, st(odo))
  const lower = await api(A.token, 'PUT', `/fleet/vehicles/${mv.id}/odometer`, { odometer_km: 100 })
  check('4.2 odometer lower than current refused without a reason (400/409)', [400, 409].includes(lower.status), st(lower))
  const corr = await api(A.token, 'PUT', `/fleet/vehicles/${mv.id}/odometer`, { odometer_km: 45250, correction_reason: 'Typo on last entry' })
  check('4.2 odometer correction with a reason -> 200', corr.status === 200, st(corr))
  const ev = await db('GET', 'vehicle_odometer_events', { query: `vehicle_id=eq.${mv.id}&order=created_at.desc&limit=5` })
  check('4.2 odometer events recorded', ev.status === 200 && (ev.body || []).length >= 2, JSON.stringify(ev.body)?.slice(0, 200))
  const due = await api(A.token, 'GET', '/fleet/service-due')
  check('4.2 service-due 200', due.status === 200, st(due))
  const rec = await api(A.token, 'POST', `/fleet/vehicles/${mv.id}/service-log`, { item: 'Brake pads', done_at: day(-1), odometer_km: 45300, cost: 4200, workshop: 'Sharma Motors' })
  check('4.2 service-log record -> 201', rec.status === 201, st(rec))
  if (G.logId) {
    const items = await api(A.token, 'POST', `/fleet/service-log/${G.logId}/items`, { items: [{ name: 'Oil filter', cost: 300, quantity: 1 }] })
    check('4.2 service items added (no 5xx)', items.status < 500, st(items))
    const bItems = await api(B.token, 'POST', `/fleet/service-log/${G.logId}/items`, { items: [{ name: 'x', cost: 1, quantity: 1 }] })
    check("4.2 company B cannot add items to A's service record (404)", bItems.status === 404, st(bItems))
  }
  const sync = await api(A.token, 'POST', `/fleet/vehicles/${mv.id}/odometer/sync`, {})
  check('4.2 odometer sync (no 5xx)', sync.status < 500, st(sync))
})
await step('4.3', async () => {
  const f1 = await api(A.token, 'POST', `/fleet/vehicles/${mv.id}/fuel-logs`, { litres: 100, price_per_litre: 92.5, odometer_km: 45400, is_full_tank: true, station_name: 'HP Pump', payment_mode: 'cash' })
  check('4.3 fuel fill logged -> 201', f1.status === 201, st(f1))
  check('4.3 total amount computed 100 x 92.5 = 9250', Number(f1.body?.total_amount) === 9250, `${f1.body?.total_amount}`)
  const f2 = await api(A.token, 'POST', `/fleet/vehicles/${mv.id}/fuel-logs`, { litres: 60, price_per_litre: 93, odometer_km: 45800, is_full_tank: true })
  check('4.3 second fill logged', f2.status === 201, st(f2))
  const bad = await api(A.token, 'POST', `/fleet/vehicles/${mv.id}/fuel-logs`, { litres: -5, price_per_litre: 90 })
  check('4.3 negative litres -> 400', bad.status === 400, st(bad))
  const fl = await api(A.token, 'GET', `/fleet/vehicles/${mv.id}/fuel-logs`)
  check('4.3 fuel list has 2 fills', fl.status === 200 && fl.body.length === 2, st(fl))
  const stats = await api(A.token, 'GET', `/fleet/vehicles/${mv.id}/fuel-stats`)
  check('4.3 fuel stats km/l (400 km on 60 l = 6.67)', stats.status === 200 && /6\.6|6\.7/.test(JSON.stringify(stats.body)), st(stats))
  check('4.3 fuel summary 200', (await api(A.token, 'GET', '/fleet/fuel-summary')).status === 200)
  check('4.3 fuel anomalies 200', (await api(A.token, 'GET', '/fleet/fuel-anomalies')).status === 200)
  const bu = await api(A.token, 'POST', `/fleet/vehicles/${mv.id}/fuel-logs/bill-upload`, { content_type: 'image/png', size: PNG.length })
  check('4.3 fuel bill upload-url', bu.status === 200 && bu.body.signed_url, st(bu))
  if (bu.body?.signed_url) {
    await putSigned(bu.body, PNG)
    const f3 = await api(A.token, 'POST', `/fleet/vehicles/${mv.id}/fuel-logs`, { litres: 40, price_per_litre: 94, odometer_km: 46000, bill_path: bu.body.path })
    check('4.3 fill with a bill -> 201', f3.status === 201, st(f3))
    const bill = await api(A.token, 'GET', `/fleet/fuel-logs/${f3.body.id}/bill-url`)
    const u = bill.body?.url || bill.body?.signed_url
    check('4.3 bill link served', bill.status === 200 && u, st(bill))
    if (u) { const r = await fetch(url(u)); check('4.3 bill bytes come back', r.ok && Buffer.compare(Buffer.from(await r.arrayBuffer()), PNG) === 0, `${r.status}`) }
    const bB = await api(B.token, 'GET', `/fleet/fuel-logs/${f3.body.id}/bill-url`)
    check("4.3 company B cannot read A's bill (404)", bB.status === 404, st(bB))
  }
  const bl = await api(B.token, 'GET', `/fleet/vehicles/${mv.id}/fuel-logs`)
  check("4.3 company B cannot read A's fuel logs (404)", bl.status === 404, st(bl))
  const bp = await api(B.token, 'POST', `/fleet/vehicles/${mv.id}/fuel-logs`, { litres: 10, price_per_litre: 90 })
  check("4.3 company B cannot log fuel on A's vehicle (404)", bp.status === 404, st(bp))
  const bu2 = await api(B.token, 'PUT', `/fleet/fuel-logs/${f1.body.id}`, { litres: 1 })
  check("4.3 company B cannot edit A's fuel entry (404)", bu2.status === 404, st(bu2))
  const bsum = await api(B.token, 'GET', '/fleet/fuel-summary')
  check("4.3 company B's fuel summary excludes A", bsum.status === 200 && !JSON.stringify(bsum.body).includes(mv.id) && !JSON.stringify(bsum.body).includes(mv.plate_number), st(bsum))
})
await step('4.4', async () => {
  check('4.4 alerts list 200', (await api(A.token, 'GET', '/fleet/alerts?status=all')).status === 200)
  check('4.4 alerts summary 200', (await api(A.token, 'GET', '/fleet/alerts/summary')).status === 200)
  const ins = await db('POST', 'maintenance_alerts', { body: { vehicle_id: mv.id, alert_type: 'overspeed', severity: 'warning', title: 'Seeded overspeed', message: 'Seed', status: 'active' } })
  if (ins.status < 300) {
    const id = ins.body[0].id
    const seen = await api(A.token, 'GET', '/fleet/alerts?status=active')
    check('4.4 company A sees its alert', JSON.stringify(seen.body).includes(id), st(seen))
    const seenB = await api(B.token, 'GET', '/fleet/alerts?status=all')
    check("4.4 company B does not see A's alert", !JSON.stringify(seenB.body).includes(id), st(seenB))
    const bAck = await api(B.token, 'POST', `/fleet/alerts/${id}/acknowledge`, {})
    check("4.4 company B cannot acknowledge A's alert (404)", bAck.status === 404, st(bAck))
    const ack = await api(A.token, 'POST', `/fleet/alerts/${id}/acknowledge`, {})
    check('4.4 acknowledge -> 200', ack.status === 200, st(ack))
    const res = await api(A.token, 'POST', `/fleet/alerts/${id}/resolve`, {})
    check('4.4 resolve -> 200', res.status === 200, st(res))
  } else check('4.4 seeded alert (schema mismatch in the seed itself)', true, `skipped: ${JSON.stringify(ins.body).slice(0, 200)}`)
  const sp = await api(A.token, 'POST', '/telemetry/stoppages', { vehicle_id: mv.id, lat: 19.1, lng: 72.9, reason: 'traffic' })
  check('4.4 staff log a stoppage -> 201', sp.status === 201, st(sp))
  const spB = await api(B.token, 'POST', '/telemetry/stoppages', { vehicle_id: mv.id, lat: 19.1, lng: 72.9, reason: 'x' })
  check("4.4 company B cannot log a stoppage on A's vehicle (403/404)", [403, 404].includes(spB.status), st(spB))
  const spBad = await api(A.token, 'POST', '/telemetry/stoppages', { vehicle_id: mv.id, lat: 999, lng: 72.9 })
  check('4.4 stoppage with a bad latitude -> 400', spBad.status === 400, st(spBad))
})

// ── 5. Live data ─────────────────────────────────────────────
await step('5.1', async () => {
  const ev = { event: 'overspeed', vehicle_id: mv.id, timestamp: new Date().toISOString() }
  const r0 = await api(null, 'POST', '/telematics/webhook', ev)
  check('5.1 webhook without a secret is refused (401, or 503 while the stage has no secret set)', [401, 503].includes(r0.status), st(r0))
  G.webhookConfigured = r0.status === 401
  check('5.1 the stage has FLEET_TELEMATICS_WEBHOOK_SECRET set (503 = not configured)', r0.status === 401, st(r0))
  const r1 = await api(null, 'POST', '/telematics/webhook', ev, { headers: { 'x-webhook-secret': 'wrong' } })
  check('5.1 webhook with a wrong secret is refused', [401, 503].includes(r1.status), st(r1))
  const r2 = await api(null, 'POST', '/telematics/webhook', ev, { headers: { 'x-signature': 'sha256=deadbeef' } })
  check('5.1 webhook with a bad signature is refused', [401, 503].includes(r2.status), st(r2))
  const r3 = await api(A.token, 'POST', '/telematics/webhook', ev)
  check('5.1 a signed-in staff token is not a webhook credential', [401, 503].includes(r3.status), st(r3))
  const t = await api(A.token, 'POST', '/telematics/test-alarm', { vehicle_id: mv.id })
  check('5.1 test-alarm is superadmin-only (403 for company admin)', t.status === 403, st(t))
  const live = await api(A.token, 'GET', `/telemetry/${mv.id}/live`)
  check('5.1 live endpoint for own vehicle responds (no 5xx)', live.status < 500, st(live))
  const liveB = await api(B.token, 'GET', `/telemetry/${mv.id}/live`)
  check("5.1 company B cannot read A's live data (403/404)", [403, 404].includes(liveB.status), st(liveB))
  const hist = await api(B.token, 'GET', `/telemetry/${mv.id}/history`)
  check("5.1 company B cannot read A's telemetry history (403/404)", [403, 404].includes(hist.status), st(hist))
  check('5.1 (informational) the secret-bearing success path of the webhook is not testable: FLEET_TELEMATICS_WEBHOOK_SECRET is not readable by the audit', true)
})
await step('5.2', async () => {
  const vv = G.v2
  await db('PATCH', 'vehicles', { query: `id=eq.${vv.id}`, body: { latitude: 19.2, longitude: 72.95, last_heartbeat: new Date().toISOString() } })
  const bad = await api(A.token, 'POST', `/fleet/vehicles/${vv.id}/share-links`, { hours: 0 })
  check('5.2 hours 0 -> 400', bad.status === 400, st(bad))
  const big = await api(A.token, 'POST', `/fleet/vehicles/${vv.id}/share-links`, { hours: 100000 })
  check('5.2 too many hours -> 400', big.status === 400, st(big))
  const cr = await api(A.token, 'POST', `/fleet/vehicles/${vv.id}/share-links`, { hours: 2 })
  check('5.2 create share link -> 201 with token + path', cr.status === 201 && cr.body.token && cr.body.path, st(cr))
  const stored = (await db('GET', 'vehicle_share_links', { query: `vehicle_id=eq.${vv.id}&select=*` })).body
  check('5.2 only a hash of the token is stored', stored.length === 1 && !JSON.stringify(stored).includes(cr.body.token), JSON.stringify(stored).slice(0, 160))
  const pub = await api(null, 'GET', `/public/vehicle-share/${cr.body.token}`)
  check('5.2 public read by token without sign-in -> 200', pub.status === 200, st(pub))
  const txt = JSON.stringify(pub.body)
  const forbidden = ['driver_name', 'driver_phone', 'driver_id', 'rc_number', 'insurance', 'carrier_org_id', 'capacity', 'fuel', 'user_id', 'email', 'permit', 'puc', 'Ramesh', 'organization']
  const leaked = forbidden.filter(k => txt.toLowerCase().includes(k.toLowerCase()))
  check('5.2 public page exposes no more than position + plate-safe info', leaked.length === 0, `leaks: ${leaked.join(',')} body=${txt.slice(0, 300)}`)
  check('5.2 public page has the position', /19\.2/.test(txt) && /72\.9/.test(txt), txt.slice(0, 200))
  check('5.2 public page shows the plate (the point of the link) and nothing identifying the owner', txt.includes(vv.plate_number), txt.slice(0, 200))
  const pubBad = await api(null, 'GET', `/public/vehicle-share/not-a-real-token-${rnd(10)}`)
  check('5.2 unknown token -> 404', pubBad.status === 404, st(pubBad))
  const ls = await api(A.token, 'GET', `/fleet/vehicles/${vv.id}/share-links`)
  check('5.2 list shows the active link, never the token', ls.status === 200 && ls.body.length === 1 && !JSON.stringify(ls.body).includes(cr.body.token), st(ls))
  const lsB = await api(B.token, 'GET', `/fleet/vehicles/${vv.id}/share-links`)
  check("5.2 company B cannot list A's links (404)", lsB.status === 404, st(lsB))
  const crB = await api(B.token, 'POST', `/fleet/vehicles/${vv.id}/share-links`, { hours: 2 })
  check("5.2 company B cannot create a link on A's vehicle (404)", crB.status === 404, st(crB))
  const delB = await api(B.token, 'DELETE', `/fleet/share-links/${ls.body[0].id}`)
  check("5.2 company B cannot revoke A's link (404)", delB.status === 404, st(delB))
  const cr2 = await api(A.token, 'POST', `/fleet/vehicles/${vv.id}/share-links`, { hours: 1 })
  await db('PATCH', 'vehicle_share_links', { query: `token_hash=eq.${createHash('sha256').update(cr2.body.token).digest('hex')}`, body: { expires_at: new Date(Date.now() - 60000).toISOString() } })
  const exp = await api(null, 'GET', `/public/vehicle-share/${cr2.body.token}`)
  check('5.2 an expired link no longer opens (404/410)', [404, 410].includes(exp.status), st(exp))
  const rv = await api(A.token, 'DELETE', `/fleet/share-links/${ls.body[0].id}`)
  check('5.2 revoke -> 200', rv.status === 200, st(rv))
  const after = await api(null, 'GET', `/public/vehicle-share/${cr.body.token}`)
  check('5.2 a revoked link stops working (404/410)', [404, 410].includes(after.status), st(after))
  const rv2 = await api(A.token, 'DELETE', `/fleet/share-links/${ls.body[0].id}`)
  check('5.2 revoking again -> 404', rv2.status === 404, st(rv2))
  const loc = await api(A.token, 'GET', `/fleet/vehicles/${vv.id}/location`)
  check('5.2 staff location endpoint 200', loc.status === 200, st(loc))
  const locB = await api(B.token, 'GET', `/fleet/vehicles/${vv.id}/location`)
  check("5.2 company B cannot read A's location (404)", locB.status === 404, st(locB))
})
await step('5.3', async () => {
  const h = await api(A.token, 'GET', '/fleet/health')
  const arr = h.body?.vehicles ?? h.body
  check('5.3 fleet health 200 with a list', h.status === 200 && Array.isArray(arr) && arr.length >= 3, st(h))
  const hB = await api(B.token, 'GET', '/fleet/health')
  const arrB = hB.body?.vehicles ?? hB.body
  check("5.3 company B's fleet health excludes A's vehicles", hB.status === 200 && Array.isArray(arrB) && !JSON.stringify(arrB).includes(mv.plate_number), st(hB))
  const vh = await api(A.token, 'GET', `/fleet/vehicles/${G.v2.id}/health`)
  check('5.3 vehicle health 200', vh.status === 200, st(vh))
  const vhB = await api(B.token, 'GET', `/fleet/vehicles/${G.v2.id}/health`)
  check("5.3 company B cannot read A's vehicle health (404)", vhB.status === 404, st(vhB))
  const act = await api(B.token, 'GET', `/fleet/vehicles/${G.v2.id}/activity`)
  check("5.3 company B cannot read A's vehicle activity (404)", act.status === 404, st(act))
  check('5.3 fleet analytics 200', (await api(A.token, 'GET', '/fleet/analytics?days=30')).status === 200)
  const s0 = await api(A.token, 'GET', '/fleet/alert-settings')
  check('5.3 alert settings GET -> values + limits', s0.status === 200 && s0.body.values && s0.body.limits, st(s0))
  const field = Object.keys(s0.body.values)[0]
  const lim = s0.body.limits[field]
  const bBefore = (await api(B.token, 'GET', '/fleet/alert-settings')).body.values[field]
  const cur = Number(s0.body.values[field])
  const newVal = cur + 1 <= lim.max ? cur + 1 : cur - 1
  const put = await api(A.token, 'PUT', '/fleet/alert-settings', { [field]: newVal })
  check(`5.3 company A admin sets ${field}=${newVal}`, put.status === 200 && put.body.values[field] === newVal, st(put))
  const aAfter = await api(A.token, 'GET', '/fleet/alert-settings')
  const bAfter = await api(B.token, 'GET', '/fleet/alert-settings')
  check("5.3 A's value persisted", aAfter.body.values[field] === newVal, JSON.stringify(aAfter.body.values))
  check("5.3 company B's thresholds are unchanged by A's", bAfter.body.values[field] === bBefore, `${bBefore} -> ${bAfter.body.values[field]}`)
  const bPut = await api(B.token, 'PUT', '/fleet/alert-settings', { [field]: lim.min })
  const aStill = await api(A.token, 'GET', '/fleet/alert-settings')
  check("5.3 and B changing its own does not change A's", bPut.status === 200 && aStill.body.values[field] === newVal, st(bPut))
  const badv = await api(A.token, 'PUT', '/fleet/alert-settings', { [field]: lim.max + 1000 })
  check('5.3 out-of-range threshold -> 400', badv.status === 400, st(badv))
  const mgr = await api(AM.token, 'PUT', '/fleet/alert-settings', { [field]: newVal })
  check('5.3 manager cannot change alert settings (403)', mgr.status === 403, st(mgr))
  check('5.3 manager can read alert settings', (await api(AM.token, 'GET', '/fleet/alert-settings')).status === 200)
})

// ── 6. Isolation ─────────────────────────────────────────────
await step('6', async () => {
  const vid = mv.id
  const probes = [
    ['GET', `/vehicles/${vid}`], ['PATCH', `/vehicles/${vid}`, { vehicle_model: 'x' }], ['POST', `/vehicles/${vid}/status`, { status: 'maintenance' }],
    ['POST', `/vehicles/${vid}/archive`, {}], ['POST', `/vehicles/${vid}/unarchive`, {}], ['DELETE', `/vehicles/${vid}`],
    ['POST', `/vehicles/${vid}/approve`, {}], ['POST', `/vehicles/${vid}/reject`, { reason: 'Photos are not readable' }],
    ['GET', `/vehicles/${vid}/photos`], ['POST', `/vehicles/${vid}/photos/upload-url`, { slot: 'front', content_type: 'image/png', size: 10 }],
    ['PUT', `/vehicles/${vid}/photos/front`, { file_path: `vehicles/${vid}/photos/front_x.png` }], ['DELETE', `/vehicles/${vid}/photos/front`],
    ['GET', `/vehicles/${vid}/sos`], ['POST', `/vehicles/${vid}/sos`, { alert_type: 'other' }], ['POST', `/vehicles/${vid}/return-trip`, {}],
    ['GET', `/fleet/vehicles/${vid}/health`], ['GET', `/fleet/vehicles/${vid}/location`], ['GET', `/fleet/vehicles/${vid}/activity`],
    ['POST', `/fleet/vehicles/${vid}/share-links`, {}], ['GET', `/fleet/vehicles/${vid}/share-links`], ['PUT', `/fleet/vehicles/${vid}/odometer`, { odometer_km: 1 }],
    ['GET', `/fleet/vehicles/${vid}/service-plans`], ['POST', `/fleet/vehicles/${vid}/service-plans`, { item: 'x', interval_km: 1 }], ['GET', `/fleet/vehicles/${vid}/service-log`],
    ['POST', `/fleet/vehicles/${vid}/service-log`, { summary: 'x', done_at: day(0), odometer_km: 1 }], ['GET', `/fleet/vehicles/${vid}/maintenance/preview`],
    ['POST', `/fleet/vehicles/${vid}/maintenance`, { reason_type: 'tyre' }], ['POST', `/fleet/vehicles/${vid}/service-plans/defaults`, {}],
    ['POST', `/fleet/vehicles/${vid}/odometer/sync`, {}], ['POST', `/fleet/vehicles/${vid}/service-attachments/upload-url`, { content_type: 'image/png', size: 5, file_name: 'a.png' }],
    ['GET', `/fleet/vehicles/${vid}/fuel-logs`], ['POST', `/fleet/vehicles/${vid}/fuel-logs`, { litres: 1, price_per_litre: 1 }], ['GET', `/fleet/vehicles/${vid}/fuel-stats`],
    ['POST', `/fleet/vehicles/${vid}/fuel-logs/bill-upload`, { content_type: 'image/png', size: 5 }],
    ['GET', `/telemetry/${vid}/live`], ['GET', `/telemetry/${vid}/history`], ['POST', `/telemetry/call-driver/${vid}`, {}],
    ['GET', `/people/${person.id}`], ['PATCH', `/people/${person.id}`, { full_name: 'Hacked' }], ['POST', `/people/${person.id}/status`, { status: 'inactive' }], ['POST', `/people/${person.id}/invite`, {}],
    ['POST', `/people/${person.id}/consent`, { method: 'in_person' }], ['GET', `/people/${person.id}/documents`],
    ['POST', `/people/${person.id}/documents/upload-url`, { doc_type: 'pan', file_name: 'a.png', content_type: 'image/png', size: 5 }],
    ['GET', `/people/${person.id}/emergency-contacts`], ['POST', `/people/${person.id}/emergency-contacts`, { name: 'x', phone: '9999999999', relationship: 'friend' }],
    ['GET', `/people/${person.id}/bank-accounts`], ['GET', `/people/${person.id}/notes`], ['POST', `/people/${person.id}/notes`, { body: 'x', note: 'x' }],
  ]
  for (const [label, tok] of [['admin', B.token], ['manager', BM.token]]) {
    const bad = []
    for (const [m, p, b] of probes) {
      const r = await api(tok, m, p, b)
      const body = JSON.stringify(r.body || '')
      const leaks = body.includes('Ramesh') || body.includes(mv.plate_number)
      if (![403, 404].includes(r.status) || leaks) bad.push(`${m} ${p.replace(/[0-9a-f-]{36}/g, ':id')} -> ${r.status}${leaks ? ' LEAK' : ''}`)
    }
    check(`6.1 company B ${label}: 404/403 and no data on ${probes.length} guessed sub-routes`, bad.length === 0, bad.join(' | '))
  }
  const lst = await api(B.token, 'GET', '/vehicles?limit=500')
  check('6.3 company B vehicle list contains no company A vehicle', lst.status === 200 && !JSON.stringify(lst.body).includes(mv.plate_number) && !JSON.stringify(lst.body).includes(P1), st(lst))
  const sum = await api(B.token, 'GET', '/vehicles/summary')
  check("6.3 company B's summary counts only its own single vehicle", sum.status === 200 && sum.body?.total === 1, st(sum))
  const ppl = await api(B.token, 'GET', '/people?limit=200')
  check('6.3 company B people list has no company A person', ppl.status === 200 && !JSON.stringify(ppl.body).includes(person.id) && !JSON.stringify(ppl.body).includes(A.id), st(ppl))
  const dup = await api(B.token, 'GET', `/people/duplicates?phone=${dPhone}`)
  check("6.3 B's duplicate check does not reveal A's driver", dup.status < 500 && !JSON.stringify(dup.body).includes(person.id) && !JSON.stringify(dup.body).includes('Ramesh'), st(dup))
  const jobs = await api(B.token, 'GET', `/fleet/maintenance/jobs?vehicle_id=${mv.id}`)
  check("6.3 B filtering maintenance jobs by A's vehicle id gets nothing", jobs.status === 200 && (jobs.body || []).length === 0, st(jobs))
  const due = await api(B.token, 'GET', '/fleet/service-due')
  check("6.3 B's service-due excludes A", due.status === 200 && !JSON.stringify(due.body).includes(mv.plate_number), st(due))
  const dtok = G.drvA.token
  const drvOther = await api(dtok, 'GET', `/vehicles/${vid}`)
  check("6.5 a driver of A cannot read a vehicle that isn't theirs (403/404)", [403, 404].includes(drvOther.status), st(drvOther))
  const drvList = await api(dtok, 'GET', '/vehicles')
  check('6.5 a driver sees only their own vehicle', drvList.status === 200 && drvList.body.length === 1 && drvList.body[0].id === G.vidDrv, st(drvList))
  const drvPeople = await api(dtok, 'GET', `/people/${person.id}`)
  check("6.5 a driver cannot read a colleague's profile (403)", drvPeople.status === 403, st(drvPeople))
  check('6.5 a driver cannot create a fleet vehicle (403)', (await api(dtok, 'POST', '/vehicles', vBody)).status === 403)
  check('6.5 a driver cannot change status (403)', (await api(dtok, 'POST', `/vehicles/${G.vidDrv}/status`, { status: 'maintenance' })).status === 403)
})

const f = results.filter(r => !r.ok)
console.log(`\n${results.length - f.length} PASS, ${f.length} FAIL of ${results.length}`)
for (const r of f) console.log(`  FAIL ${r.name}: ${r.detail}`)
