// Audit area 2: trips and the driver, walked as real actors in OWN company on the TEST stage.
//   node e2e/staging/trips.mjs
import { api, db, check, results, makeCompany, makeCompanyAdmin, makeDriver, putSigned, readObject, PNG, tag, sleep } from './actors.mjs'

const J = x => JSON.stringify(x)?.slice(0, 260)
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const PHONE = /\b[6-9]\d{9}\b/
const section = name => console.log(`\n== ${name}`)
async function guard(name, fn) {
  try { await fn() } catch (e) { check(`${name}: no crash`, false, String(e?.stack || e).slice(0, 300)) }
}

// Mumbai start, three drops
const ORIGIN = { name: 'Vashi Warehouse', address: 'Plot 4, APMC Market, Vashi, Navi Mumbai', lat: 19.0745, lng: 72.9978 }
const DROPS = {
  thane: { name: 'Thane Retail', address: 'Ghodbunder Road, Thane West', lat: 19.2183, lng: 72.9781 },
  pune: { name: 'Pune Hub', address: 'Hinjewadi Phase 1, Pune', lat: 18.5912, lng: 73.7389 },
  nashik: { name: 'Nashik Depot', address: 'Ambad MIDC, Nashik', lat: 19.9975, lng: 73.7898 },
}
const shipBody = (drop, extra = {}) => ({
  priority: 'medium', origin_name: ORIGIN.name, origin_address: ORIGIN.address, origin_lat: ORIGIN.lat, origin_lng: ORIGIN.lng,
  dest_name: drop.name, dest_address: drop.address, dest_lat: drop.lat, dest_lng: drop.lng,
  total_items: 4, total_weight_kg: 400, consignee_name: 'Ravi Kumar', consignee_phone: '9876500011', freight_charge: 12000, ...extra,
})

const co = await makeCompany(`Trips Co ${tag()}`)
const co2 = await makeCompany(`Other Co ${tag()}`)
const staff = await makeCompanyAdmin(co.id, 'admin')
const staff2 = await makeCompanyAdmin(co2.id, 'admin')
const d1 = await makeDriver(co.id) // main trip
const d2 = await makeDriver(co.id) // other driver (isolation) + failed stop
const d3 = await makeDriver(co.id) // SOS with cargo
const d4 = await makeDriver(co.id) // SOS, nothing on board
console.log(`company ${co.id} staff ${staff.email}`)

async function newVehicle(driver, cap = 5000) {
  const plate = `MH12${tag().toUpperCase().slice(0, 2)}${Math.floor(1000 + Math.random() * 8999)}`
  const v = await api(staff.token, 'POST', '/vehicles', { plate_number: plate, vehicle_type: 'truck', capacity_kg: cap, vehicle_model: 'Tata 407' })
  if (v.status !== 201) throw new Error(`vehicle: ${v.status} ${J(v.body)}`)
  if (driver) {
    const p = await api(staff.token, 'PATCH', `/vehicles/${v.body.id}`, { driver_id: driver.id, status: 'available' })
    if (p.status !== 200) throw new Error(`driver link: ${p.status} ${J(p.body)}`)
    // the driver may be seen on next request only: cache is 30 s for driver vehicle ids; fresh driver so fine
  }
  return v.body
}
const V1 = await newVehicle(d1), V2 = await newVehicle(d2), V3 = await newVehicle(d3), V4 = await newVehicle(d4), VNODRIVER = await newVehicle(null)
// give the vehicles a starting position (the live map and ETA need one)
for (const v of [V1, V2, V3, V4]) await api(staff.token, 'PATCH', `/vehicles/${v.id}`, { latitude: ORIGIN.lat, longitude: ORIGIN.lng })

const mk = async (drop, extra) => {
  const r = await api(staff.token, 'POST', '/shipments', shipBody(drop, extra))
  if (r.status !== 201) throw new Error(`shipment: ${r.status} ${J(r.body)}`)
  return r.body
}
const shipStatus = async id => (await db('GET', 'shipments', { query: `id=eq.${id}&select=status,current_holder,current_vehicle_id,delivery_attempts,received_by,photo_url,signature_url` })).body?.[0]
const vehRow = async id => (await db('GET', 'vehicles', { query: `id=eq.${id}&select=status,current_load_kg,available_capacity_kg,driver_id` })).body?.[0]
const routeRow = async id => (await db('GET', 'routes', { query: `id=eq.${id}&select=*` })).body?.[0]
const stopsOf = async id => (await db('GET', 'route_stops', { query: `route_id=eq.${id}&select=*&order=sequence.asc` })).body
// problems (cargo cases) that list a shipment among their goods
const casesOf = async shipmentId => {
  const items = (await db('GET', 'cargo_exception_items', { query: `shipment_id=eq.${shipmentId}&select=exception_id` })).body || []
  if (!items.length) return []
  return (await db('GET', 'cargo_exceptions', { query: `id=in.(${[...new Set(items.map(i => i.exception_id))].join(',')})&select=*` })).body
}
const notifsOf =async (userId, type) => (await db('GET', 'notifications', { query: `user_id=eq.${userId}${type ? `&type=eq.${type}` : ''}&select=*&order=created_at.desc` })).body

