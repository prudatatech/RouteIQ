// Invalid-path coverage for the load lifecycle work this session added (POST /vendor/loads, the
// server-computed range, direct and 3PL-network assignment), filling gaps the existing staging scripts
// (vendor.mjs, cargo.mjs, tpl.mjs) do not cover: cross-company vehicle assignment, custody recorded out of
// order, a quick-added truck's duplicate plate, and a 3PL partner acting on an offer not sent to them.
// Posting validation (bad HSN, weight, dates, pincodes, phone...) is already thorough in vendor.mjs and is
// not repeated here.
//
//   node e2e/staging/load-lifecycle-invalid.mjs
import {
  api, db, check, results, tag, makeCompany, makeCompanyAdmin, makeDriver, makeVendor, makePlatformAdmin, makeUser, login, env, DATA,
} from './actors.mjs'

const realFetch = globalThis.fetch
globalThis.fetch = (url, opts = {}) => realFetch(url, { signal: AbortSignal.timeout(120_000), ...opts })

const svc = { apikey: env.SERVICE, Authorization: `Bearer ${env.SERVICE}`, 'content-type': 'application/json' }
const dayKey = plusDays => new Date(Date.now() + 330 * 60_000 + plusDays * 86_400_000).toISOString().slice(0, 10)
const get = (token, path, opts) => api(token, 'GET', path, undefined, opts)
const msg = r => (r.body && (r.body.detail || r.body.error || r.body.message)) || JSON.stringify(r.body)?.slice(0, 160)
const rows = async (table, query) => (await db('GET', table, { query })).body
const one = async (table, query) => (await rows(table, query))?.[0]

async function mkVehicle(co, driverId, over = {}) {
  const r = await db('POST', 'vehicles', {
    body: {
      plate_number: `MH12IV${String(Math.floor(1000 + Math.random() * 8999))}`,
      vehicle_type: 'truck', capacity_kg: 20000, available_capacity_kg: 20000, status: 'available',
      latitude: 19.07, longitude: 72.88, current_location_name: 'Mumbai', carrier_org_id: co.id, driver_id: driverId, ...over,
    },
  })
  if (r.status >= 300) throw new Error(`vehicle: ${JSON.stringify(r.body)}`)
  return r.body[0]
}

async function postLoad(vendor, over = {}) {
  return api(vendor.token, 'POST', '/vendor/loads', {
    items: [{ product_name: 'Cement bags', hsn_code: '2523', gst_rate: 18, quantity: 400, unit: 'bags', weight_kg: 20000, declared_value: 150000 }],
    pickup_city: 'Mumbai', pickup_address: 'Plot 4 MIDC Andheri East', pickup_pincode: '400093', pickup_lat: 19.1197, pickup_lng: 72.8464, pickup_date: dayKey(3),
    delivery_city: 'Delhi', delivery_address: 'Warehouse 2 Okhla Phase 1', delivery_pincode: '110020', delivery_lat: 28.5355, delivery_lng: 77.275,
    priority: 'medium', ...over,
  })
}

async function makePartner(label) {
  const user = await makeUser(`${tag()}-${label}`, 'vendor')
  await realFetch(`${DATA}/auth/v1/admin/users/${user.id}`, { method: 'PUT', headers: svc, body: JSON.stringify({ app_metadata: { role: 'vendor' } }) })
  const tp = await db('POST', 'tpl_partners', {
    body: { company_name: `Haulers ${tag()}`, pan_number: 'AAAPL1234C', gstin: '27AAAPL1234C1Z5', status: 'active', email: user.email, phone: '+919900000099', user_id: user.id },
  })
  if (tp.status >= 300) throw new Error(`tpl_partners: ${JSON.stringify(tp.body)}`)
  const org = await one('organizations', `kind=eq.tpl_partner&profile->>legacy_tpl_partner_id=eq.${tp.body[0].id}&select=id`)
  return { ...user, token: await login(user.email), partnerRowId: tp.body[0].id, orgId: org.id }
}

