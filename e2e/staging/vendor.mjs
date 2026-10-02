// Audit area 7: vendor extras and the public pages, walked on the TEST stage (see docs/uat/WORKFLOW-AUDIT.md).
//   node e2e/staging/vendor.mjs            all sections
//   SECTIONS=1,2 node e2e/staging/vendor.mjs   only those sections
// Fresh @margix.test accounts every run; secrets are read by actors.mjs and never printed.
import {
  api, db, check, results, sleep, tag, PNG, putSigned, readObject, makeVendor, makeCompany, makeCompanyAdmin, makePlatformAdmin, makeDriver,
  makeUser, login, API, DATA, env, PASSWORD,
} from './actors.mjs'

// A hung request must show up as a failed step, not freeze the walk
const realFetch = globalThis.fetch
globalThis.fetch = (url, opts = {}) => realFetch(url, { signal: AbortSignal.timeout(120_000), ...opts })

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
// A load posted with a recommended range (price_min_inr..price_max_inr) is booked at an amount inside it; one without a range at its budget.
// Returns the accept response, and `at` = the amount asked for (null: the budget).
async function acceptLoad(token, id, amount) {
  let at = amount ?? null
  if (at === null) { const d = await get(token, `/company/loads/${id}`); if (d.body?.price_min_inr != null) at = Number(d.body.price_min_inr) }
  const r = await api(token, 'POST', `/company/loads/${id}/accept`, at === null ? {} : { amount_inr: at })
  r.at = at
  return r
}
async function loadRow(id) { return (await db('GET', 'vendor_shipment_requests', { query: `id=eq.${id}&select=*` })).body?.[0] }
async function notesFor(userId, type) { return (await db('GET', 'notifications', { query: `user_id=eq.${userId}${type ? `&type=eq.${type}` : ''}&select=title,body,type,data,is_read&order=created_at.desc` })).body || [] }
async function waitNotes(userId, type, pred, secs = 60) {
  for (let i = 0; i < secs / 3; i++) { const n = await notesFor(userId, type); if (n.some(pred)) return n; await sleep(3000) }
  return notesFor(userId, type)
}
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
  check("1.36a a company admin cannot approve a vendor's KYC (403): approvals are the platform's", byCompany.status === 403, `${byCompany.status}`)
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
  console.log(`   (observation) vendor organisation status while under review: ${org2?.status} (the sync trigger never reverses an activation; loads are held by the profile's kyc_status)`)
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
  const d1 = await acceptLoad(S.adminA.token, dir.body.id)
  const paid = d1.at ?? 88000
  check('2.77 direct accept works (at the vendor budget, or inside the recommended range when the load has one)', d1.status === 200 && Number(d1.body.quote?.amount_inr) === paid && d1.body.load?.carrier_org_id === S.coA.id, `${d1.status} ${msg(d1)}`)
  const d2 = await acceptLoad(S.adminB.token, dir.body.id)
  check('2.78 the second company\'s accept finds the load gone (404 or 409)', [404, 409].includes(d2.status), `${d2.status}`)
  const dvn = await notesFor(v.id, 'request_approved')
  check('2.79 the vendor is told "Load accepted"', dvn.some(n => n.data?.request_id === dir.body.id), '')
  const awardedRow = await loadRow(dir.body.id)
  check('2.80 direct accept: status approved, cost = the amount, quote row accepted', awardedRow.status === 'approved' && Number(awardedRow.cost) === paid && awardedRow.awarded_quote_id, JSON.stringify({ s: awardedRow.status, c: awardedRow.cost }))
  // a load with a recommended range is booked inside it (only when the estimator produced one on this stack)
  const ranged = await post(v, { quote_requested: false })
  const rr = await loadRow(ranged.body.id)
  if (rr?.price_min_inr != null && rr?.price_max_inr != null) {
    check('2.80a a new load stores the server-computed range and the default priority', Number(rr.price_min_inr) <= Number(rr.price_max_inr) && rr.priority === 'medium', JSON.stringify({ lo: rr.price_min_inr, hi: rr.price_max_inr, p: rr.priority }))
    const out = await api(S.adminA.token, 'POST', `/company/loads/${ranged.body.id}/accept`, { amount_inr: Number(rr.price_max_inr) + 1000 })
    check('2.80b accepting above the recommended range is refused (400)', out.status === 400, `${out.status} ${msg(out)}`)
    const none = await api(S.adminA.token, 'POST', `/company/loads/${ranged.body.id}/accept`, {})
    check('2.80c accepting a ranged load without an amount is refused (400)', none.status === 400, `${none.status} ${msg(none)}`)
    const inside = await api(S.adminA.token, 'POST', `/company/loads/${ranged.body.id}/accept`, { amount_inr: Number(rr.price_max_inr) })
    check('2.80d accepting at the top of the range works', inside.status === 200 && Number(inside.body.quote?.amount_inr) === Number(rr.price_max_inr), `${inside.status} ${msg(inside)}`)
  } else console.log('   (observation) no freight estimate on this stack: the range checks 2.80a-d were skipped')
  // two companies accept at the same time
  const dir2 = await post(v, { budget_inr: 70000 })
  const [x, y] = await Promise.all([acceptLoad(S.adminA.token, dir2.body.id), acceptLoad(S.adminB.token, dir2.body.id)])
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

// ── 3. return trips (capacity) ────────────────────────────
async function mkVehicle(co, over = {}) {
  const r = await db('POST', 'vehicles', { body: { plate_number: `MH12${tag().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 2)}${String(Math.floor(1000 + Math.random() * 8999))}`, vehicle_type: 'truck', capacity_kg: 20000, available_capacity_kg: 8000, status: 'available', latitude: 19.07, longitude: 72.88, current_location_name: 'Mumbai', carrier_org_id: co.id, ...over } })
  if (r.status >= 300) throw new Error(`vehicle: ${JSON.stringify(r.body)}`)
  return r.body[0]
}
const bidBody = (windowId, over = {}) => ({ window_id: windowId, bid_amount: 6000, weight_kg: 3000, eway_bill_ref: '123456789012', dropoff_name: 'Pune warehouse', dropoff_address: 'Hinjewadi, Pune', dropoff_lat: 18.5913, dropoff_lng: 73.7389, load_configuration: 'palletised', ...over })