// ───────────────────────────────────────────────────────────
section('1. Plan a trip (staff)')
let S1, S2, S3, trip
await guard('plan', async () => {
  S1 = await mk(DROPS.thane); S2 = await mk(DROPS.pune); S3 = await mk(DROPS.nashik, { total_weight_kg: 300 })
  check('1.1 staff creates 3 shipments (created, tracking ids)', [S1, S2, S3].every(s => s.status === 'created' && /^RTX-/.test(s.tracking_id)), J([S1.status, S1.tracking_id]))
  const ws = await api(staff.token, 'GET', '/routing/status')
  check('1.2 route planner status answers (staff)', ws.status === 200, J(ws.body))
  const opt = await api(staff.token, 'POST', '/routing/optimize-order', {
    origin: { lat: ORIGIN.lat, lng: ORIGIN.lng, name: ORIGIN.name }, destination: { lat: DROPS.nashik.lat, lng: DROPS.nashik.lng, name: 'Nashik' },
    stops: [DROPS.pune, DROPS.thane].map(d => ({ lat: d.lat, lng: d.lng, name: d.name })),
  })
  check('1.3 optimize-order returns an order (or says routing is not set up, not a 5xx)', opt.status < 500, `${opt.status} ${J(opt.body)}`)
  const plan = await api(staff.token, 'POST', '/routing/plan', {
    origin: { lat: ORIGIN.lat, lng: ORIGIN.lng, name: ORIGIN.name }, destination: { lat: DROPS.nashik.lat, lng: DROPS.nashik.lng, name: 'Nashik' },
    stops: [DROPS.thane, DROPS.pune].map(d => ({ lat: d.lat, lng: d.lng, name: d.name })), vehicle_id: V1.id, load_kg: 1100,
  })
  check('1.4 route plan answers (2xx with distance, or a clear 4xx/503; never 500)', plan.status < 500, `${plan.status} ${J(plan.body)}`)
  const planned = plan.status === 200 ? plan.body : null
  if (planned) check('1.4b plan carries distance and duration', JSON.stringify(planned).match(/distance/i) && JSON.stringify(planned).match(/(duration|minutes|time)/i), J(Object.keys(planned)))

  // create-route from planner numbers: stops reuse shipments' delivery points
  const dp = async s => (await db('GET', 'delivery_points', { query: `shipment_id=eq.${s.id}&select=id` })).body[0].id
  const cr = await api(staff.token, 'POST', '/routing/create-route', {
    vehicle_id: VNODRIVER.id, origin: { lat: ORIGIN.lat, lng: ORIGIN.lng, name: ORIGIN.name },
    stops: [{ name: DROPS.thane.name, lat: DROPS.thane.lat, lng: DROPS.thane.lng, delivery_point_id: await dp(S1) }],
    distance_km: 24.5, duration_minutes: 55, traffic_delay_minutes: 6, estimated_fuel_liters: 5, provider: 'tomtom', truck_aware: true,
  })
  check('1.5 create-route saves a PENDING trip with ordered stops', cr.status === 201 && cr.body.status === 'pending' && cr.body.stops?.[0]?.sequence === 1, `${cr.status} ${J(cr.body)}`)
  if (cr.status === 201) {
    const rr = await routeRow(cr.body.id)
    check('1.5b planner trip stores distance 24.5 km / 55 min and carrier', Number(rr.total_distance_km) === 24.5 && rr.total_duration_minutes === 55 && rr.carrier_org_id === co.id, J(rr))
    // clean this planner trip up: shipments must come back to the pool for the real trip
    await api(staff.token, 'DELETE', `/routes/${cr.body.id}`)
  }

  // assign S1..S3 to V1 without dispatch: one pending trip with 3 stops
  const a1 = await api(staff.token, 'POST', `/shipments/${S1.id}/assign`, { vehicle_id: V1.id })
  check('1.6 assign S1 to V1 (no dispatch) -> assigned', a1.status === 200 && a1.body.status === 'assigned', `${a1.status} ${J(a1.body)}`)
  const a2 = await api(staff.token, 'POST', `/shipments/${S2.id}/assign`, { vehicle_id: V1.id })
  const a3 = await api(staff.token, 'POST', `/shipments/${S3.id}/assign`, { vehicle_id: V1.id })
  check('1.7 S2 and S3 join the same pending trip', a2.status === 200 && a3.status === 200, `${a2.status} ${a3.status} ${J(a3.body)}`)
  const routes = (await db('GET', 'routes', { query: `vehicle_id=eq.${V1.id}&select=*` })).body
  check('1.8 exactly one trip for V1, status pending', routes.length === 1 && routes[0].status === 'pending', J(routes.map(r => r.status)))
  trip = routes[0]
  const stops = await stopsOf(trip.id)
  check('1.9 three stops, sequence 1,2,3, all pending', stops.length === 3 && stops.every((s, i) => s.sequence === i + 1 && s.status === 'pending'), J(stops.map(s => [s.sequence, s.status])))
  check('1.10 trip distance and duration are set (not 0)', Number(trip.total_distance_km) > 0 && Number(trip.total_duration_minutes) > 0, `distance ${trip.total_distance_km} duration ${trip.total_duration_minutes}`)
  const vr = await vehRow(V1.id)
  check('1.11 vehicle load = 1100 kg, available = 3900, status not yet on_route', Number(vr.current_load_kg) === 1100 && Number(vr.available_capacity_kg) === 3900 && vr.status !== 'on_route', J(vr))
  const nPre = await notifsOf(d1.id, 'route_activated')
  check('1.12 driver NOT notified before the trip is sent', nPre.length === 0, J(nPre))
  const dr0 = await api(d1.token, 'GET', '/telemetry/driver-ping/my-route')
  check('1.13 driver does not see an unsent trip', dr0.status === 200 && dr0.body.active === false, J(dr0.body))
  const dlist = await api(d1.token, 'GET', '/routes')
  check('1.14 driver /routes does not list the unsent trip', dlist.status === 200 && !dlist.body.some(r => r.id === trip.id), J(dlist.body?.map?.(r => r.status)))
  const dget = await api(d1.token, 'GET', `/routes/${trip.id}`)
  check('1.15 driver GET of an unsent trip is 404', dget.status === 404, `${dget.status}`)
  const today = await api(staff.token, 'GET', '/ops/today')
  check('1.16 Today queue counts one trip to send', today.status === 200 && today.body.queues?.trips_to_send?.count === 1, J(today.body?.queues?.trips_to_send))
  const dstart = await api(d1.token, 'POST', '/telemetry/driver-ping/start-route', { route_id: trip.id })
  check('1.17 driver cannot start an unsent trip (409)', dstart.status === 409, `${dstart.status} ${J(dstart.body)}`)
  const accepted = await api(d1.token, 'POST', '/telemetry/driver-ping/accept-route', { route_id: trip.id })
  check('1.18 driver cannot accept an unsent trip (409)', accepted.status === 409, `${accepted.status} ${J(accepted.body)}`)

  // Send the trip
  const [s1, s2] = await Promise.all([
    api(staff.token, 'PATCH', `/routes/${trip.id}/status`, { status: 'active' }),
    api(staff.token, 'PATCH', `/routes/${trip.id}/status`, { status: 'active' }),
  ])
  check('1.19 send trip: active, vehicle on_route', [s1, s2].some(r => r.status === 200 && r.body.status === 'active' && r.body.vehicle_status === 'on_route'), `${J(s1.body)} ${J(s2.body)}`)
  const codes = [s1.status, s2.status].sort().join(',')
  check('1.20 double dispatch at the same instant: second is a 409 or a harmless repeat', ['200,200', '200,409'].includes(codes), codes)
  const again = await api(staff.token, 'PATCH', `/routes/${trip.id}/status`, { status: 'active' })
  check('1.21 dispatching an already active trip again does not duplicate the driver notice', again.status === 200 || again.status === 409, `${again.status}`)
  const rAfter = await routeRow(trip.id)
  check('1.22 started_at stamped once', !!rAfter.started_at, J(rAfter.started_at))
  const stopsAfter = await stopsOf(trip.id)
  check('1.23 planned arrival stamped on stops', stopsAfter.every(s => !!s.planned_arrival_at), J(stopsAfter.map(s => s.planned_arrival_at)))
  await sleep(500)
  const nSent = await notifsOf(d1.id, 'route_activated')
  check('1.24 driver notified exactly once "New trip"', nSent.length === 1 && /3 stops/.test(nSent[0].message || nSent[0].body || ''), J(nSent.map(n => [n.title, n.message])))
  const dr1 = await api(d1.token, 'GET', '/telemetry/driver-ping/my-route')
  check('1.25 driver now sees the trip with 3 ordered stops', dr1.body?.active === true && dr1.body.route.id === trip.id && dr1.body.route.stops.length === 3 && dr1.body.route.stops.every((s, i) => s.sequence === i + 1), J(dr1.body).slice(0, 200))
  check('1.26 trip distance & duration shown to the driver', Number(dr1.body?.route?.total_distance_km) > 0 && Number(dr1.body?.route?.total_duration_minutes) > 0, J([dr1.body?.route?.total_distance_km, dr1.body?.route?.total_duration_minutes]))
  const sh1 = await shipStatus(S1.id)
  check('1.27 shipments stay assigned (goods still with consignor) after send', sh1.status === 'assigned', J(sh1))
})

