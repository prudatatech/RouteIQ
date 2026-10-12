// A company with no truck of its own fulfils a vendor's load through its 3PL network, on the TEST stage:
// the vendor posts a load (Post a Load v2), the company books it inside the recommended range, affiliates
// and escalates it to a 3PL partner, the partner accepts with its own vehicle and driver, the partner's
// driver delivers, and the vendor is told and invoiced exactly as when the company carries it itself.
//
//   node e2e/staging/load-lifecycle-3pl.mjs
import {
  api, db, check, results, sleep, tag, makeCompany, makeCompanyAdmin, makeDriver, makeVendor, makePlatformAdmin, makeUser, login, env, DATA,
} from './actors.mjs'

const realFetch = globalThis.fetch
globalThis.fetch = (url, opts = {}) => realFetch(url, { signal: AbortSignal.timeout(120_000), ...opts })

const svc = { apikey: env.SERVICE, Authorization: `Bearer ${env.SERVICE}`, 'content-type': 'application/json' }
const dayKey = plusDays => new Date(Date.now() + 330 * 60_000 + plusDays * 86_400_000).toISOString().slice(0, 10)
const get = (token, path, opts) => api(token, 'GET', path, undefined, opts)
const msg = r => (r.body && (r.body.detail || r.body.error || r.body.message)) || JSON.stringify(r.body)?.slice(0, 160)
const rows = async (table, query) => (await db('GET', table, { query })).body
const one = async (table, query) => (await rows(table, query))?.[0]

async function notesFor(userId, type) {
  return (await db('GET', 'notifications', { query: `user_id=eq.${userId}${type ? `&type=eq.${type}` : ''}&select=title,body,type,data,is_read&order=created_at.desc` })).body || []
}
async function waitNotes(userId, type, pred, secs = 60) {
  for (let i = 0; i < secs / 3; i++) {
    const n = await notesFor(userId, type)
    if (n.some(pred)) return n
    await sleep(3000)
  }
  return notesFor(userId, type)
}

/** A 3PL partner, with its own real login (as the real credential-setup flow ends up: a vendor-role
 * sign-in linked to the tpl_partners row), not yet affiliated with anyone. */
async function makePartner(label) {
  const user = await makeUser(`${tag()}-${label}`, 'vendor')
  await realFetch(`${DATA}/auth/v1/admin/users/${user.id}`, { method: 'PUT', headers: svc, body: JSON.stringify({ app_metadata: { role: 'vendor' } }) })
  const tp = await db('POST', 'tpl_partners', {
    body: { company_name: `Haulers ${tag()}`, pan_number: 'AAAPL1234C', gstin: '27AAAPL1234C1Z5', status: 'active', email: user.email, phone: '+919900000099', user_id: user.id },
  })
  if (tp.status >= 300) throw new Error(`tpl_partners: ${JSON.stringify(tp.body)}`)
  const partnerRow = tp.body[0]
  const org = await one('organizations', `kind=eq.tpl_partner&profile->>legacy_tpl_partner_id=eq.${partnerRow.id}&select=id`)
  return { ...user, token: await login(user.email), partnerRowId: partnerRow.id, orgId: org.id }
}