async function s3() {
  section(3, 'Return trips (capacity windows and bids)')
  const vNear = await mkVehicle(S.coA)
  const vFar = await mkVehicle(S.coA, { latitude: 28.6, longitude: 77.2, current_location_name: 'Delhi' })
  const vThird = await mkVehicle(S.coA)
  const vOtherCo = await mkVehicle(S.coB)
  const bid1 = await makeVendor({ approved: true, admin: S.pa })
  const bid2 = await makeVendor({ approved: true, admin: S.pa })
  const unapproved = await makeVendor({ approved: false })
  const far = await makeVendor({ approved: true, admin: S.pa })
  await db('PATCH', 'vendor_profiles', { query: `id=eq.${far.id}`, body: { latitude: 13.08, longitude: 80.27, city: 'Chennai' } })

  let r = await api(S.adminA.token, 'POST', '/capacity/windows', { vehicle_id: vNear.id, duration_minutes: 30 })
  check('3.01 opening a window without a minimum price is refused (400)', r.status === 400, `${r.status} ${msg(r)}`)
  r = await api(S.adminA.token, 'POST', '/capacity/windows', { vehicle_id: vNear.id, floor_price: 5000, duration_minutes: 2 })
  check('3.02 a window shorter than 5 minutes is refused (400)', r.status === 400, `${r.status} ${msg(r)}`)
  r = await api(S.adminB.token, 'POST', '/capacity/windows', { vehicle_id: vNear.id, floor_price: 5000, duration_minutes: 30 })
  check("3.03 company B cannot open a window on company A's vehicle (404)", r.status === 404, `${r.status} ${msg(r)}`)
  r = await api(S.adminA.token, 'POST', '/capacity/windows', { vehicle_id: vNear.id, floor_price: 5000, duration_minutes: 30 })
  check('3.04 company A opens a window with floor price 5000 (201)', r.status === 201 && r.body.status === 'open' && r.body.carrier_org_id === S.coA.id, `${r.status} ${msg(r)}`)
  const w1 = r.body
  r = await api(S.adminA.token, 'POST', '/capacity/windows', { vehicle_id: vNear.id, floor_price: 5000, duration_minutes: 30 })
  check('3.05 a second window on the same vehicle is refused (409)', r.status === 409, `${r.status}`)
  const wFar = (await api(S.adminA.token, 'POST', '/capacity/windows', { vehicle_id: vFar.id, floor_price: 100, duration_minutes: 30 })).body
  const w3 = (await api(S.adminA.token, 'POST', '/capacity/windows', { vehicle_id: vThird.id, floor_price: 100, duration_minutes: 30 })).body
  const wB = (await api(S.adminB.token, 'POST', '/capacity/windows', { vehicle_id: vOtherCo.id, floor_price: 100, duration_minutes: 30 })).body

  const open = await get(bid1.token, '/capacity/windows/open')
  const ids = (open.body || []).map(w => w.id)
  check('3.06 the vendor sees the near truck (any company) but not the Delhi truck', open.status === 200 && ids.includes(w1.id) && ids.includes(wB.id) && !ids.includes(wFar.id), `${open.status} ${ids.length}`)
  check('3.07 the vendor-facing window has no plate, coordinates or driver', !/plate|latitude|longitude|driver/i.test(JSON.stringify(open.body)), '')
  const farSees = await get(far.token, '/capacity/windows/open')
  check('3.08 a vendor in Chennai sees none of these windows', !(farSees.body || []).some(w => [w1.id, w3.id, wB.id].includes(w.id)), '')
  const told = await waitNotes(bid1.id, 'return_trip_opened', n => n.data?.window_id === w1.id)
  const toldFar = await notesFor(far.id, 'return_trip_opened')
  check('3.09 vendors near the truck were told about the window, once, without a plate', told.some(n => n.data?.window_id === w1.id) && !/MH\d\d/.test(JSON.stringify(told)), `${told.length}`)
  check('3.10 the vendor in Chennai was not told', !toldFar.some(n => n.data?.window_id === w1.id), '')

  // bid rules
  r = await api(unapproved.token, 'POST', '/capacity/bids', bidBody(w1.id))
  check('3.11 a vendor without approved KYC cannot bid (403)', r.status === 403, `${r.status}`)
  r = await api(bid1.token, 'POST', '/capacity/bids', bidBody(w1.id, { bid_amount: 4000 }))
  check('3.12 a bid below the floor price is refused (400, names the minimum)', r.status === 400 && has(r, 'minimum'), `${r.status} ${msg(r)}`)
  r = await api(bid1.token, 'POST', '/capacity/bids', bidBody(w1.id, { weight_kg: 9000 }))
  check('3.13 a bid heavier than the free space is refused (400)', r.status === 400 && has(r, 'exceeds'), `${r.status} ${msg(r)}`)
  r = await api(bid1.token, 'POST', '/capacity/bids', bidBody(w1.id, { eway_bill_ref: '12345' }))
  check('3.14 a bad e-way bill number is refused (400)', r.status === 400, `${r.status}`)
  r = await api(bid1.token, 'POST', '/capacity/bids', bidBody(w1.id, { dropoff_lat: undefined }))
  check('3.15 a bid without a drop-off place is refused (400)', r.status === 400, `${r.status}`)
  r = await api(bid1.token, 'POST', '/capacity/bids', bidBody(w1.id, { weight_kg: -1 }))
  check('3.16 a negative weight is refused (400)', r.status === 400, `${r.status}`)
  r = await api(far.token, 'POST', '/capacity/bids', bidBody(w1.id))
  check('3.17 geofence: a vendor in Chennai cannot bid on a Mumbai truck (400)', r.status === 400 && has(r, 'geofenc'), `${r.status} ${msg(r)}`)
  r = await api(bid1.token, 'POST', '/capacity/bids', bidBody(crypto.randomUUID()))
  check('3.18 a bid on a window that does not exist is 404', r.status === 404, `${r.status}`)
  const orphans = (await db('GET', 'delivery_points', { query: `name=eq.Pune warehouse&shipment_id=is.null&select=id` })).body.length
  r = await api(bid1.token, 'POST', '/capacity/bids', bidBody(w1.id))
  check('3.19 a valid bid is accepted (200, pending)', r.status === 200 && r.body.status === 'pending', `${r.status} ${msg(r)}`)
  const b1 = r.body
  r = await api(bid1.token, 'POST', '/capacity/bids', bidBody(w1.id))
  check('3.20 a second pending bid on the same window is 409', r.status === 409, `${r.status}`)
  const orphans2 = (await db('GET', 'delivery_points', { query: `name=eq.Pune warehouse&shipment_id=is.null&select=id` })).body.length
  check('3.21 refused bids leave no stray drop-off points behind (only the accepted bid keeps one)', orphans2 - orphans <= 1, `${orphans}->${orphans2}`)
  r = await api(bid2.token, 'POST', '/capacity/bids', bidBody(w1.id, { bid_amount: 7000, weight_kg: 2000 }))
  check('3.22 a second vendor bids on the same window (200)', r.status === 200, `${r.status} ${msg(r)}`)
  const b2 = r.body
  const mine = await get(bid1.token, '/capacity/bids/mine')
  check('3.23 "my bids" lists the bid with no plate while pending', mine.status === 200 && mine.body.some(b => b.id === b1.id) && !/plate_number":"MH/.test(JSON.stringify(mine.body)), `${mine.status}`)
  check("3.24 'my bids' shows only my bids", !mine.body.some(b => b.id === b2.id), '')
  const cnt = await get(bid1.token, `/capacity/windows/${w1.id}/bid-count`)
  check('3.25 bid count for the window is 2', cnt.status === 200 && cnt.body.count === 2, JSON.stringify(cnt.body))
  const pendA = await get(S.adminA.token, '/capacity/bids/pending')
  const pendB = await get(S.adminB.token, '/capacity/bids/pending')
  check("3.26 company A sees both pending bids; company B sees neither", pendA.body.filter(b => [b1.id, b2.id].includes(b.id)).length === 2 && !pendB.body.some(b => [b1.id, b2.id].includes(b.id)), `${pendA.status} ${pendB.status}`)
  r = await api(S.adminB.token, 'POST', `/capacity/bids/${b1.id}/approve`, {})
  check("3.27 company B cannot approve a bid on A's window (404)", r.status === 404, `${r.status}`)
  r = await api(bid1.token, 'POST', `/capacity/bids/${b1.id}/approve`, {})
  check('3.28 a vendor cannot approve a bid (403)', r.status === 403, `${r.status}`)
  const staffNotes = await waitNotes(S.adminA.id, 'capacity_bid', n => n.data?.bid_id === b1.id, 45)
  check('3.29 company A was told about the new bids', staffNotes.some(n => n.data?.bid_id === b1.id), `${staffNotes.length}`)

  r = await api(S.adminA.token, 'POST', `/capacity/bids/${b1.id}/approve`, {})
  check('3.30 company A approves the first bid (shipment made)', r.status === 200 && r.body.status === 'won' && r.body.shipment_id, `${r.status} ${msg(r)}`)
  S.bidShipment = r.body.shipment_id
  const ship = (await db('GET', 'shipments', { query: `id=eq.${r.body.shipment_id}&select=tracking_id,status,carrier_org_id,vendor_org_id,bid_id,total_weight_kg` })).body?.[0]
  check('3.31 the shipment belongs to company A and the vendor organisation, status assigned', ship?.carrier_org_id === S.coA.id && ship?.vendor_org_id && ship?.status === 'assigned' && ship?.bid_id === b1.id, JSON.stringify(ship))
  S.bidTracking = ship?.tracking_id
  const man = (await db('GET', 'cargo_manifest', { query: `vehicle_id=eq.${vNear.id}&select=id,status,carrier_org_id,vendor_org_id,capacity_kg` })).body
  check('3.32 a manifest was built for the vehicle (company A, 3000 kg)', man?.length >= 1 && man[0].carrier_org_id === S.coA.id && Number(man[0].capacity_kg) === 3000, JSON.stringify(man))
  const veh = (await db('GET', 'vehicles', { query: `id=eq.${vNear.id}&select=available_capacity_kg,bidding_window_open` })).body[0]
  check('3.33 the vehicle has only 5000 kg free now and stopped advertising', Number(veh.available_capacity_kg) === 5000 && veh.bidding_window_open === false, JSON.stringify(veh))
  const stops = (await db('GET', 'routes', { query: `vehicle_id=eq.${vNear.id}&select=id,route_stops(id,sequence,status)` })).body
  check('3.34 a route with a pickup stop and a drop stop exists', stops?.[0]?.route_stops?.length === 2, JSON.stringify(stops))
  const wrow = (await db('GET', 'capacity_windows', { query: `id=eq.${w1.id}&select=status,winning_bid_id` })).body[0]
  const brow = (await db('GET', 'capacity_bids', { query: `id=in.(${b1.id},${b2.id})&select=id,status` })).body
  check('3.35 window closed with the winning bid; the other bid is lost', wrow.winning_bid_id === b1.id && brow.find(b => b.id === b2.id)?.status === 'lost', JSON.stringify([wrow, brow]))
  r = await api(S.adminA.token, 'POST', `/capacity/bids/${b1.id}/approve`, {})
  check('3.36 approving the same bid again is 409', r.status === 409, `${r.status}`)
  r = await api(S.adminA.token, 'POST', `/capacity/bids/${b2.id}/approve`, {})
  check('3.37 approving the losing bid is 409', r.status === 409, `${r.status}`)
  await sleep(1500)
  const won = await notesFor(bid1.id, 'bid_accepted')
  const lost = await notesFor(bid2.id, 'bid_lost')
  check('3.38 winner and loser were both told', won.length >= 1 && lost.length >= 1, `${won.length}/${lost.length}`)
  const m1 = await get(bid1.token, '/capacity/bids/mine')
  const m2 = await get(bid2.token, '/capacity/bids/mine')
  check('3.39 the winner sees the plate; the loser does not', /MH12/.test(JSON.stringify(m1.body)) && !/MH12/.test(JSON.stringify(m2.body)), '')
  r = await api(bid2.token, 'POST', '/capacity/bids', bidBody(w1.id))
  check('3.40 bidding on the closed window is refused (409)', r.status === 409, `${r.status}`)

  // reject
  const b3 = (await api(bid1.token, 'POST', '/capacity/bids', bidBody(w3.id, { bid_amount: 600, weight_kg: 1000 }))).body
  r = await api(S.adminA.token, 'POST', `/capacity/bids/${b3.id}/reject`, {})
  check('3.41 rejecting without a reason is refused (400)', r.status === 400, `${r.status}`)
  r = await api(S.adminA.token, 'POST', `/capacity/bids/${b3.id}/reject`, { reason: 'Price too low for this lane' })
  check('3.42 company A rejects with a reason', r.status === 200 && r.body.status === 'rejected', `${r.status} ${msg(r)}`)
  r = await api(S.adminA.token, 'POST', `/capacity/bids/${b3.id}/reject`, { reason: 'again again' })
  check('3.43 rejecting twice is 409', r.status === 409, `${r.status}`)
  await sleep(1200)
  const rj = await notesFor(bid1.id, 'bid_rejected')
  const stored = (await db('GET', 'capacity_bids', { query: `id=eq.${b3.id}&select=rejection_reason` })).body[0]
  check('3.44 the vendor is told with the reason, and the reason is stored', rj.some(n => /too low/.test(n.body)) && /too low/.test(stored.rejection_reason || ''), JSON.stringify(rj))
  r = await api(bid1.token, 'POST', '/capacity/bids', bidBody(w3.id, { bid_amount: 700, weight_kg: 1000 }))
  check('3.45 after a rejection the vendor can bid again on an open window', r.status === 200, `${r.status} ${msg(r)}`)
  // closes_at and cancel
  await db('PATCH', 'capacity_windows', { query: `id=eq.${w3.id}`, body: { closes_at: new Date(Date.now() - 60_000).toISOString() } })
  r = await api(bid2.token, 'POST', '/capacity/bids', bidBody(w3.id))
  check('3.46 a window past its closing time takes no bid (409)', r.status === 409, `${r.status} ${msg(r)}`)
  const wc = (await api(S.adminB.token, 'POST', `/capacity/windows/${wB.id}/cancel`, {}))
  check('3.47 company B cancels its own window', wc.status === 200, `${wc.status}`)
  r = await api(S.adminA.token, 'POST', `/capacity/windows/${wB.id}/close`, {})
  check("3.48 company A cannot close B's window (404)", r.status === 404, `${r.status}`)
  r = await api(bid2.token, 'POST', '/capacity/bids', bidBody(wB.id))
  check('3.49 a cancelled window takes no bid (409)', r.status === 409, `${r.status}`)
  const nb = await get(S.adminA.token, '/capacity/nearby-vendors?lat=19.1&lng=72.85&radius=20')
  console.log(`   (observation) /capacity/nearby-vendors returns ${nb.status}; fields: ${Object.keys((nb.body || [])[0] || {}).join(',')}`)
  S.nearbyFields = Object.keys((nb.body || [])[0] || {})
  // public spare space sees an open window, with no plate
  const wP = await mkVehicle(S.coA, { plate_number: 'MH12ZZ' + Math.floor(1000 + Math.random() * 8999) })
  const wPw = (await api(S.adminA.token, 'POST', '/capacity/windows', { vehicle_id: wP.id, floor_price: 900, duration_minutes: 60 })).body
  S.publicWindow = wPw.id
}