// ───────────────────────────────────────────────────────────
section('2. The driver\'s day')
let stops = []
await guard('driver day', async () => {
  const sc = await api(d1.token, 'POST', '/driver/scan', { code: S1.tracking_id, purpose: 'pickup', stop_id: null })
  check('2.1 driver scans pickup of S1 (goods go on the vehicle)', sc.status === 200 && sc.body.status === 'picked_up', `${sc.status} ${J(sc.body)}`)
  const sc2 = await api(d1.token, 'POST', '/driver/scan', { code: S1.tracking_id, purpose: 'pickup' })
  check('2.2 repeat pickup scan is harmless (already: true)', sc2.status === 200 && sc2.body.already === true, J(sc2.body))
  await api(d1.token, 'POST', '/driver/scan', { code: S2.tracking_id, purpose: 'pickup' })
  await api(d1.token, 'POST', '/driver/scan', { code: S3.tracking_id, purpose: 'pickup' })
  const accepted = await api(d1.token, 'POST', '/telemetry/driver-ping/accept-route', { route_id: trip.id }, { headers: { 'Idempotency-Key': `acc-${tag()}-aaaa` } })
  check('2.3 accept trip records custody acceptance', accepted.status === 200, J(accepted.body))
  const start = await api(d1.token, 'POST', '/telemetry/driver-ping/start-route', { route_id: trip.id })
  check('2.4 driver start-route on an already active trip is fine', start.status === 200, `${start.status} ${J(start.body)}`)
  const inTransit = await shipStatus(S1.id)
  check('2.5 goods on board go in_transit when the route starts', inTransit.status === 'in_transit' && inTransit.current_holder === 'vehicle', J(inTransit))

  const dr = await api(d1.token, 'GET', '/telemetry/driver-ping/my-route')
  stops = dr.body.route.stops
  const byDrop = n => stops.find(s => s.delivery_point.name === n)
  const st1 = byDrop('Thane Retail'), st2 = byDrop('Pune Hub'), st3 = byDrop('Nashik Depot')

  // POD upload then complete the first stop; check evidence rules
  const noEv = await api(d1.token, 'POST', '/telemetry/driver-ping/complete-stop', { stop_id: st1.id, outcome: 'delivered', received_by: 'Ravi' })
  check('2.6 delivery without photo/signature is refused (400)', noEv.status === 400, `${noEv.status} ${J(noEv.body)}`)
  const noWho = await api(d1.token, 'POST', '/telemetry/driver-ping/complete-stop', { stop_id: st1.id, outcome: 'delivered' })
  check('2.7 delivery without a receiver name is refused (400)', noWho.status === 400, `${noWho.status} ${J(noWho.body)}`)
  const foreignPath = await api(d1.token, 'POST', '/telemetry/driver-ping/complete-stop', { stop_id: st1.id, outcome: 'delivered', received_by: 'Ravi', photo_url: `pod/${st2.id}/photo_x.png` })
  check('2.8 a photo path from another stop is refused', foreignPath.status === 400, `${foreignPath.status} ${J(foreignPath.body)}`)
  const otherDriverUpload = await api(d2.token, 'POST', '/driver/pod-upload-url', { stop_id: st1.id, kind: 'photo', content_type: 'image/png', size: PNG.length })
  check('2.9 another driver of the company cannot get an upload link for this stop (403)', otherDriverUpload.status === 403, `${otherDriverUpload.status}`)
  const link = await api(d1.token, 'POST', '/driver/pod-upload-url', { stop_id: st1.id, kind: 'photo', content_type: 'image/png', size: PNG.length })
  const link2 = await api(d1.token, 'POST', '/driver/pod-upload-url', { stop_id: st1.id, kind: 'signature', content_type: 'image/png', size: PNG.length })
  check('2.10 driver gets signed upload links (photo, signature)', link.status === 200 && link2.status === 200 && link.body.signed_url, `${link.status} ${J(link.body)}`)
  const photoPath = await putSigned(link.body), sigPath = await putSigned(link2.body)
  const stored = await readObject(link.body.bucket, photoPath)
  check('2.11 the photo is really in the object store (bytes match)', stored && Buffer.compare(stored, PNG) === 0, `bytes ${stored?.length}`)
  const key = `cs-${tag()}-key1`
  const body1 = { stop_id: st1.id, outcome: 'delivered', received_by: 'Ravi Kumar', photo_url: photoPath, signature_url: sigPath, lat: DROPS.thane.lat, lng: DROPS.thane.lng, idempotency_key: key }
  const done1 = await api(d1.token, 'POST', '/telemetry/driver-ping/complete-stop', body1)
  check('2.12 complete stop 1 (photo + signature): completed, 2 remaining, route not complete', done1.status === 200 && done1.body.status === 'completed' && done1.body.remaining_stops === 2 && done1.body.route_completed === false, `${done1.status} ${J(done1.body)}`)
  const done1b = await api(d1.token, 'POST', '/telemetry/driver-ping/complete-stop', body1)
  check('2.13 same idempotency key again: identical stored answer, no double effect', done1b.status === 200 && J(done1b.body) === J(done1.body), J(done1b.body))
  const done1c = await api(d1.token, 'POST', '/telemetry/driver-ping/complete-stop', { ...body1, idempotency_key: undefined })
  check('2.14 same call without a key (offline replay): stop already decided -> still 200, nothing re-recorded', done1c.status === 200, `${done1c.status} ${J(done1c.body)}`)
  const ev = (await db('GET', 'cargo_custody_events', { query: `shipment_id=eq.${S1.id}&kind=eq.delivery&select=id` })).body
  check('2.15 exactly ONE delivery custody event for S1', ev.length === 1, `${ev.length}`)
  const stopRow = (await stopsOf(trip.id)).find(s => s.id === st1.id)
  check('2.16 stop row: completed, arrival time, photo and signature paths stored', stopRow.status === 'completed' && stopRow.actual_arrival_at && stopRow.photo_url === photoPath && stopRow.signature_url === sigPath, J(stopRow))
  const s1row = await shipStatus(S1.id)
  check('2.17 S1 is delivered, received_by stored, holder consignee', s1row.status === 'delivered' && s1row.received_by === 'Ravi Kumar', J(s1row))
  const vr = await vehRow(V1.id)
  check('2.18 vehicle load drops by S1 weight (1100 -> 700)', Number(vr.current_load_kg) === 700, J(vr))
  const pod = await api(staff.token, 'GET', `/shipments/${S1.id}/proof`)
  check('2.19 staff sees the proof of delivery with signed links that fetch', pod.status === 200 && pod.body.photo_url && (await fetch(pod.body.photo_url)).ok, `${pod.status} ${J(pod.body)}`)

  // Failed stop with a reason: stop 2 (Pune)
  const badReason = await api(d1.token, 'POST', '/telemetry/driver-ping/complete-stop', { stop_id: st2.id, outcome: 'not_delivered', reason: 'because' })
  check('2.20 failed stop with an unknown reason is a 400', badReason.status === 400, `${badReason.status} ${J(badReason.body)}`)
  const fail = await api(d1.token, 'POST', '/telemetry/driver-ping/complete-stop', { stop_id: st2.id, outcome: 'not_delivered', reason: 'customer_unavailable', note: 'Shop shut', lat: DROPS.pune.lat, lng: DROPS.pune.lng })
  check('2.21 failed stop recorded (failed, 1 remaining)', fail.status === 200 && fail.body.status === 'failed' && fail.body.remaining_stops === 1, `${fail.status} ${J(fail.body)}`)
  const s2row = await shipStatus(S2.id)
  check('2.22 S2 goes to exception, attempts = 1, still on the vehicle', s2row.status === 'exception' && Number(s2row.delivery_attempts) === 1 && s2row.current_holder === 'vehicle', J(s2row))
  const exc = (await casesOf(S2.id))
  check('2.23 a delivery problem (case) was opened for S2 and mentions the attempt', exc.length === 1 && /attempt 1 of/i.test(exc[0].description || ''), J(exc))
  const staffNotifs = await notifsOf(staff.id, 'stop_failed')
  check('2.24 dispatch staff were told about the failed stop', staffNotifs.length >= 1, `${staffNotifs.length}`)
  const failAgain = await api(d1.token, 'POST', '/telemetry/driver-ping/complete-stop', { stop_id: st2.id, outcome: 'delivered', received_by: 'X', photo_url: `pod/${st2.id}/p.png` })
  check('2.25 a failed stop cannot be flipped to completed by the driver (409 or 400)', [400, 409].includes(failAgain.status), `${failAgain.status} ${J(failAgain.body)}`)
  const failRepeat = await api(d1.token, 'POST', '/telemetry/driver-ping/complete-stop', { stop_id: st2.id, outcome: 'not_delivered', reason: 'customer_unavailable' })
  check('2.26 repeating the same failure does not add an attempt', failRepeat.status === 200 && Number((await shipStatus(S2.id)).delivery_attempts) === 1, `${failRepeat.status}`)
  const vr2 = await vehRow(V1.id)
  check('2.27 failed goods stay on the truck (load still 700)', Number(vr2.current_load_kg) === 700, J(vr2))

  // Last stop completes the trip
  const link3 = await api(d1.token, 'POST', '/driver/pod-upload-url', { stop_id: st3.id, kind: 'photo', content_type: 'image/png', size: PNG.length })
  const ph3 = await putSigned(link3.body)
  const done3 = await api(d1.token, 'POST', '/telemetry/driver-ping/complete-stop', { stop_id: st3.id, outcome: 'delivered', received_by: 'Meena', photo_url: ph3, lat: DROPS.nashik.lat, lng: DROPS.nashik.lng })
  check('2.28 last stop completes the trip (route_completed)', done3.status === 200 && done3.body.route_completed === true, `${done3.status} ${J(done3.body)}`)
  const rEnd = await routeRow(trip.id)
  check('2.29 trip is completed with completed_at', rEnd.status === 'completed' && !!rEnd.completed_at, J([rEnd.status, rEnd.completed_at]))
  const vEnd = await vehRow(V1.id)
  check('2.30 vehicle is NOT freed/zeroed while failed goods are still on board (S2)', vEnd.status !== 'available' || Number(vEnd.current_load_kg) > 0, J(vEnd))
  const pay = (await db('GET', 'driver_pay_entries', { query: `route_id=eq.${trip.id}&select=*` })).body
  check('2.31 exactly one driver pay entry for the trip (driver, amount/status)', pay.length === 1 && pay[0].driver_id === d1.id, J(pay))
  const earn = await api(d1.token, 'GET', '/auth/driver/earnings')
  check('2.32 driver earnings answers and counts the trip', earn.status === 200 && (earn.body.completed_trips >= 1 || earn.body.total_trips >= 1), J(earn.body))
  const hist = await api(d1.token, 'GET', '/auth/driver/earnings/history?limit=5')
  check('2.33 earnings history answers (paginated shape)', hist.status === 200 && Array.isArray(hist.body.invoices), J(hist.body))
  const dpay = await api(d1.token, 'GET', '/driver/pay')
  check('2.34 /driver/pay answers with the trip', dpay.status === 200, J(dpay.body))
  const dup = await api(staff.token, 'PATCH', `/routes/${trip.id}/status`, { status: 'completed' })
  check('2.35 completing again does not make a second pay entry', ((await db('GET', 'driver_pay_entries', { query: `route_id=eq.${trip.id}&select=id` })).body.length === 1), `${dup.status}`)
  const mr = await api(d1.token, 'GET', '/telemetry/driver-ping/my-route')
  check('2.36 my-route after completion: inactive with the completed trip', mr.status === 200 && mr.body.active === false, J(mr.body).slice(0, 160))

  // Public tracking
  const pub = await api(null, 'GET', `/shipments/track/${S1.tracking_id}`)
  const pubTxt = J(pub.body) + JSON.stringify(pub.body)
  check('2.37 public tracking of S1: delivered, history, no uuid / phone / driver', pub.status === 200 && pub.body.status === 'delivered' && !UUID.test(JSON.stringify(pub.body)) && !PHONE.test(JSON.stringify(pub.body)) && !/driver|consignee|freight|price/i.test(Object.keys(pub.body).join()), pubTxt.slice(0, 300))
  const pub2 = await api(null, 'GET', `/shipments/track/${S2.tracking_id}`)
  check('2.38 public tracking of the failed shipment shows a safe status (no internal case/reason leak)', pub2.status === 200 && !UUID.test(JSON.stringify(pub2.body)) && !/customer_unavailable|Shop shut/i.test(JSON.stringify(pub2.body)), J(pub2.body))
  const pub404 = await api(null, 'GET', '/shipments/track/RTX-NOPE0000')
  check('2.39 unknown tracking id is 404', pub404.status === 404)
})

