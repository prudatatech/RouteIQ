// Section 3 of tenancy.mjs: THE ISOLATION MATRIX. Two companies, two vendors, a platform admin; every list and by-id endpoint
// the web app uses, called by each actor; plus the PostgREST tables the web reads directly.
import { randomUUID } from 'node:crypto'
import { api, db, check, makeUser, login, makeCompany, makeCompanyAdmin, makeVendor, makePlatformAdmin, makeDriver, sleep, tag, env, DATA } from './actors.mjs'

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const J = x => JSON.stringify(x)
const day = n => new Date(Date.now() + 330 * 60000 + n * 86400000).toISOString().slice(0, 10)
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)
const seedNotes = []

async function ins(table, body, what = table) {
  const r = await db('POST', table, { body })
  if (r.status >= 300) { seedNotes.push(`SEED ${what}: ${r.status} ${J(r.body).slice(0, 200)}`); console.log(`  (seed ${what} failed: ${J(r.body).slice(0, 160)})`); return null }
  return r.body[0]
}

/** One company's world: staff, vehicle, driver, trip, shipment, invoice, expense, pay, depot, problem, SOS, document, notification. */
async function seedCompany(label, co, vendor) {
  const M = `TN${label}${tag()}`.toUpperCase()
  const w = { label, co, M, ids: {}, marks: [M] }
  w.admin = await makeCompanyAdmin(co.id, 'admin')
  w.manager = await makeCompanyAdmin(co.id, 'manager')
  w.driver = await makeDriver(co.id)
  await db('PATCH', 'users', { query: `id=eq.${w.driver.id}`, body: { full_name: `Driver ${M}`, phone: `+91${9000000000 + Math.floor(Math.random() * 99999999)}` } })
  await db('PATCH', 'users', { query: `id=eq.${w.admin.id}`, body: { full_name: `Admin ${M}` } })
  const ids = w.ids
  ids.driver = w.driver.id; ids.admin = w.admin.id; ids.manager = w.manager.id

  const plate = `MH${12 + (label === 'A' ? 0 : 1)}${M.slice(-2)}${Math.floor(1000 + Math.random() * 8999)}`
  const v = await api(w.admin.token, 'POST', '/vehicles', { plate_number: plate, vehicle_type: 'truck', capacity_kg: 8000, driver_name: `Driver ${M}`, driver_phone: '98' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0') })
  check(`3.s.${label}.vehicle created via API and stamped`, v.status === 201, J(v).slice(0, 200))
  ids.vehicle = v.body?.id ?? v.body?.vehicle?.id
  w.plate = plate; w.marks.push(plate)
  w.driverPhone = (await db('GET', 'users', { query: `id=eq.${w.driver.id}&select=phone` })).body?.[0]?.phone
  const v2 = await ins('vehicles', { id: randomUUID(), plate_number: `MH0${label === 'A' ? 4 : 5}${M.slice(-2)}${Math.floor(1000 + Math.random() * 8999)}`, vehicle_type: 'van', capacity_kg: 900, carrier_org_id: co.id })
  ids.vehicle2 = v2?.id

  ids.route = (await ins('routes', { vehicle_id: ids.vehicle, carrier_org_id: co.id, status: 'pending' }))?.id
  ids.shipment = (await ins('shipments', { tracking_id: `SH${M}`, status: 'created', origin_name: `Origin ${M}`, origin_address: `Dock ${M}`, current_holder: 'consignor', carrier_org_id: co.id, consignee_name: `Consignee ${M}`, total_weight_kg: 120, total_items: 3 }))?.id
  w.marks.push(`SH${M}`)
  ids.depot = (await ins('depots', { id: randomUUID(), name: `Depot ${M}`, address: `Yard ${M}`, latitude: 19.07, longitude: 72.87, carrier_org_id: co.id }))?.id
  // vendor load awarded to this company
  const orgId = (await db('GET', 'org_members', { query: `user_id=eq.${vendor.id}&select=org_id` })).body?.[0]?.org_id
  vendor.orgId = orgId
  const req = await ins('vendor_shipment_requests', { vendor_id: vendor.id, vendor_org_id: orgId, carrier_org_id: co.id, pickup_location: `Pickup ${M}`, pickup_lat: 19.07, pickup_lng: 72.87, drop_location: `Drop ${M}`, drop_lat: 18.52, drop_lng: 73.85, required_capacity_kg: 2000, status: 'approved', cost: 20000 })
  ids.request = req?.id
  ids.manifest = (await ins('cargo_manifest', { vendor_request_id: req?.id, pickup_location: `Pickup ${M}`, pickup_lat: 19.07, pickup_lng: 72.87, drop_location: `Drop ${M}`, drop_lat: 18.52, drop_lng: 73.85, capacity_kg: 2000, status: 'scheduled', carrier_org_id: co.id, vendor_org_id: orgId, vehicle_id: ids.vehicle }))?.id
  ids.invoice = (await ins('invoices', { invoice_number: `INV-${M}`, amount: 20000, gst_rate: 5, gst_amount: 1000, total: 21000, status: 'issued', issuer_org_id: co.id, bill_to_org_id: orgId, manifest_id: ids.manifest, vendor_request_id: req?.id, vendor_id: vendor.id }))?.id
  w.marks.push(`INV-${M}`)
  const ex = await api(w.admin.token, 'POST', '/finance/expenses', { category: 'fuel', amount: 1234, expense_date: today(), note: `Expense ${M}`, vehicle_id: ids.vehicle })
  check(`3.s.${label}.expense created via API`, ex.status === 201, J(ex).slice(0, 200))
  ids.expense = ex.body?.id
  const rate = await api(w.admin.token, 'POST', '/driver-pay/rates', { vehicle_type: 'truck', per_trip_amount: 500, per_km_amount: 3, effective_from: day(1 + Math.floor(Math.random() * 300)) })
  ids.rate = rate.body?.id ?? rate.body?.rate?.id
  if (rate.status >= 300) seedNotes.push(`rate ${rate.status} ${J(rate.body).slice(0, 120)}`)
  ids.pay = (await ins('driver_pay_entries', { driver_id: w.driver.id, vehicle_id: ids.vehicle, route_id: ids.route, trip_date: today(), km: 100, km_source: 'planned', per_trip_amount: 500, per_km_amount: 300, adjustments: [], amount: 800, rate_missing: false, status: 'earned', carrier_org_id: co.id }))?.id
  ids.sos = (await ins('sos_alerts', { driver_id: w.driver.id, vehicle_id: ids.vehicle, alert_type: 'breakdown', description: `SOS ${M}`, status: 'active', carrier_org_id: co.id }))?.id
  ids.problem = (await ins('cargo_exceptions', { code: `EX-${M}`, type: 'damage', severity: 'high', status: 'open', source: 'manual', escalation_count: 0, notes: [], description: `Problem ${M}`, vehicle_id: ids.vehicle, route_id: ids.route, carrier_org_id: co.id }))?.id
  ids.claim = (await ins('cargo_claims', { code: `CL-${M}`, claim_type: 'damage', status: 'filed', raised_by_role: 'staff', document_paths: [], carrier_org_id: co.id, shipment_id: ids.shipment }))?.id
  ids.transfer = (await ins('cargo_transfers', { code: `TR-${M}`, from_vehicle_id: ids.vehicle, to_vehicle_id: ids.vehicle2, status: 'planned', planned_at: new Date().toISOString(), eway_part_b_required: false, carrier_org_id: co.id }))?.id
  ids.job = (await ins('vehicle_maintenance_jobs', { vehicle_id: ids.vehicle, status: 'open', reason_type: 'breakdown', opened_at: new Date().toISOString(), updated_at: new Date().toISOString(), carrier_org_id: co.id, note: `Job ${M}` }))?.id
  ids.fuel = (await ins('vehicle_fuel_logs', { vehicle_id: ids.vehicle, filled_at: new Date().toISOString(), litres: 50, price_per_litre: 95, total_amount: 4750, is_full_tank: true, payment_mode: 'cash', bill_status: 'no_bill', flags: [], station_name: `Pump ${M}` }))?.id
  ids.window = (await ins('capacity_windows', { vehicle_id: ids.vehicle, opens_at: new Date().toISOString(), closes_at: new Date(Date.now() + 864e5).toISOString(), status: 'open', carrier_org_id: co.id }))?.id
  ids.alert = (await ins('maintenance_alerts', { id: randomUUID(), vehicle_id: ids.vehicle, alert_type: 'overspeed', description: `Alert ${M}`, status: 'open', is_test: false, occurrences: 1, severity: 'high', carrier_org_id: co.id }))?.id
  ids.note = (await ins('notifications', { user_id: w.admin.id, title: `Note ${M}`, body: `Body ${M}`, type: 'info' }))?.id
  ids.document = (await ins('user_documents', { user_id: w.driver.id, doc_type: 'driving_licence', verification_method: 'manual', resubmission_count: 0, status: 'pending', metadata: { marker: M } }))?.id
  ids.message = (await ins('messages', { sender_role: 'admin', sender_name: `Admin ${M}`, body: `Message ${M}`, sender_id: w.admin.id, route_id: ids.route }))?.id
  ids.ldoc = (await ins('load_documents', { org_id: co.id, kind: 'lr', fields: { m: M }, status: 'draft', version: 1, load_id: ids.manifest, carrier_org_id: co.id, number: `LR-${M}` }))?.id
  ids.svc = (await ins('vehicle_service_log', { vehicle_id: ids.vehicle, item: 'Oil change', done_at: today(), note: `Service ${M}` }))?.id
  ids.custody = (await ins('cargo_custody_events', { shipment_id: ids.shipment, kind: 'pickup', photo_paths: [], notes: `Custody ${M}` }))?.id
  ids.dpoint = (await ins('delivery_points', { id: randomUUID(), name: `Drop ${M}`, address: `Gate ${M}`, latitude: 18.5, longitude: 73.8, shipment_id: ids.shipment }))?.id
  ids.stop = (await ins('route_stops', { route_id: ids.route, delivery_point_id: ids.dpoint, sequence: 1 }))?.id
  ids.odo = (await ins('vehicle_odometer_events', { vehicle_id: ids.vehicle, kind: 'manual', after_km: 100, reason: `Odo ${M}` }))?.id
  for (const [k, id] of Object.entries(ids)) if (!id) seedNotes.push(`no id for ${label}.${k}`)
  return w
}

const idsOfBody = body => new Set((J(body ?? '').match(UUID) ?? []).map(s => s.toLowerCase()))
const hasAny = (text, list) => list.filter(x => x && text.includes(x))

export async function isolation({ matrix }) {
  console.log('\n== 3. The isolation matrix ==')
  const platform = await makePlatformAdmin()
  const coA = await makeCompany(`IsoA ${tag()}`), coB = await makeCompany(`IsoB ${tag()}`)
  const vendorA = await makeVendor(), vendorB = await makeVendor()
  const A = await seedCompany('A', coA, vendorA)
  const B = await seedCompany('B', coB, vendorB)
  console.log('  seed notes:', seedNotes)
  const vendorOf = { A: vendorA, B: vendorB }
  // every id the world holds (company-owned rows only: not the people's ids, which differ per company too)
  const idsA = Object.values(A.ids).filter(Boolean), idsB = Object.values(B.ids).filter(Boolean)
  const marksA = [...A.marks, A.M], marksB = [...B.marks, B.M]
  await sleep(1500)

  const rnd = () => randomUUID()
  const full = (p, w) => p.replace(/\{(\w+)\}/g, (_, k) => w.ids[k] ?? w[k] ?? 'x')

  // ── lists ──
  const LISTS = [
    '/vehicles', '/vehicles/summary', '/vehicles/sos-counts', '/vehicles/requests', '/vehicles/requests/count',
    '/fleet/analytics', '/fleet/health', '/fleet/service-due', '/fleet/alerts', '/fleet/alerts/summary', '/fleet/alert-settings', '/fleet/maintenance/jobs',
    '/fleet/fuel-summary', '/fleet/fuel-anomalies', '/fleet/vehicles/{vehicle}/fuel-logs', '/fleet/vehicles/{vehicle}/service-log', '/fleet/vehicles/{vehicle}/service-plans',
    '/shipments', '/routes', '/routes/delivery-points', '/dashboard/kpis', '/dashboard/people-attention', '/dashboard/shipment-counts', '/ops/today',
    '/analytics/insights', '/analytics/demand', '/analytics/metrics', '/analytics/fleet-overview', '/analytics/daily-activity', '/analytics/active-missions',
    '/analytics/audit-logs', '/analytics/driver-performance', '/analytics/vendor-performance',
    '/search?q={M}', '/search?q=SH', '/search?q=Depot',
    '/finance/summary', '/finance/unpriced', '/finance/invoices', '/finance/invoices/summary', '/finance/invoice-reports', '/finance/company', '/finance/expenses', '/finance/settings',
    '/driver-pay/rates', '/driver-pay/entries', '/driver-pay/payouts',
    '/people', '/people/settings', '/people/duplicates', '/people/export.csv', '/people/documents/expiring.csv',
    '/depots', '/cargo/shipments', '/cargo/open-loads', '/cargo/security-alerts', '/cargo/exceptions', '/cargo/transfers', '/cargo/hubs', '/cargo/claims',
    '/notifications', '/messages', '/messages/unread',
    '/capacity/windows', '/capacity/windows/open', '/capacity/bids/mine', '/capacity/bids/pending', '/capacity/nearby-vendors',
    '/users', '/users/me', '/company/loads/market', '/marketplace/open-loads', '/routing/open-loads', '/pricing/settings',
    '/tpl-network/settings', '/tpl-network/orders', '/tpl-network/partners/stats', '/tpl-network/escalations',
    '/org', '/org/members', '/orgs/mine', '/bookings', '/traffic/incidents',
    '/vendor/loads', '/vendor/requests', '/vendor/profile',
  ]
  const ctx = { A, B, platform, vendorA, vendorB }
  const actors = [
    ['A', A.admin.token, undefined], ['B', B.admin.token, undefined],
    ['P', platform.token, platform.orgId], ['VA', vendorA.token, undefined], ['VB', vendorB.token, undefined],
    ['DA', A.driver.token, undefined], ['DB', B.driver.token, undefined],
  ]
  const leaks = []
  const cellOf = {}
  for (const path0 of LISTS) {
    const cell = {}
    for (const [who, token, org] of actors) {
      const owner = who === 'A' || who === 'VA' || who === 'DA' ? A : who === 'B' || who === 'VB' || who === 'DB' ? B : null
      const path = full(path0, who === 'B' || who === 'VB' || who === 'DB' ? B : A).replace('{M}', who === 'B' || who === 'VB' || who === 'DB' ? B.M : A.M)
      const r = await api(token, 'GET', path, undefined, { org })
      const text = typeof r.body === 'string' ? r.body : J(r.body)
      let verdict = String(r.status)
      if (r.status >= 500) verdict += ' 5XX'
      // what must NOT be in the response
      const foreignIds = who === 'A' || who === 'VA' || who === 'DA' ? [...idsB] : who === 'B' || who === 'VB' || who === 'DB' ? [...idsA] : []
      const foreignMarks = who === 'A' || who === 'VA' || who === 'DA' ? marksB : who === 'B' || who === 'VB' || who === 'DB' ? marksA : []
      // a vendor legitimately sees its own load's rows (request, manifest, invoice it is billed for) and its own company's name data
      const shareOk = new Set(who === 'VA' ? [A.ids.request, A.ids.manifest, A.ids.invoice] : who === 'VB' ? [B.ids.request, B.ids.manifest, B.ids.invoice] : [])
      const found = [...hasAny(text.toLowerCase(), foreignIds.filter(i => !shareOk.has(i)).map(s => s.toLowerCase())), ...hasAny(text, foreignMarks)]
      // a vendor must see none of the OTHER company's staff-side rows, nor its own load company's internals
      let ownLeak = []
      if (who === 'VA' || who === 'VB') {
        const mine = who === 'VA' ? A : B
        const internal = ['vehicle2', 'route', 'shipment', 'depot', 'pay', 'sos', 'problem', 'claim', 'transfer', 'job', 'fuel', 'window', 'alert', 'expense', 'rate', 'document', 'ldoc', 'driver', 'admin', 'manager'].map(k => mine.ids[k]).filter(Boolean)
        ownLeak = hasAny(text.toLowerCase(), internal.map(s => s.toLowerCase()))
        if (r.status === 200) ownLeak = ownLeak.concat(hasAny(text, [`Depot ${mine.M}`, `Driver ${mine.M}`]))
      }
      const own = owner && (who === 'A' || who === 'B') ? (who === 'A' ? A : B) : null
      const byDesign = (who === 'VA' || who === 'VB') && path0 === '/capacity/windows/open'
      if (byDesign) { found.length = 0; ownLeak = [] }
      if (found.length || ownLeak.length) { verdict += ` LEAK(${[...found, ...ownLeak].slice(0, 3).join(',')})`; leaks.push({ path: path0, who, found: [...found, ...ownLeak] }) }
      if (who === 'P' && r.status === 200) {
        const seenA = hasAny(text.toLowerCase(), idsA.map(s => s.toLowerCase())).length + hasAny(text, marksA).length
        const seenB = hasAny(text.toLowerCase(), idsB.map(s => s.toLowerCase())).length + hasAny(text, marksB).length
        verdict += seenA && seenB ? ' both' : seenA ? ' A-only' : seenB ? ' B-only' : ' none'
      }
      if ((who === 'A' || who === 'B') && own && r.status === 200) {
        const mineIds = Object.values(own.ids).filter(Boolean)
        const sees = hasAny(text.toLowerCase(), mineIds.map(s => s.toLowerCase())).length + hasAny(text, own.marks).length
        verdict += sees ? ' own' : ' empty'
      }
      cell[who] = verdict
    }
    cellOf[path0] = cell
    const bad = Object.values(cell).some(v => /LEAK|5XX/.test(v))
    check(`3.1 list ${path0}  A:${cell.A} B:${cell.B} P:${cell.P} VA:${cell.VA} VB:${cell.VB} DA:${cell.DA} DB:${cell.DB}`, !bad, J(cell))
  }
  matrix.push({ section: 'lists', cells: cellOf })

  // ── by id: B (and a vendor not involved) touching A's rows must look exactly like touching nothing ──
  const BYID = [
    ['GET', '/vehicles/{vehicle}'], ['GET', '/vehicles/{vehicle}/sos'], ['GET', '/vehicles/{vehicle}/photos'],
    ['PATCH', '/vehicles/{vehicle}', { vehicle_model: 'Hacked' }], ['POST', '/vehicles/{vehicle}/status', { status: 'maintenance' }], ['DELETE', '/vehicles/{vehicle}'],
    ['POST', '/vehicles/{vehicle}/approve', {}], ['POST', '/vehicles/{vehicle}/reject', { reason: 'no' }], ['POST', '/vehicles/{vehicle}/sos', { alert_type: 'breakdown' }],
    ['GET', '/fleet/vehicles/{vehicle}/health'], ['GET', '/fleet/vehicles/{vehicle}/location'], ['GET', '/fleet/vehicles/{vehicle}/activity'], ['GET', '/fleet/vehicles/{vehicle}/share-links'],
    ['POST', '/fleet/vehicles/{vehicle}/share-links', {}], ['GET', '/fleet/vehicles/{vehicle}/service-plans'], ['GET', '/fleet/vehicles/{vehicle}/service-log'], ['GET', '/fleet/vehicles/{vehicle}/fuel-logs'], ['GET', '/fleet/vehicles/{vehicle}/fuel-stats'],
    ['PUT', '/fleet/vehicles/{vehicle}/odometer', { odometer_km: 123456 }], ['GET', '/fleet/vehicles/{vehicle}/maintenance/preview'], ['POST', '/fleet/vehicles/{vehicle}/maintenance', { reason_type: 'other' }],
    ['PUT', '/fleet/fuel-logs/{fuel}', { litres: 1 }], ['DELETE', '/fleet/fuel-logs/{fuel}'], ['GET', '/fleet/fuel-logs/{fuel}/bill-url'],
    ['PATCH', '/fleet/maintenance/jobs/{job}', { notes: 'x' }], ['POST', '/fleet/maintenance/jobs/{job}/close', {}],
    ['POST', '/fleet/alerts/{alert}/acknowledge', {}], ['POST', '/fleet/alerts/{alert}/resolve', {}],
    ['GET', '/cargo/vehicles/{vehicle}/on-board'], ['GET', '/telemetry/{vehicle}/history'], ['GET', '/telemetry/{vehicle}/live'], ['GET', '/gps/vehicle/{vehicle}'], ['GET', '/gps/vehicle/{vehicle}/track'],
    ['GET', '/shipments/{shipment}'], ['GET', '/shipments/{shipment}/overview'], ['GET', '/shipments/{shipment}/history'], ['GET', '/shipments/{shipment}/proof'], ['GET', '/shipments/{shipment}/verify'], ['GET', '/shipments/{shipment}/assign-options'],
    ['PATCH', '/shipments/{shipment}', { status: 'cancelled' }], ['PATCH', '/shipments/{shipment}/edit', { consignee_name: 'Hacked' }], ['PUT', '/shipments/{shipment}/metadata', { metadata: { x: 1 } }], ['POST', '/shipments/{shipment}/rating', { rating: 5 }], ['POST', '/shipments/{shipment}/assign', { vehicle_id: '{vehicle}' }], ['DELETE', '/shipments/{shipment}'],
    ['GET', '/routes/{route}'], ['PATCH', '/routes/{route}', { status: 'cancelled' }], ['PATCH', '/routes/{route}/status', { status: 'cancelled' }], ['POST', '/routes/{route}/reroute', {}], ['DELETE', '/routes/{route}'], ['GET', '/weather/route/{route}'],
    ['GET', '/invoices/{invoice}'], ['GET', '/invoices/{invoice}/pdf'], ['PUT', '/finance/invoices/{invoice}/pay', { payment_method: 'cash' }], ['PUT', '/finance/invoices/{invoice}/void', { reason: 'x' }],
    ['PUT', '/finance/expenses/{expense}', { amount: 1 }], ['DELETE', '/finance/expenses/{expense}'], ['GET', '/finance/expenses/{expense}/receipt-url'],
    ['PATCH', '/driver-pay/rates/{rate}', { per_trip_amount: 1 }], ['DELETE', '/driver-pay/rates/{rate}'], ['POST', '/driver-pay/entries/{pay}/adjust', { amount: 1, reason: 'x' }], ['POST', '/driver-pay/entries/{pay}/void', { reason: 'x' }],
    ['GET', '/people/{driver}'], ['PATCH', '/people/{driver}', { full_name: 'Hacked' }], ['POST', '/people/{driver}/status', { status: 'inactive' }], ['POST', '/people/{driver}/invite', {}], ['GET', '/people/{driver}/documents'], ['GET', '/people/{driver}/emergency-contacts'],
    ['GET', '/people/{driver}/bank-accounts'], ['GET', '/people/{driver}/notes'], ['POST', '/people/{driver}/notes', { note: 'x' }], ['GET', '/people/{driver}/documents/{document}/file'], ['PATCH', '/people/{driver}/documents/{document}', { status: 'verified' }], ['DELETE', '/people/{driver}/documents/{document}'],
    ['PATCH', '/users/{driver}', { full_name: 'Hacked' }],
    ['GET', '/cargo/exceptions/{problem}'], ['POST', '/cargo/exceptions/{problem}/actions', { action: 'note', note: 'x' }], ['GET', '/cargo/exceptions/{problem}/relief-vehicles'],
    ['GET', '/cargo/transfers/{transfer}'], ['POST', '/cargo/transfers/{transfer}/cancel', {}], ['POST', '/cargo/transfers/{transfer}/handover-out', {}], ['POST', '/cargo/transfers/{transfer}/eway', {}],
    ['GET', '/cargo/claims/{claim}'], ['PATCH', '/cargo/claims/{claim}', { status: 'approved' }],
    ['GET', '/cargo/lots/{shipment}'], ['GET', '/cargo/where/{shipment}'], ['GET', '/cargo/timeline/{shipment}'], ['GET', '/cargo/hubs/{depot}/inventory'], ['POST', '/cargo/resolve-alert/{sos}', {}],
    ['POST', '/capacity/windows/{window}/close', {}], ['GET', '/capacity/windows/{window}/bid-count'],
    ['GET', '/company/loads/{request}'], ['POST', '/company/loads/{request}/quotes', { amount: 1 }], ['POST', '/company/loads/{request}/accept', {}],
    ['GET', '/loads/{manifest}/documents'], ['GET', '/loads/{manifest}/timeline'], ['GET', '/loads/{manifest}/settlement'], ['GET', '/loads/{manifest}/dispatch-check'],
    ['POST', '/notifications/{note}/read', {}],
    ['PUT', '/telemetry/sos/{sos}/acknowledge', {}], ['PUT', '/telemetry/sos/{sos}/resolve', {}], ['POST', '/telemetry/sos/{sos}/cancel', {}],
    ['POST', '/telemetry', { vehicle_id: '{vehicle}', latitude: 19.1, longitude: 72.9, speed_kmph: 10, heading: 10 }],
    ['POST', '/telemetry/call-driver/{vehicle}', {}], ['POST', '/telemetry/mobile-session', { vehicle_id: '{vehicle}', phone: '9876543210' }],
    ['POST', '/telemetry/stoppages', { vehicle_id: '{vehicle}', latitude: 19.1, longitude: 72.9, started_at: new Date().toISOString() }],
    ['GET', '/fleet/vehicles/{vehicle}/service-log'], ['POST', '/fleet/vehicles/{vehicle}/service-log', { service_date: today(), service_type: 'oil' }],
    ['GET', '/org/tpl-affiliations/{vehicle}'],
    ['PUT', '/vendor/shipment-request/{request}/approve', {}], ['PUT', '/vendor/shipment-request/{request}/reject', { reason: 'nope nope' }], ['PUT', '/vendor/shipment-request/{request}/cancel', {}],
    ['PUT', '/vendor/shipment-request/{request}/assign-vehicle', { vehicle_id: '{vehicle}' }], ['GET', '/vendor/loads/{request}'], ['GET', '/vendor/loads/{request}/quotes'],
    ['POST', '/optimize/incubate/{vehicle}', {}], ['POST', '/optimize/reoptimize/{route}', {}],
    ['POST', '/cargo/verify-pod', { tracking_id: 'SH{M}', recipient_name: 'Bob', reason: 'handed at gate' }],
    ['POST', '/cargo/optimize-pooling', { shipment_ids: ['{shipment}', '{shipment}'], vehicle_id: '{vehicle}' }],
    ['POST', '/bookings/{request}/assign', { vehicle_id: '{vehicle}' }], ['POST', '/bookings/{request}/cancel', {}],
  ]
  const idMap = x => x
  const byIdCells = {}
  // actors that must be shut out of A's rows: B's admin and (for load/vendor-facing ones) vendor B
  for (const [method, path0, body0] of BYID) {
    const fill = (w, o) => full(path0, w).replace('{M}', w.M).replace(/\{\w+\}/g, 'x')
    const bodyFor = w => body0 && JSON.parse(J(body0).replace(/\{(\w+)\}/g, (_, k) => w.ids[k] ?? w[k] ?? 'x'))
    const ghostBody = () => { if (!body0) return body0; let t = J(bodyFor(A)); for (const id of Object.values(A.ids)) if (id) t = t.split(id).join(rnd()); return JSON.parse(t.split(A.M).join('ZZZ' + rnd().slice(0, 6))) }
    const mine = await api(A.admin.token, method === 'GET' ? 'GET' : 'GET', '/orgs/mine') // keep A's session warm
    const asB = await api(B.admin.token, method, fill(A), bodyFor(A))
    // the control: the same call for an id nobody has
    const nothing = path0.replace(/\{\w+\}/g, () => rnd())
    const ghost = await api(B.admin.token, method, nothing, ghostBody())
    const asVB = await api(vendorB.token, method, fill(A), bodyFor(A))
    const asDB = await api(B.driver.token, method, fill(A), bodyFor(A))
    const bad = (s, g) => s >= 500 || (s >= 200 && s < 300) || (s === 403 && g !== 403) || (s !== g && s === 404 ? false : false)
    const leak = asB.status >= 500 || (asB.status >= 200 && asB.status < 300) || (asB.status === 403 && ghost.status !== 403) || (asB.status !== ghost.status && ![400, 404, 422].includes(asB.status))
    const vbad = asVB.status >= 500 || (asVB.status >= 200 && asVB.status < 300 && !(path0.includes('/notifications/') || path0.includes('/capacity/windows/'))) // vendors bid on any open window: by design
    const dbad = asDB.status >= 500 || (asDB.status >= 200 && asDB.status < 300 && !path0.includes('/notifications/'))
    const cell = `B:${asB.status}(ghost ${ghost.status}) VB:${asVB.status} DB:${asDB.status}`
    byIdCells[`${method} ${path0}`] = cell
    check(`3.2 by-id ${method} ${path0}  ${cell}`, !leak && !vbad && !dbad, `B on A's row: ${asB.status} ${J(asB.body).slice(0, 120)} | ghost ${ghost.status} ${J(ghost.body).slice(0, 80)} | VB ${asVB.status} ${J(asVB.body).slice(0, 100)} | DB ${asDB.status} ${J(asDB.body).slice(0, 100)}`)
  }
  matrix.push({ section: 'byid', cells: byIdCells })

  // ── lists filtered by ANOTHER company's id or text: must still answer nothing of theirs ──
  const FILTERS = [
    '/fleet/alerts?status=all&vehicle_id={vehicle}', '/driver-pay/entries?driver_id={driver}', '/driver-pay/payouts?driver_id={driver}',
    '/analytics/driver-performance?driver_id={driver}', '/analytics/vendor-performance?vendor_id={driver}', '/messages?route_id={route}', '/messages?shipment_id={shipment}',
    '/cargo/claims?ref={shipment}', '/cargo/exceptions?vehicle_id={vehicle}', '/people?search={M}', '/people?q={M}', '/search?q={M}', '/search?q={plate}',
    '/shipments?search={M}', '/finance/invoices?search={M}', '/finance/expenses?vehicle_id={vehicle}', '/vehicles?search={plate}', '/routes?vehicle_id={vehicle}',
    '/fleet/maintenance/jobs?vehicle_id={vehicle}', '/fleet/fuel-anomalies?vehicle_id={vehicle}', '/cargo/transfers?vehicle_id={vehicle}',
  ]
  const filterCells = {}
  for (const f of FILTERS) {
    const path = full(f, A).replace('{M}', A.M).replace('{plate}', A.plate)
    const r = await api(B.admin.token, 'GET', path)
    const text = J(r.body ?? '')
    const found = [...hasAny(text.toLowerCase(), idsA.map(x => x.toLowerCase())), ...hasAny(text, marksA)]
    filterCells[f] = `${r.status}${found.length ? ' LEAK' : ''}`
    check(`3.2c filter as B naming A's value: GET ${f} -> ${r.status}`, r.status < 500 && !found.length, `${r.status} found ${found.slice(0, 3).join(',')}`)
  }
  matrix.push({ section: 'foreign-filters', cells: filterCells })

  // ── writes that NAME another company's row in the body ──
  const REFS = [
    ['POST', '/finance/expenses', w => ({ category: 'fuel', amount: 100, expense_date: today(), vehicle_id: w.ids.vehicle })],
    ['POST', '/capacity/windows', w => ({ vehicle_id: w.ids.vehicle, floor_price: 1000, duration_minutes: 60 })],
    ['POST', '/cargo/exceptions', w => ({ type: 'damage', severity: 'low', vehicle_id: w.ids.vehicle, description: 'ref probe' })],
    ['POST', '/cargo/transfers', w => ({ from_vehicle_id: w.ids.vehicle, to_depot_id: w.ids.depot })],
    ['POST', '/cargo/claims', w => ({ shipment_id: w.ids.shipment, claim_type: 'damage', claimed_amount: 100 })],
    ['POST', '/messages', w => ({ route_id: w.ids.route, body: 'ref probe' })],
    ['POST', '/driver-pay/payouts', w => ({ driver_id: w.ids.driver, amount: 100, method: 'cash', entry_ids: [w.ids.pay] })],
    ['POST', '/driver-pay/entries/approve', w => ({ ids: [w.ids.pay] })],
    ['POST', '/finance/invoices', w => ({ manifest_id: w.ids.manifest })],
    ['POST', '/finance/unpriced/price', w => ({ kind: 'manifest', id: w.ids.manifest, amount: 1 })],
    ['POST', '/cargo/lots/split', w => ({ ref: w.ids.shipment, parts: [{ pieces: 1 }, { pieces: 1 }] })],
    ['POST', '/cargo/custody', w => ({ ref: w.ids.shipment, kind: 'pickup', pieces: 1 })],
    ['POST', '/vehicles', w => ({ plate_number: `MH20${Math.floor(100000 + Math.random() * 899999)}`, vehicle_type: 'truck', capacity_kg: 1000, driver_name: 'Foreign Driver', driver_phone: w.driverPhone })],
    ['PATCH', 'OWN:/vehicles/{vehicle}', w => ({ driver_id: w.ids.driver })],
    ['POST', '/optimize', w => ({ vehicle_ids: [w.ids.vehicle], shipment_ids: [w.ids.shipment] })],
    ['POST', '/shipments', w => ({ tracking_id: `RF${tag()}`.toUpperCase(), origin_name: 'x', vehicle_id: w.ids.vehicle })],
  ]
  const refCells = {}
  for (const [method, path0, mk] of REFS) {
    const own = path0.startsWith('OWN:')
    const path = own ? path0.slice(4).replace('{vehicle}', B.ids.vehicle) : path0
    const foreign = await api(B.admin.token, method, path, mk(A))
    const control = await api(B.admin.token, method, path, mk(B))
    const created = foreign.status >= 200 && foreign.status < 300 && !(J(foreign.body).includes('"approved":[]') && J(foreign.body).includes('Not found'))
    const note = control.status >= 400 ? ' (control with own ids also refused: body not conclusive)' : ''
    refCells[`${method} ${path0}`] = `foreign:${foreign.status} control:${control.status}`
    check(`3.2b foreign reference ${method} ${path0}  foreign:${foreign.status} control:${control.status}${note}`, !created && foreign.status < 500, `${foreign.status} ${J(foreign.body).slice(0, 200)} | control ${control.status} ${J(control.body).slice(0, 100)}`)
  }
  matrix.push({ section: 'foreign-references', cells: refCells })
  // An error answer is not proof nothing was written: read back what B's admin created and look for A's ids
  const byB = [['cargo_exceptions', 'created_by'], ['cargo_transfers', 'created_by'], ['cargo_claims', 'raised_by'], ['capacity_windows', 'created_by'], ['expenses', 'created_by'], ['messages', 'sender_id'],
    ['cargo_custody_events', 'recorded_by'], ['driver_payouts', 'created_by'], ['shipments', 'created_by'], ['vehicles', 'submitted_by'], ['invoices', 'created_by']]
  const stray = []
  for (const [table, col] of byB) {
    const r = await db('GET', table, { query: `${col}=eq.${B.admin.id}&select=*` })
    if (r.status >= 300) continue
    for (const row of r.body) {
      const t = J(row)
      const hitsA = hasAny(t.toLowerCase(), idsA.map(x => x.toLowerCase())).filter(x => x !== A.ids.driver.toLowerCase() || table !== 'vehicles')
      const ownerA = [row.carrier_org_id, row.issuer_org_id].includes(A.co.id)
      if (hitsA.length || ownerA) stray.push(`${table}:${row.id}`)
    }
  }
  check('3.2d nothing B\'s admin created (even through a refused call) points at, or is owned by, company A', stray.length === 0, `rows: ${stray.join(', ')}`)
  const adrv = await db('GET', 'vehicles', { query: `driver_id=eq.${A.ids.driver}&select=id,carrier_org_id` })
  check('3.2e company A\'s driver is on no vehicle of company B', (adrv.body ?? []).every(v => v.carrier_org_id === A.co.id), J(adrv.body))

  // ── staff notifications of one company's events reach that company's staff only ──
  const noteMark = `Notify probe ${A.M}`
  const caseA = await api(A.admin.token, 'POST', '/cargo/exceptions', { type: 'damage', severity: 'high', vehicle_id: A.ids.vehicle, description: noteMark })
  const sosA = await api(A.admin.token, 'POST', `/vehicles/${A.ids.vehicle}/sos`, { alert_type: 'breakdown', description: noteMark })
  await sleep(2500)
  const got = async u => J((await db('GET', 'notifications', { query: `user_id=eq.${u}&select=title,body,data&order=created_at.desc&limit=100` })).body ?? [])
  const [gA, gAm, gB, gBm, gBd, gP] = await Promise.all([got(A.admin.id), got(A.manager.id), got(B.admin.id), got(B.manager.id), got(B.driver.id), got(platform.id)])
  check(`3.20 a case/SOS raised in A (case ${caseA.status}, SOS ${sosA.status}) notifies A's admin and manager`, gA.includes(noteMark) && gAm.includes(noteMark), `admin ${gA.includes(noteMark)} manager ${gAm.includes(noteMark)}`)
  check('3.21 ... and notifies nobody in company B (admin, manager, driver)', !gB.includes(noteMark) && !gBm.includes(noteMark) && !gBd.includes(noteMark) && !gB.includes(A.ids.vehicle), `B admin ${gB.includes(noteMark)} manager ${gBm.includes(noteMark)} driver ${gBd.includes(noteMark)}`)
  console.log(`   platform admin got it: ${gP.includes(noteMark)} (expected: yes, the platform's owners and admins are told)`)

  // A's rows must still be intact (nothing a foreign caller did changed them)
  const veh = await db('GET', 'vehicles', { query: `id=eq.${A.ids.vehicle}&select=id,vehicle_model,status,odometer_km` })
  const shp = await db('GET', 'shipments', { query: `id=eq.${A.ids.shipment}&select=id,status,consignee_name` })
  const inv = await db('GET', 'invoices', { query: `id=eq.${A.ids.invoice}&select=id,status` })
  const exp = await db('GET', 'expenses', { query: `id=eq.${A.ids.expense}&select=id,amount` })
  const usr = await db('GET', 'users', { query: `id=eq.${A.ids.driver}&select=id,full_name,status` })
  check('3.3 after the foreign calls, A\'s vehicle, shipment, invoice, expense and person are untouched',
    veh.body?.[0] && veh.body[0].vehicle_model !== 'Hacked' && shp.body?.[0]?.status === 'created' && shp.body[0].consignee_name !== 'Hacked' && inv.body?.[0]?.status === 'issued' && Number(exp.body?.[0]?.amount) === 1234 && usr.body?.[0]?.full_name?.startsWith('Driver '), J({ veh: veh.body, shp: shp.body, inv: inv.body, exp: exp.body, usr: usr.body }).slice(0, 300))

  // ── the platform admin acting as a company, and a superadmin inside a company ──
  const sa = await makeCompanyAdmin(coA.id, 'admin')
  await db('PATCH', 'users', { query: `id=eq.${sa.id}`, body: { role: 'superadmin' } })
  await sleep(100)
  const saList = await api(sa.token, 'GET', '/vehicles', undefined, { org: coA.id })
  const saB = await api(sa.token, 'GET', `/vehicles/${B.ids.vehicle}`, undefined, { org: coA.id })
  const saP = await api(sa.token, 'GET', '/admin/orgs', undefined, { org: coA.id })
  check('3.4 a user whose account role is superadmin but who acts inside company A is that company\'s admin only (no B rows, no platform routes)',
    saList.status === 200 && !J(saList.body).includes(B.ids.vehicle) && saB.status === 404 && saP.status === 403, `${saList.status} ${saB.status} ${saP.status}`)
  let seenA = false, seenB = false, st = 0
  for (let skip = 0; skip < 5000 && !(seenA && seenB); skip += 500) {
    const pl = await api(platform.token, 'GET', `/vehicles?limit=500&skip=${skip}`, undefined, { org: platform.orgId })
    st = pl.status
    const t = J(pl.body); seenA ||= t.includes(A.ids.vehicle); seenB ||= t.includes(B.ids.vehicle)
    if (!Array.isArray(pl.body) || pl.body.length < 500) break
  }
  check('3.5 the platform admin acting as the platform sees vehicles of both companies', st === 200 && seenA && seenB, `${st} A:${seenA} B:${seenB}`)
  const platById = await api(platform.token, 'GET', `/vehicles/${A.ids.vehicle}`, undefined, { org: platform.orgId })
  check('3.6 platform reads a company vehicle by id (support)', platById.status === 200, `${platById.status}`)
  const platActAs = await api(platform.token, 'GET', '/vehicles', undefined, { org: coA.id })
  check('3.7 the platform admin cannot act as a company they are not a member of (X-Org-Id of A -> 403)', platActAs.status === 403, `${platActAs.status}`)

  // ── the PostgREST reads the web makes ──
  await postgrest({ A, B, platform, vendorA, vendorB, idsA, idsB, marksA, marksB, matrix })
  await realtime({ A, B, platform, matrix })
  for (const l of leaks) console.log('LEAK', J(l))
  return ctx
}

// ── Direct PostgREST (the browser's own reads with a staff JWT) ──
async function pg(token, table, query = 'select=*&limit=1000') {
  const res = await fetch(`${DATA}/rest/v1/${table}?${query}`, { headers: { apikey: env.ANON, Authorization: `Bearer ${token}` } })
  const text = await res.text()
  let body; try { body = JSON.parse(text) } catch { body = text }
  return { status: res.status, body, text }
}

async function postgrest({ A, B, platform, vendorA, vendorB, idsA, idsB, marksA, marksB, matrix }) {
  console.log('\n-- PostgREST with a staff JWT (RLS) --')
  const web = ['vendor_profiles', 'notifications', 'vehicles', 'tpl_partners', 'kyc_documents', 'users', 'sos_alerts', 'cargo_manifest', 'vendor_shipment_requests', 'shipments', 'routes', 'route_stops', 'driver_confirmations', 'capacity_windows', 'capacity_bids']
  const all = ['vehicles', 'shipments', 'routes', 'route_stops', 'invoices', 'expenses', 'driver_pay_entries', 'driver_pay_rates', 'driver_payouts', 'depots', 'cargo_exceptions', 'cargo_exception_items', 'cargo_claims', 'cargo_transfers', 'cargo_transfer_items', 'cargo_custody_events', 'cargo_manifest', 'vendor_shipment_requests', 'sos_alerts', 'maintenance_alerts', 'vehicle_maintenance_jobs', 'vehicle_fuel_logs', 'vehicle_service_log', 'vehicle_service_plans', 'vehicle_share_links', 'capacity_windows', 'capacity_bids', 'user_documents', 'user_bank_accounts', 'user_notes', 'user_emergency_contacts', 'user_profiles', 'users', 'notifications', 'messages', 'load_documents', 'load_document_events', 'payments', 'organizations', 'org_members', 'tpl_affiliations', 'tpl_partners', 'tpl_documents', 'tpl_offers', 'tpl_orders', 'tpl_partner_statements', 'customers', 'customer_bookings', 'vendor_profiles', 'kyc_profiles', 'gps_points', 'telemetry', 'ai_agent_logs', 'system_settings', 'driver_confirmations', 'driver_vehicle_assignments', 'parcels', 'parcel_scans', 'shipment_logs', 'shipment_hsn', 'trip_settlements', 'price_quotes', 'load_quotes', 'load_items', 'invoice_payment_reports', 'idempotency_keys', 'traffic_incidents', 'vehicle_photos', 'vehicle_stoppages', 'vehicle_odometer_events', 'vendor_route_opportunities', 'delivery_points', 'tpl_corridors']
  const tables = [...new Set([...web, ...all])]
  const cells = {}
  const OWNER_COLS = ['carrier_org_id', 'issuer_org_id', 'vendor_org_id', 'bill_to_org_id', 'org_id']
  for (const t of tables) {
    const rA = await pg(A.admin.token, t), rB = await pg(B.admin.token, t)
    const cell = {}
    for (const [who, r, mine, theirs, foreignIds, foreignMarks, ownOrg, otherOrg] of [['A', rA, A, B, idsB, marksB, A.co.id, B.co.id], ['B', rB, B, A, idsA, marksA, B.co.id, A.co.id]]) {
      if (r.status !== 200) { cell[who] = `${r.status}`; continue }
      const rows = Array.isArray(r.body) ? r.body : []
      const text = r.text.toLowerCase()
      const foundIds = foreignIds.filter(i => i && text.includes(i.toLowerCase()))
      const foundMarks = foreignMarks.filter(m => m && r.text.includes(m))
      const otherOwned = rows.filter(x => OWNER_COLS.some(c => x[c] === otherOrg)).length
      let v = `${rows.length}`
      if (foundIds.length || foundMarks.length || otherOwned) v += ` LEAK(${otherOwned} other-owned, ${foundIds.length + foundMarks.length} marks: ${[...foundIds, ...foundMarks].slice(0, 2).join('|')})`
      cell[who] = v
    }
    cells[t] = cell
    check(`3.8 PostgREST ${t}  A:${cell.A} B:${cell.B}`, !/LEAK/.test(`${cell.A} ${cell.B}`), J(cell))
  }
  matrix.push({ section: 'postgrest', cells })
  // writes through PostgREST: a staff JWT must not write another company's rows
  const patch = await fetch(`${DATA}/rest/v1/vehicles?id=eq.${A.ids.vehicle}`, { method: 'PATCH', headers: { apikey: env.ANON, Authorization: `Bearer ${B.admin.token}`, 'content-type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ vehicle_model: 'HackedPG' }) })
  const pb = await patch.text()
  const still = await db('GET', 'vehicles', { query: `id=eq.${A.ids.vehicle}&select=vehicle_model` })
  check('3.9 PostgREST: B\'s staff JWT cannot PATCH A\'s vehicle', still.body?.[0]?.vehicle_model !== 'HackedPG', `${patch.status} ${pb.slice(0, 120)}`)
  const del = await fetch(`${DATA}/rest/v1/depots?id=eq.${A.ids.depot}`, { method: 'DELETE', headers: { apikey: env.ANON, Authorization: `Bearer ${B.admin.token}`, Prefer: 'return=representation' } })
  const stillD = await db('GET', 'depots', { query: `id=eq.${A.ids.depot}&select=id` })
  check('3.10 PostgREST: B\'s staff JWT cannot DELETE A\'s depot', stillD.body?.length === 1, `${del.status}`)
  const insB = await fetch(`${DATA}/rest/v1/depots`, { method: 'POST', headers: { apikey: env.ANON, Authorization: `Bearer ${B.admin.token}`, 'content-type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ name: `Forged ${B.M}`, address: 'x', latitude: 1, longitude: 1, carrier_org_id: A.co.id }) })
  const forged = await db('GET', 'depots', { query: `name=eq.Forged ${B.M}&select=id,carrier_org_id` })
  check('3.11 PostgREST: B cannot insert a depot owned by A', !(forged.body ?? []).some(d => d.carrier_org_id === A.co.id), `${insB.status} ${J(forged.body)}`)
  const upUser = await fetch(`${DATA}/rest/v1/users?id=eq.${A.ids.driver}`, { method: 'PATCH', headers: { apikey: env.ANON, Authorization: `Bearer ${B.admin.token}`, 'content-type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ full_name: 'HackedPG' }) })
  const u = await db('GET', 'users', { query: `id=eq.${A.ids.driver}&select=full_name` })
  check('3.12 PostgREST: B cannot rename A\'s person', u.body?.[0]?.full_name !== 'HackedPG', `${upUser.status}`)
  const roleUp = await fetch(`${DATA}/rest/v1/users?id=eq.${B.ids.admin}`, { method: 'PATCH', headers: { apikey: env.ANON, Authorization: `Bearer ${B.admin.token}`, 'content-type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ role: 'superadmin' }) })
  const ru = await db('GET', 'users', { query: `id=eq.${B.ids.admin}&select=role` })
  check('3.13 PostgREST: a company admin cannot make themselves superadmin through users.role', ru.body?.[0]?.role !== 'superadmin', `${roleUp.status} role now ${ru.body?.[0]?.role}`)
  const memUp = await fetch(`${DATA}/rest/v1/org_members`, { method: 'POST', headers: { apikey: env.ANON, Authorization: `Bearer ${B.admin.token}`, 'content-type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ org_id: platform.orgId, user_id: B.ids.admin, role: 'owner', status: 'active' }) })
  const mem = await db('GET', 'org_members', { query: `org_id=eq.${platform.orgId}&user_id=eq.${B.ids.admin}` })
  check('3.14 PostgREST: a company admin cannot add themselves to the platform organisation', !mem.body?.length, `${memUp.status}`)
  const orgUp = await fetch(`${DATA}/rest/v1/organizations?id=eq.${B.co.id}`, { method: 'PATCH', headers: { apikey: env.ANON, Authorization: `Bearer ${B.admin.token}`, 'content-type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ status: 'suspended', name: 'HackedPG' }) })
  const orgNow = await db('GET', 'organizations', { query: `id=eq.${B.co.id}&select=status,name` })
  check('3.15 PostgREST: a company admin cannot edit its own organisation row (status/name) directly', orgNow.body?.[0]?.name !== 'HackedPG' && orgNow.body?.[0]?.status === 'active', `${orgUp.status} ${J(orgNow.body)}`)
}

// ── Realtime ──
async function realtime({ A, B, platform, matrix }) {
  console.log('\n-- Realtime / WebSocket --')
  if (typeof WebSocket === 'undefined') { console.log('  (no global WebSocket in this node; skipped)'); return }
  const base = (process.env.UAT_API || 'https://staging-api.margixindia.com/api/v1').replace(/^http/, 'ws').replace(/\/api\/v1$/, '')
  const open = (token, org) => new Promise(resolve => {
    const events = []; let status = 'connecting'
    const ws = new WebSocket(`${base}/api/v1/telemetry/ws?token=${encodeURIComponent(token)}${org ? `&org=${org}` : ''}`)
    ws.onopen = () => { status = 'open' }
    ws.onmessage = m => events.push(String(m.data))
    ws.onerror = () => { if (status === 'connecting') status = 'refused' }
    ws.onclose = () => { if (status === 'connecting') status = 'refused' }
    setTimeout(() => resolve({ events, get status() { return status }, close: () => { try { ws.close() } catch { /* ignore */ } } }), 3500)
  })
  const a = await open(A.admin.token), b = await open(B.admin.token), p = await open(platform.token, platform.orgId)
  const x = await open(B.admin.token, A.co.id)
  check('3.16 websocket: a staff member can open the feed for their own company; a foreign ?org= is refused', a.status === 'open' && b.status === 'open' && x.status !== 'open', `A ${a.status} B ${b.status} foreign ${x.status}`)
  const ping = await api(A.admin.token, 'POST', '/telemetry', { vehicle_id: A.ids.vehicle, latitude: 19.11, longitude: 72.91, speed_kmph: 20, heading: 90 })
  await sleep(3000)
  const sawA = a.events.join(' '), sawB = b.events.join(' '), sawP = p.events.join(' ')
  check(`3.17 websocket: A's location ping (status ${ping.status}) reaches A's connection`, sawA.includes(A.ids.vehicle), `A got ${a.events.length}`)
  check('3.18 websocket: ... and does NOT reach B\'s connection', !sawB.includes(A.ids.vehicle) && !sawB.includes(A.M), `B got ${b.events.length}: ${sawB.slice(0, 160)}`)
  check('3.19 websocket: ... and reaches the platform admin\'s feed (acting as platform)', sawP.includes(A.ids.vehicle), `P got ${p.events.length}`)
  for (const c of [a, b, p, x]) c.close()
}
