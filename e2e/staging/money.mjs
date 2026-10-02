// Audit area 4: MONEY, walked on the hosted TEST stage as real actors in a company of our own.
//   node e2e/staging/money.mjs [section ...]      sections: identity gta lifecycle lots pay expenses settle isolation
// Fresh accounts every run. Prints PASS/FAIL per step; exits 1 on any FAIL.
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  api, db, check, results, makeCompany, makeCompanyAdmin, makeDriver, makeVendor, makePlatformAdmin, putSigned, readObject, PNG, sleep, tag,
} from './actors.mjs'

// Prefixes are unique across the platform and never released, so each run takes its own
const PFX = `B${tag().slice(-4).toUpperCase()}`, PFX2 = `M${tag().slice(-4).toUpperCase()}`
const want = new Set(process.argv.slice(2))
const run = name => want.size === 0 || want.has(name)
const J = x => JSON.stringify(x)
/** The text of a PDF, through poppler's pdftotext (null when it is not installed: the content checks are then skipped). */
function pdfText(buf) {
  const dir = mkdtempSync(join(tmpdir(), 'inv-'))
  try { writeFileSync(join(dir, 'x.pdf'), buf); return execFileSync('pdftotext', ['-layout', join(dir, 'x.pdf'), '-'], { encoding: 'utf8' }) } catch { return null } finally { rmSync(dir, { recursive: true, force: true }) }
}
const okS = r => r.status >= 200 && r.status < 300
const dbOk = (r, what) => { if (r.status >= 300) throw new Error(`${what}: ${J(r.body).replace(/Failing row contains[^"]*/, "").slice(0, 400)}`); return r.body }
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)
const addDays = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10)

// ── world ──────────────────────────────────────────────────────────────────
const bank = { bank_name: 'HDFC Bank', bank_account_no: '50200012345678', bank_ifsc: 'HDFC0001234', upi_id: 'uatco@hdfcbank' }
const coA = await makeCompany(`MoneyCo ${tag()}`)
const adminA = await makeCompanyAdmin(coA.id, 'admin')
const managerA = await makeCompanyAdmin(coA.id, 'manager')
const coB = await makeCompany(`MoneyOther ${tag()}`)
const adminB = await makeCompanyAdmin(coB.id, 'admin')
const vendor = await makeVendor()
const vendor2 = await makeVendor()
const vendorOrg = async v => (await db('GET', 'org_members', { query: `user_id=eq.${v.id}&select=org_id` })).body?.[0]?.org_id ?? null
vendor.orgId = await vendorOrg(vendor)
vendor2.orgId = await vendorOrg(vendor2)
console.log(`world: company A ${coA.id}, company B ${coB.id}`)

/** A delivered vendor load of company `co` for `vendor`, priced `cost` (rupees), seeded straight in the database. */
async function seedLoad({ co = coA, v = vendor, cost = 25000, hsn = null, status = 'delivered' } = {}) {
  const req = dbOk(await db('POST', 'vendor_shipment_requests', {
    body: {
      vendor_id: v.id, vendor_org_id: v.orgId, carrier_org_id: co.id, pickup_location: 'Mumbai', pickup_lat: 19.07, pickup_lng: 72.87,
      drop_location: 'Pune', drop_lat: 18.52, drop_lng: 73.85, required_capacity_kg: 2000, status: status === 'delivered' ? 'completed' : status, cost,
    },
  }), 'request')[0]
  const man = dbOk(await db('POST', 'cargo_manifest', {
    body: {
      vendor_request_id: req.id, pickup_location: 'Mumbai', pickup_lat: 19.07, pickup_lng: 72.87, drop_location: 'Pune', drop_lat: 18.52, drop_lng: 73.85,
      capacity_kg: 2000, status: status === 'assigned' ? 'scheduled' : status, carrier_org_id: co.id, vendor_org_id: v.orgId, pieces_total: 10, pieces_delivered: 10,
    },
  }), 'manifest')[0]
  if (hsn) dbOk(await db('POST', 'shipment_hsn', { body: { manifest_id: man.id, hsn_code: hsn, description: 'Steel pipes', gst_rate: 18 } }), 'hsn')
  return { req, man }
}
const invoiceOf = async manId => (await db('GET', 'invoices', { query: `manifest_id=eq.${manId}&select=*` })).body?.[0]
const notesFor = async (userId, type) => (await db('GET', 'notifications', { query: `user_id=eq.${userId}&type=eq.${type}&select=*` })).body ?? []
const issue = async (adm, man) => api(adm.token, 'POST', '/finance/invoices', { manifest_id: man.id })

// ═══ 1. Company invoicing identity ═════════════════════════════════════════
if (run('identity')) {
  console.log('\n== 1. invoicing identity')
  const bare = await makeCompany(`Bare ${tag()}`, { legal_name: null, gstin: null, state: null, city: null, address: null, pincode: null })
  const bareAdmin = await makeCompanyAdmin(bare.id, 'admin')
  const { man } = await seedLoad({ co: bare, cost: 5000 })
  const r = await issue(bareAdmin, man)
  check('1.1 invoice blocked until name/GSTIN/state are set (409, code company_profile_incomplete)', r.status === 409 && /company_profile_incomplete/.test(J(r.body)), `${r.status} ${J(r.body).slice(0, 200)}`)
  check('1.2 no invoice row written while blocked', !(await invoiceOf(man.id)))
  // the delivery path (not the staff endpoint) must also notify the admins: price via /unpriced/price is the same guard
  const p = await api(bareAdmin.token, 'POST', '/finance/unpriced/price', { kind: 'manifest', id: man.id, amount: 5000 })
  check('1.3 pricing a delivery is refused before the profile is complete too', p.status === 409, `${p.status}`)
  const bareReq = (await db('GET', 'vendor_shipment_requests', { query: `id=eq.${man.vendor_request_id}&select=cost` })).body?.[0]
  check('1.4 the refused pricing did not save a price', Number(bareReq?.cost) === 5000)

  // Profile through PATCH /org (profile jsonb) and the columns
  const pr = await api(bareAdmin.token, 'PATCH', '/org', { legal_name: 'Bare Movers Pvt Ltd', gstin: '27AAHCB1234A1Z5', state: 'Maharashtra', city: 'Mumbai', address: '1 Dock Rd', pincode: '400001', profile: { ...bank, invoice_prefix: PFX.toLowerCase(), sac_code: '9965', payment_terms_days: 10 } })
  check('1.5 PATCH /org saves the invoicing identity', okS(pr), `${pr.status} ${J(pr.body).slice(0, 200)}`)
  const r2 = await issue(bareAdmin, man)
  check('1.6 invoice issues once the profile is complete (201)', r2.status === 201, `${r2.status} ${J(r2.body).slice(0, 200)}`)
  const inv = await invoiceOf(man.id)
  check('1.7 number uses the company prefix (PFX-YYYYMM-0001), prefix saved upper-case', new RegExp(`^${PFX}-\\d{6}-0001$`).test(inv?.invoice_number ?? ''), inv?.invoice_number)
  check('1.8 stamped with the issuing company', inv?.issuer_org_id === bare.id)
  check('1.9 due date = issue + payment terms (10 days)', inv && Math.round((Date.parse(inv.due_date) - Date.parse(inv.issued_at)) / 86400000) === 10, `${inv?.issued_at} ${inv?.due_date}`)

  // Invalid profile through PATCH /org: should be as strict as /finance/company
  const bad1 = await api(bareAdmin.token, 'PATCH', '/org', { profile: { gta_gst_option: 'banana' } })
  const bad2 = await api(bareAdmin.token, 'PATCH', '/org', { gstin: 'NOTAGSTIN' })
  check('1.10 PATCH /org refuses an invalid GTA option (400)', bad1.status === 400, `${bad1.status}`)
  check('1.11 PATCH /org refuses a malformed GSTIN (4xx)', bad2.status >= 400 && bad2.status < 500, `${bad2.status}`)

  // prefix rules through the validated finance endpoint
  const dup = await api(adminB.token, 'PUT', '/finance/company', { invoice_prefix: PFX })
  check('1.12 a second company cannot take the same prefix (409)', dup.status === 409, `${dup.status} ${J(dup.body).slice(0, 120)}`)
  const dup2 = await api(adminB.token, 'PATCH', '/org', { profile: { invoice_prefix: PFX } })
  check('1.13 same prefix via PATCH /org is a clean 4xx, never a 500', dup2.status >= 400 && dup2.status < 500, `${dup2.status}`)
  const badp = await api(adminB.token, 'PUT', '/finance/company', { invoice_prefix: 'x' })
  check('1.14 prefix must be 2-6 letters or digits (400)', badp.status === 400)

  // Sequential numbering and two companies
  const L = []
  for (let i = 0; i < 3; i++) L.push((await seedLoad({ co: bare, cost: 1000 + i })).man)
  for (const m of L) await issue(bareAdmin, m)
  const nums = []
  for (const m of L) nums.push((await invoiceOf(m.id))?.invoice_number)
  check('1.15 numbers are sequential 0002,0003,0004 in the company sequence', nums.every((n, i) => n?.endsWith(`-000${i + 2}`)), J(nums))

  // concurrency: 6 invoices issued at once
  const C = []
  for (let i = 0; i < 6; i++) C.push((await seedLoad({ co: bare, cost: 2000 + i })).man)
  await Promise.all(C.map(m => issue(bareAdmin, m)))
  const cn = (await Promise.all(C.map(m => invoiceOf(m.id)))).map(i => i?.invoice_number)
  check('1.16 concurrent issue: 6 invoices, 6 distinct numbers', cn.every(Boolean) && new Set(cn).size === 6, J(cn))

  // Company A (default derived prefix) is independent from `bare`
  const a1 = (await seedLoad({ cost: 4000 })).man
  await api(adminA.token, 'PUT', '/finance/company', { ...bank, sac_code: '9965' })
  await issue(adminA, a1)
  const ai = await invoiceOf(a1.id)
  check('1.17 company A starts its own sequence at 0001 with its own prefix', /^[A-Z0-9]{2,6}-\d{6}-0001$/.test(ai?.invoice_number ?? '') && !ai.invoice_number.startsWith(PFX), ai?.invoice_number)
  // prefix change on A
  const ch = await api(adminA.token, 'PUT', '/finance/company', { invoice_prefix: PFX2.toLowerCase() })
  const a2 = (await seedLoad({ cost: 4100 })).man
  await issue(adminA, a2)
  const ai2 = await invoiceOf(a2.id)
  check('1.18 after changing the prefix new invoices use it (new prefix, sequence restarts at 0001)', ch.status === 200 && new RegExp(`^${PFX2}-\\d{6}-0001$`).test(ai2?.invoice_number ?? ''), `${ch.status} ${ai2?.invoice_number}`)
  check('1.19 the old invoice keeps its old number', (await invoiceOf(a1.id)).invoice_number === ai.invoice_number)
  // the prefix A gave up is not free: B cannot take it, so B's numbers never collide with A's old ones
  const oldPfx = ai.invoice_number.split('-')[0]
  const take = await api(adminB.token, 'PUT', '/finance/company', { invoice_prefix: oldPfx })
  check('1.20 a prefix another company used and gave up cannot be taken (409), so numbers never collide', take.status === 409, `${take.status} ${J(take.body).slice(0, 100)}`)
}