// ───────────────────────────────────────────────────────────
section('3. SOS')
await guard('sos', async () => {
  // d3 has cargo on board (picked up), d4 has nothing
  const A = await mk(DROPS.pune), B = await mk(DROPS.thane)
  await api(staff.token, 'POST', `/shipments/${A.id}/assign`, { vehicle_id: V3.id, dispatch: true })
  await api(d3.token, 'POST', '/driver/scan', { code: A.tracking_id, purpose: 'pickup' })
  const aOn = await shipStatus(A.id)
  check('3.0 setup: cargo A on d3 vehicle', aOn.status === 'picked_up' && aOn.current_holder === 'vehicle', J(aOn))
  await api(staff.token, 'POST', `/shipments/${B.id}/assign`, { vehicle_id: V4.id, dispatch: true })

  const nodrv = await api(staff.token, 'POST', '/telemetry/sos/trigger', { lat: 19, lng: 73 })
  check('3.1 staff cannot raise an SOS (403)', nodrv.status === 403, `${nodrv.status}`)
  const key = `sos-${tag()}-k1`
  const t = await api(d3.token, 'POST', '/telemetry/sos/trigger', { lat: 19.5, lng: 73.1, alert_type: 'accident', description: 'Truck hit divider', idempotency_key: key })
  check('3.2 driver raises SOS (accident) with a location', t.status === 200 && t.body.id, `${t.status} ${J(t.body)}`)
  const t2 = await api(d3.token, 'POST', '/telemetry/sos/trigger', { lat: 19.5, lng: 73.1, alert_type: 'accident', description: 'Truck hit divider', idempotency_key: key })
  check('3.3 same key again: same alert id, still one alert', t2.status === 200 && t2.body.id === t.body.id && (await db('GET', 'sos_alerts', { query: `vehicle_id=eq.${V3.id}&select=id` })).body.length === 1, J(t2.body))
  const sosId = t.body.id
  const sev = await api(d3.token, 'PATCH', `/telemetry/sos/${sosId}/details`, { severity: 'serious' })
  check('3.4 driver adds severity serious', sev.status === 200, `${sev.status} ${J(sev.body)}`)
  const vsos = await api(staff.token, 'GET', `/vehicles/${V3.id}/sos`)
  check('3.5 staff sees the alert on the vehicle (active, serious)', vsos.status === 200 && vsos.body.alerts?.[0]?.id === sosId && vsos.body.counts.open === 1, J(vsos.body).slice(0, 200))
  const todayQ = await api(staff.token, 'GET', '/ops/today')
  check('3.6 Today queue shows 1 open SOS', todayQ.body?.queues?.sos?.count === 1, J(todayQ.body?.queues?.sos))
  const fa = await api(staff.token, 'GET', '/fleet/alerts')
  check('3.6b fleet alerts answer', fa.status === 200, `${fa.status}`)
  const bell = await notifsOf(staff.id, 'sos')
  check('3.7 staff bell has the SOS notification', bell.some(n => n.data?.alert_id === sosId), J(bell.map(n => n.title)))
  const vh = await vehRow(V3.id)
  check('3.8 vehicle is held in maintenance after a serious accident', vh.status === 'maintenance', J(vh))
  const A2 = await shipStatus(A.id)
  check('3.9 cargo on board A goes on_hold (not stranded), stays on the vehicle', A2.status === 'on_hold' && A2.current_holder === 'vehicle' && A2.current_vehicle_id === V3.id, J(A2))
  const exs = (await casesOf(A.id))
  check('3.10 a vehicle_accident case was auto-opened and linked to the SOS', exs.length === 1 && exs[0].type === 'vehicle_accident' && /sos/i.test(J(exs[0])), J(exs))
  const ack = await api(staff.token, 'PUT', `/telemetry/sos/${sosId}/acknowledge`)
  check('3.11 staff acknowledge', ack.status === 200 && ack.body.status === 'acknowledged', `${ack.status} ${J(ack.body)}`)
  const ack2 = await api(staff.token, 'PUT', `/telemetry/sos/${sosId}/acknowledge`)
  check('3.12 acknowledge twice is harmless (changed:false)', ack2.status === 200 && ack2.body.changed === false, J(ack2.body))
  const other = await api(staff2.token, 'PUT', `/telemetry/sos/${sosId}/resolve`)
  check('3.13 another company cannot resolve this SOS (404)', other.status === 404, `${other.status}`)
  const otherList = await api(staff2.token, 'GET', `/vehicles/${V3.id}/sos`)
  check('3.14 another company cannot read this vehicle\'s SOS (404)', otherList.status === 404, `${otherList.status}`)
  const cancelLate = await api(d3.token, 'POST', `/telemetry/sos/${sosId}/cancel`)
  check('3.15 driver may withdraw an acknowledged alert (false alarm) -> cancel releases the hold', cancelLate.status === 200, `${cancelLate.status} ${J(cancelLate.body)}`)
  const A3 = await shipStatus(A.id)
  const vh3 = await vehRow(V3.id)
  check('3.16 after the false alarm: vehicle back in service and cargo released from hold', vh3.status !== 'maintenance' && A3.status !== 'on_hold', J([vh3.status, A3.status]))
  const res = await api(staff.token, 'PUT', `/telemetry/sos/${sosId}/resolve`)
  check('3.17 resolving a cancelled alert is a 409 (clear message)', res.status === 409, `${res.status} ${J(res.body)}`)

  // second SOS, to resolve properly + stale escalation
  const t3 = await api(d3.token, 'POST', '/telemetry/sos/trigger', { lat: 19.6, lng: 73.2, alert_type: 'breakdown', description: 'Engine seized' })
  const sos2 = t3.body.id
  await api(d3.token, 'PATCH', `/telemetry/sos/${sos2}/details`, { severity: 'minor' })
  const vhm = await vehRow(V3.id)
  check('3.18 minor breakdown does not take the vehicle out of service', vhm.status !== 'maintenance', J(vhm))
  const r2 = await api(staff.token, 'PUT', `/telemetry/sos/${sos2}/resolve`)
  check('3.19 staff resolve straight from active', r2.status === 200 && r2.body.status === 'resolved', J(r2.body))
  const d3sos = await api(d3.token, 'PUT', `/telemetry/sos/${sos2}/resolve`)
  check('3.20 a driver cannot resolve an SOS (403)', d3sos.status === 403, `${d3sos.status}`)

  // stale escalation: raise one for d4 (nothing on board), backdate and wait one scheduler tick
  const t4 = await api(d4.token, 'POST', '/telemetry/sos/trigger', { lat: 19.7, lng: 73.3, alert_type: 'breakdown', description: 'Flat tyres' })
  await api(d4.token, 'PATCH', `/telemetry/sos/${t4.body.id}/details`, { severity: 'serious' })
  const hold4 = await vehRow(V4.id)
  check('3.21 serious breakdown (nothing picked up yet) holds the vehicle', hold4.status === 'maintenance', J(hold4))
  const exB = (await casesOf(B.id))
  const bs = await shipStatus(B.id)
  check('3.22 assigned-but-not-picked-up cargo B is not put on hold (still with the consignor)', bs.status === 'assigned' || bs.status === 'created', J([bs, exB.length]))
  await db('PATCH', 'sos_alerts', { query: `id=eq.${t4.body.id}`, body: { created_at: new Date(Date.now() - 20 * 60_000).toISOString(), updated_at: new Date(Date.now() - 20 * 60_000).toISOString() } })
  let reminded = null
  for (let i = 0; i < 6 && !reminded; i++) {
    await sleep(15000)
    reminded = (await notifsOf(staff.id, 'sos')).find(n => n.data?.alert_id === t4.body.id && n.data?.reminder)
  }
  check('3.23 a stale SOS (20 min old, unacknowledged) is escalated to staff by the scheduler', !!reminded, 'no reminder within 90 s')

  // Release the vehicle's work with nothing on board vs cargo on board
  const relNone = await api(staff.token, 'POST', `/telemetry/sos/${t4.body.id}/cancel`)
  void relNone
  // V4 route: cancel trip, nothing picked up -> B goes back to created
  const routeV4 = (await db('GET', 'routes', { query: `vehicle_id=eq.${V4.id}&select=*` })).body[0]
  const cancelV4 = await api(staff.token, 'PATCH', `/routes/${routeV4.id}/status`, { status: 'cancelled' })
  const b2 = await shipStatus(B.id)
  check('3.24 cancelling a trip with nothing on board releases B back to created', cancelV4.status === 200 && b2.status === 'created' && !b2.current_vehicle_id, `${cancelV4.status} ${J(b2)}`)
})

