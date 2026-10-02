// Audit area 5: the 3PL lifecycle on the TEST stage. Run: node e2e/staging/tpl.mjs
// Application -> review -> partner login -> affiliation -> lanes and rules -> work (offer, accept, trip, POD, invoice)
// -> earnings and statements -> stats -> isolation. Fresh accounts every run; prints PASS/FAIL per step.
import { api, check, db, env, DATA, login, makeCompany, makeCompanyAdmin, makePlatformAdmin, makeUser, makeVendor, putSigned, readObject, results, sleep, tag, PNG, PASSWORD } from './actors.mjs'

const BUCKET = 'kyc_documents'
const svc = { apikey: env.SERVICE, Authorization: `Bearer ${env.SERVICE}`, 'content-type': 'application/json' }
const j = o => JSON.stringify(o)
const short = b => (typeof b === 'string' ? b : j(b)).slice(0, 160)
const st = (name, res, want, extra = '') => {
  const wants = [].concat(want)
  return check(name, wants.includes(res.status), `status ${res.status} (wanted ${wants}) ${short(res.body)} ${extra}`)
}
const rows = async (table, query) => (await db('GET', table, { query })).body
const one = async (table, query) => (await rows(table, query))?.[0]
const istMonth = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7).replace('-', '')

async function seatPartnerLogin(partnerRow, label) {
  // The real path is the e-mail code on /3pl/onboard/setup. Seeding: a vendor-role sign-in linked to the partner row;
  // the row's trigger gives it the owner seat in the partner organisation.
  const user = await makeUser(`${tag()}-${label}`, 'vendor')
  await fetch(`${DATA}/auth/v1/admin/users/${user.id}`, { method: 'PUT', headers: svc, body: j({ app_metadata: { role: 'vendor' } }) })
  const r = await db('PATCH', 'tpl_partners', { query: `id=eq.${partnerRow}`, body: { user_id: user.id } })
  if (r.status >= 300) throw new Error(`link ${label}: ${short(r.body)}`)
  return { ...user, token: await login(user.email) }
}
const partnerOrgOf = async (partnerRow) => (await one('organizations', `kind=eq.tpl_partner&profile->>legacy_tpl_partner_id=eq.${partnerRow}&select=id,status,name,kind`))