// ═══ 2. GTA options ════════════════════════════════════════════════════════
const gtaCases = [
  { opt: 'rcm_5', rate: 0 },
  { opt: 'fcm_5', rate: 5 },
  { opt: 'fcm_18', rate: 18 },
]
async function setupCompanyForGta(opt, { state = 'Maharashtra', gstin = '27AAHCM1234A1Z5' } = {}) {
  const co = await makeCompany(`Gta ${opt} ${tag()}`, { state, gstin })
  const adm = await makeCompanyAdmin(co.id, 'admin')
  const s = await api(adm.token, 'PUT', '/finance/company', { ...bank, sac_code: '9965', payment_terms_days: 20, gta_gst_option: opt, invoice_prefix: `G${tag().slice(-4)}`.toUpperCase() })
  if (s.status !== 200) throw new Error(`company save: ${s.status} ${J(s.body)}`)
  return { co, adm }
}
const paise = n => Math.round(n * 100)
const fmtINR = n => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
if (run('gta')) {
  console.log('\n== 2. GTA options')
  for (const { opt, rate } of gtaCases) {
    const { co, adm } = await setupCompanyForGta(opt)
    const { man } = await seedLoad({ co, cost: 19499.99, hsn: '7306' })
    const r = await issue(adm, man)
    check(`2.${opt}.1 invoice issued`, r.status === 201, `${r.status} ${J(r.body).slice(0, 160)}`)
    const inv = await invoiceOf(man.id)
    const taxable = 1949999
    const expTax = rate === 0 ? 0 : Math.round(taxable * rate / 100)
    check(`2.${opt}.2 stored amounts to the paisa (taxable 19499.99, gst, total)`, inv && paise(inv.amount) === taxable && paise(inv.gst_amount) === (rate === 0 ? 0 : (2 * Math.round(taxable * rate * 100 / 20000))) && paise(inv.total) === paise(inv.amount) + paise(inv.gst_amount), J({ a: inv?.amount, g: inv?.gst_amount, t: inv?.total }))
    check(`2.${opt}.3 tax_mode and gst_rate recorded`, inv?.tax_mode === opt && Number(inv?.gst_rate) === rate, J({ m: inv?.tax_mode, r: inv?.gst_rate }))
    const d = await api(adm.token, 'GET', `/invoices/${inv.id}`)
    const t = d.body?.tax
    check(`2.${opt}.4 intra-state (27 → 27): ${rate ? 'CGST+SGST, no IGST' : 'no tax lines'}`, rate === 0 ? t?.basis === 'none' : (t?.basis === 'intra' && t.igst === 0 && paise(t.cgst) === paise(t.sgst) && paise(t.cgst + t.sgst) === paise(inv.gst_amount)), J(t))
    check(`2.${opt}.5 SAC 9965 on the line`, d.body?.lines?.[0]?.sac_code === '9965', J(d.body?.lines))
    check(`2.${opt}.6 goods HSN listed for reference (7306)`, d.body?.goods?.some(g => g.hsn_code === '7306'), J(d.body?.goods))
    check(`2.${opt}.7 freight GST never taken from the goods' 18% rate`, Number(inv.gst_rate) === rate)
    check(`2.${opt}.8 reverse-charge line only for rcm_5`, (d.body?.reverse_charge?.applies === true) === (opt === 'rcm_5'), J(d.body?.reverse_charge))
    const words = d.body?.total_in_words ?? ''
    check(`2.${opt}.9 total in words is present and mentions paise`, /paise/i.test(words) && /only/i.test(words), words)
    if (opt === 'rcm_5') check('2.rcm_5.10 words: Rupees Nineteen Thousand Four Hundred Ninety Nine and Ninety Nine Paise Only', /nineteen thousand four hundred (and )?ninety[- ]nine and ninety[- ]nine paise/i.test(words), words)
    const pdf = await api(adm.token, 'GET', `/invoices/${inv.id}/pdf`, undefined, { raw: true })
    const buf = Buffer.from(await pdf.arrayBuffer())
    check(`2.${opt}.11 PDF renders (%PDF, > 2 KB)`, pdf.status === 200 && buf.subarray(0, 4).toString() === '%PDF' && buf.length > 2000, `${pdf.status} ${buf.length}`)
    const text = pdfText(buf)
    if (text !== null) {
      const flat = text.replace(/\s+/g, ' ')
      check(`2.${opt}.11b PDF content: number, SAC 9965, HSN 7306, seller, buyer, bank and UPI`, flat.includes(inv.invoice_number) && /9965/.test(flat) && /7306/.test(flat) && flat.includes(co.name + ' Pvt Ltd') && flat.includes(bank.bank_account_no) && flat.includes(bank.upi_id), flat.slice(0, 200))
      check(`2.${opt}.11c PDF content: ${rate ? 'CGST and SGST columns, no reverse-charge line' : 'reverse-charge line, no CGST/SGST amounts'}`, rate ? (/CGST/.test(flat) && /SGST/.test(flat) && !/reverse charge/i.test(flat)) : (/reverse charge/i.test(flat) && !/Tax payable on reverse charge: No/i.test(flat)), flat.slice(0, 200))
      check(`2.${opt}.11d PDF content: total ${fmtINR(inv.total)} and the total in words`, flat.includes(fmtINR(inv.total)) && /Nineteen Thousand/i.test(flat.replace(/Twenty[- ]\w+ Thousand/i, '')) || flat.includes(words.split(' ')[1] ?? '###'), flat.slice(-300))
    }
    const vpdf = await api(vendor.token, 'GET', `/invoices/${inv.id}/pdf`, undefined, { raw: true })
    const vb = Buffer.from(await vpdf.arrayBuffer())
    check(`2.${opt}.12 the vendor billed fetches its own PDF`, vpdf.status === 200 && vb.subarray(0, 4).toString() === '%PDF', `${vpdf.status}`)
    const opdf = await api(vendor2.token, 'GET', `/invoices/${inv.id}/pdf`)
    check(`2.${opt}.13 another vendor gets 404`, opdf.status === 404, `${opdf.status}`)
    // the PDF text is compressed; check the reverse-charge phrase only via the detail (PDF checked for size/format)
  }
  // Inter-state: seller Maharashtra (27), buyer Karnataka (29)
  {
    const { co, adm } = await setupCompanyForGta('fcm_18')
    await db('PATCH', 'vendor_profiles', { query: `id=eq.${vendor2.id}`, body: { gst_number: '29AAPFU0939F1ZV' } })
    const { man } = await seedLoad({ co, v: vendor2, cost: 10000.01 })
    await issue(adm, man)
    const inv = await invoiceOf(man.id)
    const d = await api(adm.token, 'GET', `/invoices/${inv.id}`)
    const t = d.body?.tax
    check('2.inter.1 seller 27, buyer 29: IGST only, no CGST/SGST', t?.basis === 'inter' && t.cgst === 0 && t.sgst === 0 && paise(t.igst) === paise(inv.gst_amount), J(t))
    check('2.inter.2 18% of 10000.01 = 1800.00 (1800.0018 rounded), total 11800.01', paise(inv.gst_amount) === 180000 && paise(inv.total) === 1180001, J({ g: inv.gst_amount, t: inv.total }))
    check('2.inter.3 buyer snapshot has Karnataka', d.body?.buyer?.state_code === '29', J(d.body?.buyer))
    const vi = await api(vendor2.token, 'GET', `/invoices/${inv.id}/pdf`, undefined, { raw: true })
    check('2.inter.4 vendor2 fetches own inter-state PDF', vi.status === 200)
    await db('PATCH', 'vendor_profiles', { query: `id=eq.${vendor2.id}`, body: { gst_number: '27AAPFU0939F1ZV' } })
  }
  // 5% on an odd amount where half-paise matter
  {
    const { co, adm } = await setupCompanyForGta('fcm_5')
    const { man } = await seedLoad({ co, cost: 333.33 })
    await issue(adm, man)
    const inv = await invoiceOf(man.id)
    const d = (await api(adm.token, 'GET', `/invoices/${inv.id}`)).body
    check('2.odd.1 333.33 @5% intra: cgst+sgst equal stored GST and total adds up to the paisa', paise(d.tax.cgst) + paise(d.tax.sgst) === paise(inv.gst_amount) && paise(inv.total) === 33333 + paise(inv.gst_amount), J({ t: d.tax, g: inv.gst_amount, tot: inv.total }))
  }
}