// ───────────────────────────────────────────────────────────
section('4. Driver extras')
await guard('extras', async () => {
  const msgThread = { route_id: trip.id }
  const nothing = await api(d2.token, 'GET', `/messages?route_id=${trip.id}`)
  check('4.1 another driver of the company cannot read this trip\'s messages (403/404)', [403, 404].includes(nothing.status), `${nothing.status} ${J(nothing.body)}`)
  const sendOther = await api(d2.token, 'POST', '/messages', { route_id: trip.id, body: 'hello' })
  check('4.2 another driver cannot post on this trip (403/404)', [403, 404].includes(sendOther.status), `${sendOther.status}`)
  // a fresh live trip for messages: V2 / d2
  const M = await mk(DROPS.thane)
  await api(staff.token, 'POST', `/shipments/${M.id}/assign`, { vehicle_id: V2.id, dispatch: true })
  const r2 = (await db('GET', 'routes', { query: `vehicle_id=eq.${V2.id}&select=id,status` })).body[0]
  check('4.3 setup: d2 trip active', r2?.status === 'active', J(r2))
  const m1 = await api(staff.token, 'POST', '/messages', { route_id: r2.id, body: 'Please call the consignee before arriving' })
  check('4.4 staff messages the driver', m1.status === 201, `${m1.status} ${J(m1.body)}`)
  const dn = await notifsOf(d2.id, 'dispatch_message')
  check('4.5 driver gets a notification for the message', dn.length === 1, `${dn.length}`)
  const un = await api(d2.token, 'GET', '/messages/unread')
  check('4.6 driver unread = 1', un.body?.total === 1, J(un.body))
  const th = await api(d2.token, 'GET', `/messages?route_id=${r2.id}`)
  check('4.7 driver reads the thread', th.status === 200 && th.body.messages?.length === 1, J(th.body).slice(0, 160))
  await api(d2.token, 'POST', '/messages/read', { route_id: r2.id })
  check('4.8 reading clears the unread count', (await api(d2.token, 'GET', '/messages/unread')).body?.total === 0)
  const m2 = await api(d2.token, 'POST', '/messages', { route_id: r2.id, body: 'On my way, 20 min' })
  check('4.9 driver replies', m2.status === 201 && m2.body.sender_role === 'driver', `${m2.status} ${J(m2.body)}`)
  const su = await api(staff.token, 'GET', '/messages/unread')
  check('4.10 staff unread shows the reply', su.body?.total >= 1 && su.body.threads.some(t => t.route_id === r2.id), J(su.body))
  const su2 = await api(staff2.token, 'GET', '/messages/unread')
  check('4.11 another company\'s staff do NOT see this company\'s driver messages', su2.status === 200 && su2.body.total === 0, J(su2.body))
  const th2 = await api(staff2.token, 'GET', `/messages?route_id=${r2.id}`)
  check('4.12 another company cannot read the thread (403/404)', [403, 404].includes(th2.status), `${th2.status}`)
  const emp = await api(d2.token, 'POST', '/messages', { route_id: r2.id, body: '   ' })
  check('4.13 empty message is a 400', emp.status === 400, `${emp.status}`)
  const long = await api(d2.token, 'POST', '/messages', { route_id: r2.id, body: 'x'.repeat(5000) })
  check('4.14 oversize message is a 400', long.status === 400, `${long.status}`)

  // expenses with receipt: the driver logs a fuel fill with a bill
  const bill = await api(d2.token, 'POST', `/fleet/vehicles/${V2.id}/fuel-logs/bill-upload`, { content_type: 'image/png', size: PNG.length })
  check('4.15 driver gets a bill upload link', bill.status === 200 && bill.body.signed_url, `${bill.status} ${J(bill.body)}`)
  const billPath = await putSigned(bill.body)
  const fk = `fuel-${tag()}-k1`
  const fuel = await api(d2.token, 'POST', `/fleet/vehicles/${V2.id}/fuel-logs`, { litres: 40, price_per_litre: 92.5, bill_path: billPath, station_name: 'HP Vashi', payment_mode: 'cash', idempotency_key: fk })
  check('4.16 driver logs a fill with the bill (201, with_bill, total 3700)', fuel.status === 201 && fuel.body.bill_status === 'with_bill' && Number(fuel.body.total_amount) === 3700, `${fuel.status} ${J(fuel.body)}`)
  const fuel2 = await api(d2.token, 'POST', `/fleet/vehicles/${V2.id}/fuel-logs`, { litres: 40, price_per_litre: 92.5, bill_path: billPath, station_name: 'HP Vashi', payment_mode: 'cash', idempotency_key: fk })
  check('4.17 resend with same key: not a second fill', fuel2.status === 201 && fuel2.body.id === fuel.body.id, J(fuel2.body))
  const exp = await api(staff.token, 'GET', '/finance/expenses')
  check('4.18 the fill appears as a company expense for finance, with the receipt', exp.status === 200 && exp.body.some(e => e.receipt_path === billPath), `${exp.status} ${J(exp.body).slice(0, 200)}`)
  const otherFuel = await api(d1.token, 'POST', `/fleet/vehicles/${V2.id}/fuel-logs`, { litres: 10, price_per_litre: 90 })
  check('4.19 a driver cannot log fuel on another driver\'s vehicle (403)', otherFuel.status === 403, `${otherFuel.status}`)
  const otherCo = await api(staff2.token, 'GET', `/fleet/vehicles/${V2.id}/fuel-logs`)
  check('4.20 another company cannot read this vehicle\'s fuel logs (404)', otherCo.status === 404, `${otherCo.status}`)

  // documents
  const docs = await api(d2.token, 'GET', `/people/${d2.id}/documents`)
  check('4.21 driver reads own documents list', docs.status === 200, `${docs.status} ${J(docs.body)}`)
  const cons = await api(d2.token, 'POST', `/people/${d2.id}/consent`, { method: 'in_app' })
  check('4.21b driver records their own consent (needed before documents)', cons.status === 200, `${cons.status} ${J(cons.body)}`)
  const upl = await api(d2.token, 'POST', `/people/${d2.id}/documents/upload-url`, { file_name: 'licence.png', content_type: 'image/png', size: PNG.length, doc_type: 'driving_licence' })
  check('4.22 driver asks for a document upload link', upl.status === 200 && upl.body.signed_url, `${upl.status} ${J(upl.body)}`)
  if (upl.status === 200) {
    const p = await putSigned(upl.body)
    const add = await api(d2.token, 'POST', `/people/${d2.id}/documents`, { doc_type: 'driving_licence', file_path: p, doc_number: 'MH1220260001', name_on_document: 'UAT Driver', expires_on: '2031-01-01' })
    check('4.23 driver adds a document record', add.status === 201 || add.status === 200, `${add.status} ${J(add.body)}`)
  }
  const peek = await api(d1.token, 'GET', `/people/${d2.id}/documents`)
  check('4.24 a driver cannot read another driver\'s documents (403/404)', [403, 404].includes(peek.status), `${peek.status}`)
  const peek2 = await api(staff2.token, 'GET', `/people/${d2.id}/documents`)
  check('4.25 other company\'s staff cannot read this driver\'s documents (403/404)', [403, 404].includes(peek2.status), `${peek2.status}`)
  void msgThread
})

