// Quick Truck Onboarding + Direct Load Allocation (docs/specs/quick-truck-onboarding.pdf), on the TEST
// stage: a company adds a truck with only plate number and type (no driver, capacity or documents yet —
// everything else is nullable per 20261011140000_quick_truck_onboarding.sql), then assigns it directly to
// a posted load the same way the Today "Direct Load Allocation" panel does.
//
//   node e2e/staging/quick-truck-onboarding.mjs
import { api, check, makeCompany, makeCompanyAdmin, makeDriver, makeVendor, makePlatformAdmin } from './actors.mjs'

const dayKey = plusDays => new Date(Date.now() + 330 * 60_000 + plusDays * 86_400_000).toISOString().slice(0, 10)
const msg = r => (r.body && (r.body.detail || r.body.error || r.body.message)) || JSON.stringify(r.body)?.slice(0, 160)

async function run() {
  console.log('=== Quick truck onboarding and direct load allocation ===')
  const pa = await makePlatformAdmin()
  const co = await makeCompany()
  const admin = await makeCompanyAdmin(co.id, 'admin')
  const vendor = await makeVendor({ approved: true, admin: pa })

  // 1. Quick-add a truck: only plate number and type, nothing else (no driver, capacity, documents)
  const plate = `MH14QT${String(Math.floor(1000 + Math.random() * 8999))}`
  const quick = await api(admin.token, 'POST', '/vehicles', { plate_number: plate, vehicle_type: 'truck' }, { org: co.id })
  check('1.1 a truck can be added with only a plate and a type', quick.status === 201, `${quick.status} ${msg(quick)}`)
  check('1.2 it is marked quick_added, not complete', quick.body?.profile_status === 'quick_added', JSON.stringify({ profile_status: quick.body?.profile_status }))
  check('1.3 no driver, capacity or documents were required', quick.body?.driver_id == null && quick.body?.rc_number == null, JSON.stringify({ driver_id: quick.body?.driver_id, rc: quick.body?.rc_number }))

  const driver = await makeDriver(co.id)

  // 2. A vendor posts a load
  const posted = await api(vendor.token, 'POST', '/vendor/loads', {
    items: [{ product_name: 'Steel coils', hsn_code: '7308', gst_rate: 18, quantity: 10, unit: 'pieces', weight_kg: 8000, declared_value: 400000 }],
    pickup_city: 'Pune', pickup_address: 'MIDC Bhosari', pickup_pincode: '411026', pickup_lat: 18.6298, pickup_lng: 73.8131, pickup_date: dayKey(3),
    delivery_city: 'Nashik', delivery_address: 'Ambad Industrial Area', delivery_pincode: '422010', delivery_lat: 20.0, delivery_lng: 73.78,
    priority: 'medium',
  })
  check('2.1 the vendor posts a load', posted.status < 300, `${posted.status} ${msg(posted)}`)
  const loadId = posted.body?.id

  // 3. The company shows up as able to see it, and books it (same as the normal flow)
  const detail = await api(admin.token, 'GET', `/company/loads/${loadId}`, undefined, { org: co.id })
  check('3.1 the company can read the load (open market visibility)', detail.status === 200, `${detail.status} ${msg(detail)}`)
  const accepted = await api(admin.token, 'POST', `/company/loads/${loadId}/accept`, { amount_inr: Number(detail.body.price_min_inr) }, { org: co.id })
  check('3.2 the company books it', accepted.status === 200, `${accepted.status} ${msg(accepted)}`)

  // 4. Direct allocation refuses a driverless truck, with a clear reason (not a silent failure)
  const refused = await api(admin.token, 'PUT', `/vendor/shipment-request/${loadId}/assign-vehicle`, { vehicle_id: quick.body.id }, { org: co.id })
  check('4.1 assigning a driverless truck is refused (409) with a clear reason', refused.status === 409 && /driver/i.test(msg(refused)), `${refused.status} ${msg(refused)}`)

  // 5. Give the quick-added truck a driver (a real follow-up step, not part of the relaxed onboarding fields),
  // then direct allocation succeeds
  const linked = await api(admin.token, 'PATCH', `/vehicles/${quick.body.id}`, { driver_id: driver.id, capacity_kg: 10000, available_capacity_kg: 10000 }, { org: co.id })
  check('5.1 a driver can be linked to the quick-added truck afterwards', linked.status === 200, `${linked.status} ${msg(linked)}`)
  const assign = await api(admin.token, 'PUT', `/vendor/shipment-request/${loadId}/assign-vehicle`, { vehicle_id: quick.body.id }, { org: co.id })
  check('5.2 once it has a driver, the quick-added truck can be assigned directly to the load', assign.status === 200, `${assign.status} ${msg(assign)}`)
  const afterAssign = await api(admin.token, 'GET', `/company/loads/${loadId}`, undefined, { org: co.id })
  check('5.3 the load is now assigned to that truck', afterAssign.body?.assigned_vehicle_id === quick.body.id || afterAssign.body?.status === 'assigned', JSON.stringify({ status: afterAssign.body?.status, assigned_vehicle_id: afterAssign.body?.assigned_vehicle_id }))

  const results = (await import('./actors.mjs')).results
  const passed = results.filter(r => r.ok).length
  console.log(`\n${passed}/${results.length} passed`)
  if (passed !== results.length) process.exitCode = 1
}

run().catch(e => { console.error('FATAL', e); process.exitCode = 1 })