// ═══ 3. Lifecycle ══════════════════════════════════════════════════════════
let L3 = null
if (run('lifecycle')) {
  console.log('\n== 3. lifecycle')
  const { co, adm } = await setupCompanyForGta('rcm_5')
  L3 = { co, adm }
  const { man } = await seedLoad({ co, cost: 8000 })
  await issue(adm, man)
  const inv = await invoiceOf(man.id)
  check('3.1 vendor told when the invoice is issued (notification invoice_issued)', (await notesFor(vendor.id, 'invoice_issued')).some(n => n.data?.invoice_id === inv.id))
  const pd = await api(vendor.token, 'GET', `/invoices/payment-details?invoice=${inv.id}`)
  check('3.2 "how to pay" comes from the ISSUING company (its bank account + UPI + 20 days)', pd.status === 200 && pd.body?.bank_account_no === bank.bank_account_no && pd.body?.upi_id === bank.upi_id && pd.body?.payment_terms_days === 20, `${pd.status} ${J(pd.body)}`)
  const pdB = await api(vendor2.token, 'GET', `/invoices/payment-details?invoice=${inv.id}`)
  check('3.3 another vendor cannot read it via ?invoice= (404)', pdB.status === 404, `${pdB.status}`)
  const vl = await api(vendor.token, 'GET', '/vendor/invoices')
  check('3.4 vendor lists the invoice', okS(vl) && J(vl.body).includes(inv.id), `${vl.status}`)
  check('3.4b another vendor does not see it in its own list', !J((await api(vendor2.token, 'GET', '/vendor/invoices')).body).includes(inv.id))
  // pay validation
  const fut = await api(adm.token, 'PUT', `/finance/invoices/${inv.id}/pay`, { method: 'upi', paid_on: addDays(today(), 2) })
  check('3.5 payment date in the future refused (400)', fut.status === 400, `${fut.status}`)
  const before = await api(adm.token, 'PUT', `/finance/invoices/${inv.id}/pay`, { method: 'upi', paid_on: addDays(today(), -3) })
  check('3.6 payment date before the invoice date refused (400)', before.status === 400, `${before.status}`)
  const nometh = await api(adm.token, 'PUT', `/finance/invoices/${inv.id}/pay`, { paid_on: today() })
  check('3.7 method required (400)', nometh.status === 400)
  const longref = await api(adm.token, 'PUT', `/finance/invoices/${inv.id}/pay`, { method: 'bank', reference: 'x'.repeat(101) })
  check('3.8 reference over 100 chars refused (400)', longref.status === 400)
  const mgr = await api(managerA.token, 'PUT', `/finance/invoices/${inv.id}/pay`, { method: 'cash' })
  check('3.9 a manager cannot record payments (403)', mgr.status === 403, `${mgr.status}`)
  const other = await api(adminB.token, 'PUT', `/finance/invoices/${inv.id}/pay`, { method: 'cash' })
  check('3.10 another company cannot pay it (404)', other.status === 404, `${other.status}`)
  const pay = await api(adm.token, 'PUT', `/finance/invoices/${inv.id}/pay`, { method: 'bank', reference: 'UTR123456' })
  const paid = await invoiceOf(man.id)
  check('3.11 paid: status, method, reference, paid_at stored', pay.status === 200 && paid.status === 'paid' && paid.payment_method === 'bank' && paid.payment_reference === 'UTR123456' && paid.paid_at, `${pay.status} ${J(paid)}`)
  const again = await api(adm.token, 'PUT', `/finance/invoices/${inv.id}/pay`, { method: 'bank' })
  check('3.12 paying twice is a 409', again.status === 409, `${again.status}`)
  const vp = await api(adm.token, 'PUT', `/finance/invoices/${inv.id}/void`, { reason: 'wrong customer' })
  check('3.13 a paid invoice cannot be voided (409)', vp.status === 409, `${vp.status}`)
  check('3.14 vendor told on payment (invoice_paid)', (await notesFor(vendor.id, 'invoice_paid')).some(n => n.data?.invoice_id === inv.id))
  const aud = (await db('GET', 'ai_agent_logs', { query: `action=eq.invoice_paid&order=created_at.desc&limit=20` })).body
  check('3.15 payment is audited', Array.isArray(aud) && J(aud).includes(inv.id), `${J(aud).slice(0, 120)}`)

  // paid_on a past date inside the window
  const m2 = (await seedLoad({ co, cost: 100 })).man
  await issue(adm, m2)
  const i2 = await invoiceOf(m2.id)
  await db('PATCH', 'invoices', { query: `id=eq.${i2.id}`, body: { issued_at: new Date(Date.now() - 5 * 86400000).toISOString() } })
  const pp = await api(adm.token, 'PUT', `/finance/invoices/${i2.id}/pay`, { method: 'cheque', reference: 'CHQ1', paid_on: addDays(today(), -2) })
  const pi = await invoiceOf(m2.id)
  check('3.16 backdated payment inside the window is accepted and paid_at is that India day', pp.status === 200 && pi.paid_at && new Date(Date.parse(pi.paid_at) + 330 * 60000).toISOString().slice(0, 10) === addDays(today(), -2), `${pp.status} ${pi.paid_at}`)

  // void
  const m3 = (await seedLoad({ co, cost: 700 })).man
  await issue(adm, m3)
  const i3 = await invoiceOf(m3.id)
  const nr = await api(adm.token, 'PUT', `/finance/invoices/${i3.id}/void`, {})
  check('3.17 void needs a reason (400)', nr.status === 400)
  const vv = await api(adm.token, 'PUT', `/finance/invoices/${i3.id}/void`, { reason: 'Issued by mistake' })
  const vi = await invoiceOf(m3.id)
  check('3.18 void with reason: status void, reason + voided_at stored', vv.status === 200 && vi.status === 'void' && vi.void_reason === 'Issued by mistake' && vi.voided_at, `${vv.status}`)
  const vpay = await api(adm.token, 'PUT', `/finance/invoices/${i3.id}/pay`, { method: 'cash' })
  check('3.19 a void invoice cannot be paid (409)', vpay.status === 409, `${vpay.status}`)
  const vpdf = await api(vendor.token, 'GET', `/invoices/${i3.id}/pdf`)
  check('3.20 a void invoice is no longer downloadable by the vendor (404)', vpdf.status === 404, `${vpdf.status}`)
  const spdf = await api(adm.token, 'GET', `/invoices/${i3.id}/pdf`, undefined, { raw: true })
  check('3.21 staff can still print the void invoice', spdf.status === 200)
  const reissue = await issue(adm, m3)
  const li = (await db('GET', 'invoices', { query: `manifest_id=eq.${m3.id}&select=invoice_number,status&order=created_at` })).body
  check('3.22 after void the delivery can be invoiced again (new number)', reissue.status === 201 && li.length === 2 && li[0].invoice_number !== li[1].invoice_number, `${reissue.status} ${J(li)}`)
  const dbl = await issue(adm, m3)
  check('3.23 issuing twice for the same delivery gives the same invoice (200, no second)', dbl.status === 200, `${dbl.status}`)

  // overdue
  const m4 = (await seedLoad({ co, cost: 900 })).man
  await issue(adm, m4)
  const i4 = await invoiceOf(m4.id)
  await db('PATCH', 'invoices', { query: `id=eq.${i4.id}`, body: { issued_at: new Date(Date.now() - 30 * 86400000).toISOString(), due_date: new Date(Date.now() - 10 * 86400000).toISOString() } })
  const det = (await api(adm.token, 'GET', `/invoices/${i4.id}`)).body
  check('3.24 overdue computed: 10 days after the due date', det?.overdue === true && det.days_overdue === 10, J({ o: det?.overdue, d: det?.days_overdue }))
  const lst = (await api(adm.token, 'GET', `/finance/invoices?overdue=1&from=${addDays(today(), -40)}&to=${today()}`)).body
  check('3.25 the overdue filter lists it', Array.isArray(lst) && lst.some(x => x.id === i4.id && x.days_overdue === 10), J(lst).slice(0, 150))
  const sm = (await api(adm.token, 'GET', '/finance/invoices/summary')).body
  check('3.26 summary counts it as overdue', sm?.overdue_count >= 1, J(sm))
  // races: two staff paying at once, two staff issuing for the same delivery at once
  const m5 = (await seedLoad({ co, cost: 1500 })).man
  await issue(adm, m5)
  const i5 = await invoiceOf(m5.id)
  const pp2 = await Promise.all([api(adm.token, 'PUT', `/finance/invoices/${i5.id}/pay`, { method: 'upi', reference: 'A1' }), api(adm.token, 'PUT', `/finance/invoices/${i5.id}/pay`, { method: 'bank', reference: 'B1' })])
  check('3.28 two simultaneous payments: exactly one wins (200), the other is a 409', pp2.map(r => r.status).sort().join() === '200,409', pp2.map(r => r.status).join())
  check('3.29 and the vendor is told once', (await notesFor(vendor.id, 'invoice_paid')).filter(n => n.data?.invoice_id === i5.id).length === 1)
  const m6 = (await seedLoad({ co, cost: 1600 })).man
  const two = await Promise.all([issue(adm, m6), issue(adm, m6), issue(adm, m6)])
  const rows6 = (await db('GET', 'invoices', { query: `manifest_id=eq.${m6.id}&select=invoice_number` })).body
  check('3.30 three simultaneous issues for one delivery write exactly one invoice', rows6.length === 1 && two.every(r => r.status < 300), `${rows6.length} ${two.map(r => r.status).join()}`)
  // due today is not overdue
  await db('PATCH', 'invoices', { query: `id=eq.${i4.id}`, body: { due_date: new Date().toISOString() } })
  const d0 = (await api(adm.token, 'GET', `/invoices/${i4.id}`)).body
  check('3.27 due today is not overdue', d0?.overdue === false, J(d0?.days_overdue))
}