// ───────────────────────────────────────────────────────────
section('5. Driver sees only own trips')
await guard('own trips', async () => {
  const r = (await db('GET', 'routes', { query: `vehicle_id=eq.${V2.id}&select=id` })).body[0]
  for (const [name, path, m, body] of [
    ['GET trip', `/routes/${trip.id}`, 'GET'],
    ['PATCH status', `/routes/${trip.id}/status`, 'PATCH', { status: 'active' }],
    ['accept', '/telemetry/driver-ping/accept-route', 'POST', { route_id: trip.id }],
    ['start', '/telemetry/driver-ping/start-route', 'POST', { route_id: trip.id }],
  ]) {
    const x = await api(d2.token, m, path, body)
    check(`5.1 driver 2 on driver 1's trip: ${name} is 403/404`, [403, 404].includes(x.status), `${x.status} ${J(x.body)}`)
  }
  const stop0 = (await stopsOf(trip.id))[0]
  const cs = await api(d2.token, 'POST', '/telemetry/driver-ping/complete-stop', { stop_id: stop0.id, outcome: 'not_delivered', reason: 'other' })
  check('5.2 driver 2 cannot complete driver 1\'s stop (403)', cs.status === 403, `${cs.status}`)
  const lst = await api(d2.token, 'GET', '/routes')
  check('5.3 driver 2 /routes lists only own trips', lst.status === 200 && lst.body.every(x => x.vehicle_id === V2.id), J(lst.body.map(x => x.vehicle_id)))
  const mine = await api(d2.token, 'GET', `/routes/${r.id}`)
  check('5.4 driver 2 can read own trip', mine.status === 200)
  const stf = await api(d2.token, 'POST', '/shipments', shipBody(DROPS.thane))
  check('5.5 a driver cannot create shipments (403)', stf.status === 403, `${stf.status}`)
  const stf2 = await api(d2.token, 'POST', `/shipments/${S3.id}/assign`, { vehicle_id: V2.id })
  check('5.6 a driver cannot assign (403)', stf2.status === 403, `${stf2.status}`)
  const ds = await api(d2.token, 'PATCH', `/routes/${r.id}`, { status: 'cancelled' })
  check('5.7 a driver cannot cancel via PATCH (403)', ds.status === 403, `${ds.status}`)
  const dc = await api(d2.token, 'PATCH', `/routes/${r.id}/status`, { status: 'cancelled' })
  check('5.8 a driver cannot cancel via /status (403)', dc.status === 403, `${dc.status}`)
  const dd = await api(d2.token, 'DELETE', `/routes/${r.id}`)
  check('5.9 a driver cannot delete a trip (403)', dd.status === 403, `${dd.status}`)
})

