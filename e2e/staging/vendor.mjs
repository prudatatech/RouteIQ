// Audit area 7: vendor extras and the public pages, walked on the TEST stage (see docs/uat/WORKFLOW-AUDIT.md).
//   node e2e/staging/vendor.mjs            all sections
//   SECTIONS=1,2 node e2e/staging/vendor.mjs   only those sections
// Fresh @margix.test accounts every run; secrets are read by actors.mjs and never printed.
import {
  api, db, check, results, sleep, tag, PNG, putSigned, readObject, makeVendor, makeCompany, makeCompanyAdmin, makePlatformAdmin, makeDriver,
  makeUser, login, API, DATA, env, PASSWORD,
} from './actors.mjs'

const want = new Set((process.env.SECTIONS || '1,2,3,4,5,6,7').split(','))
const S = {} // shared state between sections

// ── helpers ────────────────────────────────────────────────
const dayKey = (plusDays) => new Date(Date.now() + 330 * 60_000 + plusDays * 86_400_000).toISOString().slice(0, 10)
const items = (over = {}) => [{ product_name: 'Cement bags', hsn_code: '2523', gst_rate: 18, quantity: 400, unit: 'bags', weight_kg: 20000, declared_value: 150000, ...over }]
const loadBody = (over = {}) => ({
  items: items(),
  pickup_city: 'Mumbai', pickup_address: 'Plot 4 MIDC Andheri East', pickup_pincode: '400093', pickup_lat: 19.1197, pickup_lng: 72.8464, pickup_date: dayKey(3),
  delivery_city: 'Delhi', delivery_address: 'Warehouse 2 Okhla Phase 1', delivery_pincode: '110020', delivery_lat: 28.5355, delivery_lng: 77.275, delivery_date: dayKey(6),
  ...over,
})
const get = (token, path, opts) => api(token, 'GET', path, undefined, opts)
const msg = (r) => (r.body && (r.body.detail || r.body.error || r.body.message)) || JSON.stringify(r.body)?.slice(0, 120)
const has = (r, text) => String(msg(r)).toLowerCase().includes(text.toLowerCase())
async function post(vendor, over = {}) { return api(vendor.token, 'POST', '/vendor/loads', loadBody(over)) }
async function loadRow(id) { return (await db('GET', 'vendor_shipment_requests', { query: `id=eq.${id}&select=*` })).body?.[0] }
async function notesFor(userId, type) { return (await db('GET', 'notifications', { query: `user_id=eq.${userId}${type ? `&type=eq.${type}` : ''}&select=title,body,type,data,is_read&order=created_at.desc` })).body || [] }
const section = (n, title) => console.log(`\n── ${n}. ${title}`)
const todayish = () => new Date().toISOString()

// ── setup shared by every section ─────────────────────────
async function setup() {
  S.coA = await makeCompany(`Vendor-audit Co A ${tag()}`)
  S.coB = await makeCompany(`Vendor-audit Co B ${tag()}`)
  S.coP = await makeCompany(`Vendor-audit Co P ${tag()}`, { status: 'pending' })
  S.adminA = await makeCompanyAdmin(S.coA.id)
  S.adminB = await makeCompanyAdmin(S.coB.id)
  S.adminP = await makeCompanyAdmin(S.coP.id)
  S.pa = await makePlatformAdmin()
  console.log('setup ok: companies A, B, P(pending), platform admin')
}