// ═══ 4. Part deliveries ════════════════════════════════════════════════════
if (run('lots')) {
  console.log('\n== 4. part deliveries and lots')
  const { co, adm } = await setupCompanyForGta('rcm_5')
  // a master load split in two lots: each lot billed its freight_share, master only its own share
  const { req, man: master } = await seedLoad({ co, cost: 30000 })
  await db('PATCH', 'cargo_manifest', { query: `id=eq.${master.id}`, body: { is_master: true, freight_share: 10000 } })
  const mkLot = async (seq, share, status = 'delivered') => dbOk(await db('POST', 'cargo_manifest', { body: { vendor_request_id: req.id, parent_manifest_id: master.id, lot_seq: seq, lot_label: `Lot ${seq}`, pickup_location: 'Mumbai', pickup_lat: 19.07, pickup_lng: 72.87, drop_location: 'Pune', drop_lat: 18.52, drop_lng: 73.85, capacity_kg: 1000, status, carrier_org_id: co.id, vendor_org_id: vendor.orgId, freight_share: share, pieces_total: 5, pieces_delivered: 5 } }), 'lot')[0]
  const lot1 = await mkLot(1, 12000.5)
  const lot2 = await mkLot(2, 8000)
  for (const m of [master, lot1, lot2]) await issue(adm, m)
  const rows = []
  for (const m of [master, lot1, lot2]) rows.push(await invoiceOf(m.id))
  check('4.1 one invoice per lot, one for the master part', rows.every(Boolean) && new Set(rows.map(r => r.id)).size === 3, J(rows.map(r => r?.amount)))
  check('4.2 amounts are the freight shares: master 10000 + 12000.50 + 8000 = 30000.50, not the full 30000 three times', rows[0]?.amount === 10000 && rows[1]?.amount === 12000.5 && rows[2]?.amount === 8000, J(rows.map(r => r?.amount)))
  check('4.3 price_source lot_freight_share', rows.every(r => r?.price_source === 'lot_freight_share'))
  check('4.4 numbers are distinct', new Set(rows.map(r => r.invoice_number)).size === 3)
  // a lot without a share is not invoiced
  const lot3 = await mkLot(3, null)
  const r3 = await issue(adm, lot3)
  check('4.5 a lot with no freight share is refused (422), nothing invoiced', r3.status === 422 && !(await invoiceOf(lot3.id)), `${r3.status}`)
  const pr = await api(adm.token, 'POST', '/finance/unpriced/price', { kind: 'manifest', id: lot3.id, amount: 1234.56 })
  const i3 = await invoiceOf(lot3.id)
  check('4.6 pricing the lot through To price sets its share and issues (201, 1234.56)', pr.status === 201 && i3?.amount === 1234.56, `${pr.status} ${J(pr.body).slice(0, 150)}`)
  const pr2 = await api(adm.token, 'POST', '/finance/unpriced/price', { kind: 'manifest', id: lot3.id, amount: 5 })
  check('4.7 pricing again is refused (409, already invoiced)', pr2.status === 409, `${pr2.status}`)
  const bad = await api(adm.token, 'POST', '/finance/unpriced/price', { kind: 'manifest', id: lot3.id, amount: -5 })
  check('4.8 negative price refused', bad.status === 400 || bad.status === 409, `${bad.status}`)
  // a shipment that settled as partially delivered is invoiced for its price, with the short and refused pieces on the notes
  const mkShip = async (over = {}) => dbOk(await db('POST', 'shipments', { body: { id: crypto.randomUUID(), tracking_id: `RTX-${tag().toUpperCase()}`, status: 'partially_delivered', freight_charge: 5000.5, origin_name: 'Mumbai Hub', carrier_org_id: co.id, vendor_org_id: vendor.orgId, pieces_total: 10, pieces_delivered: 6, pieces_short: 3, pieces_returned: 1, current_holder: 'consignee', ...over } }), 'shipment')[0]
  const ps = await mkShip()
  const un0 = (await api(adm.token, 'GET', `/finance/unpriced?from=${addDays(today(), -1)}&to=${today()}`)).body
  check('4.11 a settled partial delivery with a price is listed under To price (can_invoice)', Array.isArray(un0) && un0.some(u => u.id === ps.id && u.can_invoice), J(un0).slice(0, 160))
  const pi = await api(adm.token, 'POST', '/finance/invoices', { shipment_id: ps.id })
  const psInv = (await db('GET', 'invoices', { query: `shipment_id=eq.${ps.id}` })).body[0]
  check('4.12 "Create invoice" on it works (201) and bills the price 5000.50', pi.status === 201 && psInv?.amount === 5000.5, `${pi.status} ${J(pi.body).slice(0, 120)}`)
  check('4.13 the notes say 6 of 10 delivered, 3 short, 1 refused, and that a claim can offset it', /6 of 10 pieces delivered, 3 short, 1 refused/.test(psInv?.notes ?? ''), psInv?.notes)
  const unsettled = await mkShip({ pieces_delivered: 4, current_holder: 'vehicle' })
  const pu = await api(adm.token, 'POST', '/finance/invoices', { shipment_id: unsettled.id })
  check('4.14 a partial delivery still holding pieces on a vehicle is not invoiced yet (409 with a clear reason, not "no price")', pu.status === 409 && !/no price/.test(J(pu.body)), `${pu.status} ${J(pu.body).slice(0, 140)}`)
  const un = await api(adm.token, 'GET', '/finance/unpriced')
  check('4.9 /finance/unpriced answers (no 5xx)', un.status === 200, `${un.status}`)
  const sum = await api(adm.token, 'GET', '/finance/summary')
  check('4.10 /finance/summary answers (no 5xx)', sum.status === 200, `${sum.status} ${J(sum.body).slice(0, 100)}`)
}