// ───────────────────────────────────────────────────────────
section('6. Cancel / release / no vehicle / double dispatch')
await guard('cancel', async () => {
  const [C1, C2] = [await mk(DROPS.thane), await mk(DROPS.pune)]
  const VC = await newVehicle(await makeDriver(co.id))
  await api(staff.token, 'POST', `/shipments/${C1.id}/assign`, { vehicle_id: VC.id })
  await api(staff.token, 'POST', `/shipments/${C2.id}/assign`, { vehicle_id: VC.id })
  const rt = (await db('GET', 'routes', { query: `vehicle_id=eq.${VC.id}&select=*` })).body[0]
  const vL = await vehRow(VC.id)
  check('6.1 setup: pending trip, vehicle loaded 800 kg', rt.status === 'pending' && Number(vL.current_load_kg) === 800 && Number(vL.available_capacity_kg) === 4200, J([rt.status, vL]))
  const mv = await api(staff.token, 'PATCH', `/routes/${rt.id}`, { vehicle_id: VNODRIVER.id })
  check('6.2 a pending trip can change vehicle', mv.status === 200, `${mv.status} ${J(mv.body)}`)
  const vOld = await vehRow(VC.id), vNew = await vehRow(VNODRIVER.id), cM = await shipStatus(C1.id)
  check('6.2b the shipments, and both vehicles\' load, follow the move', cM.current_vehicle_id === VNODRIVER.id && Number(vOld.current_load_kg) === 0 && Number(vNew.current_load_kg) === 800, J([cM, vOld, vNew]))
  const noD = await api(staff.token, 'PATCH', `/routes/${rt.id}/status`, { status: 'active' })
  check('6.2c sending a trip whose vehicle has no driver is refused (409)', noD.status === 409, `${noD.status} ${J(noD.body)}`)
  const back = await api(staff.token, 'PATCH', `/routes/${rt.id}`, { vehicle_id: VC.id })
  check('6.2d the trip can move back', back.status === 200 && Number((await vehRow(VC.id)).current_load_kg) === 800, `${back.status}`)
  // cancel a pending trip: shipments released
  const trip2 = (await db('GET', 'routes', { query: `vehicle_id=eq.${VC.id}&select=*&status=eq.pending` })).body[0] || (await db('GET', 'routes', { query: `id=eq.${rt.id}&select=*` })).body[0]
  if (trip2.status === 'pending') {
    const cx = await api(staff.token, 'PATCH', `/routes/${trip2.id}/status`, { status: 'cancelled' })
    check('6.3 cancel a pending trip', cx.status === 200 && cx.body.status === 'cancelled', `${cx.status} ${J(cx.body)}`)
  }
  const c1 = await shipStatus(C1.id), c2 = await shipStatus(C2.id)
  check('6.4 both shipments are back to created and unassigned', c1.status === 'created' && c2.status === 'created' && !c1.current_vehicle_id, J([c1, c2]))
  const stp = await stopsOf(rt.id)
  check('6.5 the cancelled trip\'s stops are cancelled', stp.every(s => s.status === 'cancelled'), J(stp.map(s => s.status)))
  const vF = await vehRow(VC.id)
  check('6.6 vehicle load is released (0) after cancel', Number(vF.current_load_kg) === 0, J(vF))
  const recancel = await api(staff.token, 'PATCH', `/routes/${rt.id}/status`, { status: 'cancelled' })
  check('6.7 cancelling again is harmless', recancel.status === 200, `${recancel.status}`)
  const reopen = await api(staff.token, 'PATCH', `/routes/${rt.id}/status`, { status: 'active' })
  check('6.8 a cancelled trip cannot be re-opened (409)', reopen.status === 409, `${reopen.status} ${J(reopen.body)}`)
  const del = await api(staff.token, 'DELETE', `/routes/${rt.id}`)
  check('6.9 a cancelled trip can be deleted', del.status === 200, `${del.status} ${J(del.body)}`)

  // Cancel an ACTIVE trip with one shipment picked up and one not
  const [E1, E2] = [await mk(DROPS.thane), await mk(DROPS.nashik)]
  const dE = await makeDriver(co.id)
  const VE = await newVehicle(dE)
  await api(staff.token, 'POST', `/shipments/${E1.id}/assign`, { vehicle_id: VE.id })
  await api(staff.token, 'POST', `/shipments/${E2.id}/assign`, { vehicle_id: VE.id, dispatch: true })
  const rE = (await db('GET', 'routes', { query: `vehicle_id=eq.${VE.id}&select=*` })).body[0]
  check('6.10 setup: second assign with dispatch sends the whole trip', rE.status === 'active', J(rE.status))
  const eDup = await api(staff.token, 'POST', `/shipments/${E2.id}/assign`, { vehicle_id: VE.id, dispatch: true })
  check('6.11 assigning the same shipment again keeps one trip and one set of stops (no duplicates)', eDup.status === 200 && (await stopsOf(rE.id)).filter(s => s.status === 'pending').length === 2, `${eDup.status} ${(await stopsOf(rE.id)).length}`)
  await api(dE.token, 'POST', '/driver/scan', { code: E1.tracking_id, purpose: 'pickup' })
  const rel = await api(staff.token, 'PATCH', `/routes/${rE.id}/status`, { status: 'cancelled' })
  check('6.12 cancel an ACTIVE trip with goods on board', rel.status === 200, `${rel.status} ${J(rel.body)}`)
  const e1 = await shipStatus(E1.id), e2 = await shipStatus(E2.id)
  check('6.13 picked-up goods E1 are held on the vehicle (never stranded, not released as "created")', e1.status === 'on_hold' && e1.current_holder === 'vehicle', J(e1))
  check('6.14 not-picked-up E2 goes back to created', e2.status === 'created', J(e2))
  const exE = (await casesOf(E1.id))
  check('6.15 a case holds the goods (cargo problem opened)', exE.length >= 1, J(exE))
  const vE = await vehRow(VE.id)
  check('6.16 vehicle is NOT freed while goods are on it', vE.status !== 'available' || Number(vE.current_load_kg) > 0, J(vE))
  const dN = await notifsOf(dE.id, 'route_cancelled')
  check('6.17 driver told the trip was cancelled', dN.length >= 1, `${dN.length}`)
  const delAct = await api(staff.token, 'DELETE', `/routes/${rE.id}`)
  check('6.18 deleting a cancelled trip with goods held leaves the goods held', delAct.status === 200 && (await shipStatus(E1.id)).current_holder === 'vehicle', `${delAct.status} ${J(delAct.body)}`)
  const delActive = await (async () => {
    const F = await mk(DROPS.thane); const dF = await makeDriver(co.id); const VF = await newVehicle(dF)
    await api(staff.token, 'POST', `/shipments/${F.id}/assign`, { vehicle_id: VF.id, dispatch: true })
    const rF = (await db('GET', 'routes', { query: `vehicle_id=eq.${VF.id}&select=id` })).body[0]
    return api(staff.token, 'DELETE', `/routes/${rF.id}`)
  })()
  check('6.19 an active trip cannot be deleted (409)', delActive.status === 409, `${delActive.status}`)
})