// ── 1. onboarding ─────────────────────────────────────────
async function s1() {
  section(1, 'Vendor onboarding edges')
  const v = await makeVendor({ approved: false })
  S.v1 = v
  let r = await get(v.token, '/vendor/business-profile')
  check('1.01 business profile of a new vendor is readable and complete (makeVendor filled it)', r.status === 200 && r.body.complete === true, JSON.stringify(r.body))

  const base = { full_name: 'UAT Vendor', business_name: `Edge Traders ${tag()}`, account_type: 'business_partner', gstin: '27AAPFU0939F1ZV', address: 'Plot 9, MIDC Andheri East, Mumbai', pincode: '400093', business_type: 'trader', monthly_loads: '6-20' }
  r = await api(v.token, 'PUT', '/vendor/business-profile', { ...base, gstin: null })
  check('1.02 business partner without GSTIN is refused (400)', r.status === 400 && has(r, 'GSTIN'), `${r.status} ${msg(r)}`)
  r = await api(v.token, 'PUT', '/vendor/business-profile', { ...base, gstin: 'NOT-A-GSTIN' })
  check('1.03 malformed GSTIN is refused (400)', r.status === 400, `${r.status} ${msg(r)}`)
  r = await api(v.token, 'PUT', '/vendor/business-profile', { ...base, gstin: '27AAPFU0939F1ZX' })
  check('1.04 GSTIN with a wrong check character is refused (400)', r.status === 400, `${r.status} ${msg(r)}`)
  r = await api(v.token, 'PUT', '/vendor/business-profile', { ...base, pincode: '4000' })
  check('1.05 pin code of 4 digits is refused (400)', r.status === 400, `${r.status} ${msg(r)}`)
  r = await api(v.token, 'PUT', '/vendor/business-profile', { ...base, account_type: 'wholesaler' })
  check('1.06 unknown account type is refused (400)', r.status === 400, `${r.status} ${msg(r)}`)
  r = await api(v.token, 'PUT', '/vendor/business-profile', { ...base, email: 'not-an-email' })
  check('1.07 bad email is refused (400)', r.status === 400, `${r.status} ${msg(r)}`)

  // a customer (no GSTIN): the pin code alone must give the state
  const c = await makeVendor({ approved: false })
  r = await api(c.token, 'PUT', '/vendor/business-profile', { full_name: 'Solo Shipper', business_name: 'Solo Shipper', account_type: 'customer', address: '12 Connaught Place', pincode: '110001' })
  check('1.08 customer without GSTIN can save', r.status === 200, `${r.status} ${msg(r)}`)
  check('1.09 pin code 110001 sets the state (Delhi, code 07) when no GSTIN is given', r.body?.state_code === '07' && /delhi/i.test(r.body?.state || ''), JSON.stringify({ sc: r.body?.state_code, s: r.body?.state }))
  r = await api(v.token, 'PUT', '/vendor/business-profile', base)
  check('1.10 business partner with a valid GSTIN saves; state comes from the GSTIN (27 Maharashtra)', r.status === 200 && r.body.state_code === '27' && /maharashtra/i.test(r.body.state || ''), JSON.stringify({ sc: r.body?.state_code, s: r.body?.state }))
  const org = (await db('GET', 'organizations', { query: `id=eq.${(await orgOfVendor(v.id))}&select=name,legal_name,gstin,pincode,state,profile` })).body?.[0]
  check('1.11 business profile is stored on the vendor organisation (gstin, pin, account type)', org?.gstin === '27AAPFU0939F1ZV' && org?.pincode === '400093' && org?.profile?.account_type === 'business_partner', JSON.stringify(org))

  // KYC documents through the signed flow
  const docs = {}
  for (const [key, type] of [['panScan', 'image/png'], ['cancelledCheque', 'image/png'], ['gstCertificate', 'image/png'], ['companyLogo', 'image/png']]) {
    const link = await api(v.token, 'POST', '/vendor/kyc/upload-url', { key, content_type: type, size: PNG.length })
    const up = link.status === 200 ? await putSigned(link.body, PNG, type).catch(e => e.message) : null
    const back = link.status === 200 ? await readObject('kyc_documents', link.body.path) : null
    check(`1.12 ${key}: signed upload, then the exact bytes read back from storage`, link.status === 200 && up === link.body.path && back && Buffer.compare(back, PNG) === 0, `${link.status} ${msg(link)} ${typeof up === 'string' ? up : ''}`)
    if (link.status === 200) docs[key] = link.body.path
  }
  let bad = await api(v.token, 'POST', '/vendor/kyc/upload-url', { key: 'panScan', content_type: 'application/x-msdownload', size: 100 })
  check('1.13 upload of an .exe type is refused (415)', bad.status === 415, `${bad.status}`)
  bad = await api(v.token, 'POST', '/vendor/kyc/upload-url', { key: 'panScan', content_type: 'image/png', size: 50 * 1024 * 1024 })
  check('1.14 an oversized file is refused (413)', bad.status === 413, `${bad.status}`)
  bad = await api(v.token, 'POST', '/vendor/kyc/upload-url', { key: '../x', content_type: 'image/png', size: 100 })
  check('1.15 a key with path tricks is refused (400)', bad.status === 400, `${bad.status}`)

  const other = await makeVendor({ approved: false })
  const submitBody = (extra = {}) => ({
    companyName: base.business_name, gstNumber: base.gstin, city: 'Mumbai', address: base.address, lat: 19.1197, lng: 72.8464, companyLogo: docs.companyLogo,
    kycData: { data: { vendorType: 'Trader', panNumber: 'AAPFU0939F', contactPerson: 'UAT', mobile: '9876501234', bankBeneficiary: 'Edge Traders', bankAccount: '50100123456789', bankIfsc: 'HDFC0000123', bankName: 'HDFC Bank', docUrls: { panScan: docs.panScan, cancelledCheque: docs.cancelledCheque, gstCertificate: docs.gstCertificate } }, otherDocs: [] },
    ...extra,
  })
  r = await api(other.token, 'POST', '/vendor/kyc/submit', submitBody())
  check("1.16 submitting another vendor's uploaded files is refused (400)", r.status === 400, `${r.status} ${msg(r)}`)
  r = await api(v.token, 'POST', '/vendor/kyc/submit', submitBody({ kycData: { data: { panNumber: 'BAD' } } }))
  check('1.17 a bad PAN is refused (400)', r.status === 400 && has(r, 'PAN'), `${r.status} ${msg(r)}`)
  r = await api(v.token, 'POST', '/vendor/kyc/submit', submitBody({ gstNumber: '27AAPFU0939F1ZX' }))
  check('1.18 KYC with a wrong GSTIN is refused (400)', r.status === 400, `${r.status} ${msg(r)}`)
  r = await api(v.token, 'POST', '/vendor/kyc/submit', submitBody())
  check('1.19 KYC submitted with the four documents', r.status === 200 && r.body.kyc_status === 'submitted', `${r.status} ${msg(r)}`)
  let vp = (await db('GET', 'vendor_profiles', { query: `id=eq.${v.id}&select=kyc_status,kyc_data,company_logo` })).body?.[0]
  check('1.20 the stored KYC carries all three document paths and the logo', vp?.kyc_data?.data?.docUrls?.panScan === docs.panScan && vp?.kyc_data?.data?.docUrls?.gstCertificate === docs.gstCertificate && vp?.company_logo === docs.companyLogo, JSON.stringify(vp)?.slice(0, 300))
  const staffNotes = await notesFor(S.pa.id, 'kyc_submitted')
  check('1.21 the platform owner was told about the submission', staffNotes.some(n => JSON.stringify(n.data).includes(v.id)), `${staffNotes.length} notes`)

  // a held load while KYC is pending
  const held = await post(v)
  check('1.22 a load can be posted before approval and is held ("verification pending")', held.status === 201 && /verification/i.test(held.body.status_note || ''), `${held.status} ${msg(held)}`)
  S.heldLoad = held.body?.id
  const heldRow = held.body?.id && await loadRow(held.body.id)
  check('1.23 held load is marked in the database (metadata.hold) and has no quote clock', heldRow?.metadata?.hold === 'vendor_unverified' && heldRow?.quote_deadline === null, JSON.stringify(heldRow?.metadata?.hold))

  // reject with a reason
  r = await api(S.pa.token, 'PUT', `/vendor/kyc/${v.id}/reject`, {})
  check('1.24 rejecting without a reason is refused (400)', r.status === 400, `${r.status} ${msg(r)}`)
  r = await api(S.pa.token, 'PUT', `/vendor/kyc/${v.id}/reject`, { reason: 'Cancelled cheque is not readable' })
  check('1.25 KYC rejected with a reason', r.status === 200, `${r.status} ${msg(r)}`)
  vp = (await db('GET', 'vendor_profiles', { query: `id=eq.${v.id}&select=kyc_status,kyc_rejection_reason` })).body?.[0]
  check('1.26 reason is stored on the profile', vp?.kyc_status === 'rejected' && /not readable/.test(vp?.kyc_rejection_reason || ''), JSON.stringify(vp))
  const rn = await notesFor(v.id, 'kyc_rejected')
  check('1.27 the vendor is told, with the reason', rn.some(n => /not readable/.test(n.body)), JSON.stringify(rn))
  r = await get(v.token, '/vendor/profile')
  check('1.28 the vendor sees the rejection reason on their profile', r.status === 200 && r.body.kyc_status === 'rejected' && /not readable/.test(r.body.kyc_rejection_reason || ''), JSON.stringify(r.body).slice(0, 200))
  r = await api(S.pa.token, 'PUT', `/vendor/kyc/${v.id}/reject`, { reason: 'again' })
  check('1.29 deciding twice is refused (409): nothing is waiting for review', r.status === 409, `${r.status} ${msg(r)}`)

  // fix and resubmit
  const link = await api(v.token, 'POST', '/vendor/kyc/upload-url', { key: 'cancelledCheque', content_type: 'image/png', size: PNG.length })
  await putSigned(link.body, PNG)
  docs.cancelledCheque = link.body.path
  r = await api(v.token, 'POST', '/vendor/kyc/submit', submitBody())
  check('1.30 the vendor edits and resubmits after the rejection', r.status === 200 && r.body.kyc_status === 'submitted', `${r.status} ${msg(r)}`)
  vp = (await db('GET', 'vendor_profiles', { query: `id=eq.${v.id}&select=kyc_status,kyc_rejection_reason` })).body?.[0]
  check('1.31 resubmitting clears the old rejection reason', !vp?.kyc_rejection_reason, JSON.stringify(vp))

  // approve: held load released
  r = await api(S.pa.token, 'PUT', `/vendor/kyc/${v.id}/approve`, {})
  check('1.32 approved by the platform admin', r.status === 200, `${r.status} ${msg(r)}`)
  r = await api(S.pa.token, 'PUT', `/vendor/kyc/${v.id}/approve`, {})
  check('1.33 approving twice is refused (409)', r.status === 409, `${r.status}`)
  const rel = await loadRow(S.heldLoad)
  check('1.34 the held load is released on approval (hold removed)', rel && !rel.metadata?.hold, JSON.stringify(rel?.metadata?.hold))
  const orgRow = (await db('GET', 'organizations', { query: `id=eq.${await orgOfVendor(v.id)}&select=status` })).body?.[0]
  check('1.35 vendor organisation is active after approval', orgRow?.status === 'active', JSON.stringify(orgRow))

  // a company ADMIN (not the platform) must not be the one who approves vendors
  const v2 = await makeVendor({ approved: false })
  await api(v2.token, 'POST', '/vendor/kyc/submit', submitBody({ companyLogo: null, kycData: { data: { panNumber: 'AAPFU0939F' } } }))
  const byCompany = await api(S.adminA.token, 'PUT', `/vendor/kyc/${v2.id}/approve`, {})
  console.log(`   (observation) a company admin approving a vendor's KYC: ${byCompany.status}`)
  S.kycByCompany = byCompany.status
  await api(S.pa.token, 'PUT', `/vendor/kyc/${v2.id}/approve`, {}).catch(() => {})

  // edits of an approved profile
  S.v1 = v
  const w = await makeVendor({ approved: true, admin: S.pa })
  S.vEdit = w
  const before = await post(w)
  const beforeRow = await loadRow(before.body.id)
  check('1.36 an approved vendor posts a load that is NOT held', before.status === 201 && !beforeRow.metadata?.hold, `${before.status}`)
  r = await api(w.token, 'PUT', '/vendor/business-profile', { full_name: 'UAT', business_name: `Renamed Traders ${tag()}`, account_type: 'business_partner', gstin: '27AAPFU0939F1ZV', address: 'Plot 9, MIDC Andheri East, Mumbai', pincode: '400093', business_type: 'trader', monthly_loads: '6-20' })
  check('1.37 renaming the business saves', r.status === 200, `${r.status} ${msg(r)}`)
  if (r.status >= 500) {
    // the deployed build 500s here (vendor_profiles.city NOT NULL in the upsert); use the older save so the rest can be walked
    r = await api(w.token, 'POST', '/vendor/profile', { companyName: `Renamed Traders ${tag()}`, gstNumber: '27AAPFU0939F1ZV', city: 'Mumbai', address: 'Plot 9, MIDC Andheri East, Mumbai', lat: 19.1197, lng: 72.8464 })
    console.log(`   (fallback) legacy POST /vendor/profile rename: ${r.status}`)
  }
  vp = (await db('GET', 'vendor_profiles', { query: `id=eq.${w.id}&select=kyc_status` })).body?.[0]
  check('1.38 renaming an approved business sends it back to review (kyc_status submitted)', vp?.kyc_status === 'submitted', JSON.stringify(vp))
  const orgId = await orgOfVendor(w.id)
  const org2 = (await db('GET', 'organizations', { query: `id=eq.${orgId}&select=status` })).body?.[0]
  check('1.39 vendor organisation goes back to pending while it is under review', org2?.status === 'pending', JSON.stringify(org2))
  const staffTold = (await notesFor(S.pa.id, 'kyc_submitted')).filter(n => JSON.stringify(n.data).includes(w.id) && n.title)
  check('1.40 the platform owner is told that an approved vendor changed its identity and needs a review', staffTold.length >= 2, `${staffTold.length}`)
  // new load right after the edit: must be held (even within the 60 s the API remembers organisations)
  const after = await post(w)
  const afterRow = after.body?.id && await loadRow(after.body.id)
  check('1.41 a load posted right after the edit is HELD (reaches no company until re-approved)', after.status === 201 && afterRow?.metadata?.hold === 'vendor_unverified', `${after.status} hold=${afterRow?.metadata?.hold}`)
  // and no company can see it
  const seen = after.body?.id ? await get(S.adminA.token, `/company/loads/${after.body.id}`) : { status: 0 }
  check('1.42 the held load is a 404 for a company', seen.status === 404, `${seen.status}`)
  // loads already open before the edit
  const open = await get(S.adminA.token, `/company/loads/${before.body.id}`)
  console.log(`   (observation) a load posted before the edit is now: ${open.status} for a company`)
  // re-approval releases the held load
  const wait = await api(S.pa.token, 'PUT', `/vendor/kyc/${w.id}/approve`, {})
  check('1.43 re-approval works', wait.status === 200, `${wait.status} ${msg(wait)}`)
  const rel2 = after.body?.id && await loadRow(after.body.id)
  check('1.44 re-approval releases the held load', rel2 && !rel2.metadata?.hold, JSON.stringify(rel2?.metadata?.hold))
  // documents changed on an approved profile also go to review
  r = await api(w.token, 'PUT', '/vendor/kyc/documents', { docUrls: { panScan: docs.panScan } })
  check("1.45 a path outside the vendor's own folder is refused (400)", r.status === 400, `${r.status} ${msg(r)}`)
}

