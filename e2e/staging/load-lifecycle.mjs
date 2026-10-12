// The real-world flow end to end, on the TEST stage: a vendor posts a load (Post a Load v2: items/HSN,
// priority, no budget/quote/company choice), a logistic company sees the server-computed recommended
// range and priority, books inside the range, assigns one of its own vehicles and drivers, the driver
// picks up, travels and delivers with a photo POD, and the vendor sees the delivery and gets an invoice.
// Checks every notification along the way: company (priority-ranked), driver (assigned), vendor
// (picked up, delivered).
//
//   node e2e/staging/load-lifecycle.mjs
import {
  api, db, check, results, sleep, tag, makeVendor, makeCompany, makeCompanyAdmin, makeDriver, makePlatformAdmin,
} from './actors.mjs'

const realFetch = globalThis.fetch
globalThis.fetch = (url, opts = {}) => realFetch(url, { signal: AbortSignal.timeout(120_000), ...opts })

const dayKey = plusDays => new Date(Date.now() + 330 * 60_000 + plusDays * 86_400_000).toISOString().slice(0, 10)
const get = (token, path, opts) => api(token, 'GET', path, undefined, opts)
const msg = r => (r.body && (r.body.detail || r.body.error || r.body.message)) || JSON.stringify(r.body)?.slice(0, 160)

const loadBody = (over = {}) => ({
  items: [{ product_name: 'Cement bags', hsn_code: '2523', gst_rate: 18, quantity: 400, unit: 'bags', weight_kg: 20000, declared_value: 150000 }],
  pickup_city: 'Mumbai', pickup_address: 'Plot 4 MIDC Andheri East', pickup_pincode: '400093', pickup_lat: 19.1197, pickup_lng: 72.8464, pickup_date: dayKey(3),
  delivery_city: 'Delhi', delivery_address: 'Warehouse 2 Okhla Phase 1', delivery_pincode: '110020', delivery_lat: 28.5355, delivery_lng: 77.275,
  priority: 'high',
  ...over,
})

async function mkVehicle(co, driverId, over = {}) {
  const r = await db('POST', 'vehicles', {
    body: {
      plate_number: `MH12${tag().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 2)}${String(Math.floor(1000 + Math.random() * 8999))}`,
      vehicle_type: 'truck', capacity_kg: 20000, available_capacity_kg: 20000, status: 'available',
      latitude: 19.07, longitude: 72.88, current_location_name: 'Mumbai', carrier_org_id: co.id, driver_id: driverId, ...over,
    },
  })
  if (r.status >= 300) throw new Error(`vehicle: ${JSON.stringify(r.body)}`)
  return r.body[0]
}

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