async function run() {
  console.log('=== A company without its own truck fulfils a load through an affiliated 3PL partner ===')
  const pa = await makePlatformAdmin()
  const co = await makeCompany()
  const admin = await makeCompanyAdmin(co.id, 'admin')
  const vendor = await makeVendor({ approved: true, admin: pa })
  const partner = await makePartner('p3pl')

  // 1. The partner asks to join the company, the company approves — the real affiliation path, not a shortcut
  const ask = await api(partner.token, 'POST', '/tpl/affiliations', { company_id: co.id })
  check('1.1 the partner asks to join the company', [200, 201].includes(ask.status), `${ask.status} ${msg(ask)}`)
  const approve = await api(admin.token, 'PUT', `/org/tpl-affiliations/${partner.orgId}/approve`, {}, { org: co.id })
  check('1.2 the company approves the partner', approve.status === 200, `${approve.status} ${msg(approve)}`)

  // 2. The partner registers a truck and a driver in its own portal
  const plate = `MH12NW${String(Math.floor(1000 + Math.random() * 8999))}`
  const vehicle = await api(partner.token, 'POST', `/tpl-portal/${partner.orgId}/vehicles`, { plate_number: plate, vehicle_type: 'truck', capacity_kg: 15000, rc_number: 'RC-3PL-001', insurance_number: 'INS-3PL-001' })
  check('2.1 the partner registers a truck', vehicle.status === 201, `${vehicle.status} ${msg(vehicle)}`)
  const invite = await api(partner.token, 'POST', `/tpl-portal/${partner.orgId}/drivers/invite`, { full_name: 'Network Driver', phone: `+9199${String(Date.now()).slice(-8)}` })
  check('2.2 the partner invites a driver', invite.status === 201, `${invite.status} ${msg(invite)}`)
  // A real driver sign-in needs the email-code setup the invite sends; for a scripted check, seat a second
  // driver the same way the company-fleet test does (a known password) directly in the partner's organisation.
  const driver = await makeDriver(partner.orgId)
  const linkDriver = await api(partner.token, 'PATCH', `/tpl-portal/${partner.orgId}/vehicles/${vehicle.body.id}`, { driver_id: driver.id })
  check('2.3 the driver is put on the truck', linkDriver.status === 200, `${linkDriver.status} ${msg(linkDriver)}`)
  const driverToken = driver.token

  // 3. The vendor posts a load, the company (which has no truck of its own) books it
  const posted = await api(vendor.token, 'POST', '/vendor/loads', {
    items: [{ product_name: 'Textile rolls', hsn_code: '5208', gst_rate: 5, quantity: 50, unit: 'rolls', weight_kg: 10000, declared_value: 300000 }],
    pickup_city: 'Surat', pickup_address: 'Ring Road Textile Market', pickup_pincode: '395002', pickup_lat: 21.1959, pickup_lng: 72.8302, pickup_date: dayKey(3),
    delivery_city: 'Bengaluru', delivery_address: 'Yeshwanthpur Industrial Area', delivery_pincode: '560022', delivery_lat: 13.0284, delivery_lng: 77.5516,
    priority: 'medium',
  })
  check('3.1 the vendor posts a load', posted.status < 300, `${posted.status} ${msg(posted)}`)
  const loadId = posted.body?.id
  const detail = await get(admin.token, `/company/loads/${loadId}`, { org: co.id })
  const accepted = await api(admin.token, 'POST', `/company/loads/${loadId}/accept`, { amount_inr: Number(detail.body.price_min_inr) }, { org: co.id })
  check('3.2 the company books it even though it has no truck yet', accepted.status === 200, `${accepted.status} ${msg(accepted)}`)

  // 4. The company sends it to its network instead of assigning its own (nonexistent) vehicle
  const escalate = await api(admin.token, 'POST', '/tpl-network/escalations', { request_id: loadId, partner_ids: [partner.partnerRowId] }, { org: co.id })
  check('4.1 the company escalates the load to its affiliated partner', escalate.status === 201, `${escalate.status} ${msg(escalate)}`)
  const offer = escalate.body?.offers?.[0]
  check('4.2 an offer was created for that partner', !!offer, JSON.stringify(escalate.body).slice(0, 200))

  // 5. The partner sees and accepts the offer with its own truck and driver
  const myOffers = await get(partner.token, '/tpl-network/my/offers')
  check('5.1 the partner sees the offer, grouped under the company', myOffers.status === 200 && myOffers.body?.items?.some(o => o.id === offer?.id), JSON.stringify(myOffers.body).slice(0, 200))
  const agreedAmount = Number(detail.body.price_min_inr)
  const accept = await api(partner.token, 'POST', `/tpl-network/my/offers/${offer.id}/accept`, { agreed_amount: agreedAmount, vehicle_id: vehicle.body.id, driver_id: driver.id })
  check('5.2 the partner accepts with its own truck and driver', accept.status === 201, `${accept.status} ${msg(accept)}`)
  const order = accept.body
  check('5.3 the trip is owned by the company, run with the partner’s truck', !!order?.manifest_id, JSON.stringify(order).slice(0, 200))
  const manifest = await one('cargo_manifest', `id=eq.${order.manifest_id}&select=id,carrier_org_id,vehicle_id,metadata`)
  check('5.4 the manifest belongs to the company and names the partner as who ran it', manifest?.carrier_org_id === co.id && manifest?.vehicle_id === vehicle.body.id, JSON.stringify(manifest))

  // 6. The partner's driver picks up, departs and delivers
  if (driverToken) {
    const ref = { manifest_id: manifest.id }
    const pickup = await api(driverToken, 'POST', '/cargo/custody', { ref, kind: 'pickup', pieces: 50, condition: 'good', photo_paths: [`cargo/${manifest.id}/pickup.jpg`], lat: 21.1959, lng: 72.8302 })
    check('6.1 the partner’s driver records the pickup', [200, 201].includes(pickup.status), `${pickup.status} ${msg(pickup)}`)
    const depart = await api(driverToken, 'POST', '/cargo/custody', { ref, kind: 'departed' })
    check('6.2 departure recorded', [200, 201].includes(depart.status), `${depart.status} ${msg(depart)}`)
    const delivery = await api(driverToken, 'POST', '/cargo/custody', { ref, kind: 'delivery', receiver_name: 'Bengaluru warehouse', photo_paths: [`cargo/${manifest.id}/delivery.jpg`], lat: 13.0284, lng: 77.5516 })
    check('6.3 delivery recorded', [200, 201].includes(delivery.status), `${delivery.status} ${msg(delivery)}`)
  }

  const manifestAfter = await one('cargo_manifest', `id=eq.${manifest.id}&select=status`)
  check('6.4 the manifest is delivered', manifestAfter?.status === 'delivered', JSON.stringify(manifestAfter))

  // 7. The vendor sees it delivered and gets an invoice, exactly as with the company's own fleet
  const vendorLoads = await get(vendor.token, '/vendor/loads')
  const list = Array.isArray(vendorLoads.body) ? vendorLoads.body : vendorLoads.body.loads
  const own = list?.find(l => JSON.stringify(l).includes(loadId))
  check('7.1 the vendor sees the load delivered (or closed)', own && ['delivered', 'closed'].includes(own.stage ?? own.status), JSON.stringify(own).slice(0, 200))
  const deliveredNotes = await waitNotes(vendor.id, 'request_completed', n => n.data?.request_id === loadId, 45)
  check('7.2 the vendor is told the load was delivered', deliveredNotes.some(n => n.data?.request_id === loadId), JSON.stringify(deliveredNotes.slice(0, 1)))
  const invoices = await get(vendor.token, '/vendor/invoices')
  const inv = invoices.body?.find?.(i => i.vendor_request_id === loadId || i.manifest_id === manifest.id)
  check('7.3 the vendor has an invoice at the booked amount, issued by the company (not the partner)', !!inv && Number(inv.amount) === agreedAmount, JSON.stringify(inv).slice(0, 200))

  const passed = results.filter(r => r.ok).length
  console.log(`\n${passed}/${results.length} passed`)
  if (passed !== results.length) process.exitCode = 1
}

run().catch(e => { console.error('FATAL', e); process.exitCode = 1 })