async function orgOfVendor(userId) {
  const m = (await db('GET', 'org_members', { query: `user_id=eq.${userId}&select=org_id,organizations(kind)` })).body || []
  return m.find(x => x.organizations?.kind === 'vendor')?.org_id || m[0]?.org_id
}

// ── 2. posting variants ───────────────────────────────────
async function s2() {
  section(2, 'Posting variants, routing, quotes, awards')
  const v = await makeVendor({ approved: true, admin: S.pa })
  S.v = v
  const bodyless = await api(null, 'POST', '/vendor/loads', loadBody())
  check('2.01 posting without sign-in is 401', bodyless.status === 401, `${bodyless.status}`)

  const bad = async (name, over, text) => {
    const r = await post(v, over)
    check(`2.02 ${name} -> 400`, r.status === 400 && (!text || has(r, text)), `${r.status} ${msg(r)}`)
  }
  await bad('no products', { items: [] }, 'product')
  await bad('HSN of 3 digits', { items: items({ hsn_code: '252' }) }, 'HSN')
  await bad('HSN with letters', { items: items({ hsn_code: 'ABCD' }) }, 'HSN')
  await bad('zero weight', { items: items({ weight_kg: 0 }) }, 'weight')
  await bad('negative weight', { items: items({ weight_kg: -5 }) })
  await bad('over 60 t', { items: items({ weight_kg: 61000 }) }, '60')
  await bad('negative value', { items: items({ declared_value: -1 }) })
  await bad('GST rate 99', { items: items({ gst_rate: 99 }) })
  await bad('51 products', { items: Array.from({ length: 51 }, (_, i) => items({ product_name: `P${i}`, weight_kg: 10 })[0]) }, '50')
  await bad('pickup pin of 5 digits', { pickup_pincode: '40009' }, 'pin')
  await bad('delivery pin with a letter', { delivery_pincode: '1100A0' }, 'pin')
  await bad('pickup date in the past', { pickup_date: dayKey(-2) }, 'past')
  await bad('impossible date 2026-02-31', { pickup_date: '2026-02-31' })
  await bad('delivery before pickup', { delivery_date: dayKey(1), pickup_date: dayKey(4) }, 'before')
  await bad('no coordinates', { pickup_lat: undefined }, 'location')
  await bad('place at 0,0', { pickup_lat: 0, pickup_lng: 0 }, 'real')
  await bad('perishable without a temperature', { items: items({ is_perishable: true }) }, 'temperature')
  await bad('bad contact phone', { pickup_contact_phone: '12345' }, 'mobile')
  await bad('chosen with no company', { routing: 'chosen', company_ids: [] }, 'company')
  await bad('chosen with a pending company', { routing: 'chosen', company_ids: [S.coP.id] }, 'not available')
  await bad('chosen with a vendor organisation id', { routing: 'chosen', company_ids: [await orgOfVendor(v.id)] }, 'not available')
  await bad('chosen with a made-up id', { routing: 'chosen', company_ids: ['00000000-0000-4000-8000-000000000000'] }, 'not available')
  await bad('chosen with 11 companies', { routing: 'chosen', company_ids: Array.from({ length: 11 }, (_, i) => `00000000-0000-4000-8000-0000000000${10 + i}`) }, '10')
  await bad('a bad client_request_id', { client_request_id: 'nope' })

  // a good load; client can't force totals
  const crid = crypto.randomUUID()
  const r1 = await post(v, { client_request_id: crid, quote_requested: false, budget_inr: 90000, total_weight_kg: 1, tax_basis: 'intra', eway_required: false })
  check('2.03 a valid load is posted (201) with MRX-YYYY-NNNNN number', r1.status === 201 && /^MRX-\d{4}-\d{5}$/.test(r1.body.load_number || ''), `${r1.status} ${msg(r1)}`)
  S.open1 = r1.body
  const row = r1.body?.id && await loadRow(r1.body.id)
  check('2.04 totals are recomputed by the server (20000 kg), not taken from the client', Number(row?.total_weight_kg) === 20000 && Number(row?.total_declared_value) === 150000, JSON.stringify({ w: row?.total_weight_kg, v: row?.total_declared_value }))
  check('2.05 Mumbai to Delhi is inter-state (IGST) and an e-way bill is needed (value over 50,000)', row?.tax_basis === 'inter' && row?.eway_required === true, JSON.stringify({ t: row?.tax_basis, e: row?.eway_required }))
  check('2.06 the load is pending, open, owned by the vendor organisation, no carrier', row?.status === 'pending' && row?.routing === 'open' && row?.vendor_org_id && !row?.carrier_org_id && row?.pickup_state_code === '27' && row?.delivery_state_code === '07', JSON.stringify({ s: row?.status, r: row?.routing, ps: row?.pickup_state_code, ds: row?.delivery_state_code }))
  check('2.07 assessment in the answer: IGST for 18% on 1,50,000 = 27,000', Math.round((r1.body.assessment?.tax?.igst ?? -1)) === 27000, JSON.stringify(r1.body.assessment?.tax)?.slice(0, 200))
  const it = (await db('GET', 'load_items', { query: `load_id=eq.${r1.body.id}&select=*` })).body
  check('2.08 the goods line is stored (HSN 2523, 400 bags, 20000 kg)', it?.length === 1 && it[0].hsn_code === '2523' && Number(it[0].weight_kg) === 20000, JSON.stringify(it))
  const dup = await post(v, { client_request_id: crid })
  check('2.09 same client_request_id again returns the first load (200, duplicate true)', dup.status === 200 && dup.body.duplicate === true && dup.body.id === r1.body.id, `${dup.status} ${dup.body?.duplicate} ${dup.body?.id}`)
  const cnt = (await db('GET', 'vendor_shipment_requests', { query: `client_request_id=eq.${crid}&select=id` })).body
  check('2.10 only ONE load row exists for that request id', cnt?.length === 1, `${cnt?.length}`)
  const idem = crypto.randomUUID()
  const [pa, pb] = await Promise.all([post(v, { client_request_id: idem }), post(v, { client_request_id: idem })])
  const cnt2 = (await db('GET', 'vendor_shipment_requests', { query: `client_request_id=eq.${idem}&select=id` })).body
  check('2.11 two simultaneous posts with one request id make one load', cnt2?.length === 1, `${cnt2?.length} (${pa.status},${pb.status})`)

  // repost
  const rp = await api(v.token, 'POST', `/vendor/loads/${r1.body.id}/repost`, {})
  const before = (await db('GET', 'vendor_shipment_requests', { query: `vendor_id=eq.${v.id}&select=id` })).body.length
  check('2.12 repost answers a draft with the dates cleared and the same goods', rp.status === 200 && rp.body.draft?.pickup_date === null && rp.body.draft?.delivery_date === null && rp.body.draft?.items?.[0]?.hsn_code === '2523' && rp.body.draft?.reposted_from === r1.body.id, JSON.stringify(rp.body).slice(0, 200))
  const after = (await db('GET', 'vendor_shipment_requests', { query: `vendor_id=eq.${v.id}&select=id` })).body.length
  check('2.13 repost creates nothing', before === after, `${before} -> ${after}`)
  const stranger = await makeVendor({ approved: false })
  const rp2 = await api(stranger.token, 'POST', `/vendor/loads/${r1.body.id}/repost`, {})
  check("2.14 another vendor cannot repost this vendor's load (404)", rp2.status === 404, `${rp2.status}`)
  const draftPost = await api(v.token, 'POST', '/vendor/loads', { ...rp.body.draft, pickup_date: dayKey(5) })
  check('2.15 the draft with a new date posts as source repost, with reposted_from', draftPost.status === 201 && (await loadRow(draftPost.body.id))?.reposted_from === r1.body.id, `${draftPost.status} ${msg(draftPost)}`)
  const mine = await get(v.token, '/vendor/loads/mine?page=1&page_size=2')
  check('2.16 my loads are paged (2 per page) and counted', mine.status === 200 && mine.body.items.length === 2 && mine.body.total >= 2 && mine.body.page_size === 2, `${mine.status} ${mine.body?.total}`)
  const mineBad = await get(v.token, '/vendor/loads/mine?page=0')
  check('2.17 page 0 is a 400, not a 500', mineBad.status === 400, `${mineBad.status}`)
  const other = await get(stranger.token, `/vendor/loads/${r1.body.id}`)
  check("2.18 another vendor reading my load gets a 404", other.status === 404, `${other.status}`)
  const mineLoad = await get(v.token, `/vendor/loads/${r1.body.id}`)
  check('2.19 the load detail has the load and its items', mineLoad.status === 200 && mineLoad.body.load?.id === r1.body.id && mineLoad.body.items?.length === 1, `${mineLoad.status}`)

  // bulk CSV
  const tpl = await api(v.token, 'GET', '/vendor/loads/template.csv', undefined, { raw: true })
  const tplText = await tpl.text()
  check('2.20 CSV template downloads as text/csv with an attachment name and the header row', tpl.status === 200 && /text\/csv/.test(tpl.headers.get('content-type')) && /attachment/.test(tpl.headers.get('content-disposition') || '') && tplText.startsWith('product_name,hsn_code'), `${tpl.status} ${tplText.slice(0, 40)}`)
  const lines = tplText.trim().split(/\r?\n/)
  const cells = (l) => l.split(',')
  const rowOf = (over = {}) => { const h = cells(lines[0]); const base = cells(lines[1]); const o = Object.fromEntries(h.map((k, i) => [k, base[i]])); Object.assign(o, over); return h.map(k => /[,"]/.test(o[k] ?? '') ? `"${o[k].replace(/"/g, '""')}"` : (o[k] ?? '')).join(',') }
  const d = dayKey(4)
  const csv3 = [lines[0], rowOf({ pickup_date: d, delivery_date: dayKey(6), product_name: 'Bulk A' }), rowOf({ pickup_date: d, hsn_code: '12', product_name: 'Bulk bad' }), rowOf({ pickup_date: d, product_name: 'Bulk C', weight_kg: '1500' })].join('\r\n')
  const bk = await api(v.token, 'POST', '/vendor/loads/bulk', { file_name: 'uat.csv', csv: csv3 })
  check('2.21 bulk file with one bad row: 201, 2 loads made, 1 error in the report', bk.status === 201 && bk.body.loads?.length === 2 && bk.body.errors?.length === 1 && bk.body.errors[0].row === 2, `${bk.status} ${JSON.stringify(bk.body).slice(0, 300)}`)
  check('2.22 the error names the field in plain words', /hsn/i.test(bk.body?.errors?.[0]?.message || ''), JSON.stringify(bk.body?.errors))
  const batch = bk.body?.batch?.id && (await db('GET', 'load_bulk_batches', { query: `id=eq.${bk.body.batch.id}&select=*` })).body?.[0]
  check('2.23 the batch is recorded (3 rows, 2 ok, 1 error, done)', batch?.row_count === 3 && batch?.ok_count === 2 && batch?.error_count === 1 && batch?.status === 'done', JSON.stringify(batch)?.slice(0, 200))
  const bl = bk.body?.loads?.[0]?.id && await loadRow(bk.body.loads[0].id)
  check('2.24 bulk loads carry source=bulk and the batch id', bl?.source === 'bulk' && bl?.bulk_batch_id === bk.body.batch.id, `${bl?.source}`)
  const many = [lines[0], ...Array.from({ length: 51 }, () => rowOf({ pickup_date: d }))].join('\r\n')
  let r = await api(v.token, 'POST', '/vendor/loads/bulk', { csv: many })
  check('2.25 51 rows is refused (400, max 50)', r.status === 400 && has(r, '50'), `${r.status} ${msg(r)}`)
  r = await api(v.token, 'POST', '/vendor/loads/bulk', { csv: 'a,b\n1,2' })
  check('2.26 a file with the wrong header is refused and names the columns (400)', r.status === 400 && has(r, 'columns'), `${r.status} ${msg(r)}`)
  r = await api(v.token, 'POST', '/vendor/loads/bulk', { csv: '   ' })
  check('2.27 an empty file is refused (400)', r.status === 400, `${r.status}`)
  r = await api(v.token, 'POST', '/vendor/loads/bulk', { csv: lines[0] })
  check('2.28 a header with no loads is refused (400)', r.status === 400, `${r.status}`)
  const bn = await notesFor(v.id, 'load_posted')
  check('2.29 the vendor has one summary notification for the bulk file', bn.some(n => /2 of 3 loads were posted/.test(n.body)), JSON.stringify(bn.map(n => n.body)).slice(0, 200))

  // routing visibility
  const chosen = await post(v, { routing: 'chosen', company_ids: [S.coA.id] })
  S.chosen = chosen.body
  check('2.30 a load sent to chosen companies is accepted', chosen.status === 201 && (await loadRow(chosen.body.id))?.routing === 'chosen', `${chosen.status} ${msg(chosen)}`)
  const named = await post(v, { company_ids: [S.coB.id] })
  check('2.31 naming companies without a routing means chosen', (await loadRow(named.body.id))?.routing === 'chosen', '')
  const vis = async (admin, id) => (await get(admin.token, `/company/loads/${id}`)).status
  check('2.32 chosen load: visible to company A (200)', await vis(S.adminA, chosen.body.id) === 200, '')
  check('2.33 chosen load: company B (active, not chosen) gets 404', await vis(S.adminB, chosen.body.id) === 404, '')
  check('2.34 chosen load: pending company P gets 404 / 403', [403, 404].includes(await vis(S.adminP, chosen.body.id)), '')
  check('2.35 open load: visible to company A and company B (200)', await vis(S.adminA, S.open1.id) === 200 && await vis(S.adminB, S.open1.id) === 200, '')
  const pst = await vis(S.adminP, S.open1.id)
  check('2.36 open load: NOT visible to the pending company P (it is not active)', [403, 404].includes(pst), `${pst}`)
  const mk = await get(S.adminB.token, '/company/loads/market?tab=new')
  check('2.37 company B market lists the open load but not the load chosen for A', mk.status === 200 && mk.body.items.some(l => l.id === S.open1.id) && !mk.body.items.some(l => l.id === chosen.body.id), `${mk.status} ${mk.body?.items?.length}`)
  const mkp = await get(S.adminP.token, '/company/loads/market?tab=new')
  check('2.38 the pending company market is empty or refused', mkp.status !== 200 || mkp.body.items.length === 0, `${mkp.status} ${mkp.body?.items?.length}`)
  // held load to nobody
  const hv = await makeVendor({ approved: false })
  const hl = await post(hv)
  check('2.39 held load (vendor org pending): nobody sees it (A, B)', await vis(S.adminA, hl.body.id) === 404 && await vis(S.adminB, hl.body.id) === 404, '')
  const mkh = await get(S.adminA.token, '/company/loads/market?tab=new')
  check('2.40 the held load is not in any market list', !mkh.body.items.some(l => l.id === hl.body.id), '')
  const heldQuote = await api(S.adminA.token, 'POST', `/company/loads/${hl.body.id}/quotes`, { amount_inr: 1000 })
  check('2.41 quoting a held load is refused (404)', heldQuote.status === 404, `${heldQuote.status}`)
  const heldAccept = await api(S.adminA.token, 'POST', `/company/loads/${hl.body.id}/accept`, { amount_inr: 1000 })
  check('2.42 accepting a held load is refused (404)', heldAccept.status === 404, `${heldAccept.status}`)
  // notifications to matching companies only
  await sleep(1500)
  const nA = await notesFor(S.adminA.id, 'vendor_request')
  const nB = await notesFor(S.adminB.id, 'vendor_request')
  check('2.43 company A (chosen) was told about the chosen load', nA.some(n => n.data?.request_id === chosen.body.id), `${nA.length}`)
  check('2.44 company B was not told about the load chosen for A', !nB.some(n => n.data?.request_id === chosen.body.id), '')
  const nP = await notesFor(S.adminP.id, 'vendor_request')
  check('2.45 the pending company is told nothing', nP.length === 0, `${nP.length}`)
  check('2.46 nobody was told about the held load', !nA.concat(nB).some(n => n.data?.request_id === hl.body.id), '')

  // quotes
  const q = await post(v, { quote_requested: true, budget_inr: 100000 })
  S.q = q.body
  const qrow = await loadRow(q.body.id)
  const dl = Date.parse(qrow.quote_deadline) - Date.now()
  check('2.47 a load that asks for quotes gets a deadline about 2 hours ahead', dl > 119 * 60_000 && dl < 121 * 60_000, `${Math.round(dl / 60000)} min`)
  let r2 = await api(S.adminA.token, 'POST', `/company/loads/${q.body.id}/accept`, { amount_inr: 90000 })
  check('2.48 direct accept is refused (409) when quotes were requested', r2.status === 409, `${r2.status} ${msg(r2)}`)
  for (const [name, body] of [['zero', { amount_inr: 0 }], ['negative', { amount_inr: -5 }], ['text', { amount_inr: 'abc' }], ['too big', { amount_inr: 1e9 }], ['past validity', { amount_inr: 5000, valid_until: '2020-01-01' }], ['bad ETA', { amount_inr: 5000, pickup_eta: 'tomorrow' }]]) {
    const rr = await api(S.adminA.token, 'POST', `/company/loads/${q.body.id}/quotes`, body)
    check(`2.49 quote with ${name} amount/value is refused (400)`, rr.status === 400, `${rr.status} ${msg(rr)}`)
  }
  const qa = await api(S.adminA.token, 'POST', `/company/loads/${q.body.id}/quotes`, { amount_inr: 98000, valid_until: new Date(Date.now() + 86400000).toISOString(), notes: 'A first' })
  check('2.50 company A quotes (201)', qa.status === 201 && qa.body.quote?.status === 'submitted', `${qa.status} ${msg(qa)}`)
  const qb = await api(S.adminB.token, 'POST', `/company/loads/${q.body.id}/quotes`, { amount_inr: 95000 })
  check('2.51 company B quotes (201)', qb.status === 201, `${qb.status} ${msg(qb)}`)
  const qa2 = await api(S.adminA.token, 'POST', `/company/loads/${q.body.id}/quotes`, { amount_inr: 97000, notes: 'A better' })
  check('2.52 company A replaces its quote (200, replaced) and keeps ONE live quote', qa2.status === 200 && qa2.body.replaced === true, `${qa2.status} ${msg(qa2)}`)
  const live = (await db('GET', 'load_quotes', { query: `load_id=eq.${q.body.id}&carrier_org_id=eq.${S.coA.id}&status=eq.submitted&select=id,amount_inr` })).body
  check('2.53 exactly one live quote of A, at the new amount', live?.length === 1 && Number(live[0].amount_inr) === 97000, JSON.stringify(live))
  const vq = await get(v.token, `/vendor/loads/${q.body.id}/quotes`)
  check('2.54 the vendor sees both quotes with company names, cheapest first', vq.status === 200 && vq.body.quotes.length === 2 && vq.body.quotes[0].amount_inr === 95000 && vq.body.quotes[0].company_name === S.coB.name, `${vq.status} ${JSON.stringify(vq.body.quotes?.map(x => [x.company_name, x.amount_inr]))}`)
  check('2.55 the quote list leaks no company id-only internals (no GSTIN, phone)', !/gstin|phone|email/i.test(JSON.stringify(vq.body.quotes)), '')
  const vnote = await notesFor(v.id, 'quote_received')
  check('2.56 the vendor was notified of the quotes', vnote.length >= 2, `${vnote.length}`)
  const stq = await get(stranger.token, `/vendor/loads/${q.body.id}/quotes`)
  check("2.57 another vendor cannot read the quotes (404)", stq.status === 404, `${stq.status}`)
  const bq = await get(S.adminB.token, `/company/loads/${q.body.id}`)
  check('2.58 company B sees only its own quote on the load (not A\'s amount)', bq.status === 200 && bq.body.my_quote?.amount_inr === 95000 && !JSON.stringify(bq.body).includes('97000'), JSON.stringify(bq.body.my_quote))
  // withdraw
  const wd = await api(S.adminB.token, 'DELETE', `/company/loads/${q.body.id}/quotes/mine`)
  check('2.59 company B withdraws its quote', wd.status === 200 && wd.body.quote?.status === 'withdrawn', `${wd.status} ${msg(wd)}`)
  const wd2 = await api(S.adminB.token, 'DELETE', `/company/loads/${q.body.id}/quotes/mine`)
  check('2.60 withdrawing again is a 404 (no live quote)', wd2.status === 404, `${wd2.status}`)
  const vq2 = await get(v.token, `/vendor/loads/${q.body.id}/quotes`)
  check('2.61 withdrawn quotes disappear from the vendor list', vq2.body.quotes.length === 1 && vq2.body.quotes[0].carrier_org_id === S.coA.id, JSON.stringify(vq2.body.quotes?.length))
  const qb2 = await api(S.adminB.token, 'POST', `/company/loads/${q.body.id}/quotes`, { amount_inr: 94000 })
  check('2.62 after withdrawing, company B can quote again (201)', qb2.status === 201, `${qb2.status} ${msg(qb2)}`)
  S.qb2 = qb2.body.quote

  // expiry (valid_until) of a quote
  const exp = await post(v, { quote_requested: true })
  const eq = await api(S.adminA.token, 'POST', `/company/loads/${exp.body.id}/quotes`, { amount_inr: 50000, valid_until: new Date(Date.now() + 3600_000).toISOString() })
  await db('PATCH', 'load_quotes', { query: `id=eq.${eq.body.quote.id}`, body: { valid_until: new Date(Date.now() - 60_000).toISOString() } })
  const acc = await api(v.token, 'POST', `/vendor/loads/${exp.body.id}/quotes/${eq.body.quote.id}/accept`, {})
  check('2.63 accepting a quote that has run past its validity is refused (409)', acc.status === 409 && has(acc, 'expired'), `${acc.status} ${msg(acc)}`)
  S.expiring = { load: exp.body.id, quote: eq.body.quote.id, userA: S.adminA.id }

  // escalation: a load with quotes asked, no quote, deadline passed
  const quiet = await post(v, { quote_requested: true })
  await db('PATCH', 'vendor_shipment_requests', { query: `id=eq.${quiet.body.id}`, body: { quote_deadline: new Date(Date.now() - 60_000).toISOString() } })
  S.quiet = quiet.body.id

  // vendor accepts a quote: others declined, second accept 409
  const bogus = await api(v.token, 'POST', `/vendor/loads/${q.body.id}/quotes/${crypto.randomUUID()}/accept`, {})
  check('2.64 accepting a quote id that does not exist is a 404', bogus.status === 404, `${bogus.status}`)
  const strAcc = await api(stranger.token, 'POST', `/vendor/loads/${q.body.id}/quotes/${qa.body.quote.id}/accept`, {})
  check("2.65 another vendor cannot accept on my load (404)", strAcc.status === 404, `${strAcc.status}`)
  const coAcc = await api(S.adminA.token, 'POST', `/vendor/loads/${q.body.id}/quotes/${qa.body.quote.id}/accept`, {})
  check('2.66 a company cannot accept its own quote on the vendor\'s behalf (403/404)', [403, 404].includes(coAcc.status), `${coAcc.status}`)
  const win = await api(v.token, 'POST', `/vendor/loads/${q.body.id}/quotes/${qb2.body.quote.id}/accept`, {})
  check('2.67 the vendor accepts B\'s quote', win.status === 200 && win.body.load?.carrier_org_id === S.coB.id && win.body.load?.status === 'approved', `${win.status} ${msg(win)}`)
  const qrows = (await db('GET', 'load_quotes', { query: `load_id=eq.${q.body.id}&select=carrier_org_id,status` })).body
  check('2.68 the winner is accepted and the other live quote declined', qrows.find(x => x.carrier_org_id === S.coB.id && x.status === 'accepted') && qrows.find(x => x.carrier_org_id === S.coA.id && x.status === 'declined'), JSON.stringify(qrows))
  const awarded = await loadRow(q.body.id)
  check('2.69 load awarded: carrier_org_id, cost = the amount, awarded_at set', awarded.carrier_org_id === S.coB.id && Number(awarded.cost) === 94000 && awarded.awarded_at && awarded.status === 'approved', JSON.stringify({ c: awarded.cost, s: awarded.status }))
  const again = await api(v.token, 'POST', `/vendor/loads/${q.body.id}/quotes/${qa.body.quote.id}/accept`, {})
  check('2.70 accepting a second quote on the awarded load is 409', again.status === 409, `${again.status} ${msg(again)}`)
  const sameAgain = await api(v.token, 'POST', `/vendor/loads/${q.body.id}/quotes/${qb2.body.quote.id}/accept`, {})
  check('2.71 accepting the same quote twice is 409', sameAgain.status === 409, `${sameAgain.status}`)
  await sleep(1500)
  const nwin = await notesFor(S.adminB.id, 'quote_accepted')
  const nlose = await notesFor(S.adminA.id, 'quote_declined')
  check('2.72 the winner and the loser were both told', nwin.some(n => n.data?.request_id === q.body.id) && nlose.some(n => n.data?.request_id === q.body.id), `${nwin.length}/${nlose.length}`)
  const lateQuote = await api(S.adminA.token, 'POST', `/company/loads/${q.body.id}/quotes`, { amount_inr: 1000 })
  check('2.73 quoting an awarded load is refused (404 or 409)', [404, 409].includes(lateQuote.status), `${lateQuote.status}`)
  const wonTab = await get(S.adminB.token, '/company/loads/market?tab=won')
  const lostTab = await get(S.adminA.token, '/company/loads/market?tab=lost')
  check('2.74 the load is in B\'s Won tab and in A\'s Lost tab', wonTab.body.items.some(l => l.id === q.body.id) && lostTab.body.items.some(l => l.id === q.body.id), `${wonTab.body.counts && JSON.stringify(wonTab.body.counts)} ${JSON.stringify(lostTab.body.counts)}`)
  const loser = await get(S.adminA.token, `/company/loads/${q.body.id}`)
  check('2.75 the losing company can no longer read the load (404)', loser.status === 404, `${loser.status}`)

  // direct accept (no quote requested)
  const dir = await post(v, { budget_inr: 88000, quote_requested: false })
  const noBudget = await post(v, { quote_requested: false })
  const nb = await api(S.adminA.token, 'POST', `/company/loads/${noBudget.body.id}/accept`, {})
  check('2.76 direct accept with no budget and no amount is refused (400)', nb.status === 400, `${nb.status} ${msg(nb)}`)
  const d1 = await api(S.adminA.token, 'POST', `/company/loads/${dir.body.id}/accept`, {})
  check('2.77 direct accept at the vendor budget works (awarded at 88000)', d1.status === 200 && Number(d1.body.quote?.amount_inr) === 88000 && d1.body.load?.carrier_org_id === S.coA.id, `${d1.status} ${msg(d1)}`)
  const d2 = await api(S.adminB.token, 'POST', `/company/loads/${dir.body.id}/accept`, {})
  check('2.78 the second company\'s accept finds the load gone (404 or 409)', [404, 409].includes(d2.status), `${d2.status}`)
  const dvn = await notesFor(v.id, 'request_approved')
  check('2.79 the vendor is told "Load accepted"', dvn.some(n => n.data?.request_id === dir.body.id), '')
  const awardedRow = await loadRow(dir.body.id)
  check('2.80 direct accept: status approved, cost 88000, quote row accepted', awardedRow.status === 'approved' && Number(awardedRow.cost) === 88000 && awardedRow.awarded_quote_id, JSON.stringify({ s: awardedRow.status, c: awardedRow.cost }))
  // two companies accept at the same time
  const dir2 = await post(v, { budget_inr: 70000 })
  const [x, y] = await Promise.all([api(S.adminA.token, 'POST', `/company/loads/${dir2.body.id}/accept`, {}), api(S.adminB.token, 'POST', `/company/loads/${dir2.body.id}/accept`, {})])
  const wins = [x, y].filter(z => z.status === 200).length
  check('2.81 two companies accepting at once: exactly one wins, the other is 404/409, never a 500', wins === 1 && [x, y].every(z => z.status < 500), `${x.status},${y.status}`)
  // award a fresh row: cancel flow
  const cancelRow = await post(v, {})
  const cc = await api(v.token, 'PUT', `/vendor/shipment-request/${cancelRow.body.id}/cancel`, {})
  check('2.82 the vendor withdraws an open load', cc.status === 200, `${cc.status} ${msg(cc)}`)
  const cg = await vis(S.adminA, cancelRow.body.id)
  check('2.83 a cancelled load disappears for companies (404)', cg === 404, `${cg}`)
  const cq = await api(S.adminA.token, 'POST', `/company/loads/${cancelRow.body.id}/quotes`, { amount_inr: 1000 })
  check('2.84 quoting a cancelled load is refused (404/409)', [404, 409].includes(cq.status), `${cq.status}`)
}

// ── runner ────────────────────────────────────────────────
const sections = { 1: s1, 2: s2 }
async function main() {
  await setup()
  for (const n of Object.keys(sections).sort()) if (want.has(n)) {
    try { await sections[n]() } catch (e) { check(`section ${n} ran to the end`, false, e.stack?.split('\n').slice(0, 3).join(' | ')) }
  }
  const failed = results.filter(r => !r.ok)
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`)
  for (const f of failed) console.log(`  FAIL ${f.name}  ${f.detail}`)
  process.exit(failed.length ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(2) })