async function run() {
  console.log('=== Invalid paths: cross-tenant, out-of-order, and refused-permission checks on the new load flow ===')
  const pa = await makePlatformAdmin()
  const coA = await makeCompany()
  const coB = await makeCompany()
  const adminA = await makeCompanyAdmin(coA.id, 'admin')
  const adminB = await makeCompanyAdmin(coB.id, 'admin')
  const driverA = await makeDriver(coA.id)
  const vendor = await makeVendor({ approved: true, admin: pa })

  // --- A company cannot assign another company's vehicle to its own booked load ---
  const posted1 = await postLoad(vendor)
  const loadId1 = posted1.body.id
  const detail1 = await get(adminA.token, `/company/loads/${loadId1}`, { org: coA.id })
  await api(adminA.token, 'POST', `/company/loads/${loadId1}/accept`, { amount_inr: Number(detail1.body.price_min_inr) }, { org: coA.id })
  const vehicleB = await mkVehicle(coB, (await makeDriver(coB.id)).id)
  const crossAssign = await api(adminA.token, 'PUT', `/vendor/shipment-request/${loadId1}/assign-vehicle`, { vehicle_id: vehicleB.id }, { org: coA.id })
  check('A.1 company A cannot assign company B\'s vehicle to its own load', [400, 403, 404, 409, 422].includes(crossAssign.status), `${crossAssign.status} ${msg(crossAssign)}`)
  const row1After = await one('vendor_shipment_requests', `id=eq.${loadId1}&select=status`)
  check('A.2 the load was not silently assigned to the wrong truck', row1After?.status !== 'assigned', JSON.stringify(row1After))

  // --- Company B cannot assign its own vehicle to company A's load either (it is not A's load to dispatch) ---
  const vehicleOwnB = await mkVehicle(coB, (await makeDriver(coB.id)).id)
  const bAssignsAsLoad = await api(adminB.token, 'PUT', `/vendor/shipment-request/${loadId1}/assign-vehicle`, { vehicle_id: vehicleOwnB.id }, { org: coB.id })
  check('A.3 company B cannot assign to a load it does not own (404/403/409)', [403, 404, 409].includes(bAssignsAsLoad.status), `${bAssignsAsLoad.status} ${msg(bAssignsAsLoad)}`)

  // --- Custody out of order: delivery before any pickup was ever recorded ---
  const vehicleA = await mkVehicle(coA, driverA.id)
  const assign1 = await api(adminA.token, 'PUT', `/vendor/shipment-request/${loadId1}/assign-vehicle`, { vehicle_id: vehicleA.id }, { org: coA.id })
  check('A.4 setup: company A assigns its own vehicle fine', assign1.status === 200, `${assign1.status} ${msg(assign1)}`)
  const manifest1 = await one('cargo_manifest', `vendor_request_id=eq.${loadId1}&select=id,status`)
  const earlyDelivery = await api(driverA.token, 'POST', '/cargo/custody', { ref: { manifest_id: manifest1.id }, kind: 'delivery', receiver_name: 'Too soon' })
  check('B.1 delivery before any pickup is refused, not silently accepted', [400, 409, 422].includes(earlyDelivery.status), `${earlyDelivery.status} ${msg(earlyDelivery)}`)
  const earlyDepart = await api(driverA.token, 'POST', '/cargo/custody', { ref: { manifest_id: manifest1.id }, kind: 'departed' })
  check('B.2 departure before pickup is refused the same way', [400, 409, 422].includes(earlyDepart.status), `${earlyDepart.status} ${msg(earlyDepart)}`)
  const manifest1After = await one('cargo_manifest', `id=eq.${manifest1.id}&select=status`)
  check('B.3 the manifest is still scheduled, nothing recorded early', manifest1After?.status === 'scheduled', JSON.stringify(manifest1After))

  // --- Pickup, then a duplicate pickup, then real delivery works ---
  const pick1 = await api(driverA.token, 'POST', '/cargo/custody', { ref: { manifest_id: manifest1.id }, kind: 'pickup', pieces: 400, condition: 'good', photo_paths: [`cargo/${manifest1.id}/p.jpg`], lat: 19.1197, lng: 72.8464 })
  check('B.4 the real pickup succeeds', [200, 201].includes(pick1.status), `${pick1.status} ${msg(pick1)}`)
  const dupPickup = await api(driverA.token, 'POST', '/cargo/custody', { ref: { manifest_id: manifest1.id }, kind: 'pickup', pieces: 400 })
  check('B.5 recording the same pickup twice is refused, not duplicated', [400, 409, 422].includes(dupPickup.status), `${dupPickup.status} ${msg(dupPickup)}`)

  // --- A driver who does not belong to company A cannot act on company A's manifest ---
  const outsideDriver = await makeDriver(coB.id)
  const intruder = await api(outsideDriver.token, 'POST', '/cargo/custody', { ref: { manifest_id: manifest1.id }, kind: 'departed' })
  check('C.1 a driver from another company cannot touch this manifest', [403, 404].includes(intruder.status), `${intruder.status} ${msg(intruder)}`)

  // --- Quick-added truck: a duplicate plate is refused ---
  const plate = `MH14DUP${String(Math.floor(1000 + Math.random() * 8999))}`
  const first = await api(adminA.token, 'POST', '/vehicles', { plate_number: plate, vehicle_type: 'truck' }, { org: coA.id })
  check('D.1 setup: the first quick-added truck is created', first.status === 201, `${first.status} ${msg(first)}`)
  const dup = await api(adminA.token, 'POST', '/vehicles', { plate_number: plate, vehicle_type: 'truck' }, { org: coA.id })
  check('D.2 quick-adding the same plate twice is refused (409)', dup.status === 409, `${dup.status} ${msg(dup)}`)

  // --- 3PL: a partner cannot act on an offer that was never sent to them ---
  const partner1 = await makePartner('inv1')
  const partner2 = await makePartner('inv2')
  await api(partner1.token, 'POST', '/tpl/affiliations', { company_id: coA.id })
  await api(adminA.token, 'PUT', `/org/tpl-affiliations/${partner1.orgId}/approve`, {}, { org: coA.id })
  await api(partner2.token, 'POST', '/tpl/affiliations', { company_id: coA.id })
  await api(adminA.token, 'PUT', `/org/tpl-affiliations/${partner2.orgId}/approve`, {}, { org: coA.id })

  const posted2 = await postLoad(vendor)
  const loadId2 = posted2.body.id
  const detail2 = await get(adminA.token, `/company/loads/${loadId2}`, { org: coA.id })
  await api(adminA.token, 'POST', `/company/loads/${loadId2}/accept`, { amount_inr: Number(detail2.body.price_min_inr) }, { org: coA.id })
  const escalate2 = await api(adminA.token, 'POST', '/tpl-network/escalations', { request_id: loadId2, partner_ids: [partner1.partnerRowId] }, { org: coA.id })
  check('E.1 setup: the load is escalated to partner 1 only', escalate2.status === 201, `${escalate2.status} ${msg(escalate2)}`)
  const offer2 = escalate2.body?.offers?.[0]

  const partner2Vehicle = await api(partner2.token, 'POST', `/tpl-portal/${partner2.orgId}/vehicles`, { plate_number: `MH12IV${String(Math.floor(1000 + Math.random() * 8999))}`, vehicle_type: 'truck', capacity_kg: 15000 })
  const partner2Driver = await makeDriver(partner2.orgId)
  const intrudeOffer = await api(partner2.token, 'POST', `/tpl-network/my/offers/${offer2.id}/accept`, { agreed_amount: Number(detail2.body.price_min_inr), vehicle_id: partner2Vehicle.body.id, driver_id: partner2Driver.id })
  check('E.2 a partner the offer was not sent to cannot accept it (404)', intrudeOffer.status === 404, `${intrudeOffer.status} ${msg(intrudeOffer)}`)
  const myOffers2 = await get(partner2.token, '/tpl-network/my/offers')
  check('E.3 that partner does not even see the offer in their own list', !myOffers2.body?.items?.some(o => o.id === offer2?.id), JSON.stringify(myOffers2.body).slice(0, 160))

  const passed = results.filter(r => r.ok).length
  console.log(`\n${passed}/${results.length} passed`)
  if (passed !== results.length) process.exitCode = 1
}

run().catch(e => { console.error('FATAL', e); process.exitCode = 1 })