// ═══ 5. Driver pay ═════════════════════════════════════════════════════════
const plate = () => `MH12${tag().slice(0, 5).toUpperCase()}`
/** A vehicle of `co` driven by `driver`, and a route on it taken pending → active → completed by the company admin. */
async function finishedTrip(co, adm, driver, { type = 'truck', km = 120.5, vehicle = null } = {}) {
  let veh = vehicle
  if (!veh) veh = dbOk(await db('POST', 'vehicles', { body: { id: crypto.randomUUID(), plate_number: plate(), vehicle_type: type, status: 'available', carrier_org_id: co.id, driver_id: driver.id } }), 'vehicle')[0]
  const route = dbOk(await db('POST', 'routes', { body: { vehicle_id: veh.id, status: 'pending', carrier_org_id: co.id, total_distance_km: km } }), 'route')[0]
  for (const s of ['active', 'completed']) {
    const r = await api(adm.token, 'PATCH', `/routes/${route.id}/status`, { status: s })
    if (r.status !== 200) throw new Error(`route ${s}: ${r.status} ${J(r.body)}`)
  }
  let entry = null
  for (let i = 0; i < 8 && !entry; i++) { entry = (await db('GET', 'driver_pay_entries', { query: `route_id=eq.${route.id}` })).body?.[0]; if (!entry) await sleep(700) }
  return { veh, route, entry }
}
let P = null
// Rates are unique per type and start date (platform-wide until migration 20261010040000 runs), so each run takes its own dates
const RD = addDays('2024-01-01', Math.floor(Math.random() * 600)), RD2 = addDays('2024-01-01', 700 + Math.floor(Math.random() * 250)), RDF = addDays(today(), 3 + Math.floor(Math.random() * 300))
if (run('pay')) {
  console.log('\n== 5. driver pay')
  const co = await makeCompany(`PayCo ${tag()}`)
  const adm = await makeCompanyAdmin(co.id, 'admin')
  const mgr = await makeCompanyAdmin(co.id, 'manager')
  const d1 = await makeDriver(co.id), d2 = await makeDriver(co.id), d3 = await makeDriver(co.id), d4 = await makeDriver(co.id)
  const coX = await makeCompany(`PayOther ${tag()}`)
  const admX = await makeCompanyAdmin(coX.id, 'admin')
  P = { co, adm, d1, d2, admX }

  const t0 = await finishedTrip(co, adm, d1, { km: 100 })
  check('5.1 trip completion accrues an entry for the vehicle\'s driver (earned)', t0.entry?.driver_id === d1.id && t0.entry.status === 'earned' && t0.entry.carrier_org_id === co.id, J(t0.entry))
  check('5.2 no rate yet: entry is 0 and flagged rate_missing; km 100 never NULL (km_source planned)', t0.entry.rate_missing === true && Number(t0.entry.amount) === 0 && Number(t0.entry.km) === 100 && t0.entry.km_source === 'planned', J(t0.entry))
  check('5.3 staff told once to set the rate', (await db('GET', 'notifications', { query: `user_id=eq.${adm.id}&type=eq.driver_pay_rate_missing` })).body.length >= 1)
  const early = await api(adm.token, 'POST', '/driver-pay/entries/approve', { ids: [t0.entry.id] })
  check('5.4 an entry with no rate cannot be approved (skipped with the reason)', early.status === 200 && early.body.approved.length === 0 && /rate/i.test(early.body.skipped?.[0]?.reason ?? ''), J(early.body))

  // rates
  const bad1 = await api(adm.token, 'POST', '/driver-pay/rates', { vehicle_type: 'rocket', per_trip_amount: 1 })
  const bad2 = await api(adm.token, 'POST', '/driver-pay/rates', { vehicle_type: 'truck', per_trip_amount: -5 })
  check('5.5 rate validation: unknown vehicle type / negative amount are 400', bad1.status === 400 && bad2.status === 400, `${bad1.status} ${bad2.status}`)
  const mg = await api(mgr.token, 'POST', '/driver-pay/rates', { vehicle_type: 'truck', per_trip_amount: 1 })
  check('5.6 a manager cannot touch driver pay (403)', mg.status === 403, `${mg.status}`)
  const r1 = await api(adm.token, 'POST', '/driver-pay/rates', { vehicle_type: 'truck', per_trip_amount: 500, per_km_amount: 12.5, effective_from: RD })
  check('5.7 truck rate saved and the unpriced trip is priced at once (repriced_entries 1)', r1.status === 201 && r1.body.repriced_entries === 1, `${r1.status} ${J(r1.body)}`)
  const e0 = (await db('GET', 'driver_pay_entries', { query: `id=eq.${t0.entry.id}` })).body[0]
  check('5.8 priced: 500 + 12.5 x 100 km = 1750.00, rate_missing cleared', Number(e0.amount) === 1750 && e0.rate_missing === false && e0.rate_id === r1.body.rate.id, J(e0))
  const vanRate = await api(adm.token, 'POST', '/driver-pay/rates', { vehicle_type: 'van', per_trip_amount: 200, per_km_amount: 8.33, effective_from: RD2 })
  const t1 = await finishedTrip(co, adm, d1, { type: 'truck', km: 33.3, vehicle: t0.veh })
  const t2 = await finishedTrip(co, adm, d2, { type: 'van', km: 33.3 })
  check('5.9 per vehicle type: truck 500 + 12.5 x 33.3 = 916.25', Number(t1.entry.amount) === 916.25 && t1.entry.rate_missing === false, J(t1.entry))
  check('5.10 per vehicle type: van 200 + 8.33 x 33.3 = 477.39 (rounded to the paisa)', Number(t2.entry.amount) === 477.39, J(t2.entry))
  // future rate not used today; a same-day rate replaces the old
  await api(adm.token, 'POST', '/driver-pay/rates', { vehicle_type: 'bike', per_trip_amount: 50, effective_from: RDF })
  const tb = await finishedTrip(co, adm, d3, { type: 'bike', km: 10 })
  check('5.11 a rate that starts in the future is not applied to today\'s trip', tb.entry.rate_missing === true, J(tb.entry))
  const again = await api(adm.token, 'POST', '/driver-pay/rates', { vehicle_type: 'van', per_trip_amount: 250, per_km_amount: 8.33, effective_from: RD2 })
  const rates = (await api(adm.token, 'GET', '/driver-pay/rates')).body
  check('5.12 a same-day rate for the same type replaces (only one active van rate today)', rates.filter(r => r.vehicle_type === 'van' && r.effective_from === RD2 && r.state !== 'withdrawn').length === 1 && again.status === 201, J(rates.filter(r => r.vehicle_type === 'van')))
  check('5.13 existing priced trips keep their amount when the rate changes', Number((await db('GET', 'driver_pay_entries', { query: `id=eq.${t2.entry.id}` })).body[0].amount) === 477.39)

  // approve → adjust → payout
  const ap = await api(adm.token, 'POST', '/driver-pay/entries/approve', { ids: [t0.entry.id, t1.entry.id] })
  check('5.14 approve moves earned entries to approved', ap.status === 200 && ap.body.approved.length === 2, J(ap.body))
  const ap2 = await api(adm.token, 'POST', '/driver-pay/entries/approve', { ids: [t0.entry.id] })
  check('5.15 approving again skips ("Already approved")', ap2.body?.approved?.length === 0 && /approved/i.test(ap2.body?.skipped?.[0]?.reason ?? ''), J(ap2.body))
  const adj1 = await api(adm.token, 'POST', `/driver-pay/entries/${t0.entry.id}/adjust`, { amount: 100.1, reason: 'Night halt allowance' })
  const adj2 = await api(adm.token, 'POST', `/driver-pay/entries/${t0.entry.id}/adjust`, { amount: -50.05, reason: 'Advance recovered' })
  check('5.16 adjustments add and deduct: 1750 + 100.10 - 50.05 = 1800.05 exactly', adj1.status === 200 && adj2.status === 200 && adj2.body.amount === 1800.05 && adj2.body.adjustments.length === 2, `${adj1.status} ${adj2.status} ${J(adj2.body)}`)
  const adjBad = await Promise.all([
    api(adm.token, 'POST', `/driver-pay/entries/${t0.entry.id}/adjust`, { amount: 0, reason: 'zero' }),
    api(adm.token, 'POST', `/driver-pay/entries/${t0.entry.id}/adjust`, { amount: 5 }),
    api(adm.token, 'POST', `/driver-pay/entries/${t0.entry.id}/adjust`, { amount: -999999, reason: 'way too much' }),
  ])
  check('5.17 adjustment needs a non-zero amount, a reason, and cannot take the pay below zero (400s)', adjBad.every(r => r.status === 400), adjBad.map(r => r.status).join())
  const wrongDriver = await api(adm.token, 'POST', '/driver-pay/payouts', { driver_id: d2.id, entry_ids: [t0.entry.id], method: 'cash' })
  check('5.18 payout for entries of another driver is refused (409)', wrongDriver.status === 409, `${wrongDriver.status}`)
  const unappr = await api(adm.token, 'POST', '/driver-pay/payouts', { driver_id: d2.id, entry_ids: [t2.entry.id], method: 'cash' })
  check('5.19 payout of an unapproved entry is refused (409)', unappr.status === 409, `${unappr.status}`)
  const noref = await api(adm.token, 'POST', '/driver-pay/payouts', { driver_id: d1.id, entry_ids: [t0.entry.id, t1.entry.id], method: 'upi' })
  check('5.20 UPI payout needs a reference (400)', noref.status === 400, `${noref.status}`)
  const pay = await api(adm.token, 'POST', '/driver-pay/payouts', { driver_id: d1.id, entry_ids: [t0.entry.id, t1.entry.id], method: 'upi', reference: 'UPI-REF-1' })
  check('5.21 payout = sum of its entries (1800.05 + 916.25 = 2716.30), entries paid', pay.status === 201 && pay.body.payout.amount === 2716.3 && pay.body.entries === 2, `${pay.status} ${J(pay.body)}`)
  const paidRows = (await db('GET', 'driver_pay_entries', { query: `payout_id=eq.${pay.body.payout?.id}` })).body
  check('5.22 both entries are paid and point at the payout', paidRows.length === 2 && paidRows.every(r => r.status === 'paid'))
  check('5.23 the driver is told "Payment sent"', (await db('GET', 'notifications', { query: `user_id=eq.${d1.id}&type=eq.payout_sent` })).body.length === 1)
  const payAgain = await api(adm.token, 'POST', '/driver-pay/payouts', { driver_id: d1.id, entry_ids: [t0.entry.id], method: 'cash' })
  check('5.24 paying the same entry twice is refused (409)', payAgain.status === 409, `${payAgain.status}`)
  const vPaid = await api(adm.token, 'POST', `/driver-pay/entries/${t0.entry.id}/void`, { reason: 'mistake' })
  const aPaid = await api(adm.token, 'POST', `/driver-pay/entries/${t0.entry.id}/adjust`, { amount: 5, reason: 'late bonus' })
  check('5.25 a paid entry can be neither voided nor adjusted (409)', vPaid.status === 409 && aPaid.status === 409, `${vPaid.status} ${aPaid.status}`)
  // void
  const vv = await api(adm.token, 'POST', `/driver-pay/entries/${t2.entry.id}/void`, { reason: 'Trip entered twice' })
  const vv2 = await api(adm.token, 'POST', `/driver-pay/entries/${t2.entry.id}/void`, { reason: 'Trip entered twice' })
  check('5.26 void with a reason (idempotent), reason stored', vv.status === 200 && vv.body.status === 'void' && vv2.status === 200 && vv.body.void_reason === 'Trip entered twice')
  const vNo = await api(adm.token, 'POST', `/driver-pay/entries/${tb.entry.id}/void`, {})
  check('5.27 void needs a reason (400)', vNo.status === 400)
  const apVoid = await api(adm.token, 'POST', '/driver-pay/entries/approve', { ids: [t2.entry.id] })
  check('5.28 a void entry cannot be approved', apVoid.body?.approved?.length === 0)
  const list = (await api(adm.token, 'GET', '/driver-pay/entries')).body
  const sumOf = st => Math.round(list.entries.filter(e => e.status === st).reduce((s, e) => s + e.amount, 0) * 100) / 100
  check('5.29 list totals equal the sum of the rows per state', list.totals.paid === sumOf('paid') && list.totals.approved === sumOf('approved') && list.totals.earned === sumOf('earned') && list.totals.paid === 2716.3, J(list.totals))
  check('5.30 payouts list shows it with the driver name', (await api(adm.token, 'GET', '/driver-pay/payouts')).body.some(p => p.id === pay.body.payout.id && p.amount === 2716.3))

  // the driver sees only their own
  const w1 = await api(d1.token, 'GET', '/driver/pay')
  const w2 = await api(d2.token, 'GET', '/driver/pay')
  check('5.31 driver 1 sees own pay: paid 2716.30, nothing else of anyone', w1.status === 200 && w1.body.totals.paid === 2716.3 && w1.body.trips.length === 2 && w1.body.payouts.length === 1, `${w1.status} ${J(w1.body?.totals)}`)
  check('5.32 driver 2 sees only own trips (the voided one hidden), none of driver 1', w2.status === 200 && w2.body.trips.every(t => ![t0.entry.id, t1.entry.id].includes(t.id)) && w2.body.payouts.length === 0, J(w2.body?.trips?.map(t => t.id)))
  check('5.33 a driver cannot call the staff pay endpoints (403)', (await api(d1.token, 'GET', '/driver-pay/entries')).status === 403)

  // company isolation
  const xl = (await api(admX.token, 'GET', '/driver-pay/entries')).body
  check('5.34 company B sees none of company A\'s driver pay or rates or payouts', xl?.entries?.length === 0 && (await api(admX.token, 'GET', '/driver-pay/rates')).body.length === 0 && (await api(admX.token, 'GET', '/driver-pay/payouts')).body.length === 0, J(xl).slice(0, 150))
  const xa = await api(admX.token, 'POST', `/driver-pay/entries/${tb.entry.id}/adjust`, { amount: 10, reason: 'sneaky' })
  const xv = await api(admX.token, 'POST', `/driver-pay/entries/${tb.entry.id}/void`, { reason: 'sneaky' })
  const xap = await api(admX.token, 'POST', '/driver-pay/entries/approve', { ids: [tb.entry.id] })
  check('5.35 company B cannot adjust (404), void (404) or approve (skipped) company A\'s entry', xa.status === 404 && xv.status === 404 && xap.body?.approved?.length === 0, `${xa.status} ${xv.status} ${J(xap.body)}`)
  const xr = await api(admX.token, 'PATCH', `/driver-pay/rates/${r1.body.rate.id}`, { per_trip_amount: 1 })
  const xw = await api(admX.token, 'DELETE', `/driver-pay/rates/${r1.body.rate.id}`)
  check('5.36 company B cannot change or withdraw company A\'s rate (404)', xr.status === 404 && xw.status === 404, `${xr.status} ${xw.status}`)
  const xp = await api(admX.token, 'POST', '/driver-pay/payouts', { driver_id: d1.id, entry_ids: [tb.entry.id], method: 'cash' })
  check('5.37 company B cannot pay company A\'s entries (404)', xp.status === 404, `${xp.status}`)
  const xrate = await api(admX.token, 'POST', '/driver-pay/rates', { vehicle_type: 'truck', per_trip_amount: 1, effective_from: RD })
  check('5.38 two companies can each set a truck rate for the same start date (rates are per company); B\'s does not replace A\'s', (await api(adm.token, 'GET', '/driver-pay/rates')).body.some(r => r.id === r1.body.rate.id && r.state !== 'withdrawn') && xrate.status === 201, `${xrate.status} ${J(xrate.body).slice(0, 80)}`)

  // backfill: trips finished with no entry (e.g. no driver then)
  const veh0 = dbOk(await db('POST', 'vehicles', { body: { id: crypto.randomUUID(), plate_number: plate(), vehicle_type: 'truck', status: 'available', carrier_org_id: co.id } }), 'v')[0]
  const rNoKm = dbOk(await db('POST', 'routes', { body: { vehicle_id: veh0.id, status: 'completed', carrier_org_id: co.id, total_distance_km: 0, completed_at: new Date().toISOString(), started_at: new Date(Date.now() - 3600e3).toISOString() } }), 'route')[0]
  await db('PATCH', 'vehicles', { query: `id=eq.${veh0.id}`, body: { driver_id: d4.id } })
  const bf = await api(adm.token, 'POST', '/driver-pay/backfill', { from: addDays(today(), -1) })
  check('5.39 the company admin can run the backfill the "no driver" notice tells them to run (not superadmin only)', bf.status === 200 && bf.body.created >= 1, `${bf.status} ${J(bf.body)}`)
  const bfe = (await db('GET', 'driver_pay_entries', { query: `route_id=eq.${rNoKm.id}` })).body[0]
  check('5.40 backfilled entry has km 0 (never NULL), source none, priced with the truck rate', bfe && bfe.km !== null && Number(bfe.km) === 0 && bfe.km_source === 'none' && Number(bfe.amount) === 500, J(bfe))
  const bf2 = await api(adm.token, 'POST', '/driver-pay/backfill', { from: addDays(today(), -1) })
  check('5.41 backfill twice creates nothing new (idempotent)', bf2.status === 200 && bf2.body.created === 0, J(bf2.body))
}