// ───────────────────────────────────────────────────────────
section('7. Isolation: another company\'s staff')
await guard('isolation', async () => {
  const x = (n, r, ok = [403, 404]) => check(`7 ${n}`, ok.includes(r.status), `${r.status} ${J(r.body)}`)
  x('GET trip', await api(staff2.token, 'GET', `/routes/${trip.id}`))
  x('PATCH trip status', await api(staff2.token, 'PATCH', `/routes/${trip.id}/status`, { status: 'cancelled' }))
  x('PATCH trip', await api(staff2.token, 'PATCH', `/routes/${trip.id}`, { vehicle_id: V2.id }))
  x('DELETE trip', await api(staff2.token, 'DELETE', `/routes/${trip.id}`))
  x('reroute trip', await api(staff2.token, 'POST', `/routes/${trip.id}/reroute`, { new_sequence: [] }))
  x('GET shipment', await api(staff2.token, 'GET', `/shipments/${S1.id}`))
  x('GET shipment overview', await api(staff2.token, 'GET', `/shipments/${S1.id}/overview`))
  x('GET shipment history', await api(staff2.token, 'GET', `/shipments/${S1.id}/history`))
  x('GET shipment proof', await api(staff2.token, 'GET', `/shipments/${S1.id}/proof`))
  x('assign shipment to own vehicle? (not own shipment)', await api(staff2.token, 'POST', `/shipments/${S3.id}/assign`, { vehicle_id: V1.id }))
  x('shipment edit', await api(staff2.token, 'PATCH', `/shipments/${S3.id}/edit`, { priority: 'high' }))
  x('shipment delete', await api(staff2.token, 'DELETE', `/shipments/${S3.id}`))
  x('vehicle', await api(staff2.token, 'GET', `/vehicles/${V1.id}`))
  x('vehicle telemetry history', await api(staff2.token, 'GET', `/telemetry/${V1.id}/history`))
  x('vehicle live', await api(staff2.token, 'GET', `/telemetry/${V1.id}/live`))
  x('messages', await api(staff2.token, 'POST', '/messages', { route_id: trip.id, body: 'intrude' }))
  x('planner create-route on foreign vehicle', await api(staff2.token, 'POST', '/routing/create-route', { vehicle_id: V1.id, origin: { lat: 19, lng: 72.9 }, stops: [{ name: 'x', lat: 19.2, lng: 73 }], distance_km: 10, duration_minutes: 20, provider: 'tomtom', truck_aware: true }))
  const lst = await api(staff2.token, 'GET', '/routes')
  check('7 other company /routes lists none of ours', lst.status === 200 && !lst.body.some(r => r.id === trip.id), `${lst.body?.length}`)
  const sl = await api(staff2.token, 'GET', '/shipments')
  check('7 other company /shipments lists none of ours', sl.status === 200 && !sl.body.some(s => s.id === S1.id), `${sl.body?.length}`)
  const pts = await api(staff2.token, 'GET', '/routes/delivery-points')
  check('7 other company delivery-points do not include ours', pts.status === 200 && !pts.body.some(p => p.shipment_id === S1.id), `${pts.body?.length}`)
  const ptsOpt = await api(staff2.token, 'POST', '/optimize', { vehicle_ids: [V1.id], shipment_ids: [S3.id] })
  check('7 optimize with our ids from another company is refused or empty (not a 5xx)', ptsOpt.status < 500, `${ptsOpt.status} ${J(ptsOpt.body)}`)
  const driverCross = await api(staff2.token, 'GET', `/driver/dispatch-contact`)
  check('7 dispatch contact is per company', driverCross.status === 200, `${driverCross.status}`)
})

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
for (const f of failed) console.log(`FAIL: ${f.name} :: ${f.detail}`)
process.exit(failed.length ? 1 : 0)