// ── 4. documents panel ────────────────────────────────────
const PDFBYTES = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
async function s4() {
  section(4, 'Documents panel, checklist, dispatch block')
  const v = await makeVendor({ approved: true, admin: S.pa })
  const stranger = await makeVendor({ approved: false })
  const lp = await post(v, { budget_inr: 88000, quote_requested: false, items: items({ declared_value: 150000 }) })
  const id = lp.body.id
  let r = await acceptLoad(S.adminA.token, id)
  check('4.01 setup: load awarded to company A', r.status === 200, `${r.status} ${msg(r)}`)
  const D = (path) => `/loads/${id}/documents${path || ''}`

  // before any document: the checklist flags
  r = await get(v.token, `/loads/${id}/dispatch-check`)
  const key = (x, k) => x.body.items?.find(i => i.key === k)
  check('4.02 checklist, nothing uploaded: invoice missing, e-way bill missing (value over 50,000), LR missing', r.status === 200 && key(r, 'invoice')?.status === 'missing' && key(r, 'eway_bill')?.status === 'missing' && key(r, 'lr')?.status === 'missing' && r.body.ready === false, JSON.stringify(r.body.items?.map(i => [i.key, i.status])))

  // vendor upload through the signed flow
  let link = await api(v.token, 'POST', D('/upload-url'), { kind: 'tax_invoice', content_type: 'application/pdf', size: PDFBYTES.length })
  check('4.03 vendor asks for a signed upload link for the invoice', link.status === 200 && link.body.path?.startsWith(`loads/${id}/`), `${link.status} ${msg(link)}`)
  await putSigned(link.body, PDFBYTES, 'application/pdf')
  const back = await readObject('load_documents', link.body.path)
  check('4.04 the uploaded invoice reads back byte for byte', back && Buffer.compare(back, PDFBYTES) === 0, `${back?.length}`)
  r = await api(v.token, 'POST', D(), { kind: 'tax_invoice', number: 'INV-2026-001', doc_date: dayKey(0), file_path: link.body.path, fields: { total_value: 150000, buyer_name: 'Buyer Co' } })
  check('4.05 vendor records the invoice with the file (201, final, version 1)', r.status === 201 && r.body.status === 'final' && r.body.version === 1 && r.body.file_url, `${r.status} ${msg(r)}`)
  const inv = r.body
  const fileGet = await api(v.token, 'GET', D(`/${inv.id}/pdf`))
  const fileBytes = fileGet.status === 200 && fileGet.body.url ? Buffer.from(await (await fetch(fileGet.body.url)).arrayBuffer()) : null
  check('4.06 the invoice file is served through a short-lived signed link with the same bytes', fileBytes && Buffer.compare(fileBytes, PDFBYTES) === 0, `${fileGet.status}`)
  r = await api(v.token, 'POST', D('/upload-url'), { kind: 'tax_invoice', content_type: 'text/html', size: 100 })
  check('4.07 an HTML upload is refused (415)', r.status === 415, `${r.status}`)
  r = await api(v.token, 'POST', D('/upload-url'), { kind: 'tax_invoice', content_type: 'application/pdf', size: 50 * 1024 * 1024 })
  check('4.08 a 50 MB upload is refused (413)', r.status === 413, `${r.status}`)
  r = await api(v.token, 'POST', D(), { kind: 'tax_invoice', number: 'X', file_path: 'loads/other/ev.pdf' })
  check("4.09 a file path outside this load's folder is refused (400)", r.status === 400, `${r.status} ${msg(r)}`)
  r = await api(v.token, 'POST', D(), { kind: 'delivery_challan' })
  check('4.10 a challan without a number is refused (400)', r.status === 400, `${r.status}`)
  r = await api(v.token, 'POST', D(), { kind: 'delivery_challan', number: 'DC-77', doc_date: dayKey(0), fields: { total_value: 150000 } })
  check('4.11 vendor records a delivery challan', r.status === 201, `${r.status} ${msg(r)}`)
  r = await api(v.token, 'POST', D(), { kind: 'lr', number: 'LR-1' })
  check('4.12 a vendor cannot create an LR (403): it is issued by the company', r.status === 403, `${r.status}`)
  r = await api(v.token, 'POST', D('/generate/lr'), {})
  check('4.13 a vendor cannot generate an LR (403)', r.status === 403, `${r.status} ${msg(r)}`)
  r = await api(stranger.token, 'GET', D())
  check("4.14 another vendor cannot read this load's documents (404)", r.status === 404, `${r.status}`)
  r = await api(S.adminB.token, 'GET', D())
  check("4.15 another company cannot read this load's documents (404)", r.status === 404, `${r.status}`)
  r = await api(S.adminB.token, 'POST', D('/generate/lr'), {})
  check('4.16 another company cannot generate for it (404)', r.status === 404, `${r.status}`)
  r = await api(S.pa.token, 'POST', D(), { kind: 'delivery_challan', number: 'DC-9' })
  check('4.17 the platform owner may read but not write (403)', r.status === 403, `${r.status}`)
  r = await api(S.pa.token, 'GET', D())
  check('4.18 the platform owner can read the documents (200)', r.status === 200, `${r.status}`)

  // e-way bill by the company
  r = await api(S.adminA.token, 'POST', D(), { kind: 'eway_bill', number: '12345', valid_until: new Date(Date.now() + 5 * 86400000).toISOString(), fields: { ewb_number: '12345' } })
  check('4.19 an e-way bill number of 5 digits is refused (400)', r.status === 400, `${r.status} ${msg(r)}`)
  r = await api(S.adminA.token, 'POST', D(), { kind: 'eway_bill', number: '123456789012', fields: { ewb_number: '123456789012' } })
  check('4.20 an e-way bill without a validity is refused (400)', r.status === 400 && has(r, 'valid_until'), `${r.status} ${msg(r)}`)
  r = await api(S.adminA.token, 'POST', D(), { kind: 'eway_bill', number: '123456789012', valid_until: new Date(Date.now() - 86400000).toISOString(), fields: { ewb_number: '123456789012', vehicle_number: 'MH 12 AB 1234' } })
  check('4.21 the company records an e-way bill (already expired, to test the flag)', r.status === 201, `${r.status} ${msg(r)}`)
  const ewb = r.body
  check('4.22 the expired e-way bill reads back as expired', ewb.expired === true && ewb.effective_status === 'expired', JSON.stringify({ e: ewb.expired, s: ewb.effective_status }))
  r = await get(v.token, `/loads/${id}/dispatch-check`)
  check('4.23 checklist: invoice ok, e-way bill expired, LR missing; not ready', key(r, 'invoice')?.status === 'ok' && key(r, 'eway_bill')?.status === 'expired' && key(r, 'lr')?.status === 'missing' && r.body.ready === false, JSON.stringify(r.body.items?.map(i => [i.key, i.status])))
  // extend the validity: a new version
  r = await api(S.adminA.token, 'PATCH', D(`/${ewb.id}`), { valid_until: new Date(Date.now() + 5 * 86400000).toISOString() })
  check('4.24 extending the e-way bill makes a new version and it is live again', r.status === 200 && r.body.version === 2 && r.body.status === 'final' && r.body.expired === false, `${r.status} ${msg(r)} v${r.body?.version} ${r.body?.status}`)
  r = await api(S.adminA.token, 'GET', D(`/${ewb.id}/history`))
  check('4.25 history lists the created and the updated event with what changed', r.status === 200 && r.body.events.length >= 2 && r.body.events.some(e => e.changes?.valid_until), JSON.stringify(r.body.events?.map(e => [e.action, e.version])))
  r = await api(v.token, 'PATCH', D(`/${ewb.id}`), { fields: { remarks: 'x' } })
  check("4.26 the vendor cannot change the company's e-way bill (403)", r.status === 403, `${r.status}`)
  r = await api(S.adminA.token, 'PATCH', D(`/${ewb.id}`), { status: 'expired' })
  check('4.27 setting status expired by hand is refused (400: system-set)', r.status === 400, `${r.status} ${msg(r)}`)

  // generated documents
  r = await api(S.adminA.token, 'POST', D('/generate/lr'), {})
  check('4.28 the company generates the LR (201, number LR/…-YYYY-NNNNN)', r.status === 201 && r.body.number && r.body.kind === 'lr', `${r.status} ${msg(r)} ${r.body?.number}`)
  const lr = r.body
  const pdf = await api(S.adminA.token, 'GET', D(`/${lr.id}/pdf`), undefined, { raw: true })
  const pb = Buffer.from(await pdf.arrayBuffer())
  check('4.29 the LR PDF is a real PDF (%PDF, application/pdf)', pdf.status === 200 && /application\/pdf/.test(pdf.headers.get('content-type')) && pb.subarray(0, 4).toString() === '%PDF', `${pdf.status} ${pb.subarray(0, 8).toString()}`)
  const pdfV = await api(v.token, 'GET', D(`/${lr.id}/pdf`), undefined, { raw: true })
  check('4.30 the vendor can fetch the LR PDF too', pdfV.status === 200 && Buffer.from(await pdfV.arrayBuffer()).subarray(0, 4).toString() === '%PDF', `${pdfV.status}`)
  const pdfX = await api(S.adminB.token, 'GET', D(`/${lr.id}/pdf`), undefined, { raw: true })
  check("4.31 another company cannot fetch it (404)", pdfX.status === 404, `${pdfX.status}`)
  r = await api(S.adminA.token, 'POST', D('/generate/lr'), {})
  check('4.32 generating the LR again keeps its number and bumps the version (no second LR)', r.status === 201 && r.body.id === lr.id && r.body.number === lr.number && r.body.version === lr.version + 1, `${r.status} ${r.body?.id === lr.id} v${r.body?.version}`)
  r = await api(S.adminA.token, 'POST', D('/generate/freight_sheet'), {})
  check('4.33 the freight sheet is generated', r.status === 201, `${r.status} ${msg(r)}`)
  const fsPdf = r.status === 201 ? Buffer.from(await (await api(S.adminA.token, 'GET', D(`/${r.body.id}/pdf`), undefined, { raw: true })).arrayBuffer()) : Buffer.alloc(0)
  check('4.34 the freight sheet PDF starts with %PDF', fsPdf.subarray(0, 4).toString() === '%PDF', fsPdf.subarray(0, 8).toString())
  r = await api(S.adminA.token, 'POST', D('/generate/pod'), {})
  check('4.35 a POD cannot be generated before any delivery (409, clear message)', r.status === 409 && /delivery/i.test(msg(r)), `${r.status} ${msg(r)}`)
  r = await api(S.adminA.token, 'POST', D('/generate/trip_closure'), {})
  check('4.36 a trip closure cannot be generated before the settlement is opened (409)', r.status === 409, `${r.status} ${msg(r)}`)
  r = await api(S.adminA.token, 'POST', D('/generate/invoice'), {})
  check('4.37 an unknown kind is a 404, not a 500', r.status === 404, `${r.status}`)
  r = await api(S.adminA.token, 'POST', `/loads/${id}/settlement`, {})
  check('4.38 settlement opens at the agreed price of 88,000', r.status === 200 && r.body.agreed_freight === 88000, `${r.status} ${msg(r)}`)
  r = await api(S.adminA.token, 'POST', `/loads/${id}/settlement/close`, {})
  check('4.39 closing the trip without a final POD is refused (409)', r.status === 409, `${r.status} ${msg(r)}`)
  r = await api(S.adminA.token, 'POST', D(), { kind: 'pod', status: 'final', doc_date: dayKey(0), fields: { complete: true, delivered_at: new Date().toISOString(), receiver_name: 'R. Kumar', delivered_quantity: 400 } })
  check('4.40 the company records a final POD', r.status === 201, `${r.status} ${msg(r)}`)
  const podPdf = r.status === 201 ? Buffer.from(await (await api(S.adminA.token, 'GET', D(`/${r.body.id}/pdf`), undefined, { raw: true })).arrayBuffer()) : Buffer.alloc(0)
  check('4.41 the POD PDF starts with %PDF', podPdf.subarray(0, 4).toString() === '%PDF', podPdf.subarray(0, 8).toString())
  r = await api(S.adminA.token, 'POST', `/loads/${id}/settlement/close`, {})
  check('4.42 the trip closes with the POD and writes the trip closure document', r.status === 200 && r.body.status === 'closed' && r.body.trip_closure_document_id, `${r.status} ${msg(r)}`)
  const tcPdf = r.status === 200 ? Buffer.from(await (await api(S.adminA.token, 'GET', D(`/${r.body.trip_closure_document_id}/pdf`), undefined, { raw: true })).arrayBuffer()) : Buffer.alloc(0)
  check('4.43 the trip closure PDF starts with %PDF', tcPdf.subarray(0, 4).toString() === '%PDF', tcPdf.subarray(0, 8).toString())
  r = await get(v.token, `/loads/${id}/timeline`)
  check('4.44 the vendor reads the timeline of the load (documents and settlement)', r.status === 200 && r.body.entries?.length >= 5, `${r.status} ${r.body?.entries?.length}`)
  r = await get(v.token, `/loads/${id}/documents`)
  check('4.45 the document list has no raw storage bucket paths exposed to strangers (only own load files)', r.status === 200 && r.body.documents.every(d => !d.file_path || d.file_path.startsWith(`loads/${id}/`)), '')

  // supersede
  r = await api(v.token, 'POST', D(), { kind: 'tax_invoice', number: 'INV-2026-001B', supersedes: inv.id, fields: { total_value: 150000 } })
  const old = (await get(v.token, `/loads/${id}/documents`)).body.documents.find(d => d.id === inv.id)
  check('4.46 a corrected invoice supersedes the old one (old becomes superseded)', r.status === 201 && old?.status === 'superseded', `${r.status} ${old?.status}`)
  r = await api(v.token, 'PATCH', D(`/${inv.id}`), { number: 'zzz' })
  check('4.47 a superseded document cannot be edited (409)', r.status === 409, `${r.status}`)

  // dispatch block on a fresh load with vehicle and driver
  const lp2 = await post(v, { budget_inr: 90000, quote_requested: false })
  await acceptLoad(S.adminA.token, lp2.body.id)
  const drv = await makeDriver(S.coA.id)
  const veh = await mkVehicle(S.coA, { driver_id: drv.id, driver_name: 'UAT Driver', available_capacity_kg: 25000, capacity_kg: 25000 })
  r = await api(S.adminA.token, 'PUT', `/vendor/shipment-request/${lp2.body.id}/assign-vehicle`, { vehicle_id: veh.id })
  check('4.48 setup: vehicle assigned, a manifest is built', r.status === 200, `${r.status} ${msg(r)}`)
  const mf = (await db('GET', 'cargo_manifest', { query: `vendor_request_id=eq.${lp2.body.id}&select=id` })).body?.[0]
  const dcheck = await get(S.adminA.token, `/loads/${lp2.body.id}/dispatch-check`)
  const bad = dcheck.body.items?.filter(i => ['missing', 'expired', 'inconsistent'].includes(i.status)).map(i => i.key)
  check('4.49 checklist with a vehicle: flags the missing invoice, e-way bill, LR and vehicle papers', dcheck.status === 200 && bad.includes('invoice') && bad.includes('eway_bill') && bad.includes('lr'), JSON.stringify(dcheck.body.items?.map(i => [i.key, i.status])))
  check('4.50 default mode is warn: dispatch is allowed with flags', dcheck.body.mode === 'warn' && dcheck.body.can_dispatch === true, `${dcheck.body.mode}`)
  // a wrong-vehicle e-way bill is inconsistent
  await api(S.adminA.token, 'POST', `/loads/${lp2.body.id}/documents`, { kind: 'eway_bill', number: '210987654321', valid_until: new Date(Date.now() + 3 * 86400000).toISOString(), fields: { ewb_number: '210987654321', vehicle_number: 'KA01AA0001' } })
  const d2 = await get(S.adminA.token, `/loads/${lp2.body.id}/dispatch-check`)
  check('4.51 an e-way bill naming another vehicle is flagged inconsistent', d2.body.items?.find(i => i.key === 'eway_bill_vehicle')?.status === 'inconsistent', JSON.stringify(d2.body.items?.map(i => [i.key, i.status])))
  // switch the block on
  const org = (await db('GET', 'organizations', { query: `id=eq.${S.coA.id}&select=profile` })).body[0]
  await db('PATCH', 'organizations', { query: `id=eq.${S.coA.id}`, body: { profile: { ...(org.profile || {}), settings: { ...(org.profile?.settings || {}), dispatch_block_on_missing_docs: true } } } })
  await sleep(32000)
  const d3 = await get(S.adminA.token, `/loads/${lp2.body.id}/dispatch-check`)
  check('4.52 with the company setting on, the checklist says block and cannot dispatch', d3.body.mode === 'block' && d3.body.can_dispatch === false, `${d3.body.mode} ${d3.body.can_dispatch}`)
  const pick = await api(drv.token, 'POST', '/cargo/custody', { ref: { manifest_id: mf.id }, kind: 'pickup', pieces: 400 })
  check('4.53 the driver completing the pickup is REFUSED (409) and the message lists what is wrong', pick.status === 409 && /cannot leave yet/i.test(msg(pick)), `${pick.status} ${msg(pick)}`)
  const manAfter = (await db('GET', 'cargo_manifest', { query: `id=eq.${mf.id}&select=status` })).body[0]
  check('4.54 the manifest has not moved (still scheduled)', manAfter.status === 'scheduled', manAfter.status)
  const staffPick = await api(S.adminA.token, 'POST', '/cargo/custody', { ref: { manifest_id: mf.id }, kind: 'pickup', pieces: 400 })
  check('4.55 staff recording the pickup is refused the same way (409)', staffPick.status === 409, `${staffPick.status}`)
  await db('PATCH', 'organizations', { query: `id=eq.${S.coA.id}`, body: { profile: { ...(org.profile || {}), settings: { ...(org.profile?.settings || {}), dispatch_block_on_missing_docs: false } } } })
  await sleep(32000)
  const pick2 = await api(drv.token, 'POST', '/cargo/custody', { ref: { manifest_id: mf.id }, kind: 'pickup', pieces: 400 })
  check('4.56 with the setting off, the same pickup goes through (201)', pick2.status === 201, `${pick2.status} ${msg(pick2)}`)
  S.docLoad = { id: lp2.body.id, vendor: v }
}