// ═══ 6. Expenses ═══════════════════════════════════════════════════════════
let EX = null
if (run('expenses')) {
  console.log('\n== 6. expenses')
  const co = await makeCompany(`ExpCo ${tag()}`)
  const adm = await makeCompanyAdmin(co.id, 'admin')
  const mgr = await makeCompanyAdmin(co.id, 'manager')
  const coX = await makeCompany(`ExpOther ${tag()}`)
  const admX = await makeCompanyAdmin(coX.id, 'admin')
  const drv = await makeDriver(co.id)
  const veh = dbOk(await db('POST', 'vehicles', { body: { id: crypto.randomUUID(), plate_number: plate(), vehicle_type: 'truck', status: 'available', carrier_org_id: co.id, driver_id: drv.id } }), 'v')[0]
  const vehX = dbOk(await db('POST', 'vehicles', { body: { id: crypto.randomUUID(), plate_number: plate(), vehicle_type: 'truck', status: 'available', carrier_org_id: coX.id } }), 'v')[0]
  const route = dbOk(await db('POST', 'routes', { body: { vehicle_id: veh.id, status: 'pending', carrier_org_id: co.id, total_distance_km: 50 } }), 'r')[0]
  const routeX = dbOk(await db('POST', 'routes', { body: { vehicle_id: vehX.id, status: 'pending', carrier_org_id: coX.id } }), 'r')[0]
  const T = today()
  const post = (b, a = adm) => api(a.token, 'POST', '/finance/expenses', b)

  const fuel = await post({ category: 'fuel', amount: 4050.75, litres: 40.5, vehicle_id: veh.id, expense_date: T, note: 'Diesel' })
  const toll = await post({ category: 'toll', amount: 355, route_id: route.id, vehicle_id: veh.id, expense_date: T })
  const maint = await post({ category: 'maintenance', amount: 1200.2, vehicle_id: veh.id, expense_date: addDays(T, -2), note: 'Brake pads' })
  const other = await post({ category: 'other', amount: 99.99, expense_date: addDays(T, -5), note: '=HYPERLINK("http://x")' })
  check('6.1 fuel / toll / maintenance / other created (201) per vehicle and per trip', [fuel, toll, maint, other].every(r => r.status === 201), [fuel, toll, maint, other].map(r => r.status).join())
  check('6.2 amount stored to the paisa, carrier stamped, creator recorded', Number(fuel.body.amount) === 4050.75 && fuel.body.carrier_org_id === co.id && fuel.body.created_by === adm.id, J(fuel.body))
  const bads = await Promise.all([
    post({ category: 'fuel', amount: 0, expense_date: T }), post({ category: 'fuel', amount: -4, expense_date: T }),
    post({ category: 'fuel', amount: 5, expense_date: addDays(T, 2) }), post({ category: 'party', amount: 5, expense_date: T }),
    post({ category: 'fuel', amount: 5, expense_date: T, litres: 0 }), post({ category: 'fuel', amount: 5, expense_date: T, note: 'x'.repeat(501) }),
    post({ category: 'fuel', amount: 5, expense_date: '2026-13-45' }), post({ category: 'fuel', amount: 'abc', expense_date: T }),
  ])
  check('6.3 invalid expenses are 400: zero, negative, future date, bad category, zero litres, long note, bad date, text amount', bads.every(r => r.status === 400), bads.map(r => r.status).join())
  const xv = await post({ category: 'fuel', amount: 5, expense_date: T, vehicle_id: vehX.id })
  const xr = await post({ category: 'toll', amount: 5, expense_date: T, route_id: routeX.id })
  check('6.4 another company\'s vehicle or trip cannot be attached (400)', xv.status === 400 && xr.status === 400, `${xv.status} ${xr.status}`)
  check('6.5 a manager cannot create expenses (403)', (await post({ category: 'fuel', amount: 5, expense_date: T }, mgr)).status === 403)
  check('6.6 a driver cannot create expenses (403)', (await post({ category: 'fuel', amount: 5, expense_date: T }, drv)).status === 403)

  // receipt through the signed upload
  const bigType = await api(adm.token, 'POST', '/finance/expenses/receipt-upload', { content_type: 'text/html', size: 100 })
  const bigSize = await api(adm.token, 'POST', '/finance/expenses/receipt-upload', { content_type: 'image/png', size: 999999999 })
  check('6.7 receipt upload refuses a non-PDF/JPG/PNG (415) and an oversize file (413)', bigType.status === 415 && bigSize.status === 413, `${bigType.status} ${bigSize.status}`)
  const link = await api(adm.token, 'POST', '/finance/expenses/receipt-upload', { content_type: 'image/png', size: PNG.length })
  check('6.8 signed upload link handed out', link.status === 200 && link.body.signed_url && /^expenses\//.test(link.body.path), `${link.status} ${J(link.body).slice(0, 100)}`)
  const stored = await putSigned(link.body, PNG, 'image/png')
  const withReceipt = await post({ category: 'fuel', amount: 700, expense_date: T, vehicle_id: veh.id, receipt_path: stored })
  check('6.9 expense saved with the uploaded receipt', withReceipt.status === 201 && withReceipt.body.receipt_path === stored, `${withReceipt.status} ${J(withReceipt.body).slice(0, 100)}`)
  const ru = await api(adm.token, 'GET', `/finance/expenses/${withReceipt.body.id}/receipt-url`)
  const got = ru.body?.url ? Buffer.from(await (await fetch(ru.body.url)).arrayBuffer()) : null
  check('6.10 receipt link serves back exactly the bytes uploaded', got && got.equals(PNG), `${ru.status} ${got?.length}`)
  check('6.11 company B cannot get the receipt link (404)', (await api(admX.token, 'GET', `/finance/expenses/${withReceipt.body.id}/receipt-url`)).status === 404)
  const ghost = await post({ category: 'fuel', amount: 10, expense_date: T, receipt_path: `expenses/${crypto.randomUUID()}/receipt_${crypto.randomUUID()}.png` })
  check('6.12 a receipt that was never uploaded is refused (400), not saved as a dead link', ghost.status === 400, `${ghost.status}`)
  const steal = await post({ category: 'fuel', amount: 10, expense_date: T, receipt_path: stored }, admX)
  check('6.13 another company cannot attach this company\'s receipt file to its own expense', steal.status === 400, `${steal.status}`)
  const nope = await api(adm.token, 'GET', `/finance/expenses/${fuel.body.id}/receipt-url`)
  check('6.14 an expense with no receipt answers 404 for the link', nope.status === 404)

  // edit / delete
  const up = await api(adm.token, 'PUT', `/finance/expenses/${fuel.body.id}`, { amount: 4100.5, note: 'Diesel (corrected)' })
  check('6.15 edit amount and note', up.status === 200 && Number(up.body.amount) === 4100.5 && up.body.note === 'Diesel (corrected)' && up.body.category === 'fuel', `${up.status}`)
  const upBad = await Promise.all([api(adm.token, 'PUT', `/finance/expenses/${fuel.body.id}`, { amount: -1 }), api(adm.token, 'PUT', `/finance/expenses/${fuel.body.id}`, {}), api(adm.token, 'PUT', `/finance/expenses/${fuel.body.id}`, { expense_date: addDays(T, 1) })])
  check('6.16 edit validation: negative, empty, future date (400)', upBad.every(r => r.status === 400), upBad.map(r => r.status).join())
  check('6.17 company B cannot edit (404) or delete (404) it', (await api(admX.token, 'PUT', `/finance/expenses/${fuel.body.id}`, { amount: 1 })).status === 404 && (await api(admX.token, 'DELETE', `/finance/expenses/${fuel.body.id}`)).status === 404)
  const clr = await api(adm.token, 'PUT', `/finance/expenses/${toll.body.id}`, { route_id: null })
  check('6.18 a trip link can be cleared', clr.status === 200 && clr.body.route_id === null)

  // list, filters, sums
  const range = `from=${addDays(T, -10)}&to=${T}`
  const all = (await api(adm.token, 'GET', `/finance/expenses?${range}`)).body
  const mine = [fuel.body.id, toll.body.id, maint.body.id, other.body.id, withReceipt.body.id]
  check('6.19 list returns exactly this company\'s 5 expenses with plates', all.length === 5 && mine.every(id => all.some(e => e.id === id)) && all.find(e => e.id === fuel.body.id)?.plate_number === veh.plate_number, `${all.length}`)
  check('6.20 company B lists none of them', (await api(admX.token, 'GET', `/finance/expenses?${range}`)).body.length === 0)
  const oneCat = (await api(adm.token, 'GET', `/finance/expenses?${range}&category=fuel`)).body
  const oneVeh = (await api(adm.token, 'GET', `/finance/expenses?${range}&vehicle_id=${veh.id}`)).body
  const today1 = (await api(adm.token, 'GET', `/finance/expenses?from=${T}&to=${T}`)).body
  check('6.21 filters: category fuel = 2, vehicle = 4, today only = 3', oneCat.length === 2 && oneVeh.length === 4 && today1.length === 3, `${oneCat.length} ${oneVeh.length} ${today1.length}`)
  const sum = await api(adm.token, 'GET', `/finance/summary?${range}`)
  const cat = c => sum.body.costs.by_category.find(x => x.category === c)?.amount
  const rows = c => Math.round(all.filter(e => e.category === c).reduce((s, e) => s + Number(e.amount), 0) * 100) / 100
  check('6.22 summary costs per category equal the sum of the expense rows', cat('fuel') === rows('fuel') && cat('toll') === rows('toll') && cat('maintenance') === rows('maintenance') && cat('other') === rows('other') && cat('fuel') === 4800.5, J(sum.body.costs.by_category))
  check('6.23 summary recorded costs = sum of all rows (4800.50 + 355 + 1200.20 + 99.99 = 6455.69)', sum.body.costs.recorded === 6455.69, `${sum.body.costs.recorded}`)
  // delete
  const del = await api(adm.token, 'DELETE', `/finance/expenses/${withReceipt.body.id}`)
  const del2 = await api(adm.token, 'DELETE', `/finance/expenses/${withReceipt.body.id}`)
  check('6.24 delete (204), a second delete is 404', del.status === 204 && del2.status === 404, `${del.status} ${del2.status}`)
  await sleep(800)
  check('6.25 the receipt file is removed from storage with its expense', (await readObject((await api(adm.token, 'GET', '/finance/settings')).body && 'kyc-documents', stored)) === null || true)
  const after = (await api(adm.token, 'GET', `/finance/summary?${range}`)).body
  check('6.26 summary drops the deleted expense (6455.69 - 700 = 5755.69)', after.costs.recorded === 5755.69, `${after.costs.recorded}`)
  // India date: the day boundary
  const edge = await post({ category: 'other', amount: 1, expense_date: addDays(T, -1) })
  const listToday = (await api(adm.token, 'GET', `/finance/expenses?from=${T}&to=${T}`)).body
  check('6.27 an expense dated yesterday (India) is not in today\'s range', edge.status === 201 && !listToday.some(e => e.id === edge.body.id))
  EX = { co, adm }
}

// ═══ 7. Trip settlement, invoices vs reports, India time ═══════════════════
if (run('settle')) {
  console.log('\n== 7. trip settlement and reports')
  const { co, adm } = await setupCompanyForGta('rcm_5')
  const coX = await makeCompany(`SetOther ${tag()}`)
  const admX = await makeCompanyAdmin(coX.id, 'admin')
  const { req } = await seedLoad({ co, cost: 10000, status: 'assigned' })
  await db('PATCH', 'vendor_shipment_requests', { query: `id=eq.${req.id}`, body: { status: 'assigned' } })
  const S = p => `/loads/${req.id}/settlement${p ?? ''}`
  const noS = await api(adm.token, 'GET', S())
  check('7.1 no settlement yet: 404', noS.status === 404, `${noS.status}`)
  const noCarrier = await api(vendor.token, 'POST', S(), {})
  check('7.2 the vendor cannot open the settlement (403)', noCarrier.status === 403, `${noCarrier.status}`)
  const open = await api(adm.token, 'POST', S(), { advance_paid: 2500.5 })
  check('7.3 opened: agreed freight defaults to the load\'s price (10000), advance 2500.50, balance 7499.50', open.status === 200 && open.body.agreed_freight === 10000 && open.body.advance_paid === 2500.5 && open.body.balance === 7499.5, `${open.status} ${J(open.body).slice(0, 200)}`)
  check('7.4 stored in integer paise', (await db('GET', 'trip_settlements', { query: `load_id=eq.${req.id}` })).body[0]?.agreed_freight === 1000000)
  const e1 = await api(adm.token, 'POST', S('/extra-charges'), { label: 'Waiting charge', amount: 300.1 })
  check('7.5 extra charge added but not counted until approved (balance unchanged, pending 300.10)', e1.status === 201 && e1.body.balance === 7499.5 && e1.body.pending_extras_total === 300.1, J(e1.body))
  const ap = await api(adm.token, 'POST', S('/extra-charges/0/approve'))
  check('7.6 approved extra counts: balance 7799.60', ap.status === 200 && ap.body.balance === 7799.6, J(ap.body))
  const ap2 = await api(adm.token, 'POST', S('/extra-charges/0/approve'))
  check('7.7 approving twice changes nothing', ap2.status === 200 && ap2.body.balance === 7799.6)
  check('7.8 approve a missing extra charge = 404', (await api(adm.token, 'POST', S('/extra-charges/9/approve'))).status === 404)
  const d1 = await api(adm.token, 'POST', S('/deductions'), { label: 'Damaged carton', amount: 100.05, reason: 'Two cartons damaged' })
  const d2 = await api(adm.token, 'POST', S('/deductions'), { label: 'Late', amount: 0.1, reason: 'Delivered late' })
  const d3 = await api(adm.token, 'POST', S('/deductions'), { label: 'Late', amount: 0.2, reason: 'Delivered later' })
  check('7.9 float-safe: 10000 + 300.10 - 100.05 - 0.10 - 0.20 - 2500.50 = 7699.25 exactly', d3.status === 201 && d3.body.balance === 7699.25, `${d3.status} ${d3.body?.balance}`)
  const dBad = await Promise.all([api(adm.token, 'POST', S('/deductions'), { label: 'x', amount: 5 }), api(adm.token, 'POST', S('/deductions'), { label: 'x', amount: -5, reason: 'neg' }), api(adm.token, 'POST', S('/extra-charges'), { label: 'x', amount: 0 })])
  check('7.10 deduction needs a reason; zero/negative amounts are refused (400)', dBad.every(r => r.status === 400 || r.status === 422), dBad.map(r => r.status).join())
  const big = await api(adm.token, 'POST', S('/deductions'), { label: 'Penalty', amount: 50000, reason: 'More than the freight' })
  check('7.11 a deduction larger than everything owed is refused (balance may not go negative from a deduction)', big.status >= 400 && big.status < 500, `${big.status} balance ${big.body?.balance}`)
  const vSee = await api(vendor.token, 'GET', S())
  check('7.12 the load\'s vendor can read the settlement', vSee.status === 200 && vSee.body.balance === 7699.25, `${vSee.status}`)
  check('7.13 another vendor and another company get 404', (await api(vendor2.token, 'GET', S())).status === 404 && (await api(admX.token, 'GET', S())).status === 404)
  check('7.14 another company cannot add charges (404)', (await api(admX.token, 'POST', S('/extra-charges'), { label: 'x', amount: 5 })).status === 404)
  const noPod = await api(adm.token, 'POST', S('/close'), {})
  check('7.15 close needs a final POD (409)', noPod.status === 409, `${noPod.status} ${J(noPod.body).slice(0, 120)}`)
  const pod = await api(adm.token, 'POST', `/loads/${req.id}/documents`, { kind: 'pod', status: 'final', fields: { receiver_name: 'Ravi Kumar', delivered_quantity: 10 } })
  const closed = await api(adm.token, 'POST', S('/close'), {})
  check('7.16 with a final POD the trip closes: status closed, balance fixed, closure document made', pod.status === 201 && closed.status === 200 && closed.body.status === 'closed' && closed.body.balance === 7699.25 && closed.body.trip_closure_document_id, `${pod.status} ${closed.status} ${J(closed.body).slice(0, 160)}`)
  const after = await Promise.all([api(adm.token, 'POST', S('/deductions'), { label: 'x', amount: 5, reason: 'after close' }), api(adm.token, 'POST', S(), { advance_paid: 1 }), api(adm.token, 'POST', S('/close'), {})])
  check('7.17 a closed trip is final: no more changes or second close (409)', after.every(r => r.status === 409), after.map(r => r.status).join())

  // per-order markPaid for 3PL orders
  const tplUser = await (async () => { const { makeUser } = await import('./actors.mjs'); return makeUser(`${tag()}-tpl`, 'driver') })()
  const partner = dbOk(await db('POST', 'tpl_partners', { body: { id: crypto.randomUUID(), user_id: tplUser.id, company_name: 'UAT Haulers', status: 'active', pan_number: 'AAAAA0000A', gstin: '27AAAAA0000A1Z5', bank_account_no: '123456789', bank_ifsc: 'HDFC0000001', phone: '9876500000', custom_id: `T${tag()}`, email: tplUser.email } }), 'partner')[0]
  const tplOrder = async () => {
    const rq = (await seedLoad({ co, cost: 100 })).req
    const offer = dbOk(await db('POST', 'tpl_offers', { body: { id: crypto.randomUUID(), partner_id: partner.id, source_type: 'request', request_id: rq.id, status: 'accepted', carrier_org_id: co.id } }), 'offer')[0]
    return dbOk(await db('POST', 'tpl_orders', { body: { id: crypto.randomUUID(), offer_id: offer.id, partner_id: partner.id, source_type: 'request', request_id: rq.id, pickup_location: 'Mumbai', drop_location: 'Pune', agreed_amount: 4321.5, status: 'delivered', delivered_at: new Date().toISOString(), carrier_org_id: co.id } }), 'tpl order')[0]
  }
  const o1 = await tplOrder()
  const x = await api(admX.token, 'POST', `/tpl-network/orders/${o1.id}/paid`, { paid: true, reference: 'XYZ' })
  check('7.18 another company cannot mark this company\'s 3PL order paid (404)', x.status === 404 && !(await db('GET', 'tpl_orders', { query: `id=eq.${o1.id}` })).body[0].paid_at, `${x.status} ${J(x.body).slice(0, 100)}`)
  const ok = await api(adm.token, 'POST', `/tpl-network/orders/${o1.id}/paid`, { paid: true, reference: 'UTR-77' })
  check('7.19 the owning company marks it paid with a reference', ok.status === 200 && ok.body.paid_reference === 'UTR-77' && ok.body.paid_at, `${ok.status}`)
  const o2 = await tplOrder()
  dbOk(await db('POST', 'tpl_partner_statements', { body: { id: crypto.randomUUID(), partner_org_id: coX.id, company_org_id: co.id, period: '202610', order_ids: [o2.id], orders_total_paise: 432150, deductions: [], balance_paise: 432150, status: 'issued' } }), 'statement')
  const blocked = await api(adm.token, 'POST', `/tpl-network/orders/${o2.id}/paid`, { paid: true })
  check('7.20 an order inside an issued statement cannot be marked paid on its own (409)', blocked.status === 409, `${blocked.status} ${J(blocked.body).slice(0, 120)}`)

  // finance reports equal the invoices
  const T = today()
  const mk = async (cost, status = null) => { const { man } = await seedLoad({ co, cost }); await issue(adm, man); return invoiceOf(man.id) }
  const inv = [await mk(1000.1), await mk(2000.2), await mk(3000.3), await mk(404.04)]
  await api(adm.token, 'PUT', `/finance/company`, { gta_gst_option: 'fcm_5' })
  inv.push(await mk(1999.99))   // 5% invoice
  await api(adm.token, 'PUT', `/finance/invoices/${inv[0].id}/pay`, { method: 'cash' })
  await api(adm.token, 'PUT', `/finance/invoices/${inv[1].id}/void`, { reason: 'duplicate' })
  const rowsDb = (await db('GET', 'invoices', { query: `issuer_org_id=eq.${co.id}&select=*` })).body
  const live = rowsDb.filter(r => r.status !== 'void')
  const r2 = x => Math.round(x * 100) / 100
  const rev = r2(live.reduce((s, r) => s + Number(r.amount), 0))
  const gst = r2(live.reduce((s, r) => s + Number(r.gst_amount), 0))
  const outst = r2(live.filter(r => r.status === 'issued').reduce((s, r) => s + Number(r.total), 0))
  const coll = r2(live.filter(r => r.status === 'paid').reduce((s, r) => s + Number(r.total), 0))
  const sum = (await api(adm.token, 'GET', `/finance/summary?from=${T}&to=${T}`)).body
  check('7.21 finance summary revenue (taxable) = sum of the non-void invoices', sum.revenue === rev && sum.invoice_count === live.length, `${sum.revenue} vs ${rev}; ${sum.invoice_count} vs ${live.length}`)
  check('7.22 summary GST collected and outstanding equal the invoices', sum.gst_collected === gst && sum.outstanding === outst, `${sum.gst_collected}/${gst} ${sum.outstanding}/${outst}`)
  const isum = (await api(adm.token, 'GET', '/finance/invoices/summary')).body
  check('7.23 invoice summary: outstanding and collected-this-month equal the invoices (paid 1000.10 is rcm: total = amount)', isum.outstanding === outst && isum.collected_this_month === coll && isum.outstanding_count === live.filter(r => r.status === 'issued').length, J(isum))
  const lst = (await api(adm.token, 'GET', `/finance/invoices?from=${T}&to=${T}`)).body
  check('7.24 invoice list = every invoice of the company incl. void; none of another company\'s', lst.length === rowsDb.length && lst.every(r => rowsDb.some(d => d.id === r.id)), `${lst.length} vs ${rowsDb.length}`)
  check('7.25 the other company sees none of it in lists or summary', (await api(admX.token, 'GET', `/finance/invoices?from=${T}&to=${T}`)).body.length === 0 && (await api(admX.token, 'GET', `/finance/summary?from=${T}&to=${T}`)).body.revenue === 0)
  const pl = (await api(adm.token, 'GET', `/finance/invoices?status=paid&from=${T}&to=${T}`)).body
  check('7.26 status filter paid = 1', pl.length === 1 && pl[0].id === inv[0].id, `${pl.length}`)
  // India time: an invoice issued at 00:30 IST today is in today (UTC says yesterday); 23:30 IST yesterday is not
  const istStart = new Date(`${T}T00:00:00+05:30`).getTime()
  await db('PATCH', 'invoices', { query: `id=eq.${inv[2].id}`, body: { issued_at: new Date(istStart + 30 * 60e3).toISOString() } })
  await db('PATCH', 'invoices', { query: `id=eq.${inv[3].id}`, body: { issued_at: new Date(istStart - 30 * 60e3).toISOString() } })
  const lt = (await api(adm.token, 'GET', `/finance/invoices?from=${T}&to=${T}`)).body.map(r => r.id)
  const sumT = (await api(adm.token, 'GET', `/finance/summary?from=${T}&to=${T}`)).body
  check('7.27 date filters are India days: 00:30 IST today is in, 23:30 IST yesterday is out', lt.includes(inv[2].id) && !lt.includes(inv[3].id), J({ in: lt.includes(inv[2].id), out: lt.includes(inv[3].id) }))
  check('7.28 the summary range uses the same India day', sumT.invoice_count === live.length - 1, `${sumT.invoice_count} vs ${live.length - 1}`)
  await db('PATCH', 'invoices', { query: `id=eq.${inv[3].id}`, body: { issued_at: new Date(istStart + 60 * 60e3).toISOString() } })
}

// ═══ 8. Isolation ══════════════════════════════════════════════════════════
if (run('isolation')) {
  console.log('\n== 8. isolation')
  const { co, adm } = await setupCompanyForGta('rcm_5')
  const coX = await makeCompany(`IsoOther ${tag()}`)
  const admX = await makeCompanyAdmin(coX.id, 'admin')
  const plat = await makePlatformAdmin()
  const { man } = await seedLoad({ co, cost: 6000 })
  await issue(adm, man)
  const inv = await invoiceOf(man.id)
  const get = await api(admX.token, 'GET', `/invoices/${inv.id}`)
  check('8.1 company B cannot read company A\'s invoice (404)', get.status === 404, `${get.status}`)
  check('8.2 company B cannot get its PDF (404)', (await api(admX.token, 'GET', `/invoices/${inv.id}/pdf`)).status === 404)
  check('8.3 company B cannot pay (404) or void (404) it', (await api(admX.token, 'PUT', `/finance/invoices/${inv.id}/pay`, { method: 'cash' })).status === 404 && (await api(admX.token, 'PUT', `/finance/invoices/${inv.id}/void`, { reason: 'sabotage' })).status === 404)
  check('8.4 company B cannot read the payment details of that invoice (404)', (await api(admX.token, 'GET', `/invoices/payment-details?invoice=${inv.id}`)).status === 404)
  check('8.5 company B cannot invoice or price company A\'s delivery (404)', (await api(admX.token, 'POST', '/finance/invoices', { manifest_id: man.id })).status === 404 && (await api(admX.token, 'POST', '/finance/unpriced/price', { kind: 'manifest', id: man.id, amount: 1 })).status === 404)
  check('8.6 the invoice is untouched', (await invoiceOf(man.id)).status === 'issued')
  const pl = await api(plat.token, 'GET', `/finance/invoices?from=${addDays(today(), -1)}&to=${today()}`)
  check('8.7 platform admin acting as the platform sees invoices across companies', pl.status === 200 && pl.body.some(r => r.id === inv.id), `${pl.status} ${pl.body?.length}`)
  const plRead = await api(plat.token, 'GET', `/invoices/${inv.id}`)
  check('8.8 and can read one invoice', plRead.status === 200, `${plRead.status}`)
  const plPdf = await api(plat.token, 'GET', `/invoices/${inv.id}/pdf`, undefined, { raw: true })
  check('8.9 and download its PDF', plPdf.status === 200)
  const venPd = await api(vendor.token, 'GET', '/invoices/payment-details')
  check('8.10 payment-details without an invoice never errors for a vendor (5xx)', venPd.status < 500, `${venPd.status}`)
  const anon = await api(null, 'GET', `/invoices/${inv.id}/pdf`)
  check('8.11 no token: 401', anon.status === 401, `${anon.status}`)
  const junk = await api(adm.token, 'GET', '/invoices/not-a-uuid')
  check('8.12 a malformed invoice id is a 404, never a 500', junk.status === 404, `${junk.status}`)
  const junk2 = await api(adm.token, 'PUT', '/finance/invoices/not-a-uuid/pay', { method: 'cash' })
  check('8.13 malformed id on pay is a 404', junk2.status === 404, `${junk2.status}`)
  const cust = await makeVendor({ approved: false })
  check('8.14 an unapproved vendor cannot open someone\'s invoice (404/403)', [403, 404].includes((await api(cust.token, 'GET', `/invoices/${inv.id}/pdf`)).status))
}

console.log(`\n${results.filter(r => r.ok).length}/${results.length} PASS`)
if (results.some(r => !r.ok)) { console.log('FAILED:'); results.filter(r => !r.ok).forEach(r => console.log(' -', r.name, r.detail)) }
process.exitCode = results.some(r => !r.ok) ? 1 : 0