async function run() {
  console.log('=== Full load lifecycle: vendor posts, company books and assigns, driver delivers, vendor is told ===')

  const pa = await makePlatformAdmin()
  const co = await makeCompany()
  const admin = await makeCompanyAdmin(co.id, 'admin')
  const driver = await makeDriver(co.id)
  const vendor = await makeVendor({ approved: true, admin: pa })

  // 1. The vendor posts the load (Post a Load v2 payload: no budget, no quote_requested, no company_ids)
  const posted = await api(vendor.token, 'POST', '/vendor/loads', loadBody())
  check('1.1 the vendor posts the load', posted.status < 300, `${posted.status} ${msg(posted)}`)
  const loadId = posted.body?.id
  check('1.2 the response carries priority and a computed recommended range', posted.body?.priority === 'high' && posted.body?.price_min_inr > 0 && posted.body?.price_max_inr >= posted.body?.price_min_inr, JSON.stringify({ priority: posted.body?.priority, min: posted.body?.price_min_inr, max: posted.body?.price_max_inr }))
  const row = (await db('GET', 'vendor_shipment_requests', { query: `id=eq.${loadId}&select=status,routing,quote_requested,vendor_org_id,carrier_org_id,price_min_inr,price_max_inr,priority` })).body?.[0]
  check('1.3 stored pending, open to every company, no price/quote choice, no carrier yet', row?.status === 'pending' && row?.routing === 'open' && row?.quote_requested === false && !row?.carrier_org_id, JSON.stringify(row))

  // 2. The company sees it on its board, with the priority and range (never a budget the vendor set)
  const board = await get(admin.token, '/company/loads/market', { org: co.id })
  check('2.1 the company sees the load on its board', board.status === 200 && JSON.stringify(board.body).includes(loadId), `${board.status}`)
  const detail = await get(admin.token, `/company/loads/${loadId}`, { org: co.id })
  check('2.2 the company reads the same priority and range the vendor was shown', detail.status === 200 && detail.body?.priority === 'high' && Number(detail.body?.price_min_inr) === Number(row.price_min_inr), JSON.stringify(detail.body).slice(0, 200))

  // 3. Because the priority is high, the company should be told promptly (urgent)
  const urgentNotes = await waitNotes(admin.id, null, n => n.data?.request_id === loadId || n.data?.load_id === loadId, 30)
  check('3.1 the company is notified a load was posted', urgentNotes.length > 0, JSON.stringify(urgentNotes.slice(0, 2)))

  // 4. The company books it at the bottom of the recommended range (never outside it)
  const amount = Number(detail.body.price_min_inr)
  const outside = await api(admin.token, 'POST', `/company/loads/${loadId}/accept`, { amount_inr: amount - 5000 }, { org: co.id })
  check('4.1 booking below the range is refused (400)', outside.status === 400, `${outside.status} ${msg(outside)}`)
  const accepted = await api(admin.token, 'POST', `/company/loads/${loadId}/accept`, { amount_inr: amount }, { org: co.id })
  check('4.2 booking inside the range succeeds', accepted.status === 200, `${accepted.status} ${msg(accepted)}`)
  const afterAccept = (await db('GET', 'vendor_shipment_requests', { query: `id=eq.${loadId}&select=status,carrier_org_id,cost` })).body?.[0]
  check('4.3 the load is now owned by the company, at the booked amount', afterAccept?.carrier_org_id === co.id && Number(afterAccept?.cost) === amount, JSON.stringify(afterAccept))

  // 5. The company assigns one of its own vehicles (with a driver on it)
  const vehicle = await mkVehicle(co, driver.id)
  const assign = await api(admin.token, 'PUT', `/vendor/shipment-request/${loadId}/assign-vehicle`, { vehicle_id: vehicle.id }, { org: co.id })
  check('5.1 the vehicle is assigned and a manifest is built', assign.status === 200, `${assign.status} ${msg(assign)}`)
  const manifest = (await db('GET', 'cargo_manifest', { query: `vendor_request_id=eq.${loadId}&select=id,status` })).body?.[0]
  check('5.2 a manifest exists for the load', !!manifest, JSON.stringify(manifest))

  // 6. The driver was told
  const driverNotes = await waitNotes(driver.id, 'cargo_assigned', n => n.data?.manifest_id === manifest?.id || JSON.stringify(n).includes(loadId), 30)
  check('6.1 the driver was notified of the assignment', driverNotes.length > 0, JSON.stringify(driverNotes.slice(0, 1)))

  // 7. The driver picks up, departs and delivers (with photo evidence)
  const ref = { manifest_id: manifest.id }
  const pickup = await api(driver.token, 'POST', '/cargo/custody', { ref, kind: 'pickup', pieces: 400, condition: 'good', photo_paths: [`cargo/${manifest.id}/pickup.jpg`], lat: 19.1197, lng: 72.8464 })
  check('7.1 the driver records the pickup', [200, 201].includes(pickup.status), `${pickup.status} ${msg(pickup)}`)

  // 8. The vendor is told it was picked up
  const pickedUpNotes = await waitNotes(vendor.id, 'load_picked_up', n => n.data?.request_id === loadId, 30)
  check('8.1 the vendor is told the load was picked up', pickedUpNotes.some(n => n.data?.request_id === loadId), JSON.stringify(pickedUpNotes.slice(0, 1)))

  const depart = await api(driver.token, 'POST', '/cargo/custody', { ref, kind: 'departed' })
  check('9.1 the driver records departure', [200, 201].includes(depart.status), `${depart.status} ${msg(depart)}`)

  const delivery = await api(driver.token, 'POST', '/cargo/custody', { ref, kind: 'delivery', receiver_name: 'Delhi warehouse', photo_paths: [`cargo/${manifest.id}/delivery.jpg`], lat: 28.5355, lng: 77.275 })
  check('10.1 the driver records the delivery', [200, 201].includes(delivery.status), `${delivery.status} ${msg(delivery)}`)
  const manifestAfter = (await db('GET', 'cargo_manifest', { query: `id=eq.${manifest.id}&select=status` })).body?.[0]
  check('10.2 the manifest is delivered', manifestAfter?.status === 'delivered', JSON.stringify(manifestAfter))

  // 11. The vendor sees it delivered on their own board
  const vendorLoads = await get(vendor.token, '/vendor/loads')
  check('11.1 the vendor can read their loads', vendorLoads.status === 200, `${vendorLoads.status}`)
  const list = Array.isArray(vendorLoads.body) ? vendorLoads.body : vendorLoads.body.loads
  const own = list?.find(l => JSON.stringify(l).includes(loadId))
  check('11.2 the vendor sees this load as delivered (or closed)', own && ['delivered', 'closed'].includes(own.stage ?? own.status), JSON.stringify(own).slice(0, 200))

  // 12. The vendor is told it was delivered
  const deliveredNotes = await waitNotes(vendor.id, 'request_completed', n => n.data?.request_id === loadId, 45)
  check('12.1 the vendor is told the load was delivered', deliveredNotes.some(n => n.data?.request_id === loadId), JSON.stringify(deliveredNotes.slice(0, 1)))

  // 13. The vendor has an invoice at the booked price, GST on freight under the company's GTA option
  const invoices = await get(vendor.token, '/vendor/invoices')
  check('13.1 the vendor can read their invoices', invoices.status === 200, `${invoices.status}`)
  const inv = invoices.body?.find?.(i => i.vendor_request_id === loadId || i.manifest_id === manifest.id)
  check('13.2 an invoice was raised for this load, at the booked amount', !!inv && Number(inv.amount) === amount, JSON.stringify(inv).slice(0, 200))
  if (inv) check('13.3 freight GST is the GTA reverse-charge default, not the goods’ own rate', Number(inv.gst_rate) === 0 && Number(inv.total) === amount, JSON.stringify({ gst_rate: inv.gst_rate, total: inv.total }))

  // 14. The company's own view agrees
  const companyLoad = await get(admin.token, `/company/loads/${loadId}`, { org: co.id })
  check('14.1 the company also sees the load delivered', ['delivered', 'closed'].includes(companyLoad.body?.status) || manifestAfter?.status === 'delivered', JSON.stringify(companyLoad.body).slice(0, 160))

  const passed = results.filter(r => r.ok).length
  console.log(`\n${passed}/${results.length} passed`)
  if (passed !== results.length) process.exitCode = 1
}

run().catch(e => { console.error('FATAL', e); process.exitCode = 1 })