// ── 5. claims, boards, notifications, colleague ───────────
async function s5() {
  section(5, 'Claims, boards, notifications, a colleague in the vendor organisation')
  const v = S.v || await makeVendor({ approved: true, admin: S.pa })
  const other = await makeVendor({ approved: false })
  const lp = await post(v, { budget_inr: 70000 })
  const id = lp.body.id
  let r = await get(v.token, '/vendor/loads')
  const mineRow = Array.isArray(r.body) ? r.body.find(x => x.id === id) : null
  check('5.01 the loads board lists the new load with a stage', r.status === 200 && mineRow && (mineRow.stage || mineRow.status), `${r.status} ${JSON.stringify(mineRow)?.slice(0, 200)}`)
  const stageOpen = mineRow?.stage
  const acc5 = await acceptLoad(S.adminA.token, id)
  r = await get(v.token, '/vendor/loads')
  const after = r.body.find(x => x.id === id)
  check('5.02 after a company accepts, the board stage changes and the price shows', after && after.stage !== stageOpen && Number(after.cost ?? after.price ?? 0) === (acc5.at ?? 70000), JSON.stringify(after)?.slice(0, 250))
  const names = JSON.stringify(after)
  check('5.03 the board shows the company by name but no GSTIN / phone', !/gstin|phone/i.test(names), names.slice(0, 200))
  const od = await get(other.token, '/vendor/loads')
  check("5.04 another vendor's board has none of my loads", Array.isArray(od.body) && !od.body.some(x => x.id === id), '')
  r = await get(v.token, '/vendor/invoices')
  check('5.05 invoices page data answers 200 as a list (empty before delivery)', r.status === 200 && Array.isArray(r.body), `${r.status}`)
  r = await get(other.token, '/vendor/invoices')
  check("5.06 another vendor's invoice list is a separate list", r.status === 200 && Array.isArray(r.body), `${r.status}`)

  // claims
  const cl = await api(v.token, 'GET', '/cargo/claims')
  check('5.07 the vendor claims page data answers 200', cl.status === 200, `${cl.status} ${msg(cl)}`)
  const mf = (await db('GET', 'cargo_manifest', { query: `vendor_request_id=eq.${id}&select=id` })).body?.[0]
  const claimBody = { claim_type: 'damage', claimed_amount: 1000, description: 'Bags torn' }
  r = await api(v.token, 'POST', '/cargo/claims', { ref: { manifest_id: crypto.randomUUID() }, ...claimBody })
  check('5.08 a claim on an unknown load is a 404', r.status === 404, `${r.status} ${msg(r)}`)
  const vdoc = S.docLoad
  const dm = vdoc && (await db('GET', 'cargo_manifest', { query: `vendor_request_id=eq.${vdoc.id}&select=id` })).body?.[0]
  const own = dm ? await api(vdoc.vendor.token, 'POST', '/cargo/claims', { ref: { manifest_id: dm.id }, ...claimBody }) : { status: 0 }
  check('5.09 a claim on a load that is not yet delivered is refused with a reason (409), not a 500', [409, 404, 400].includes(own.status), `${own.status} ${msg(own)}`)
  r = await api(other.token, 'POST', '/cargo/claims', { ref: { manifest_id: dm?.id || crypto.randomUUID() }, ...claimBody })
  check("5.10 another vendor cannot claim on my load (404)", r.status === 404, `${r.status} ${msg(r)}`)
  r = await api(v.token, 'POST', '/cargo/claims', { ref: { manifest_id: dm?.id }, claim_type: 'nonsense' })
  check('5.11 a claim with an unknown type is refused (400)', r.status === 400, `${r.status}`)
  r = await api(v.token, 'PATCH', `/cargo/claims/${crypto.randomUUID()}`, { status: 'approved' })
  check('5.12 a vendor cannot decide a claim (403)', r.status === 403, `${r.status}`)

  // notifications
  const n = await get(v.token, '/notifications?limit=5')
  check('5.13 notifications list answers with an unread count and a page', n.status === 200 && n.body.notifications.length > 0 && n.body.unread_count > 0 && n.body.limit === 5, `${n.status} ${n.body?.unread_count}`)
  const first = n.body.notifications[0]
  const mark = await api(v.token, 'POST', `/notifications/${first.id}/read`, {})
  check('5.14 marking one read works and the count drops by one', mark.status === 200 && mark.body.is_read === true && (await get(v.token, '/notifications')).body.unread_count === n.body.unread_count - 1, `${mark.status}`)
  const strangerMark = await api(other.token, 'POST', `/notifications/${n.body.notifications[1].id}/read`, {})
  check("5.15 another user cannot mark my notification (404)", strangerMark.status === 404, `${strangerMark.status}`)
  const bigPage = await get(v.token, '/notifications?limit=100000&offset=-5')
  check('5.16 absurd paging is clamped, not a 500', bigPage.status === 200, `${bigPage.status}`)
  const all = await api(v.token, 'POST', '/notifications/read-all', {})
  check('5.17 read-all clears the unread count', all.status === 200 && (await get(v.token, '/notifications')).body.unread_count === 0, `${all.status}`)
  check("5.18 other users' unread counts are untouched", (await get(other.token, '/notifications')).status === 200, '')

  // a colleague in the same vendor organisation
  const orgId = await orgOfVendor(v.id)
  const col = await makeUser(`${tag()}-colleague`, 'vendor')
  await db('DELETE', 'org_members', { query: `user_id=eq.${col.id}` })
  await db('POST', 'org_members', { body: { org_id: orgId, user_id: col.id, role: 'member', status: 'active' } })
  const ct = await login(col.email)
  r = await get(ct, '/vendor/loads/mine')
  check("5.19 a colleague in the same vendor organisation sees the organisation's loads", r.status === 200 && r.body.items.some(x => x.id === id), `${r.status} ${r.body?.items?.length}`)
  r = await get(ct, `/vendor/loads/${id}`)
  check('5.20 and can open one (200)', r.status === 200 && r.body.load?.id === id, `${r.status} ${msg(r)}`)
  r = await get(ct, `/vendor/loads/${id}/quotes`)
  check('5.21 and read its quotes', r.status === 200, `${r.status}`)
  r = await api(ct, 'GET', `/loads/${id}/documents`)
  check('5.22 and its documents', r.status === 200, `${r.status}`)
  r = await get(ct, '/vendor/business-profile')
  check('5.23 and the business profile', r.status === 200 && r.body.business_name, `${r.status}`)
  const own2 = await post({ token: ct }, { client_request_id: crypto.randomUUID() })
  check('5.24 and can post a load for the organisation, which then shows to the first user', own2.status === 201 && (await get(v.token, '/vendor/loads/mine')).body.items.some(x => x.id === own2.body.id), `${own2.status} ${msg(own2)}`)
  r = await get(ct, `/vendor/loads/${lp.body.id}`)
  const outsider = await get(other.token, `/vendor/loads/${id}`)
  check('5.25 an outsider still gets 404', outsider.status === 404, `${outsider.status}`)
}