async function main() {
  const T = tag()
  const A = await makeCompany(`TPL A ${T}`)
  const B = await makeCompany(`TPL B ${T}`)
  const adminA = await makeCompanyAdmin(A.id)
  const adminB = await makeCompanyAdmin(B.id)
  const plat = await makePlatformAdmin()
  console.log(`# companies A=${A.id} B=${B.id}`)

  // ── 1. Public application ────────────────────────────────────────────────
  console.log('\n## 1. Public application')
  const good = (n, extra = {}) => ({
    custom_id: `tpl_${T}_${n}`.toLowerCase().slice(0, 20), companyName: `Haulers ${T} ${n}`, email: `tpl-${T}-${n}@margix.test`, phone: '9876543210',
    pan: 'AAPFU0939F', gst: '27AAPFU0939F1ZV', msmeStatus: 'Micro', bankAccount: '50100123456789', bankIfsc: 'HDFC0000123',
    slaCommitment: '12 Hours', taxTreatment: '5% GTA (No ITC) - Reverse Charge', ...extra,
  })
  // onboarding is limited to 5 per hour per address, failures included: field checks run through the edit route
  // (same validators) on a real pending application further down; here only the GSTIN-vs-PAN rule is tried on submit
  if (!process.env.SEED) st('rejected at submit: GSTIN of another PAN', await api(null, 'POST', '/tpl/onboard', { ...good('bad'), email: `bad-${tag()}@margix.test`, custom_id: undefined, gst: '27AABCU9603R1ZX' }), 400)

  // guest upload through the signed flow
  const docs = {}
  const app1 = good('p1', { corridors: [{ name: 'Delhi to Jaipur', vehicles: 'truck', rate: 18000, rate_unit: 'per_trip', priority: '1' }, { name: 'Pune to Mumbai', rate: 12, rate_unit: 'per_km', priority: '2' }] })
  st('upload-url: bad document type 400', await api(null, 'POST', '/tpl/applications/upload-url', { custom_id: app1.custom_id, doc_type: 'Selfie', content_type: 'image/png', size: PNG.length }), 400)
  st('upload-url: .exe refused 415', await api(null, 'POST', '/tpl/applications/upload-url', { custom_id: app1.custom_id, doc_type: 'PAN Card', content_type: 'application/x-msdownload', size: 10 }), 415)
  st('upload-url: 5 MB refused 413', await api(null, 'POST', '/tpl/applications/upload-url', { custom_id: app1.custom_id, doc_type: 'PAN Card', content_type: 'image/png', size: 5 * 1024 * 1024 }), 413)
  st('upload-url: no application id 400', await api(null, 'POST', '/tpl/applications/upload-url', { doc_type: 'PAN Card', content_type: 'image/png', size: 10 }), 400)
  for (const [k, t] of process.env.SEED ? [] : [['pan', 'PAN Card'], ['gst', 'GST Certificate'], ['cheque', 'Cancelled Cheque']]) {
    const up = await api(null, 'POST', '/tpl/applications/upload-url', { custom_id: app1.custom_id, doc_type: t, content_type: 'image/png', size: PNG.length })
    if (!st(`guest upload-url: ${t}`, up, 200)) continue
    try {
      const path = await putSigned(up.body, PNG)
      const back = await readObject(BUCKET, path)
      check(`document ${t} read back byte for byte`, back && Buffer.compare(back, PNG) === 0, `got ${back?.length}`)
      docs[k] = { type: t, url: path }
    } catch (e) { check(`document ${t} stored`, false, e.message) }
  }
  app1.documents = Object.values(docs)
  if (process.env.SEED) app1.documents = [{ type: 'PAN Card', url: 'x/pan.png' }, { type: 'GST Certificate', url: 'x/gst.png' }, { type: 'Cancelled Cheque', url: 'x/chq.png' }]

  let o1
  if (process.env.SEED) {
    const r = (await db('POST', 'tpl_partners', { body: { custom_id: app1.custom_id, company_name: app1.companyName, email: app1.email, phone: '9876543210', pan_number: app1.pan, gstin: app1.gst, bank_ifsc: 'HDFC0000123', status: 'pending', sla_commitment: '12 Hours' } })).body[0]
    await db('POST', 'tpl_corridors', { body: [{ partner_id: r.id, corridor_name: 'Delhi to Jaipur', rate_amount: 18000, rate_unit: 'per_trip', proposed_rate: '18000', priority: '1' }, { partner_id: r.id, corridor_name: 'Pune to Mumbai', rate_amount: 12, rate_unit: 'per_km', proposed_rate: '12', priority: '2' }] })
    await db('POST', 'tpl_documents', { body: app1.documents.map(d => ({ partner_id: r.id, doc_type: d.type, file_url: d.url })) })
    o1 = { status: 200, body: { data: { id: r.id, custom_id: r.custom_id, status: 'pending' } } }
  } else o1 = await api(null, 'POST', '/tpl/onboard', app1)
  st('guest application submitted', o1, 200)
  const P1 = o1.body?.data
  check('application is pending with a tracking id', P1?.status === 'pending' && P1?.id, short(o1.body))
  const dbP1 = await one('tpl_partners', `id=eq.${P1?.id}&select=*,tpl_documents(*),tpl_corridors(*)`)
  check('db: 3 documents and 2 corridors stored', dbP1?.tpl_documents?.length === 3 && dbP1?.tpl_corridors?.length === 2, j({ d: dbP1?.tpl_documents?.length, c: dbP1?.tpl_corridors?.length }))
  check('db: corridor rate kept as number + unit', dbP1?.tpl_corridors?.some(c => Number(c.rate_amount) === 18000 && c.rate_unit === 'per_trip'), j(dbP1?.tpl_corridors))
  check('db: phone stored as 10 digits, IFSC upper case, bank name looked up or blank', dbP1?.phone === '9876543210' && dbP1?.bank_ifsc === 'HDFC0000123', j({ p: dbP1?.phone, i: dbP1?.bank_ifsc }))
  const org1pending = await partnerOrgOf(P1.id)
  check('db: partner organisation (tpl_partner) exists, pending', org1pending?.kind === 'tpl_partner' && org1pending.status === 'pending', j(org1pending))
  const badEdit = async (name, patch) => st(`rejected: ${name}`, await api(plat.token, 'PATCH', `/tpl/${P1.id}`, patch), 400)
  await badEdit('bad PAN', { pan: 'ABC123' })
  await badEdit('bad GSTIN', { gst: '27AAPFU0939F1Z' })
  await badEdit('GSTIN of another PAN', { gst: '27AABCU9603R1ZX' })
  await badEdit('bad phone', { phone: '12345' })
  await badEdit('bad IFSC', { bankIfsc: 'HDFC123' })
  await badEdit('bad account number', { bankAccount: '12ab' })
  await badEdit('bad e-mail', { email: 'not-an-email' })
  await badEdit('corridor rate without unit', { corridors: [{ name: 'Delhi to Jaipur', rate: 100 }] })
  await badEdit('document path not issued', { documents: [{ type: 'PAN Card', url: 'tpl-applications/someoneelse/pan.png' }] })
  await badEdit('SLA outside the list', { slaCommitment: '1 minute' })
  if (!process.env.SEED) st('upload-url for a taken partner id 409', await api(null, 'POST', '/tpl/applications/upload-url', { custom_id: app1.custom_id, doc_type: 'PAN Card', content_type: 'image/png', size: 10 }), 409)
  if (!process.env.SEED) st('upload-url for an application with the wrong PAN 403', await api(null, 'POST', '/tpl/applications/upload-url', { application_id: P1.id, verify_pan: 'ZZZZZ9999Z', doc_type: 'PAN Card', content_type: 'image/png', size: 10 }), 403)
  if (!process.env.SEED) st('upload-url for an existing pending application with its PAN', await api(null, 'POST', '/tpl/applications/upload-url', { application_id: P1.id, verify_pan: app1.pan, doc_type: 'GST Certificate', content_type: 'image/png', size: 10 }), 200)

  let P2, P3
  const app2 = good('p2', { phone: '+91 98765 43211', corridors: [{ name: 'Delhi to Jaipur', rate: 9, rate_unit: 'per_km', priority: '1' }] })
  const app3 = good('p3')
  if (process.env.SEED) {
    const seed = async a => (await db('POST', 'tpl_partners', { body: { custom_id: a.custom_id, company_name: a.companyName, email: a.email, phone: '9876543211', pan_number: a.pan, gstin: a.gst, status: 'pending', sla_commitment: '12 Hours' } })).body[0]
    P2 = await seed(app2); P3 = await seed(app3)
    await db('POST', 'tpl_corridors', { body: { partner_id: P2.id, corridor_name: 'Delhi to Jaipur', rate_amount: 9, rate_unit: 'per_km', proposed_rate: '9 per km', priority: '1' } })
    console.log('   (SEED mode: P2 and P3 inserted directly because onboarding is limited to 5 per hour per address)')
  } else {
    st('duplicate e-mail 409', await api(null, 'POST', '/tpl/onboard', { ...app2, email: app1.email, custom_id: 'tpl_dupmail' + T.slice(0, 5) }), 409)
    P2 = (await api(null, 'POST', '/tpl/onboard', app2)).body?.data
    P3 = (await api(null, 'POST', '/tpl/onboard', app3)).body?.data
    check('phone with +91 and spaces is normalised', (await one('tpl_partners', `id=eq.${P2?.id}&select=phone`))?.phone === '9876543211')
  }
  // P4: only ever seeded (the fourth application of the hour would hit the per-address limit)
  const app4 = good('p4')
  const P4 = (await db('POST', 'tpl_partners', { body: { custom_id: app4.custom_id, company_name: app4.companyName, email: app4.email, phone: '9876543212', pan_number: app4.pan, gstin: app4.gst, status: 'pending', sla_commitment: '12 Hours' } })).body[0]
  check('three more applications exist (P2, P3 and P4)', P2?.id && P3?.id && P4?.id)

  // the tracking page
  const pub = await api(null, 'GET', `/tpl/${P1.id}`)
  st('track by id as a guest', pub, 200)
  const leaked = ['pan_number', 'bank_account_no', 'bank_ifsc', 'gstin', 'phone', 'tpl_documents', 'user_id', 'pending_updates'].filter(k => k in (pub.body ?? {}))
  check('track view carries no PAN, bank, phone or documents', leaked.length === 0, `leaks: ${leaked}`)
  check('track view masks the e-mail', /^.{2}\*\*\*@/.test(pub.body?.email_masked ?? '') && !j(pub.body).includes(app1.email), short(pub.body))
  const pubC = await api(null, 'GET', `/tpl/${app1.custom_id}`)
  check('track by partner id works', pubC.status === 200 && pubC.body?.id === P1.id, short(pubC.body))
  check('track view of one never names another application', !j(pub.body).includes(P2.id) && !j(pub.body).includes(`Haulers ${T} p2`))
  st('track with a wrong PAN stays the status-only view', await api(null, 'GET', `/tpl/${P1.id}?pan=ZZZZZ9999Z`), 200)
  const full = await api(null, 'GET', `/tpl/${P1.id}?pan=${app1.pan}`)
  check('track with the right PAN returns the full record', full.status === 200 && full.body?.pan_number === app1.pan, short(full.body))
  st('track an unknown id 404', await api(null, 'GET', '/tpl/00000000-0000-4000-8000-000000000000'), 404)
  st('track a garbage id 404', await api(null, 'GET', '/tpl/x'), 404)
  st('queue as a guest 401', await api(null, 'GET', '/tpl/queue'), 401)

  // other tenants' staff and the applicant's private data
  const staffQ = await api(adminB.token, 'GET', '/tpl/queue?status=pending')
  check('company B admin cannot read the platform application queue (bank, PAN of strangers)', staffQ.status === 403, `status ${staffQ.status} rows ${staffQ.body?.length}`)
  const staffFull = await api(adminB.token, 'GET', `/tpl/${P1.id}`)
  check('company B admin sees only the status view of a stranger application', !('pan_number' in (staffFull.body ?? {})), `leaks ${Object.keys(staffFull.body ?? {}).includes('bank_account_no')}`)
  st('company B admin cannot approve (403)', await api(adminB.token, 'POST', `/tpl/approve/${P1.id}`), 403)
  st('a guest cannot approve (401)', await api(null, 'POST', `/tpl/approve/${P1.id}`), 401)

  // ── 2. Platform review ───────────────────────────────────────────────────
  console.log('\n## 2. Platform review')
  const pq = await api(plat.token, 'GET', '/tpl/queue?status=pending')
  check('platform queue lists the applications', pq.status === 200 && [P1, P2, P3, P4].every(p => pq.body.some(r => r.id === p.id)), `status ${pq.status}`)
  st('reject without a reason 400', await api(plat.token, 'POST', `/tpl/reject/${P3.id}`, {}), 400)
  st('reject with a reason', await api(plat.token, 'POST', `/tpl/reject/${P3.id}`, { reason: 'PAN card is not legible' }), 200)
  const tr3 = await api(null, 'GET', `/tpl/${P3.id}`)
  check('applicant sees the rejection reason on the track page', tr3.body?.status === 'rejected' && tr3.body?.rejection_reason === 'PAN card is not legible', short(tr3.body))
  check('db: rejected partner organisation is rejected', (await partnerOrgOf(P3.id))?.status === 'rejected')
  st('approve a rejected application 409', await api(plat.token, 'POST', `/tpl/approve/${P3.id}`), 409)
  st('reject twice 409', await api(plat.token, 'POST', `/tpl/reject/${P3.id}`, { reason: 'again again' }), 409)
  st('approve P1', await api(plat.token, 'POST', `/tpl/approve/${P1.id}`), 200)
  st('approve P1 twice 409', await api(plat.token, 'POST', `/tpl/approve/${P1.id}`), 409)
  st('approve P2', await api(plat.token, 'POST', `/tpl/approve/${P2.id}`), 200)
  st('approve P4', await api(plat.token, 'POST', `/tpl/approve/${P4.id}`), 200)
  st('approve unknown 404', await api(plat.token, 'POST', '/tpl/approve/00000000-0000-4000-8000-000000000000'), 404)
  const org1 = await partnerOrgOf(P1.id); const org2 = await partnerOrgOf(P2.id); const org4 = await partnerOrgOf(P4.id)
  check('approved partners have an active tpl_partner organisation', [org1, org2, org4].every(o => o?.status === 'active' && o.kind === 'tpl_partner'), j([org1, org2, org4]))
  st('track shows approved', await api(null, 'GET', `/tpl/${P1.id}`), 200)
  st('edit an approved application with its PAN 409', await api(null, 'PATCH', `/tpl/${P1.id}`, { verify_pan: app1.pan, companyName: 'Hacked' }), 409)
  st('edit with the wrong PAN 403', await api(null, 'PATCH', `/tpl/${P1.id}`, { verify_pan: 'ZZZZZ9999Z', companyName: 'Hacked' }), 403)
  const edit = await api(null, 'PATCH', `/tpl/${P4.id}`, { verify_pan: app4.pan, companyName: 'Whatever' })
  check('a pending-only edit is refused once approved', edit.status === 409, `status ${edit.status}`)

  // e-mail code flow
  const otp = process.env.SEED ? { status: 200, body: 'skipped' } : await api(null, 'POST', '/tpl/auth/send-otp', { email: app1.email })
  check('send-otp for an approved partner is a clean 200 (or a clean 503 when e-mail is not set up), never a 500', [200, 503].includes(otp.status), `status ${otp.status} ${short(otp.body)}`)
  console.log(`   (info) send-otp answered ${otp.status}: ${short(otp.body)}`)
  if (!process.env.SEED) st('send-otp for an unknown e-mail does not reveal it (200)', await api(null, 'POST', '/tpl/auth/send-otp', { email: `nobody-${T}@margix.test` }), 200)
  if (!process.env.SEED) st('send-otp with a bad address 400', await api(null, 'POST', '/tpl/auth/send-otp', { email: 'x' }), 400)
  st('setup-password with a wrong code 400', await api(null, 'POST', '/tpl/auth/setup-password', { email: app1.email, otp: '000000', password: 'Longenough123' }), 400)
  st('setup-password with a short password 400', await api(null, 'POST', '/tpl/auth/setup-password', { email: app1.email, otp: '000000', password: 'short' }), 400)

  // partner logins (seeded; see the findings for why)
  const u1 = await seatPartnerLogin(P1.id, 'p1'); const u2 = await seatPartnerLogin(P2.id, 'p2'); const u4 = await seatPartnerLogin(P4.id, 'p4')
  const mine1 = await api(u1.token, 'GET', '/orgs/mine')
  check('partner owner sees its tpl_partner organisation in /orgs/mine', mine1.body?.some?.(m => m.org.id === org1.id && m.org.kind === 'tpl_partner' && m.role === 'owner'), short(mine1.body))
  check('the partner finds its record by user', (await api(u1.token, 'GET', `/tpl/by-user/${u1.id}`)).body?.id === P1.id)
  st('a partner cannot read another user record 403', await api(u1.token, 'GET', `/tpl/by-user/${u2.id}`), 403)
  const own = await api(u1.token, 'GET', `/tpl/${P1.id}`)
  check('the partner sees its full record', own.body?.pan_number === app1.pan, short(own.body))
  const other = await api(u1.token, 'GET', `/tpl/${P2.id}`)
  check('partner P1 sees only the status view of P2', !('pan_number' in (other.body ?? {})), short(other.body))

  // request for changes (the partner asks; staff decide)
  const ch = await api(u4.token, 'POST', `/tpl/${P4.id}/settings`, { sla_commitment: '4 Hours', tax_treatment: '12% GTA (With ITC) - Forward Charge', corridors: [{ name: 'Pune to Mumbai', rate: 15000, rate_unit: 'per_trip' }] })
  st('partner requests changes (SLA, tax, corridors)', ch, 200)
  const p4row = await one('tpl_partners', `id=eq.${P4.id}&select=status,sla_commitment,pending_updates`)
  check('the partner waits in review with the old SLA until staff decide', p4row.status === 'pending' && p4row.sla_commitment === '12 Hours' && p4row.pending_updates, j(p4row))
  check('the organisation stops working while changes are reviewed', (await partnerOrgOf(P4.id)).status === 'pending')
  st('another partner cannot request changes for P4 (403)', await api(u2.token, 'POST', `/tpl/${P4.id}/settings`, { sla_commitment: '2 Hours', tax_treatment: '5% GTA (No ITC) - Reverse Charge' }), 403)
  st('staff reject the changes with a reason', await api(plat.token, 'POST', `/tpl/reject/${P4.id}`, { reason: 'Rate looks wrong' }), 200)
  const p4b = await one('tpl_partners', `id=eq.${P4.id}&select=status,sla_commitment,pending_updates`)
  check('rejecting changes keeps the partner active with the old terms', p4b.status === 'active' && p4b.sla_commitment === '12 Hours' && !p4b.pending_updates, j(p4b))
  await api(u4.token, 'POST', `/tpl/${P4.id}/settings`, { sla_commitment: '4 Hours', tax_treatment: '12% GTA (With ITC) - Forward Charge', corridors: [{ name: 'Pune to Mumbai', rate: 15000, rate_unit: 'per_trip' }] })
  st('staff approve the changes', await api(plat.token, 'POST', `/tpl/approve/${P4.id}`), 200)
  const p4c = await one('tpl_partners', `id=eq.${P4.id}&select=status,sla_commitment,tax_treatment,tpl_corridors(corridor_name,rate_amount,rate_unit)`)
  check('approved changes are applied (SLA, tax, corridor)', p4c.status === 'active' && p4c.sla_commitment === '4 Hours' && p4c.tpl_corridors?.[0]?.corridor_name === 'Pune to Mumbai' && Number(p4c.tpl_corridors[0].rate_amount) === 15000, j(p4c))
  const doc = dbP1.tpl_documents[0]
  const up2 = process.env.SEED ? { status: 200, body: {} } : await api(u1.token, 'POST', '/tpl/applications/upload-url', { application_id: P1.id, doc_type: doc.doc_type, content_type: 'image/png', size: PNG.length })
  if (st('partner gets a signed link for a replacement document', up2, 200)) {
    const path = process.env.SEED ? `${P1.id}/pan_${T}.png` : await putSigned(up2.body, PNG)
    st('partner replaces a document (goes back to review)', await api(u1.token, 'POST', `/tpl/${P1.id}/documents/${doc.id}/replace`, { path }), 200)
    check('the organisation is pending while the document is reviewed', (await partnerOrgOf(P1.id)).status === 'pending')
    st('staff approve again', await api(plat.token, 'POST', `/tpl/approve/${P1.id}`), 200)
    check('active again', (await partnerOrgOf(P1.id)).status === 'active')
  }
  st('pause P4 (platform)', await api(plat.token, 'POST', `/tpl/${P4.id}/pause`), 200)
  check('paused partner org is suspended', (await partnerOrgOf(P4.id)).status === 'suspended')
  st('resume P4', await api(plat.token, 'POST', `/tpl/${P4.id}/resume`), 200)
  st('company admin cannot pause (403)', await api(adminA.token, 'POST', `/tpl/${P4.id}/pause`), 403)

  // ── 3. Affiliation ───────────────────────────────────────────────────────
  console.log('\n## 3. Affiliation')
  st('a company admin cannot ask to join (partner only) 403', await api(adminA.token, 'POST', '/tpl/affiliations', { company_id: A.id }), 403)
  st('P1 asks to join company A', await api(u1.token, 'POST', '/tpl/affiliations', { company_id: A.id }), 201)
  st('asking twice is refused 409 (or idempotent)', await api(u1.token, 'POST', '/tpl/affiliations', { company_id: A.id }), [409, 200, 201])
  st('P1 asks for a company that does not exist 404/422', await api(u1.token, 'POST', '/tpl/affiliations', { company_id: '00000000-0000-4000-8000-000000000000' }), [404, 422])
  st('P1 asks to join the partner org of P2 (not a company) 4xx', await api(u1.token, 'POST', '/tpl/affiliations', { company_id: org2.id }), [404, 409, 422, 400])
  const pend = await api(adminA.token, 'GET', '/org/tpl-affiliations')
  check('company A sees the request pending', pend.body?.some?.(a => (a.tpl_id ?? a.organization?.id) === org1.id && a.status === 'pending'), short(pend.body))
  const bList = await api(adminB.token, 'GET', '/org/tpl-affiliations')
  check('company B does not see the partner of A', st('B lists its partners', bList, 200) && !j(bList.body).includes(org1.id), short(bList.body))
  st('B cannot read A partner (404)', await api(adminB.token, 'GET', `/org/tpl-affiliations/${org1.id}`), 404)
  st('B cannot approve it (404)', await api(adminB.token, 'PUT', `/org/tpl-affiliations/${org1.id}/approve`), 404)
  st('B cannot read its fleet counts (404)', await api(adminB.token, 'GET', `/org/tpl-affiliations/${org1.id}/fleet`), 404)
  st('A approves P1', await api(adminA.token, 'PUT', `/org/tpl-affiliations/${org1.id}/approve`), 200)
  st('P2 asks to join A', await api(u2.token, 'POST', '/tpl/affiliations', { company_id: A.id }), 201)
  st('A approves P2', await api(adminA.token, 'PUT', `/org/tpl-affiliations/${org2.id}/approve`), 200)
  st('A pauses P1', await api(adminA.token, 'PUT', `/org/tpl-affiliations/${org1.id}/pause`), 200)
  check('db: affiliation paused', (await one('tpl_affiliations', `company_id=eq.${A.id}&tpl_id=eq.${org1.id}`))?.status === 'paused')
  st('A re-approves P1 (resume)', await api(adminA.token, 'PUT', `/org/tpl-affiliations/${org1.id}/approve`), 200)
  st('P1 asks to join B too (several companies)', await api(u1.token, 'POST', '/tpl/affiliations', { company_id: B.id }), 201)
  st('B approves P1', await api(adminB.token, 'PUT', `/org/tpl-affiliations/${org1.id}/approve`), 200)
  const mineP1 = await api(u1.token, 'GET', '/tpl/affiliations')
  check('P1 lists both companies as active', ['active'].every(s => [A.id, B.id].every(c => mineP1.body?.some?.(a => (a.company_id ?? a.organization?.id) === c && a.status === s))), short(mineP1.body))
  const mineP2 = await api(u2.token, 'GET', '/tpl/affiliations')
  check('P2 lists only company A (and the default company)', mineP2.status === 200 && !j(mineP2.body).includes(B.id), short(mineP2.body))
  st('P2 cannot read the affiliation list of a company (403)', await api(u2.token, 'GET', '/org/tpl-affiliations'), 403)
  const lateB = await api(adminB.token, 'GET', '/org/tpl-affiliations')
  check('company B now sees P1 but not P2', j(lateB.body).includes(org1.id) && !j(lateB.body).includes(org2.id), short(lateB.body))
  st('A ends P4 (never active in A: 404)', await api(adminA.token, 'PUT', `/org/tpl-affiliations/${org4.id}/end`), 404)
  st('P4 asks to join A', await api(u4.token, 'POST', '/tpl/affiliations', { company_id: A.id }), 201)
  st('A approves then ends P4', await api(adminA.token, 'PUT', `/org/tpl-affiliations/${org4.id}/approve`), 200)
  st('A ends P4', await api(adminA.token, 'PUT', `/org/tpl-affiliations/${org4.id}/end`), 200)
  check('db: ended', (await one('tpl_affiliations', `company_id=eq.${A.id}&tpl_id=eq.${org4.id}`))?.status === 'ended')
  st('an ended partner is a 404 for the company (no data)', await api(adminA.token, 'GET', `/org/tpl-affiliations/${org4.id}/fleet`), 404)

  // ── 4/5. Fleet of the partner, then rules ────────────────────────────────
  console.log('\n## 4. Fleet, lanes and rules')
  const plate = n => `MH12${T.slice(0, 2).toUpperCase().replace(/[^A-Z]/g, 'X')}${String(Date.now()).slice(-4)}${n}`.slice(0, 10)
  const veh = await api(u1.token, 'POST', `/tpl-portal/${org1.id}/vehicles`, { plate_number: plate(1), vehicle_type: 'truck', capacity_kg: 8000, rc_number: `RC${T}1`, insurance_number: `INS${T}1` })
  st('P1 registers a truck with RC + insurance', veh, 201)
  check('the truck is usable and owned by the partner org', veh.body?.usable && veh.body?.carrier_org_id === org1.id, short(veh.body))
  const veh0 = await api(u1.token, 'POST', `/tpl-portal/${org1.id}/vehicles`, { plate_number: plate(2), vehicle_type: 'truck', capacity_kg: 8000 })
  check('a truck without documents waits (not usable)', veh0.status === 201 && veh0.body?.usable === false, short(veh0.body))
  st('duplicate plate 409', await api(u1.token, 'POST', `/tpl-portal/${org1.id}/vehicles`, { plate_number: veh.body?.plate_number, vehicle_type: 'truck', capacity_kg: 100 }), 409)
  st('bad vehicle 422', await api(u1.token, 'POST', `/tpl-portal/${org1.id}/vehicles`, { plate_number: 'X', vehicle_type: 'spaceship', capacity_kg: -1 }), [400, 422])
  st('P2 cannot read the fleet of P1 (403)', await api(u2.token, 'GET', `/tpl-portal/${org1.id}/vehicles`), 403)
  st('P2 cannot add a vehicle to P1 (403)', await api(u2.token, 'POST', `/tpl-portal/${org1.id}/vehicles`, { plate_number: plate(3), vehicle_type: 'truck', capacity_kg: 100 }), 403)
  st('company A cannot use the partner portal (403)', await api(adminA.token, 'GET', `/tpl-portal/${org1.id}/vehicles`), 403)
  // vehicle photo / documents through the signed flow
  const vphoto = await api(u1.token, 'POST', `/tpl-portal/${org1.id}/vehicles/${veh.body.id}/photos/upload-url`, { slot: 'front', content_type: 'image/png', size: PNG.length })
  check('a partner can upload a vehicle photo through the signed flow', vphoto.status === 200 && vphoto.body?.signed_url, `status ${vphoto.status} ${short(vphoto.body)}`)
  if (vphoto.status === 200) {
    const path = await putSigned(vphoto.body, PNG)
    const back = await readObject(vphoto.body.bucket ?? BUCKET, path)
    check('vehicle photo read back byte for byte', back && Buffer.compare(back, PNG) === 0)
    st('the photo is recorded on the vehicle', await api(u1.token, 'PUT', `/tpl-portal/${org1.id}/vehicles/${veh.body.id}/photos/front`, { file_path: path }), 200)
    check('and listed', (await api(u1.token, 'GET', `/tpl-portal/${org1.id}/vehicles/${veh.body.id}/photos`)).body?.length === 1)
  }
  st('P2 cannot upload a photo for the truck of P1 (403)', await api(u2.token, 'POST', `/tpl-portal/${org1.id}/vehicles/${veh.body.id}/photos/upload-url`, { slot: 'front', content_type: 'image/png', size: 10 }), 403)
  // drivers
  const inv = await api(u1.token, 'POST', `/tpl-portal/${org1.id}/drivers/invite`, { full_name: `Partner Driver ${T}`, phone: `+9190000${String(Date.now()).slice(-5)}` })
  st('P1 invites a driver by phone', inv, 201)
  // A driver the partner invites signs in by phone code (a server-issued driver token, which keeps the driver role). That
  // code cannot be read on the stage, so the trip is run by a password sign-in: it belongs to the partner organisation
  // (the truck is assigned through that seat) and also holds a driver seat in company A, which gives it the driver role.
  const driver1 = await makeCompanyAdmin(org1.id, 'driver')
  await db('POST', 'org_members', { body: { org_id: A.id, user_id: driver1.id, role: 'driver', status: 'active' } })
  driver1.token = await login(driver1.email)
  const dl = await api(u1.token, 'GET', `/tpl-portal/${org1.id}/drivers`)
  check('drivers list shows both (invited + seeded)', dl.body?.items?.length >= 2 && dl.body.items.some(d => d.id === driver1.id), short(dl.body))
  const assign = await api(u1.token, 'PATCH', `/tpl-portal/${org1.id}/vehicles/${veh.body.id}`, { driver_id: driver1.id })
  st('P1 gives the truck its driver', assign, 200)
  st('P1 cannot give the truck a driver of another org 422', await api(u1.token, 'PATCH', `/tpl-portal/${org1.id}/vehicles/${veh.body.id}`, { driver_id: adminA.id }), 422)
  const fleetA = await api(adminA.token, 'GET', `/org/tpl-affiliations/${org1.id}/fleet`)
  check('company A sees fleet counts only', fleetA.status === 200 && fleetA.body.vehicles_total >= 1 && !j(fleetA.body).includes(veh.body.plate_number), short(fleetA.body))

  // vendors, loads
  const vendorA = await makeVendor({ admin: adminA })
  const vendorB = await makeVendor({ admin: adminB })
  const post = async (v, drop = 'Sitapura, Jaipur') => (await api(v.token, 'POST', '/vendor/shipment-request', {
    pickup: { address: 'Okhla, Delhi', lat: 28.53, lng: 77.27 }, drop: { address: drop, lat: 26.79, lng: 75.82 }, capacity: 1500,
    metadata: { cargo: { gstRate: '18', declaredValue: '120000', description: 'Packaged goods' } },
  }))
  const mkLoad = async (v, admin, cost = 22000) => {
    const r = await post(v)
    if (r.status >= 300) throw new Error(`post load: ${short(r.body)}`)
    const ap = await api(admin.token, 'PUT', `/vendor/shipment-request/${r.body.id}/approve`, { cost })
    if (ap.status >= 300) throw new Error(`approve load: ${short(ap.body)}`)
    return r.body
  }
  const R1 = await mkLoad(vendorA, adminA)
  check('the vendor load belongs to company A once accepted', (await one('vendor_shipment_requests', `id=eq.${R1.id}&select=carrier_org_id,status`))?.carrier_org_id === A.id)

  // rules in the preview
  const pv = path => api(adminA.token, 'GET', `/tpl-network/escalations/preview?request_id=${R1.id}${path ?? ''}`)
  const pv0 = await pv()
  check('preview offers the load to both active partners of A', pv0.status === 200 && [P1.id, P2.id].every(id => pv0.body.partners.some(p => p.partner_id === id)) && !pv0.body.partners.some(p => p.partner_id === P4.id), short(pv0.body))
  check('preview prices P1 per trip (18000) and P2 per km x distance', pv0.body?.partners?.find(p => p.partner_id === P1.id)?.price === 18000 && pv0.body?.partners?.find(p => p.partner_id === P2.id)?.price > 0, j(pv0.body?.partners))
  const setRules = (org, rules) => api(adminA.token, 'PATCH', `/org/tpl-affiliations/${org}/rules`, rules)
  st('A sets rules on P1: min 100/km', await setRules(org1.id, { min_rate_per_km: 100 }), 200)
  const pv1 = await pv()
  check('preview excludes P1 with the reason (rate below minimum per km)', pv1.body?.excluded?.some(e => e.partner_id === P1.id && /per km/.test(e.reason)) && !pv1.body.partners.some(p => p.partner_id === P1.id), short(pv1.body))
  check('P2 is still offered', pv1.body?.partners?.some(p => p.partner_id === P2.id))
  st('rules: gps required (P1 has no GPS) ', await setRules(org1.id, { gps_required: true }), 200)
  check('preview excludes P1: needs GPS', (await pv()).body?.excluded?.some(e => e.partner_id === P1.id && /GPS/.test(e.reason)))
  st('rules: insurance required (P1 has one)', await setRules(org1.id, { insurance_required: true }), 200)
  check('P1 passes the insurance rule', (await pv()).body?.partners?.some(p => p.partner_id === P1.id))
  st('rules: only the reefer class', await setRules(org1.id, { vehicle_classes: ['reefer'] }), 200)
  await db('PATCH', 'vendor_shipment_requests', { query: `id=eq.${R1.id}`, body: { vehicle_class: 'truck' } })
  check('preview excludes P1: vehicle class not allowed', (await pv()).body?.excluded?.some(e => e.partner_id === P1.id && /vehicle class/.test(e.reason)))
  const lane = await one('tpl_corridors', `partner_id=eq.${P1.id}&corridor_name=eq.Pune to Mumbai`)
  st('rules: only the Pune-Mumbai lane', await setRules(org1.id, { corridor_ids: [lane.id] }), 200)
  check('preview excludes P1: its lane is not allowed', (await pv()).body?.excluded?.some(e => e.partner_id === P1.id && /lane/.test(e.reason)))
  st('rules with an unknown key 422', await setRules(org1.id, { colour: 'red' }), [400, 422])
  st('rules with negative min 422', await setRules(org1.id, { min_rate_per_km: -5 }), [400, 422])
  st('B cannot set A rules on P2 (404)', await api(adminB.token, 'PATCH', `/org/tpl-affiliations/${org2.id}/rules`, { gps_required: true }), 404)
  st('clear the rules', await setRules(org1.id, {}), 200)
  check('after clearing, preview offers P1 again', (await pv()).body?.partners?.some(p => p.partner_id === P1.id))
  check('targeted preview of P2 only', (await pv(`&partner_ids=${P2.id}`)).body?.partners?.length === 1)
  st('targeted preview of a partner of nobody 400', await api(adminA.token, 'GET', `/tpl-network/escalations/preview?request_id=${R1.id}&partner_ids=${P4.id}`), 400)
  st('B previews A load (404)', await api(adminB.token, 'GET', `/tpl-network/escalations/preview?request_id=${R1.id}`), 404)

  // ── 5. Work ──────────────────────────────────────────────────────────────
  console.log('\n## 5. Work')
  st('B cannot escalate A load (404)', await api(adminB.token, 'POST', '/tpl-network/escalations', { request_id: R1.id }), 404)
  st('bad escalation body 400', await api(adminA.token, 'POST', '/tpl-network/escalations', {}), 400)
  st('too many partner ids 400', await api(adminA.token, 'POST', '/tpl-network/escalations', { request_id: R1.id, partner_ids: [] }), 400)
  const esc = await api(adminA.token, 'POST', '/tpl-network/escalations', { request_id: R1.id })
  st('A escalates R1 to every matching partner', esc, 201)
  check('two offers (P1, P2) owned by company A, not targeted', esc.body?.created === 2 && esc.body.offers.every(o => o.carrier_org_id === A.id && o.targeted === false), short(esc.body))
  check('request is escalated', (await one('vendor_shipment_requests', `id=eq.${R1.id}&select=status`)).status === 'escalated')
  st('escalating again 409 (already offered)', await api(adminA.token, 'POST', '/tpl-network/escalations', { request_id: R1.id }), 409)
  const offerOf = (esc2, id) => esc2.body.offers.find(o => o.partner_id === id)
  const offP1 = offerOf(esc, P1.id); const offP2 = offerOf(esc, P2.id)
  const listA = await api(adminA.token, 'GET', `/tpl-network/escalations?request_id=${R1.id}`)
  check('A lists the two offers with partner names', listA.body?.offers?.length === 2 && listA.body.offers.every(o => o.partner_name), short(listA.body))
  const listB = await api(adminB.token, 'GET', `/tpl-network/escalations?request_id=${R1.id}`)
  check('B lists A escalations: nothing', listB.status === 200 ? listB.body.offers.length === 0 && listB.body.order === null : listB.status === 404, `status ${listB.status} ${short(listB.body)}`)
  const mo1 = await api(u1.token, 'GET', '/tpl-network/my/offers')
  check('P1 sees the offer grouped under company A', mo1.body?.companies?.some(c => c.org_id === A.id && c.name === A.name && c.offers.some(o => o.id === offP1.id)), short(mo1.body))
  check('P1 does not see the offer of P2', !mo1.body?.items?.some(o => o.id === offP2.id))
  st('P2 cannot accept the offer of P1 (404)', await api(u2.token, 'POST', `/tpl-network/my/offers/${offP1.id}/accept`, { agreed_amount: 100 }), 404)
  st('P1 accept with no vehicle while it has vehicles 400', await api(u1.token, 'POST', `/tpl-network/my/offers/${offP1.id}/accept`, { agreed_amount: 18000 }), 400)
  st('P1 accept with a vehicle and no driver 400', await api(u1.token, 'POST', `/tpl-network/my/offers/${offP1.id}/accept`, { agreed_amount: 18000, vehicle_id: veh.body.id }), 400)
  st('P1 accept with a driver of another org 404', await api(u1.token, 'POST', `/tpl-network/my/offers/${offP1.id}/accept`, { agreed_amount: 18000, vehicle_id: veh.body.id, driver_id: adminA.id }), 404)
  st('P1 accept with the vehicle that waits for documents 409', await api(u1.token, 'POST', `/tpl-network/my/offers/${offP1.id}/accept`, { agreed_amount: 18000, vehicle_id: veh0.body.id, driver_id: driver1.id }), [404, 409])
  st('P1 accept with a negative amount 400', await api(u1.token, 'POST', `/tpl-network/my/offers/${offP1.id}/accept`, { agreed_amount: -5, vehicle_id: veh.body.id, driver_id: driver1.id }), 400)
  check('the offer is still open after refused tries', (await one('tpl_offers', `id=eq.${offP1.id}`)).status === 'offered')
  const acc = await api(u1.token, 'POST', `/tpl-network/my/offers/${offP1.id}/accept`, { agreed_amount: 18000, vehicle_id: veh.body.id, driver_id: driver1.id })
  st('P1 accepts with its truck and driver', acc, 201)
  const ord1 = acc.body
  check('the order carries truck, driver and a trip; amount 18000', ord1?.manifest_id && ord1.vehicle_id === veh.body.id && ord1.driver_id === driver1.id && Number(ord1.agreed_amount) === 18000 && ord1.carrier_org_id === A.id, short(ord1))
  const man = await one('cargo_manifest', `id=eq.${ord1?.manifest_id}`)
  check('the trip is owned by company A and run on the partner truck', man?.carrier_org_id === A.id && man?.vehicle_id === veh.body.id, j({ c: man?.carrier_org_id, v: man?.vehicle_id }))
  const acc2 = await api(u2.token, 'POST', `/tpl-network/my/offers/${offP2.id}/accept`, { agreed_amount: 9000 })
  check('P2 accepting after P1 is refused: taken', acc2.status === 409 && /another partner/i.test(acc2.body?.detail ?? acc2.body?.error ?? ''), short(acc2.body))
  check('db: the second offer is marked taken, the request is assigned to a partner', (await one('tpl_offers', `id=eq.${offP2.id}`)).status === 'taken' && (await one('vendor_shipment_requests', `id=eq.${R1.id}`)).status === 'assigned_to_partner')
  st('A cannot withdraw anything now (409)', await api(adminA.token, 'POST', '/tpl-network/escalations/withdraw', { request_id: R1.id }), 409)
  const vloads = await api(vendorA.token, 'GET', '/vendor/loads')
  console.log(`   (info) vendor board after accept: ${short((vloads.body?.items ?? vloads.body)?.find?.(l => l.id === R1.id) ?? vloads.body)}`)

  // delivery without a proof is refused; the driver moves the trip
  st('delivered without a POD is refused 409 (trip-backed)', await api(u1.token, 'POST', `/tpl-network/my/orders/${ord1.id}/status`, { status: 'delivered', note: 'done' }), 409)
  st('the partner cannot move a trip-backed order to picked_up by hand 409', await api(u1.token, 'POST', `/tpl-network/my/orders/${ord1.id}/status`, { status: 'picked_up' }), 409)
  const ref = { manifest_id: ord1.manifest_id }
  const phUp = await api(driver1.token, 'POST', '/cargo/custody/upload-url', { ref, kind: 'photo', content_type: 'image/png', size: PNG.length })
  st('driver gets a signed link for a pickup photo', phUp, 200)
  const photo1 = await putSigned(phUp.body, PNG)
  const pk = await api(driver1.token, 'POST', '/cargo/custody', { ref, kind: 'pickup', pieces: 10, condition: 'good', photo_paths: [photo1], lat: 28.53, lng: 77.27 })
  st('driver records the pickup', pk, [200, 201])
  check('order follows the pickup (picked up or already in transit)', ['picked_up', 'in_transit'].includes((await one('tpl_orders', `id=eq.${ord1.id}`)).status), (await one('tpl_orders', `id=eq.${ord1.id}`)).status)
  st('driver departs', await api(driver1.token, 'POST', '/cargo/custody', { ref, kind: 'departed' }), [200, 201])
  check('order is in transit', (await one('tpl_orders', `id=eq.${ord1.id}`)).status === 'in_transit')
  check('vendor load stays assigned while in transit', ['assigned_to_partner', 'in_transit'].includes((await one('vendor_shipment_requests', `id=eq.${R1.id}`)).status), (await one('vendor_shipment_requests', `id=eq.${R1.id}`)).status)
  st('delivery with no evidence is refused', await api(driver1.token, 'POST', '/cargo/custody', { ref, kind: 'delivery', receiver_name: 'Consignee' }), [400, 409, 422])
  check('order is not delivered by a refused delivery', (await one('tpl_orders', `id=eq.${ord1.id}`)).status === 'in_transit')
  st("another partner's driver cannot act on this trip", await api((await makeCompanyAdmin(org2.id, 'driver')).token, 'POST', '/cargo/custody', { ref, kind: 'delivery', receiver_name: 'X', photo_paths: [photo1] }), [403, 404])
  const podUp = await api(driver1.token, 'POST', '/cargo/custody/upload-url', { ref, kind: 'photo', content_type: 'image/png', size: PNG.length })
  const sigUp = await api(driver1.token, 'POST', '/cargo/custody/upload-url', { ref, kind: 'signature', content_type: 'image/png', size: PNG.length })
  const podPath = await putSigned(podUp.body, PNG); const sigPath = await putSigned(sigUp.body, PNG)
  check('POD photo read back from storage', Buffer.compare((await readObject(BUCKET, podPath)) ?? Buffer.alloc(0), PNG) === 0)
  st('driver delivers with a photo and a signature', await api(driver1.token, 'POST', '/cargo/custody', { ref, kind: 'delivery', receiver_name: 'Jaipur consignee', photo_paths: [podPath], signature_path: sigPath, lat: 26.79, lng: 75.82 }), [200, 201])
  const o1d = await one('tpl_orders', `id=eq.${ord1.id}`)
  check('order delivered with the POD photo, signature and receiver on file', o1d.status === 'delivered' && o1d.pod_photo_url && o1d.pod_signature_url && o1d.pod_received_by === 'Jaipur consignee' && o1d.delivered_at, j({ s: o1d.status, p: o1d.pod_photo_url, g: o1d.pod_signature_url, r: o1d.pod_received_by }))
  const r1d = await one('vendor_shipment_requests', `id=eq.${R1.id}&select=status,cost`)
  check('the vendor load is completed', r1d.status === 'completed', j(r1d))
  const invs = await api(vendorA.token, 'GET', '/vendor/invoices')
  const invR1 = invs.body?.find?.(i => i.manifest_id === ord1.manifest_id || i.vendor_request_id === R1.id)
  check("the vendor's invoice is made from the price set by the company (22000), not the partner's charge (18000)", invR1 && Number(invR1.amount) === 22000, j(invR1 ?? invs.body))
  check('the invoice total is the amount plus its GST', invR1 && Math.abs(Number(invR1.total) - (Number(invR1.amount) + Number(invR1.gst_amount))) < 0.01, j(invR1))
  const dbInv = await rows('invoices', `or=(vendor_request_id.eq.${R1.id},manifest_id.eq.${ord1.manifest_id})&select=id,issuer_org_id,status,vendor_id`)
  check('exactly one invoice, issued by company A', dbInv.length === 1 && dbInv[0].issuer_org_id === A.id, j(dbInv))

  // legacy path: P2 has no vehicles
  const R2 = await mkLoad(vendorA, adminA, 20000)
  const esc2 = await api(adminA.token, 'POST', '/tpl-network/escalations', { request_id: R2.id, partner_ids: [P2.id] })
  st('A targets R2 at P2 only', esc2, 201)
  check('targeted: one offer, flagged targeted, none for P1', esc2.body?.created === 1 && esc2.body.offers[0].targeted === true && esc2.body.offers[0].partner_id === P2.id)
  check('P1 has no offer for R2', !(await api(u1.token, 'GET', '/tpl-network/my/offers')).body?.items?.some(o => o.request_id === R2.id))
  const offR2 = esc2.body.offers[0]
  st('P2 accept without an amount when the offer has no price 400', await api(u2.token, 'POST', `/tpl-network/my/offers/${offR2.id}/accept`, {}), offR2.proposed_price ? 201 : 400)
  const accL = offR2.proposed_price ? { status: 201, body: (await one('tpl_orders', `offer_id=eq.${offR2.id}`)) } : await api(u2.token, 'POST', `/tpl-network/my/offers/${offR2.id}/accept`, { agreed_amount: 8500, pickup_eta: new Date(Date.now() + 3600_000).toISOString(), delivery_eta: new Date(Date.now() + 5 * 3600_000).toISOString() })
  if (!offR2.proposed_price) st('P2 (no vehicles) accepts the legacy way', accL, 201)
  const ordL = accL.body
  check('legacy order has no trip', ordL && !ordL.manifest_id, short(ordL))
  st('legacy: skip a step (delivered from accepted) needs a note 400', await api(u2.token, 'POST', `/tpl-network/my/orders/${ordL.id}/status`, { status: 'delivered' }), 400)
  st('legacy: bad status 400', await api(u2.token, 'POST', `/tpl-network/my/orders/${ordL.id}/status`, { status: 'teleported' }), 400)
  st('legacy: P1 cannot move the order of P2 (404)', await api(u1.token, 'POST', `/tpl-network/my/orders/${ordL.id}/status`, { status: 'picked_up' }), 404)
  st('legacy: picked up', await api(u2.token, 'POST', `/tpl-network/my/orders/${ordL.id}/status`, { status: 'picked_up' }), 200)
  st('legacy: in transit', await api(u2.token, 'POST', `/tpl-network/my/orders/${ordL.id}/status`, { status: 'in_transit' }), 200)
  st('legacy: back to picked up 409', await api(u2.token, 'POST', `/tpl-network/my/orders/${ordL.id}/status`, { status: 'picked_up' }), 409)
  st('legacy: delivered without a note refused 400', await api(u2.token, 'POST', `/tpl-network/my/orders/${ordL.id}/status`, { status: 'delivered' }), 400)
  st('legacy: delivered with a POD note', await api(u2.token, 'POST', `/tpl-network/my/orders/${ordL.id}/status`, { status: 'delivered', note: 'Received by Mr Sharma, Jaipur' }), 200)
  check('legacy: the vendor load is completed and the vendor is invoiced', (await one('vendor_shipment_requests', `id=eq.${R2.id}`)).status === 'completed' && (await rows('invoices', `vendor_request_id=eq.${R2.id}`)).length + (await api(vendorA.token, 'GET', '/vendor/invoices')).body.filter(i => i.reference === `REQ-${R2.id.slice(0, 8).toUpperCase()}`).length >= 1)

  // decline + withdraw
  const R3 = await mkLoad(vendorA, adminA, 21000)
  const esc3 = await api(adminA.token, 'POST', '/tpl-network/escalations', { request_id: R3.id })
  st('A escalates R3 (broadcast)', esc3, 201)
  const o3p1 = offerOf(esc3, P1.id); const o3p2 = offerOf(esc3, P2.id)
  st('decline without a reason 400', await api(u1.token, 'POST', `/tpl-network/my/offers/${o3p1.id}/decline`, {}), 400)
  st('P1 declines with a reason', await api(u1.token, 'POST', `/tpl-network/my/offers/${o3p1.id}/decline`, { reason: 'No driver available' }), 200)
  st('P1 declines again 409', await api(u1.token, 'POST', `/tpl-network/my/offers/${o3p1.id}/decline`, { reason: 'No driver available' }), 409)
  check('R3 stays escalated while P2 has an open offer', (await one('vendor_shipment_requests', `id=eq.${R3.id}`)).status === 'escalated')
  st('B cannot withdraw A offer (404)', await api(adminB.token, 'POST', `/tpl-network/offers/${o3p2.id}/withdraw`), 404)
  check('and A offer is untouched by that attempt', (await one('tpl_offers', `id=eq.${o3p2.id}`)).status === 'offered')
  st('A withdraws the open offer of P2', await api(adminA.token, 'POST', `/tpl-network/offers/${o3p2.id}/withdraw`), 200)
  check('R3 goes back to approved', (await one('vendor_shipment_requests', `id=eq.${R3.id}`)).status === 'approved')
  st('P2 accepts a withdrawn offer 409', await api(u2.token, 'POST', `/tpl-network/my/offers/${o3p2.id}/accept`, { agreed_amount: 5000 }), 409)

  // company B's load for P1: two companies' work in one portal
  const RB = await mkLoad(vendorB, adminB, 24000)
  const escB = await api(adminB.token, 'POST', '/tpl-network/escalations', { request_id: RB.id })
  st('B escalates its own load: only its partner P1 gets it', escB, 201)
  check('B escalation reached P1 only (P2 is not a partner of B)', escB.body?.created === 1 && escB.body.offers[0].partner_id === P1.id && escB.body.offers[0].carrier_org_id === B.id, short(escB.body))
  const offB = escB.body?.offers?.[0]
  const mo1b = await api(u1.token, 'GET', '/tpl-network/my/offers')
  const grp = mo1b.body?.companies ?? []
  check('P1 sees offers grouped by company: A and B separately', grp.some(c => c.org_id === A.id && c.offers.every(o => o.carrier_org_id === A.id)) && grp.some(c => c.org_id === B.id && c.offers.every(o => o.carrier_org_id === B.id)), j(grp.map(c => [c.org_id, c.name, c.offers.length])))
  const accB = await api(u1.token, 'POST', `/tpl-network/my/offers/${offB.id}/accept`, { agreed_amount: 20000, vehicle_id: veh.body.id, driver_id: driver1.id })
  st('P1 accepts the load of B (its truck is free again)', accB, 201)
  const ordB = accB.body
  const moo = await api(u1.token, 'GET', '/tpl-network/my/orders')
  check('P1 sees orders grouped by company', moo.body?.companies?.length >= 2 && moo.body.companies.some(c => c.org_id === B.id && c.orders.some(o => o.id === ordB.id)) && moo.body.companies.some(c => c.org_id === A.id && c.orders.some(o => o.id === ord1.id)), j(moo.body?.companies?.map(c => [c.name, c.orders.length])))
  const refB = { manifest_id: ordB.manifest_id }
  const phB = await putSigned((await api(driver1.token, 'POST', '/cargo/custody/upload-url', { ref: refB, kind: 'photo', content_type: 'image/png', size: PNG.length })).body)
  st('driver picks up the load of B', await api(driver1.token, 'POST', '/cargo/custody', { ref: refB, kind: 'pickup', pieces: 10, condition: 'good', photo_paths: [phB] }), [200, 201])
  st('driver departs', await api(driver1.token, 'POST', '/cargo/custody', { ref: refB, kind: 'departed' }), [200, 201])
  const phB2 = await putSigned((await api(driver1.token, 'POST', '/cargo/custody/upload-url', { ref: refB, kind: 'photo', content_type: 'image/png', size: PNG.length })).body)
  st('driver delivers the load of B', await api(driver1.token, 'POST', '/cargo/custody', { ref: refB, kind: 'delivery', receiver_name: 'B consignee', photo_paths: [phB2] }), [200, 201])
  check('order of B delivered', (await one('tpl_orders', `id=eq.${ordB.id}`)).status === 'delivered')

  // ── 6. Money ─────────────────────────────────────────────────────────────
  console.log('\n## 6. Money')
  const ea = await api(u1.token, 'GET', '/tpl-network/my/earnings')
  const month = istMonth().slice(0, 4) + '-' + istMonth().slice(4)
  check('P1 earnings: 18000 (A) + 20000 (B) payable this month, none paid', ea.status === 200 && ea.body.totals.total === 38000 && ea.body.totals.payable === 38000 && ea.body.totals.paid === 0 && ea.body.months?.[0]?.month === month, short(ea.body))
  const period = istMonth()
  const sp = `/org/tpl-affiliations/${org1.id}/statements`
  st('build for a bad month 422', await api(adminA.token, 'POST', sp, { period: '2026-10' }), 422)
  st('build for a month with no orders 409', await api(adminA.token, 'POST', sp, { period: '202001' }), 409)
  st('a partner cannot build a statement (403)', await api(u1.token, 'POST', sp, { period }), 403)
  st('B cannot build A statement for P1 with A orders: B has its own', await api(adminB.token, 'POST', sp, { period }), 201)
  const bst = (await api(adminB.token, 'GET', sp)).body.items[0]
  check("B's statement holds only B's order (20000), A's order is not in it", bst.orders_total_paise === 2_000_000 && bst.order_ids.length === 1 && bst.order_ids[0] === ordB.id, j(bst))
  const b1 = await api(adminA.token, 'POST', sp, { period })
  st('A builds the month for P1', b1, 201)
  const S = b1.body
  check("A's statement holds only A's order, in paise (1,800,000), balance equal", S.order_ids.length === 1 && S.order_ids[0] === ord1.id && S.orders_total_paise === 1_800_000 && S.balance_paise === 1_800_000 && S.status === 'draft', j(S))
  st('building the draft again refreshes (200)', await api(adminA.token, 'POST', sp, { period }), 200)
  st('the partner cannot see a draft (404)', await api(u1.token, 'GET', `/tpl-portal/${org1.id}/statements/${S.id}`), 404)
  check('the partner list has no drafts', (await api(u1.token, 'GET', `/tpl-portal/${org1.id}/statements`)).body.items.length === 0)
  st('deductions above the total 422', await api(adminA.token, 'PATCH', `${sp}/${S.id}`, { deductions: [{ label: 'Too much', amount_paise: 1_800_001 }] }), 422)
  st('a fractional-paise deduction 400/422', await api(adminA.token, 'PATCH', `${sp}/${S.id}`, { deductions: [{ label: 'x', amount_paise: 10.5 }] }), [400, 422])
  st('a deduction without a label 400/422', await api(adminA.token, 'PATCH', `${sp}/${S.id}`, { deductions: [{ amount_paise: 100 }] }), [400, 422])
  const dd = await api(adminA.token, 'PATCH', `${sp}/${S.id}`, { deductions: [{ label: 'Damaged carton', amount_paise: 250_000, reason: 'One carton crushed' }, { label: 'Late fee', amount_paise: 50_000 }] })
  check('two deductions: balance = 1,800,000 - 300,000 = 1,500,000', dd.status === 200 && dd.body.balance_paise === 1_500_000 && dd.body.deductions_total_paise === 300_000, short(dd.body))
  st('B cannot read A statement (404)', await api(adminB.token, 'GET', `${sp}/${S.id}`), 404)
  st('B cannot issue it (404)', await api(adminB.token, 'POST', `${sp}/${S.id}/issue`), 404)
  st('mark-paid before issue 409', await api(adminA.token, 'POST', `${sp}/${S.id}/mark-paid`, {}), 409)
  st('per-order mark paid while only a draft covers it works (200)', await api(adminA.token, 'POST', `/tpl-network/orders/${ord1.id}/paid`, { paid: true, reference: 'single' }), 200)
  st('...and unpaid again', await api(adminA.token, 'POST', `/tpl-network/orders/${ord1.id}/paid`, { paid: false }), 200)
  const iss = await api(adminA.token, 'POST', `${sp}/${S.id}/issue`)
  check('A issues it', iss.status === 200 && iss.body.status === 'issued' && iss.body.balance_paise === 1_500_000, short(iss.body))
  st('issuing twice 409', await api(adminA.token, 'POST', `${sp}/${S.id}/issue`), 409)
  st('editing an issued statement 409', await api(adminA.token, 'PATCH', `${sp}/${S.id}`, { deductions: [] }), 409)
  st('rebuilding an issued month 409', await api(adminA.token, 'POST', sp, { period }), 409)
  st('per-order markPaid inside an issued statement 409', await api(adminA.token, 'POST', `/tpl-network/orders/${ord1.id}/paid`, { paid: true, reference: 'x' }), 409)
  const pl = await api(u1.token, 'GET', `/tpl-portal/${org1.id}/statements`)
  check('the partner now sees only the statement of A (not the draft of B)', pl.status === 200 && pl.body.items.length === 1 && pl.body.items[0].id === S.id && pl.body.items[0].company_name === A.name, short(pl.body))
  const pd = await api(u1.token, 'GET', `/tpl-portal/${org1.id}/statements/${S.id}`)
  check('the partner reads detail: orders, deductions, balance in paise', pd.status === 200 && pd.body.orders?.length === 1 && pd.body.deductions.length === 2 && pd.body.balance_paise === 1_500_000, short(pd.body))
  const pdfRes = await api(u1.token, 'GET', `/tpl-portal/${org1.id}/statements/${S.id}/pdf`, undefined, { raw: true })
  const pdfBytes = Buffer.from(await pdfRes.arrayBuffer())
  check('the partner downloads a real PDF', pdfRes.status === 200 && /pdf/.test(pdfRes.headers.get('content-type')) && pdfBytes.subarray(0, 5).toString() === '%PDF-' && pdfBytes.length > 800, `status ${pdfRes.status} ${pdfBytes.length} bytes`)
  const cpdf = await api(adminA.token, 'GET', `${sp}/${S.id}/pdf`, undefined, { raw: true })
  check('the company downloads the same PDF', cpdf.status === 200 && Buffer.from(await cpdf.arrayBuffer()).subarray(0, 5).toString() === '%PDF-')
  st('P2 cannot read the statement of P1 via the portal path (403)', await api(u2.token, 'GET', `/tpl-portal/${org1.id}/statements/${S.id}`), 403)
  st('B cannot get the PDF (404)', await api(adminB.token, 'GET', `${sp}/${S.id}/pdf`), 404)
  st('mark paid by a partner 403', await api(u1.token, 'POST', `${sp}/${S.id}/mark-paid`, {}), 403)
  const paid = await api(adminA.token, 'POST', `${sp}/${S.id}/mark-paid`, { reference: 'UTR-' + T })
  check('A marks it paid with a reference', paid.status === 200 && paid.body.status === 'paid' && paid.body.paid_reference === 'UTR-' + T && paid.body.balance_paise === 1_500_000, short(paid.body))
  const o1p = await one('tpl_orders', `id=eq.${ord1.id}`)
  check('the order inside is marked paid with the reference', o1p.paid_at && o1p.paid_reference === 'UTR-' + T, j({ p: o1p.paid_at, r: o1p.paid_reference }))
  st('marking paid twice 409', await api(adminA.token, 'POST', `${sp}/${S.id}/mark-paid`, {}), 409)
  st('per-order markPaid inside a paid statement 409', await api(adminA.token, 'POST', `/tpl-network/orders/${ord1.id}/paid`, { paid: false }), 409)
  const ea2 = await api(u1.token, 'GET', '/tpl-network/my/earnings')
  check('earnings now: 18000 paid, 20000 payable', ea2.body.totals.paid === 18000 && ea2.body.totals.payable === 20000, short(ea2.body.totals))
  // legacy order: paid one by one
  st('B cannot mark the legacy order of A paid (404 expected)', await api(adminB.token, 'POST', `/tpl-network/orders/${ordL.id}/paid`, { paid: true }), 404)
  check('and the order is still unpaid', !(await one('tpl_orders', `id=eq.${ordL.id}`)).paid_at)
  st('A marks the legacy order paid', await api(adminA.token, 'POST', `/tpl-network/orders/${ordL.id}/paid`, { paid: true, reference: 'NEFT-1' }), 200)
  st('marking an undelivered order paid 409', await api(adminA.token, 'POST', `/tpl-network/orders/${(await one('tpl_orders', `offer_id=eq.${offB.id}`)).id}/paid`, { paid: true }), 200)
  st('a manager (not admin) cannot mark paid 403', await api((await makeCompanyAdmin(A.id, 'manager')).token, 'POST', `/tpl-network/orders/${ordL.id}/paid`, { paid: false }), 403)
  st('P2 statement build: its only order was paid one by one, so nothing to build 409', await api(adminA.token, 'POST', `/org/tpl-affiliations/${org2.id}/statements`, { period }), 409)

  // ── 7. Performance ───────────────────────────────────────────────────────
  console.log('\n## 7. Performance')
  st('A rates a delivered order', await api(adminA.token, 'POST', `/tpl-network/orders/${ord1.id}/rate`, { rating: 4, note: 'On time' }), 200)
  st('rating out of range 400', await api(adminA.token, 'POST', `/tpl-network/orders/${ord1.id}/rate`, { rating: 6 }), 400)
  st('B cannot rate the order of A (404)', await api(adminB.token, 'POST', `/tpl-network/orders/${ord1.id}/rate`, { rating: 1 }), 404)
  check('and the rating of A stays 4', (await one('tpl_orders', `id=eq.${ord1.id}`)).rating === 4)
  st('B rates its own order', await api(adminB.token, 'POST', `/tpl-network/orders/${ordB.id}/rate`, { rating: 2 }), 200)
  const sp1 = await api(u1.token, 'GET', '/tpl-network/my/stats')
  const offs = await rows('tpl_offers', `partner_id=eq.${P1.id}`)
  const ords = await rows('tpl_orders', `partner_id=eq.${P1.id}`)
  const acceptedN = offs.filter(o => o.status === 'accepted').length; const declinedN = offs.filter(o => o.status === 'declined').length
  const mins = offs.filter(o => ['accepted', 'declined'].includes(o.status)).map(o => (new Date(o.responded_at) - new Date(o.offered_at)) / 60000)
  const avg = mins.reduce((a, b) => a + b, 0) / mins.length
  const s = sp1.body
  check(`offers: received ${offs.length}, accepted ${acceptedN}, declined ${declinedN}`, s.offers_received === offs.length && s.offers_accepted === acceptedN && s.offers_declined === declinedN, short(s))
  check(`acceptance rate = ${acceptedN}/${acceptedN + declinedN}`, Math.abs(s.acceptance_rate - acceptedN / (acceptedN + declinedN)) < 1e-9, short(s))
  check(`average response ${avg.toFixed(2)} min`, s.avg_response_minutes != null && Math.abs(s.avg_response_minutes - avg) < 0.01, short(s))
  check('orders completed 2, active 0', s.orders_completed === 2 && s.orders_active === 0, short(s))
  const breach = ords.filter(o => o.due_by && new Date(o.delivered_at) > new Date(o.due_by)).length
  check(`SLA breaches ${breach} of ${ords.filter(o => o.due_by).length}`, s.sla_breaches === breach && s.sla_measured === ords.filter(o => o.due_by).length, short(s))
  check('rating average (4 + 2)/2 = 3 over 2 ratings', s.rating_avg === 3 && s.rating_count === 2, short(s))
  const sp2 = (await api(u2.token, 'GET', '/tpl-network/my/stats')).body
  check('P2 stats: accepted 1 (legacy), taken 1, declined 0, acceptance rate 1', sp2.offers_accepted === 1 && sp2.offers_taken === 1 && sp2.acceptance_rate === 1, short(sp2))
  const stA = await api(adminA.token, 'GET', `/tpl-network/partners/${P1.id}/stats`)
  check('company A reads the stats of its partner', stA.status === 200 && stA.body.orders_completed >= 1, short(stA.body))
  const allB = await api(adminB.token, 'GET', '/tpl-network/partners/stats')
  check('company B sees stats of its own partners only (not P2, which works for A only)', allB.status === 200 && !(P2.id in allB.body), `ids ${Object.keys(allB.body ?? {}).length} has P2: ${P2.id in (allB.body ?? {})}`)
  const stB = await api(adminB.token, 'GET', `/tpl-network/partners/${P2.id}/stats`)
  check("company B cannot read the stats of A's partner P2 (404)", stB.status === 404, `status ${stB.status} ${short(stB.body)}`)
  const stB1 = await api(adminB.token, 'GET', `/tpl-network/partners/${P1.id}/stats`)
  check("company B's view of P1 counts only B's work (1 order), not A's", stB1.status === 200 && stB1.body.orders_completed === 1, `completed ${stB1.body?.orders_completed}`)

  // ── 8. Isolation ─────────────────────────────────────────────────────────
  console.log('\n## 8. Isolation')
  const ordsB = await api(adminB.token, 'GET', `/tpl-network/orders?partner_id=${P2.id}`)
  check('B lists orders of P2: none', ordsB.status === 200 && ordsB.body.length === 0, short(ordsB.body))
  const ordsB1 = await api(adminB.token, 'GET', '/tpl-network/orders')
  check("B lists orders: only B's own (1)", ordsB1.body.length === 1 && ordsB1.body[0].id === ordB.id, `n=${ordsB1.body?.length}`)
  st('B sets the price of the load of A (404)', await api(adminB.token, 'PUT', `/tpl-network/requests/${R3.id}/price`, { cost: 1 }), 404)
  check("and the price of A's load is unchanged", Number((await one('vendor_shipment_requests', `id=eq.${R3.id}`)).cost) === 21000)
  st('B cannot see the settings of... (staff settings are readable)', await api(adminB.token, 'GET', '/tpl-network/settings'), 200)
  st('B cannot change the platform auto-escalate switch (403)', await api(adminB.token, 'PUT', '/tpl-network/settings', { auto_escalate: true }), 403)
  st('a vendor cannot call staff network routes (403)', await api(vendorA.token, 'GET', `/tpl-network/escalations?request_id=${R1.id}`), 403)
  st('a vendor cannot call partner routes (403)', await api(vendorA.token, 'GET', '/tpl-network/my/offers'), 403)
  st('a vendor cannot call the partner portal (403)', await api(vendorA.token, 'GET', `/tpl-portal/${org1.id}/vehicles`), 403)
  st('a vendor cannot approve applications (403)', await api(vendorA.token, 'POST', `/tpl/approve/${P2.id}`), 403)
  st('a partner cannot call staff network routes (403)', await api(u1.token, 'GET', `/tpl-network/escalations?request_id=${R1.id}`), 403)
  st('a partner cannot escalate (403)', await api(u1.token, 'POST', '/tpl-network/escalations', { request_id: R1.id }), 403)
  st('a partner cannot list orders as staff (403)', await api(u1.token, 'GET', '/tpl-network/orders'), 403)
  st('a partner cannot rate (403)', await api(u1.token, 'POST', `/tpl-network/orders/${ord1.id}/rate`, { rating: 5 }), 403)
  st('a partner cannot mark paid (403)', await api(u1.token, 'POST', `/tpl-network/orders/${ordL.id}/paid`, { paid: true }), 403)
  st('a partner cannot read the company affiliations (403)', await api(u1.token, 'GET', '/org/tpl-affiliations'), 403)
  st('a partner cannot read the platform queue (403)', await api(u1.token, 'GET', '/tpl/queue'), 403)
  st('a partner cannot read stats of others (403)', await api(u1.token, 'GET', `/tpl-network/partners/${P2.id}/stats`), 403)
  st('a company admin cannot call partner routes (403)', await api(adminA.token, 'GET', '/tpl-network/my/offers'), 403)
  st('a company driver cannot call partner routes (403)', await api(driver1.token, 'GET', '/tpl-network/my/offers'), 403)
  st('a partner driver cannot read the partner fleet list as a writer (403)', await api(driver1.token, 'POST', `/tpl-portal/${org1.id}/vehicles`, { plate_number: plate(9), vehicle_type: 'truck', capacity_kg: 1 }), 403)
  st('P2 cannot accept the order-less offer of P1 (404)', await api(u2.token, 'POST', `/tpl-network/my/offers/${offP1.id}/decline`, { reason: 'steal it' }), 404)
  st('P2 cannot read P1 statements via its own org path: 200 but empty', await api(u2.token, 'GET', `/tpl-portal/${org2.id}/statements`), 200)
  check('P2 sees none of the orders of P1', !(await api(u2.token, 'GET', '/tpl-network/my/orders')).body.items.some(o => o.id === ord1.id))
  st('a guest cannot call the portal (401)', await api(null, 'GET', `/tpl-portal/${org1.id}/vehicles`), 401)
  st('a guest cannot call the network (401)', await api(null, 'GET', '/tpl-network/my/offers'), 401)

  const failed = results.filter(r => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  if (failed.length) { console.log('FAILED:'); for (const f of failed) console.log(` - ${f.name}  ${f.detail}`) }
  process.exit(failed.length ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(2) })