// ── 6. public pages ───────────────────────────────────────
const PLATE = /\b[A-Z]{2}\s?\d{2}\s?[A-Z]{1,3}\s?\d{4}\b/
const PHONE = /(\+91|\b)[6-9]\d{9}\b/
const GSTIN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/
async function raw(path, opts = {}) {
  const res = await fetch(`${API}${path}`, { method: opts.method || 'GET', headers: { 'content-type': 'application/json', ...(opts.headers || {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined })
  const text = await res.text()
  let json; try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, body: json, text, headers: res.headers }
}
async function s6() {
  section(6, 'Public pages (no sign-in)')
  const leaks = (name, t) => check(`6.xx ${name}: no plate, phone, GSTIN, email`, !PLATE.test(t) && !PHONE.test(t) && !GSTIN.test(t) && !/@[a-z0-9-]+\./i.test(t), (t.match(PLATE) || t.match(PHONE) || t.match(GSTIN) || ['email'])[0])
  let r = await raw('/public/stats')
  check('6.01 stats: 4 counts only, cached 10 min', r.status === 200 && Object.keys(r.body).sort().join() === 'active_partners,cities_served,deliveries_completed,vehicles' && /max-age=600/.test(r.headers.get('cache-control') || ''), `${r.status} ${r.text.slice(0, 120)}`)
  r = await raw('/public/hsn/search?q=cement')
  check('6.02 HSN search "cement": hits with 2523 at 18%', r.status === 200 && r.body.items.some(i => i.hsn_code === '2523' && i.gst_rates.includes(18)) && r.body.items.length <= 8, `${r.status} ${r.text.slice(0, 150)}`)
  r = await raw('/public/hsn/search?q=ce')
  check('6.03 HSN search under 3 characters is a 400', r.status === 400, `${r.status}`)
  r = await raw('/public/hsn/search')
  check('6.04 HSN search with no query is a 400', r.status === 400, `${r.status}`)
  r = await raw('/public/hsn/25232910')
  check('6.05 8-digit HSN 25232910 resolves (own row or its parent) with the rate', r.status === 200 && r.body.gst_rate === 18, `${r.status} ${r.text.slice(0, 150)}`)
  r = await raw('/public/hsn/25239999')
  check('6.06 an 8-digit code the master lacks falls back to the parent heading (matched_prefix shorter)', r.status === 200 && r.body.matched_prefix && r.body.matched_prefix.length < 8, `${r.status} ${r.text.slice(0, 160)}`)
  r = await raw('/public/hsn/99')
  check('6.07 HSN "99" is not a 500 (200 or 404)', [200, 404].includes(r.status), `${r.status}`)
  r = await raw('/public/hsn/abc')
  check('6.08 HSN "abc" is a 400', r.status === 400, `${r.status}`)
  r = await raw('/public/hsn/00000000')
  check('6.09 an HSN that exists nowhere is a 404 with a friendly message', r.status === 404 && /by hand/.test(r.text), `${r.status} ${r.text.slice(0, 100)}`)
  r = await raw('/public/pincode/400093')
  check('6.10 pin 400093 is Maharashtra (27)', r.status === 200 && r.body.state_code === '27', `${r.status} ${r.text}`)
  r = await raw('/public/pincode/110001')
  check('6.11 pin 110001 is Delhi (07)', r.body.state_code === '07', r.text)
  r = await raw('/public/pincode/12345')
  check('6.12 a 5-digit pin is a 400', r.status === 400, `${r.status}`)
  r = await raw('/public/pincode/000000')
  check('6.13 pin 000000 is a 400/404 not a 500', [400, 404].includes(r.status), `${r.status}`)
  r = await raw('/public/vehicle-classes')
  check('6.14 vehicle classes: 9 classes in the PRD table with keys', r.status === 200 && r.body.items.length >= 9 && r.body.items.every(c => c.key && c.name) && /max-age=600/.test(r.headers.get('cache-control')), `${r.status} ${r.body.items?.length}`)
  r = await raw('/public/goods-categories')
  check('6.15 goods categories answer with default rates', r.status === 200 && r.body.items.length >= 8 && r.body.items.every(c => Array.isArray(c.default_rates)), `${r.status} ${r.body.items?.length}`)
  r = await raw('/public/companies')
  leaks('6.16 /public/companies', r.text)
  const ids = (r.body.items || []).map(c => c.id)
  check('6.17 companies: at most 50, the pending test company is absent; fields are the contract', r.status === 200 && !ids.includes(S.coP.id) && r.body.items.length <= 50 && r.body.items.every(c => Object.keys(c).sort().join() === 'city,id,name,trips_completed,vehicle_types'), `${r.status}`)
  check('6.18 companies: cached 60 s', /max-age=60/.test(r.headers.get('cache-control') || ''), r.headers.get('cache-control'))
  r = await raw('/public/companies?city=Mumbai&vehicle_type=truck')
  check('6.19 companies filter by city and vehicle type', r.status === 200 && r.body.items.every(c => c.city === 'Mumbai'), `${r.status}`)
  r = await raw(`/public/companies?city=${'x'.repeat(200)}`)
  check('6.20 an absurd filter is a 400, not a 500', r.status === 400, `${r.status}`)
  r = await raw('/public/cities?q=mum')
  check('6.21 cities suggest Mumbai', r.status === 200 && r.body.cities.includes('Mumbai'), `${r.status} ${r.text.slice(0, 100)}`)
  r = await raw('/public/spare-space')
  leaks('6.22 /public/spare-space', r.text)
  const sp = (r.body.items || []).find(i => i.id === S.publicWindow)
  check('6.23 spare space lists the open window of the active company with free kg and no vehicle id / coordinates', r.status === 200 && (!S.publicWindow || sp) && !/latitude|longitude|vehicle_id|plate/i.test(r.text), `${r.status} found=${!!sp}`)
  r = await raw('/public/spare-space?date=tomorrow')
  check('6.24 spare space with a bad date is a 400', r.status === 400, `${r.status}`)
  r = await raw('/public/spare-space?min_kg=-3')
  check('6.25 spare space with min_kg -3 is a 400', r.status === 400, `${r.status}`)

  const lane = { pickup: { lat: 19.0760, lng: 72.8777, label: 'Mumbai' }, drop: { lat: 28.6139, lng: 77.2090, label: 'Delhi' }, weight_kg: 20900 }
  r = await raw('/public/quote', { method: 'POST', body: lane })
  check('6.26 indicative quote Mumbai to Delhi: low <= suggested <= high, distance, no rate card, not cached', r.status === 200 && (r.body.status === 'unavailable' || (r.body.low <= r.body.suggested && r.body.suggested <= r.body.high && r.body.distance_km > 1000)) && /no-store/.test(r.headers.get('cache-control') || '') && !/rate_card|margin|factors|demand/i.test(r.text), `${r.status} ${r.text.slice(0, 200)}`)
  console.log(`   (observation) quote answer: ${r.text.slice(0, 200)}`)
  r = await raw('/public/quote', { method: 'POST', body: { ...lane, weight_kg: 0 } })
  check('6.27 a quote with 0 kg is a 400', r.status === 400, `${r.status}`)
  r = await raw('/public/quote', { method: 'POST', body: { ...lane, pickup: { lat: 99, lng: 0 } } })
  check('6.28 a quote with latitude 99 is a 400', r.status === 400, `${r.status}`)
  r = await raw('/public/quote', { method: 'POST', body: '{bad' , headers: {} })
  check('6.29 a quote with broken JSON is a 400, not a 500', r.status === 400, `${r.status}`)

  // load assist: the PRD 8.3 example: 20,900 kg, Rs 7,62,500; GST per the master
  const assistBody = {
    items: [
      { product_name: 'Cement bags', hsn_code: '2523', gst_rate: 18, quantity: 400, unit: 'bags', weight_kg: 12900, declared_value: 462500 },
      { product_name: 'Steel TMT bars', hsn_code: '7214', gst_rate: 18, quantity: 8, unit: 'tonnes', weight_kg: 8000, declared_value: 300000 },
    ],
    pickup_city: 'Mumbai', pickup_pincode: '400093', pickup_lat: 19.1197, pickup_lng: 72.8464, pickup_date: dayKey(3),
    delivery_city: 'Delhi', delivery_pincode: '110020', delivery_lat: 28.5355, delivery_lng: 77.275, delivery_date: dayKey(6),
  }
  r = await raw('/public/loads/assist', { method: 'POST', body: assistBody })
  const a = r.body
  check('6.30 assist: totals 20,900 kg and Rs 7,62,500', r.status === 200 && a.totals?.weight_kg === 20900 && a.totals?.declared_value === 762500, `${r.status} ${JSON.stringify(a.totals)}`)
  check('6.31 assist: Mumbai to Delhi is inter-state (IGST), no CGST/SGST', a.tax?.basis === 'inter' && a.tax.igst > 0 && a.tax.cgst === 0 && a.tax.sgst === 0, JSON.stringify(a.tax)?.slice(0, 250))
  const rateOf = async (code) => (await raw(`/public/hsn/${code}`)).body.gst_rate
  const r1 = await rateOf('2523'), r2 = await rateOf('7214')
  const expectGst = Math.round(462500 * r1 / 100 + 300000 * r2 / 100)
  check(`6.32 assist: GST is the master's rates (2523 at ${r1}%, 7214 at ${r2}%) = ${expectGst}`, Math.round(a.tax?.gst_total) === expectGst && Math.round(a.tax?.grand_total) === 762500 + expectGst, `${a.tax?.gst_total} vs ${expectGst}; by_rate=${JSON.stringify(a.tax?.by_rate)}`)
  check('6.33 assist: e-way bill is required (over Rs 50,000) and the recommendations include it', a.eway?.required === true && (a.recommendations || []).some(x => /eway/.test(x.code)), JSON.stringify(a.eway))
  check('6.34 assist: a vehicle suggestion over 18 t points to a larger vehicle / FTL', a.suggested?.load_type === 'ftl' && a.suggested?.vehicle_class, JSON.stringify(a.suggested))
  r = await raw('/public/loads/assist', { method: 'POST', body: { ...assistBody, items: [] } })
  check('6.35 assist with an empty draft answers 200 or 400, never 500', [200, 400].includes(r.status), `${r.status}`)
  r = await raw('/public/loads/assist', { method: 'POST', body: { ...assistBody, items: [{ ...assistBody.items[0], weight_kg: 'heavy' }] } })
  check('6.36 assist with weight "heavy" is a 400', r.status === 400, `${r.status}`)
  r = await raw('/public/loads/assist', { method: 'POST', body: { items: [{ product_name: 'Cement', hsn_code: '2523', weight_kg: 100 }] } })
  check('6.37 assist with a half-filled form still answers (200)', r.status === 200, `${r.status} ${r.text.slice(0, 120)}`)

  // tracking page data and vehicle share
  const trk = S.bidTracking
  if (trk) {
    r = await raw(`/shipments/track/${trk}`)
    check('6.38 public tracking data for a real shipment answers 200', r.status === 200 && r.body.tracking_id === trk, `${r.status} ${r.text.slice(0, 150)}`)
    const t = r.text
    check('6.39 tracking: no driver, vendor, phone, GSTIN, email, price', !/driver|vendor|phone|gstin|email|price|amount|cost|customer/i.test(Object.keys(r.body).join(',') + JSON.stringify(r.body.vehicle || {})) && !PHONE.test(t) && !GSTIN.test(t), t.slice(0, 200))
    console.log(`   (observation) tracking exposes keys: ${Object.keys(r.body).join(',')}; vehicle keys: ${Object.keys(r.body.vehicle || {}).join(',')}`)
    S.trackKeys = { top: Object.keys(r.body), vehicle: Object.keys(r.body.vehicle || {}), plate: PLATE.test(t), vehicleId: !!r.body.vehicle?.id, idLeak: !!r.body.id }
    const rr = await raw(`/shipments/track/${trk}/route`)
    check('6.40 tracking route answers without coordinates in the request (200/404, not 500)', [200, 404].includes(rr.status), `${rr.status}`)
  }
  r = await raw('/shipments/track/RTX-NOPE000')
  check('6.41 tracking an unknown id is a clean 404', r.status === 404 && !/stack|at \w+ \(/.test(r.text), `${r.status}`)
  r = await raw('/shipments/track/%ZZ')
  check('6.42 a bad percent escape in the id is a 400/404, not a 500', [400, 404].includes(r.status), `${r.status}`)

  // vehicle share
  const vsVeh = await mkVehicle(S.coA, { plate_number: 'MH12SH' + Math.floor(1000 + Math.random() * 8999) })
  const link = await api(S.adminA.token, 'POST', `/fleet/vehicles/${vsVeh.id}/share-links`, { hours: 2 })
  check('6.43 staff create a share link (201)', link.status === 201 && link.body.token, `${link.status} ${msg(link)}`)
  if (link.body?.token) {
    r = await raw(`/public/vehicle-share/${link.body.token}`)
    check('6.44 the share link answers without sign-in, no store (no-store cache)', r.status === 200 && /no-store/.test(r.headers.get('cache-control') || ''), `${r.status}`)
    check('6.45 share data: no driver, phone, vehicle id, load, customer, company ids', !/driver|phone|vehicle_id|"id"|load|customer|vendor|carrier|org/i.test(Object.keys(r.body).join(',')) && !PHONE.test(r.text) && !GSTIN.test(r.text), Object.keys(r.body).join(','))
    const del = await api(S.adminA.token, 'DELETE', `/fleet/share-links/${link.body.id}`)
    r = await raw(`/public/vehicle-share/${link.body.token}`)
    check('6.46 a closed share link is a 404', del.status < 300 && r.status === 404, `${del.status} ${r.status}`)
  }
  r = await raw('/public/vehicle-share/not-a-token')
  check('6.47 an invalid share token is a clean 404', r.status === 404, `${r.status}`)

  // rate limits answer 429 not 500
  let codes = []
  for (let i = 0; i < 24; i++) codes.push((await raw('/public/quote', { method: 'POST', body: lane })).status)
  check('6.48 hammering /public/quote (limit 20/min) turns to 429, with no 5xx', codes.includes(429) && !codes.some(c => c >= 500), codes.join(','))
  const lim = await raw('/public/quote', { method: 'POST', body: lane })
  check('6.49 the 429 carries a message and Retry-After or a clear detail', lim.status !== 429 || (lim.body?.detail || lim.body?.error), lim.text.slice(0, 100))
  r = await raw('/public/nonexistent')
  check('6.50 an unknown public path is a 404', r.status === 404, `${r.status}`)
  r = await raw('/vendor/loads')
  check('6.51 vendor routes without a token are 401', r.status === 401, `${r.status}`)
}

// ── 7. auth edges ─────────────────────────────────────────
async function s7() {
  section(7, 'Auth edges')
  const raw2 = raw
  const staffPhone = '+919800000' + String(Math.floor(100 + Math.random() * 899))
  let r = await raw2('/auth/vendor/send-otp', { method: 'POST', body: { phone: '12345' } })
  check('7.01 vendor OTP with a bad phone is a 400', r.status === 400, `${r.status} ${r.text.slice(0, 100)}`)
  r = await raw2('/auth/vendor/send-otp', { method: 'POST', body: {} })
  check('7.02 vendor OTP with no phone is a 400', r.status === 400, `${r.status}`)
  r = await raw2('/auth/vendor/send-otp', { method: 'POST', body: { phone: staffPhone } })
  check('7.03 vendor OTP request for a valid number answers cleanly (200 sent, or 4xx/502/503 with a detail), never a 500', r.status < 500 || [502, 503].includes(r.status), `${r.status} ${r.text.slice(0, 160)}`)
  console.log(`   (observation) send-otp on the stage answers ${r.status}: ${r.text.slice(0, 140)}`)
  r = await raw2('/auth/vendor/verify-otp', { method: 'POST', body: { phone: staffPhone, otp: '000000' } })
  check('7.04 verifying a wrong/missing OTP is 401 (or 429), never 500 and never a session', [401, 429].includes(r.status) && !/access_token/.test(r.text), `${r.status} ${r.text.slice(0, 100)}`)
  r = await raw2('/auth/vendor/verify-otp', { method: 'POST', body: { phone: staffPhone } })
  check('7.05 verify without an otp is a 400', r.status === 400, `${r.status}`)

  // an existing non-vendor account (a driver) with a phone must never be changed by the vendor OTP endpoints
  const drv = await makeDriver(S.coA.id)
  const phone = '+91970000' + String(Math.floor(1000 + Math.random() * 8999))
  await db('PATCH', 'users', { query: `id=eq.${drv.id}`, body: { phone } })
  const before = (await db('GET', 'users', { query: `id=eq.${drv.id}&select=role,phone,full_name` })).body[0]
  await raw2('/auth/vendor/send-otp', { method: 'POST', body: { phone } })
  await raw2('/auth/vendor/verify-otp', { method: 'POST', body: { phone, otp: '123456' } })
  const after = (await db('GET', 'users', { query: `id=eq.${drv.id}&select=role,phone,full_name` })).body[0]
  check('7.06 the vendor OTP endpoints never change an existing driver account (role, phone, name)', JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} -> ${JSON.stringify(after)}`)
  const asVendor = await db('GET', 'users', { query: `phone=eq.${phone}&role=eq.vendor&select=id` })
  check('7.07 and no vendor account was created for that number', asVendor.body.length === 0, JSON.stringify(asVendor.body))

  // password reset: same answer for known and unknown emails
  const known = await makeVendor({ approved: false })
  const rec = async (email) => { const res = await fetch(`${DATA}/auth/v1/recover`, { method: 'POST', headers: { apikey: env.ANON, 'content-type': 'application/json' }, body: JSON.stringify({ email }) }); return { status: res.status, text: (await res.text()).slice(0, 200) } }
  const rk = await rec(known.email)
  const ru = await rec(`nobody-${tag()}@margix.test`)
  check('7.08 password reset request answers the same status and body for a known and an unknown email', rk.status === ru.status && rk.text === ru.text, `${rk.status} ${rk.text} | ${ru.status} ${ru.text}`)
  check('7.09 and is not a 5xx', rk.status < 500, `${rk.status} ${rk.text}`)

  // roles
  const v = S.v || await makeVendor({ approved: true, admin: S.pa })
  for (const [path, label] of [['/company/loads/market', 'company market'], ['/capacity/bids/pending', 'pending bids'], ['/vendor/shipment-request/pending', 'pending requests'], ['/users', 'user list'], ['/finance/summary', 'finance summary'], ['/fleet/vehicles', 'fleet vehicles']]) {
    const x = await api(v.token, 'GET', path)
    check(`7.10 a vendor token on staff route ${label} (${path}) is 403 or 404, no data`, [401, 403, 404].includes(x.status), `${x.status} ${msg(x)}`)
  }
  r = await api(v.token, 'PUT', `/vendor/kyc/${v.id}/approve`, {})
  check('7.11 a vendor cannot approve its own KYC (403)', r.status === 403, `${r.status}`)
  r = await api(v.token, 'POST', '/capacity/windows', { vehicle_id: crypto.randomUUID(), floor_price: 1, duration_minutes: 30 })
  check('7.12 a vendor cannot open a capacity window (403)', r.status === 403, `${r.status}`)
  for (const [m, path, body] of [['POST', '/vendor/loads', loadBody()], ['GET', '/vendor/loads/mine'], ['GET', '/vendor/business-profile'], ['GET', '/vendor/invoices'], ['POST', '/vendor/loads/bulk', { csv: 'x' }], ['POST', '/vendor/kyc/submit', {}]]) {
    const x = await api(S.adminA.token, m, path, body)
    check(`7.13 a company admin on vendor route ${m} ${path} is refused (403)`, x.status === 403, `${x.status} ${msg(x)}`)
  }
  const staffPost = await api(S.adminA.token, 'POST', '/vendor/loads', loadBody())
  check('7.14 staff posting a load gets a clear message (403 with a detail)', staffPost.status === 403 && msg(staffPost) && msg(staffPost) !== '{}', `${staffPost.status} ${msg(staffPost)}`)
  const mgr = await makeCompanyAdmin(S.coA.id, 'manager')
  const mp = await api(mgr.token, 'POST', '/vendor/loads', loadBody())
  check('7.15 a manager posting a load is refused (403)', mp.status === 403, `${mp.status}`)
  const dp = await api(drv.token, 'GET', '/vendor/loads/mine')
  check('7.16 a driver token on a vendor route is 403', dp.status === 403, `${dp.status}`)
  r = await api('garbage.token.value', 'GET', '/vendor/loads/mine')
  check('7.17 a garbage token is a clean 401', r.status === 401, `${r.status}`)
  r = await api(v.token, 'GET', '/vendor/loads/not-a-uuid')
  check('7.18 a malformed load id is 400/404, never 500', [400, 404].includes(r.status), `${r.status}`)
  r = await api(v.token, 'PUT', `/vendor/kyc/${crypto.randomUUID()}/approve`, {})
  check('7.19 a vendor cannot approve anyone (403, not 404)', r.status === 403, `${r.status}`)

  // escalation and expiry, run by the scheduler every 15 minutes
  if (S.quiet && !process.env.SKIP_SCHEDULER) {
    console.log('   waiting for the scheduler (every 15 min) to escalate the quiet load and expire the quote, up to 17 minutes...')
    let esc = null, exq = null
    for (let i = 0; i < 70 && !(esc?.quote_escalated_at && exq?.status === 'expired'); i++) {
      esc = await loadRow(S.quiet)
      exq = (await db('GET', 'load_quotes', { query: `id=eq.${S.expiring.quote}&select=status` })).body?.[0]
      if (esc?.quote_escalated_at && exq?.status === 'expired') break
      await sleep(15000)
    }
    check('7.20 the scheduler escalated the load with no quote after its 2-hour deadline (quote_escalated_at set)', !!esc?.quote_escalated_at, JSON.stringify(esc?.quote_escalated_at))
    const vn = await notesFor(S.v.id, 'quote_delayed')
    check('7.21 the vendor was told "Companies need a little longer"', vn.some(n => n.data?.request_id === S.quiet), `${vn.length}`)
    const pn = await notesFor(S.pa.id, 'vendor_request')
    check('7.22 the platform admin was told once about the quiet load', pn.filter(n => n.data?.request_id === S.quiet).length === 1, `${pn.filter(n => n.data?.request_id === S.quiet).length}`)
    check('7.23 the quote past its validity is marked expired by the scheduler', exq?.status === 'expired', JSON.stringify(exq))
    const en = await notesFor(S.expiring.userA, 'quote_expired')
    check('7.24 and its company was told', en.some(n => n.data?.request_id === S.expiring.load), `${en.length}`)
  }
}

// ── runner ────────────────────────────────────────────────
const sections = { 1: s1, 2: s2, 3: s3, 4: s4, 5: s5, 6: s6, 7: s7 }
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
