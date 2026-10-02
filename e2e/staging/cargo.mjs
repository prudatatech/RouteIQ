// Audit area 3: cargo custody, problems (cargo cases), transfers, hubs, claims, delivery outcomes, lots.
// Runs against the TEST stage only (see docs/uat/WORKFLOW-AUDIT.md). Fresh accounts every run.
//   node e2e/staging/cargo.mjs [section ...]      sections: custody problems transfer hubs shipments claims lots isolation
import crypto from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { api, db, check, results, makeCompany, makeCompanyAdmin, makeDriver, makeVendor, putSigned, readObject, PNG, tag } from './actors.mjs'

const only = new Set(process.argv.slice(2))
const want = s => only.size === 0 || only.has(s)
const J = o => JSON.stringify(o)
const short = o => String(J(o) ?? 'undefined').slice(0, 260)
const uuid = () => crypto.randomUUID()
const sleepMs = ms => new Promise(r => setTimeout(r, ms))
// "step => expected": the table in the findings is built from these
const ok = (step, expected, cond, detail = '') => check(`${step} => ${expected}`, cond, detail)
const H = key => ({ headers: { 'Idempotency-Key': key } })

// ── Fixture: one company, its staff and drivers, other tenants for the isolation checks ──
const co = await makeCompany(`Cargo Co ${tag()}`)
const other = await makeCompany(`Other Co ${tag()}`)
const admin = await makeCompanyAdmin(co.id, 'admin')
const manager = await makeCompanyAdmin(co.id, 'manager')
const otherAdmin = await makeCompanyAdmin(other.id, 'admin')
const otherDriver = await makeDriver(other.id)
const vendor = await makeVendor({ admin })
const vendor2 = await makeVendor({ admin })

const cars = []
async function newVehicle(label, capacity = 9000, org = co) {
  const drv = await makeDriver(org.id)
  const plate = `MH${String(10 + cars.length).slice(-2)}${label}${tag().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-4)}`
  const v = await db('POST', 'vehicles', { body: { id: uuid(), plate_number: plate, vehicle_type: 'truck', capacity_kg: capacity, available_capacity_kg: capacity, current_load_kg: 0, status: 'available', driver_id: drv.id, driver_name: `UAT ${label}`, driver_phone: `98765${String(cars.length).padStart(5, '0')}`, carrier_org_id: org.id, review_decision: 'approved', latitude: 19.1 + cars.length / 100, longitude: 72.85 } })
  if (v.status >= 300) throw new Error(`vehicle ${label}: ${short(v.body)}`)
  const car = { id: v.body[0].id, plate, drv, tok: drv.token }
  cars.push(car)
  return car
}
const today = new Date().toISOString().slice(0, 10)
const loadBody = (pieces = 10, kg = 500) => ({
  items: [{ product_name: 'Steel bolts', hsn_code: '7318', gst_rate: 18, quantity: pieces, unit: 'box', weight_kg: kg, declared_value: 50000 }],
  pickup_city: 'Mumbai', pickup_address: 'Plot 9 MIDC Andheri East', pickup_pincode: '400093', pickup_lat: 19.1197, pickup_lng: 72.8464, pickup_date: today,
  delivery_city: 'Pune', delivery_address: 'Hinjewadi Phase 1', delivery_pincode: '411057', delivery_lat: 18.5912, delivery_lng: 73.7389,
  routing: 'chosen', company_ids: [co.id],
})
/** Vendor posts a load, company quotes, vendor accepts, company assigns the vehicle: returns the manifest. */
async function newManifest(car, { pieces = 10, kg = 500, eway = null, v = vendor } = {}) {
  const l = await api(v.token, 'POST', '/vendor/loads', loadBody(pieces, kg))
  if (l.status >= 300) throw new Error(`post load: ${short(l.body)}`)
  const id = l.body.id
  const q = await api(admin.token, 'POST', `/company/loads/${id}/quotes`, { amount_inr: 20000 })
  if (q.status >= 300) throw new Error(`quote: ${short(q.body)}`)
  const a = await api(v.token, 'POST', `/vendor/loads/${id}/quotes/${q.body.quote.id}/accept`)
  if (a.status >= 300) throw new Error(`accept: ${short(a.body)}`)
  const s = await api(admin.token, 'PUT', `/vendor/shipment-request/${id}/assign-vehicle`, { vehicle_id: car.id })
  if (s.status >= 300) throw new Error(`assign: ${short(s.body)}`)
  const m = (await db('GET', 'cargo_manifest', { query: `vendor_request_id=eq.${id}&select=*` })).body?.[0]
  if (!m) throw new Error('no manifest after assign')
  if (eway) await db('PATCH', 'cargo_manifest', { query: `id=eq.${m.id}`, body: { eway_bill_ref: eway } })
  return { requestId: id, id: m.id, ref: { manifest_id: m.id }, car, vendor: v }
}
/** A customer-style shipment (RTX) put on a vehicle by staff. */
async function newShipment(car, { pieces = 5, kg = 200, declared = 40000, dispatch = false } = {}) {
  const r = await api(admin.token, 'POST', '/shipments', {
    origin_name: 'Andheri warehouse', origin_address: 'MIDC Andheri East, Mumbai', origin_lat: 19.1197, origin_lng: 72.8464,
    dest_name: 'Pune consignee', dest_address: 'Hinjewadi Phase 1, Pune', dest_lat: 18.5912, dest_lng: 73.7389,
    delivery_point_id: null, total_items: pieces, total_weight_kg: kg, declared_value: declared, consignee_name: 'Pune Receiver', vehicle_id: car.id, dispatch,
  })
  if (r.status >= 300) throw new Error(`shipment: ${short(r.body)}`)
  return { id: r.body.id, tracking: r.body.tracking_id, ref: { shipment_id: r.body.id }, car }
}
async function photo(tok, ref) {
  const l = await api(tok, 'POST', '/cargo/custody/upload-url', { ref, kind: 'photo', content_type: 'image/png', size: PNG.length })
  if (l.status !== 200) return { err: l }
  await putSigned(l.body)
  return { path: l.body.path, bucket: l.body.bucket }
}
const cust = (tok, body, key) => api(tok, 'POST', '/cargo/custody', body, key ? H(key) : {})
const manifestRow = async id => (await db('GET', 'cargo_manifest', { query: `id=eq.${id}&select=*` })).body?.[0]
const shipmentRow = async id => (await db('GET', 'shipments', { query: `id=eq.${id}&select=*` })).body?.[0]
const events = async (col, id) => (await db('GET', 'cargo_custody_events', { query: `${col}=eq.${id}&select=*&order=recorded_at.asc` })).body ?? []
const exc = async id => (await api(admin.token, 'GET', `/cargo/exceptions/${id}`))
const act = (id, body) => api(admin.token, 'POST', `/cargo/exceptions/${id}/actions`, body)
const vehRow = async id => (await db('GET', 'vehicles', { query: `id=eq.${id}&select=*` })).body?.[0]
const notes = async (userId, type) => (await db('GET', 'notifications', { query: `user_id=eq.${userId}${type ? `&type=eq.${type}` : ''}&select=type,title,body,data&order=created_at.asc` })).body ?? []
const within = (a, b, ms) => Math.abs(Date.parse(a) - Date.parse(b)) <= ms

const guard = async (name, fn) => { try { await fn() } catch (e) { ok(name, 'section runs without crashing', false, String(e?.message ?? e).slice(0, 300)) } }

const world = {}   // things the isolation section checks at the end

// ═══ 1. Custody chain on a vendor load ═══
if (want('custody')) await guard('custody', async () => {
  const car = await newVehicle('A1')
  const m = await newManifest(car, { pieces: 10 })
  world.m1 = m
  const where0 = await api(admin.token, 'GET', `/cargo/where/${m.id}`)
  ok('custody: where before pickup', 'scheduled (stored status), held by the consignor', where0.status === 200 && where0.body.status === 'scheduled' && where0.body.current_holder === 'consignor', short(where0.body))

  // validation first
  let r = await cust(car.tok, { ref: m.ref, kind: 'pickup', condition: 'good' })
  ok('pickup without a piece count', '400 (count the pieces)', r.status === 400, short(r.body))
  r = await cust(car.tok, { ref: m.ref, kind: 'pickup', pieces: -3 })
  ok('pickup with negative pieces', '400', r.status === 400, short(r.body))
  r = await cust(car.tok, { ref: m.ref, kind: 'pickup', pieces: 2.5 })
  ok('pickup with 2.5 pieces', '400', r.status === 400, short(r.body))
  r = await cust(car.tok, { ref: m.ref, kind: 'pickup', pieces: 10, photo_paths: [`cargo/${uuid()}/x.png`] })
  ok('pickup with a photo path from somewhere else', '400 (not this shipment\'s upload)', r.status === 400, short(r.body))
  r = await cust(car.tok, { ref: m.ref, kind: 'delivery', pieces: 10, receiver_name: 'X', reason: 'abc' })
  ok('delivery of goods never picked up', '409 (record the pickup first)', r.status === 409, short(r.body))

  // the real pickup: count, condition, seal, photo through the signed upload
  const ph = await photo(car.tok, m.ref)
  ok('custody photo: signed upload link', 'link, PUT works, file is stored', !!ph.path && !!(await readObject(ph.bucket, ph.path)), short(ph.err ?? ph))
  const key = `pk-${uuid()}`
  r = await cust(car.tok, { ref: m.ref, kind: 'pickup', pieces: 10, condition: 'good', seal_number: 'SEAL-7781', photo_paths: [ph.path], lat: 19.12, lng: 72.85 }, key)
  ok('pickup 10 of 10, good, sealed, photo', '201, in transit, held by the vehicle, 10 on board', r.status === 201 && r.body.status === 'in_transit' && r.body.current_holder === 'vehicle' && r.body.pieces.total === 10 && r.body.pieces.on_board === 10 && r.body.exception_ids.length === 0, short(r.body))
  const replay = await cust(car.tok, { ref: m.ref, kind: 'pickup', pieces: 10, condition: 'good', seal_number: 'SEAL-7781', photo_paths: [ph.path], lat: 19.12, lng: 72.85 }, key)
  ok('pickup replayed with the same Idempotency-Key', 'same answer, no second event', (replay.status === 201 || replay.status === 200) && replay.body?.event?.id === r.body?.event?.id, short(replay.body))
  r = await cust(car.tok, { ref: m.ref, kind: 'pickup', pieces: 10 })
  ok('second pickup', '409 already picked up', r.status === 409, short(r.body))
  const row = await manifestRow(m.id)
  ok('manifest row after pickup', 'in_transit, seal saved, pieces_total 10, holder vehicle, vehicle V', row.status === 'in_transit' && row.seal_number === 'SEAL-7781' && row.pieces_total === 10 && row.current_holder === 'vehicle' && row.current_vehicle_id === car.id, short(row))
  let ev = await events('manifest_id', m.id)
  ok('custody event for the pickup', 'one pickup event with photo path, seal, recorder = driver', ev.filter(e => e.kind === 'pickup').length === 1 && ev[0].photo_paths?.[0] === ph.path && ev[0].recorded_by === car.drv.id && ev[0].to_holder === 'vehicle', short(ev))

  r = await cust(car.tok, { ref: m.ref, kind: 'departed', lat: 19.0, lng: 73.0 })
  ok('departed', '201, still in transit', r.status === 201 && r.body.status === 'in_transit', short(r.body))
  r = await cust(car.tok, { ref: m.ref, kind: 'arrived_drop', lat: 18.6, lng: 73.7 })
  ok('arrived at the drop', '201, informational', r.status === 201, short(r.body))

  // pieces arithmetic at delivery
  const dph = await photo(car.tok, m.ref)
  const base = { ref: m.ref, kind: 'delivery', receiver_name: 'Ravi Kulkarni', photo_paths: [dph.path] }
  r = await cust(car.tok, { ...base, pieces: 9 })
  ok('deliver 9 of 10 as a full delivery', '409 (record a partial delivery)', r.status === 409, short(r.body))
  r = await cust(car.tok, { ...base, pieces: 11 })
  ok('deliver 11 of 10', '409 (only 10 on board)', r.status === 409, short(r.body))
  r = await cust(car.tok, { ref: m.ref, kind: 'delivery', pieces: 10, photo_paths: [dph.path] })
  ok('delivery with no receiver name', '400', r.status === 400, short(r.body))
  r = await cust(car.tok, { ref: m.ref, kind: 'delivery', pieces: 10, receiver_name: 'Ravi' })
  ok('delivery with no photo or signature (driver)', '400', r.status === 400, short(r.body))
  r = await cust(car.tok, { ...base, pieces: 10 })
  ok('delivery 10 of 10 with receiver and photo', '201, delivered, held by the consignee', r.status === 201 && r.body.status === 'delivered' && r.body.current_holder === 'consignee' && r.body.pieces.delivered === 10 && r.body.pieces.on_board === 0, short(r.body))
  r = await cust(car.tok, { ...base, pieces: 10 })
  ok('delivery again', '409 already delivered', r.status === 409, short(r.body))
  const done = await manifestRow(m.id)
  ok('manifest row after delivery', 'delivered, received_by saved, delivered 10', done.status === 'delivered' && done.received_by === 'Ravi Kulkarni' && done.pieces_delivered === 10, short(done))
  const reqRow = (await db('GET', 'vendor_shipment_requests', { query: `id=eq.${m.requestId}&select=status` })).body?.[0]
  ok('the vendor request after delivery', 'completed', reqRow?.status === 'completed', short(reqRow))
  const v = await vehRow(car.id)
  ok('vehicle after delivery', 'available again, load released (0 kg)', v.status === 'available' && Number(v.current_load_kg) === 0, short({ s: v.status, l: v.current_load_kg, a: v.available_capacity_kg }))
  const inv = (await db('GET', 'invoices', { query: `manifest_id=eq.${m.id}&select=id,status,vendor_id,amount` })).body ?? []
  ok('invoice raised on delivery', 'one invoice for the vendor', inv.length === 1 && inv[0].vendor_id === vendor.id, short(inv))

  // the timeline and where, as staff, the vendor and others
  const tl = await api(admin.token, 'GET', `/cargo/timeline/${m.id}`)
  const kinds = (tl.body?.events ?? tl.body ?? []).map?.(e => e.kind) ?? []
  ok('custody timeline (company)', 'pickup, departed, arrived_drop, delivery in order', tl.status === 200 && ['pickup', 'departed', 'arrived_drop', 'delivery'].every(k => kinds.includes(k)) && kinds.indexOf('pickup') < kinds.indexOf('delivery'), short(tl.body))
  const vt = await api(vendor.token, 'GET', `/cargo/timeline/${m.id}`)
  ok('custody timeline (the load\'s vendor)', 'readable, redacted', vt.status === 200, short(vt.body))
  const vtext = J(vt.body)
  ok('vendor timeline hides the driver and staff', 'no driver id, no user ids', !vtext.includes(car.drv.id) && !vtext.includes(admin.id), vtext.slice(0, 300))
  const vw = await api(vendor.token, 'GET', `/cargo/where/${m.id}`)
  ok('where (the load\'s vendor)', '200, delivered', vw.status === 200 && vw.body.status === 'delivered', short(vw.body))
  const vtext2 = J(vw.body)
  ok('vendor where hides the driver\'s name and phone', 'redacted', !vtext2.includes('UAT A1') && !vtext2.includes('98765'), vtext2.slice(0, 400))
  const vn = await notes(vendor.id)
  const types = vn.map(n => n.type)
  ok('vendor milestones as notifications', 'picked up and delivered', types.some(t => /picked/.test(t)) && types.some(t => /request_completed/.test(t)), J(types))
  const vl = await api(vendor.token, 'GET', '/vendor/loads')
  const mine = (vl.body ?? []).find?.(x => x.id === m.requestId)
  ok('vendor "my loads" board shows the load as delivered', 'stage delivered/completed', !!mine && /deliver|complete/.test(J(mine)), short(mine))
  // the custody chain of the shipment hash is for shipments; manifests have the event rows
  world.m1done = true
})

// ═══ 2. Problems ═══
if (want('problems')) await guard('problems', async () => {
  // damage at pickup
  const c2 = await newVehicle('B2')
  const m2 = await newManifest(c2, { pieces: 10 })
  world.m2 = m2
  let r = await cust(c2.tok, { ref: m2.ref, kind: 'pickup', pieces: 10, condition: 'damaged_goods', notes: 'Two cartons crushed', lat: 19.12, lng: 72.85 })
  ok('pickup with damaged goods', '201 and a damage problem opens by itself', r.status === 201 && r.body.exception_ids.length === 1, short(r.body))
  const eid = r.body.exception_ids?.[0]
  let e = await exc(eid)
  const d = e.body
  ok('damage problem fields', 'type damage, medium, open, source driver, the load attached', e.status === 200 && d.type === 'damage' && d.severity === 'medium' && d.status === 'open' && d.source === 'driver' && d.items?.length === 1, short(d))
  ok('damage problem SLA', 'due 24 h after opening, not overdue', !!d.sla_due_at && within(d.sla_due_at, d.created_at, 5 * 60_000 + 24 * 3600_000) && Math.abs(Date.parse(d.sla_due_at) - Date.parse(d.created_at) - 24 * 3600_000) < 60_000 && d.sla?.overdue === false, short({ due: d.sla_due_at, c: d.created_at, sla: d.sla }))
  const own = (await db('GET', 'cargo_exceptions', { query: `id=eq.${eid}&select=carrier_org_id` })).body?.[0]
  ok('problem belongs to the company running the load', 'carrier_org_id = the company', own?.carrier_org_id === co.id, short(own))
  const vtype = (await notes(vendor.id, 'cargo_exception_opened')).length
  ok('vendor told about the damage', 'a notice in the vendor\'s inbox', vtype >= 1, String(vtype))
  r = await cust(c2.tok, { ref: m2.ref, kind: 'inspection', condition: 'wet' })
  ok('inspection during the trip finding wet goods', '201 and a second problem', r.status === 201 && r.body.exception_ids.length === 1, short(r.body))

  // status ladder
  r = await act(eid, { action: 'set_status', status: 'resolved' })
  ok('set_status resolved directly', '400 use the resolve action', r.status === 400, short(r.body))
  r = await act(eid, { action: 'assign_owner', owner_id: manager.id })
  ok('assign owner (a manager) moves it to investigating', '200, investigating, owner set', r.status === 200 && r.body.status === 'investigating' && r.body.owner?.id === manager.id, short(r.body))
  r = await act(eid, { action: 'assign_owner', owner_id: 'not-a-user' })
  ok('assign owner with a nonsense id', '400', r.status === 400, short(r.body))
  r = await act(eid, { action: 'assign_owner', owner_id: c2.drv.id })
  ok('assign a driver as owner', '400 staff only', r.status === 400, short(r.body))
  r = await act(eid, { action: 'set_status', status: 'action_planned' })
  ok('investigating to action planned', '200', r.status === 200 && r.body.status === 'action_planned', short(r.body))
  r = await act(eid, { action: 'set_status', status: 'investigating' })
  ok('action planned back to investigating', '200 (allowed)', r.status === 200 && r.body.status === 'investigating', short(r.body))
  r = await act(eid, { action: 'add_note', note: 'Photos with the vendor' })
  ok('add a note', '200 and the note is on the timeline', r.status === 200 && J(r.body.timeline).includes('Photos with the vendor'), short(r.body?.timeline?.slice?.(-2)))
  r = await act(eid, { action: 'resolve' })
  ok('resolve without a resolution', '400', r.status === 400, short(r.body))
  r = await act(eid, { action: 'resolve', resolution: 'burned_down' })
  ok('resolve with an unknown resolution', '400', r.status === 400, short(r.body))
  r = await act(eid, { action: 'bogus' })
  ok('unknown action', '400', r.status === 400, short(r.body))
  r = await act(eid, { action: 'resolve', resolution: 'delivered_with_remarks', note: 'Vendor accepted the loss' })
  ok('resolve delivered_with_remarks', '200, resolved, resolver and time saved', r.status === 200 && r.body.status === 'resolved' && r.body.resolution === 'delivered_with_remarks' && !!r.body.resolved_at && r.body.resolved_by === admin.id, short(r.body))
  r = await act(eid, { action: 'set_status', status: 'investigating' })
  ok('reopen a resolved problem', '409', r.status === 409, short(r.body))
  r = await act(eid, { action: 'resolve', resolution: 'no_action' })
  ok('resolve twice', '409', r.status === 409, short(r.body))
  r = await act(eid, { action: 'set_status', status: 'closed' })
  ok('close a resolved problem', '200 closed', r.status === 200 && r.body.status === 'closed', short(r.body))
  const list = await api(admin.token, 'GET', '/cargo/exceptions?status=open,investigating&type=damage')
  ok('problem queue filter', 'only open ones of that type; the closed one is not in it', list.status === 200 && Array.isArray(list.body) && !list.body.some(x => x.id === eid), short(list.body?.slice?.(0, 2)))
  r = await api(admin.token, 'GET', '/cargo/exceptions?status=bogus')
  ok('queue filter with an unknown status', '400', r.status === 400, short(r.body))
  // finish the load so the vehicle frees
  const dp = await photo(c2.tok, m2.ref)
  r = await cust(c2.tok, { ref: m2.ref, kind: 'delivery', pieces: 10, receiver_name: 'Receiver', photo_paths: [dp.path], condition: 'damaged_goods', pieces_damaged: 2 })
  ok('delivery with 2 damaged pieces', '201 delivered and a damage-on-delivery problem', r.status === 201 && r.body.status === 'delivered' && r.body.exception_ids.length >= 1 && r.body.pieces.damaged === 2, short(r.body))
  r = await cust(c2.tok, { ref: m2.ref, kind: 'delivery', pieces: 0, receiver_name: 'x', reason: 'abc' })
  ok('more damage than delivered cannot be recorded', '409 on a settled load', r.status === 409, short(r.body))

  // shortage at delivery
  const c3 = await newVehicle('B3')
  const m3 = await newManifest(c3, { pieces: 10 })
  world.m3 = m3
  await cust(c3.tok, { ref: m3.ref, kind: 'pickup', pieces: 10, condition: 'good' })
  const p3 = await photo(c3.tok, m3.ref)
  const pd = { ref: m3.ref, kind: 'partial_delivery', receiver_name: 'Shop', photo_paths: [p3.path] }
  r = await cust(c3.tok, { ...pd, pieces: 7 })
  ok('partial delivery with nothing refused or short', '400', r.status === 400, short(r.body))
  r = await cust(c3.tok, { ...pd, pieces: 7, pieces_short: 5 })
  ok('partial 7 + 5 short of 10 on board', '409 does not add up', r.status === 409, short(r.body))
  r = await cust(c3.tok, { ...pd, pieces: 0, pieces_short: 10 })
  ok('partial with 0 accepted', '400 (at least 1)', r.status === 400, short(r.body))
  r = await cust(c3.tok, { ...pd, pieces: 7, pieces_short: 3, reason: 'Three cartons missing at the dock' })
  ok('partial delivery: 7 accepted, 3 short', '201, shortage problem opens, 7 delivered / 3 short', r.status === 201 && r.body.pieces.delivered === 7 && r.body.pieces.short === 3 && r.body.exception_ids.length >= 1, short(r.body))
  const sid = r.body.exception_ids?.[r.body.exception_ids.length - 1]
  e = await exc(sid)
  ok('shortage problem', 'type shortage, severity high, SLA 4 h', e.body.type === 'shortage' && e.body.severity === 'high' && Math.abs(Date.parse(e.body.sla_due_at) - Date.parse(e.body.created_at) - 4 * 3600_000) < 60_000, short({ t: e.body.type, s: e.body.severity, due: e.body.sla_due_at, c: e.body.created_at }))
  const m3row = await manifestRow(m3.id)
  ok('load after a partial delivery', 'pieces 7/3, status not delivered', m3row.pieces_delivered === 7 && m3row.pieces_short === 3 && m3row.status !== 'delivered', short(m3row))
  const m3req = (await db('GET', 'vendor_shipment_requests', { query: `id=eq.${m3.requestId}&select=status` })).body?.[0]
  ok('the vendor request after a partial delivery', 'not completed (7 of 10)', m3req?.status !== 'completed', short(m3req))
  r = await cust(c3.tok, { ref: m3.ref, kind: 'delivery', pieces: 1, receiver_name: 'x', photo_paths: [p3.path] })
  ok('deliver one more piece after 7 + 3 accounted', '409 or refused: nothing left on board', r.status >= 400, short(r.body))
  const w3 = await api(admin.token, 'GET', `/cargo/where/${m3.id}`)
  ok('where after a partial delivery', 'open shortage case listed, 0 on board', (w3.body.open_exceptions ?? []).some(x => x.type === 'shortage') && w3.body.pieces.on_board === 0, short(w3.body))
  r = await act(sid, { action: 'raise_claim', claim_type: 'shortage', claimed_amount: 15000, note: 'Three boxes' })
  ok('raise a claim from the problem', '200 with a draft claim', r.status === 200 && r.body.claim?.status === 'draft', short(r.body))
  world.claim3 = r.body.claim
  world.shortCase = sid

  // vendor refused pieces, re-attempt
  const c3b = await newVehicle('B3b')
  const m3b = await newManifest(c3b, { pieces: 10 })
  await cust(c3b.tok, { ref: m3b.ref, kind: 'pickup', pieces: 10 })
  const p3b = await photo(c3b.tok, m3b.ref)
  r = await cust(c3b.tok, { ref: m3b.ref, kind: 'partial_delivery', pieces: 8, pieces_refused: 2, receiver_name: 'Shop', photo_paths: [p3b.path], reason: 'customer_refused' })
  ok('partial 8 accepted, 2 refused', '201, 2 still on board', r.status === 201 && r.body.pieces.delivered === 8 && r.body.current_holder === 'vehicle' && r.body.pieces.on_board === 2, short(r.body))
  const refusedCase = r.body.exception_ids?.[r.body.exception_ids.length - 1]
  r = await act(refusedCase, { action: 'reattempt', scheduled_for: new Date(Date.now() + 3600_000).toISOString() })
  ok('re-attempt the 2 refused pieces', '200, action planned, departed recorded', r.status === 200 && r.body.status === 'action_planned', short(r.body))
  r = await cust(c3b.tok, { ref: m3b.ref, kind: 'delivery', pieces: 2, receiver_name: 'Shop', photo_paths: [p3b.path] })
  ok('deliver the last 2 pieces', '201 delivered, 10 delivered in all', r.status === 201 && r.body.status === 'delivered' && r.body.pieces.delivered === 10, short(r.body))

  // breakdown with cargo on board
  const c4 = await newVehicle('B4')
  const m4 = await newManifest(c4, { pieces: 10, eway: 'EWB-100200300400' })
  world.m4 = m4
  await cust(c4.tok, { ref: m4.ref, kind: 'pickup', pieces: 10, condition: 'good', seal_number: 'S-44' })
  r = await api(c4.tok, 'POST', `/vehicles/${c4.id}/sos`, { alert_type: 'breakdown', severity: 'serious', description: 'Gearbox failed on the expressway', latitude: 19.0, longitude: 73.05 })
  ok('driver raises a serious breakdown SOS with cargo on board', '201', r.status === 201, short(r.body))
  await sleepMs(1500)
  const cases = (await db('GET', 'cargo_exception_items', { query: `manifest_id=eq.${m4.id}&select=exception_id` })).body ?? []
  ok('a problem opened by itself for the load on board', 'one case linked to the load', cases.length === 1, short(cases))
  e = await exc(cases[0]?.exception_id)
  const b = e.body
  world.m4case = b?.id
  ok('breakdown problem', 'vehicle_breakdown, high, source sos, SLA 4 h, vehicle and position set', b.type === 'vehicle_breakdown' && b.severity === 'high' && b.source === 'sos' && b.vehicle_id === c4.id && Math.abs(Date.parse(b.sla_due_at) - Date.parse(b.created_at) - 4 * 3600_000) < 60_000 && b.lat != null, short({ t: b.type, s: b.severity, so: b.source, due: b.sla_due_at }))
  const m4row = await manifestRow(m4.id)
  ok('load on the broken truck', 'on hold, still held by that vehicle', m4row.status === 'on_hold' && m4row.current_holder === 'vehicle' && m4row.current_vehicle_id === c4.id, short(m4row))
  ok('broken truck', 'in maintenance (not offered for work)', (await vehRow(c4.id)).status === 'maintenance')
  const vn = (await notes(vendor.id, 'cargo_exception_opened')).filter(n => /delayed|broke/i.test(n.title + n.body))
  ok('vendor told the truck broke down', 'a notice mentioning the delay', vn.length >= 1, J(vn))
  r = await act(b.id, { action: 'resolve', resolution: 'no_action' })
  ok('resolve a breakdown while the goods are still on hold', '409 plan the goods first', r.status === 409, short(r.body))
  r = await api(c4.tok, 'POST', '/cargo/exceptions', { type: 'weather', description: 'Flooding ahead', items: [{ ref: m4.ref, pieces_affected: 10 }] })
  ok('driver reports a problem by hand on their own load', '201', r.status === 201 && r.body.source === 'driver', short(r.body))
  r = await api(c4.tok, 'POST', '/cargo/exceptions', { type: 'weather', description: 'Not mine', items: [{ ref: m2.ref }] })
  ok('driver reports a problem on a load that is not on their truck', '403', r.status === 403, short(r.body))
  r = await api(admin.token, 'POST', '/cargo/exceptions', { type: 'nonsense', description: 'x', vehicle_id: c4.id })
  ok('manual problem with an unknown type', '400', r.status === 400, short(r.body))
  r = await api(admin.token, 'POST', '/cargo/exceptions', { type: 'other', description: 'x' })
  ok('manual problem with no goods and no vehicle', '400', r.status === 400, short(r.body))
})

// ═══ 3. Transfer to a relief truck ═══
if (want('transfer')) await guard('transfer', async () => {
  if (!world.m4) throw new Error('needs the problems section (breakdown load)')
  const { m4 } = world
  const relief = await newVehicle('R5')
  world.relief = relief
  const c4 = m4.car
  const rv = await api(admin.token, 'GET', `/cargo/exceptions/${world.m4case}/relief-vehicles`)
  ok('relief vehicles for the breakdown', 'the working truck is offered, the broken one is not', rv.status === 200 && J(rv.body).includes(relief.id) && !J(rv.body).includes(c4.id), short(rv.body))
  // guard rails of the plan
  let r = await api(admin.token, 'POST', '/cargo/transfers', { from_vehicle_id: c4.id, to_vehicle_id: relief.id, items: [{ ref: m4.ref, pieces: 11 }] })
  ok('plan a transfer of 11 of 10 pieces', '409', r.status === 409, short(r.body))
  r = await api(admin.token, 'POST', '/cargo/transfers', { from_vehicle_id: c4.id, to_vehicle_id: c4.id, items: [{ ref: m4.ref, pieces: 10 }] })
  ok('plan a transfer to the same truck', '400', r.status === 400, short(r.body))
  r = await api(admin.token, 'POST', '/cargo/transfers', { from_vehicle_id: c4.id, items: [{ ref: m4.ref, pieces: 10 }] })
  ok('plan a transfer with no target', '400', r.status === 400, short(r.body))
  const foreign = await newVehicle('X9', 9000, other)
  r = await api(admin.token, 'POST', '/cargo/transfers', { from_vehicle_id: c4.id, to_vehicle_id: foreign.id, items: [{ ref: m4.ref, pieces: 10 }] })
  ok('plan a transfer to another company\'s truck', '404', r.status === 404, short(r.body))
  r = await api(admin.token, 'POST', '/cargo/transfers', { from_vehicle_id: c4.id, to_vehicle_id: c4.id === relief.id ? foreign.id : relief.id, items: [{ ref: m4.ref, pieces: 10 }, { ref: m4.ref, pieces: 10 }] })
  ok('the same load listed twice', '400', r.status === 400, short(r.body))
  r = await api(otherAdmin.token, 'POST', '/cargo/transfers', { from_vehicle_id: c4.id, to_vehicle_id: foreign.id, items: [{ ref: m4.ref, pieces: 10 }] })
  ok('another company plans a transfer of our load', '404', r.status === 404, short(r.body))

  // plan from the case (the action), as dispatch does
  r = await act(world.m4case, { action: 'transship', to_vehicle_id: relief.id, note: 'Gearbox: move to the relief truck' })
  const trf = r.body?.transfer
  ok('plan the transfer from the breakdown problem', '200, transfer planned, problem action planned', r.status === 200 && trf?.status === 'planned' && r.body.exception?.status === 'action_planned', short(r.body))
  world.trf = trf
  r = await api(admin.token, 'POST', '/cargo/transfers', { from_vehicle_id: c4.id, to_vehicle_id: relief.id, items: [{ ref: m4.ref, pieces: 10 }] })
  ok('plan a second transfer for the same load', '409 already on a transfer', r.status === 409, short(r.body))
  r = await api(relief.tok, 'POST', `/cargo/transfers/${trf.id}/handover-in`, { items: [{ ref: m4.ref, pieces_in: 10 }] })
  ok('receiving driver counts in before handover out', '409', r.status === 409, short(r.body))
  const outBody = { items: [{ ref: m4.ref, pieces_out: 10, condition: 'good' }] }
  r = await api(otherDriver.token, 'POST', `/cargo/transfers/${trf.id}/handover-out`, outBody)
  ok('a driver of another company counts out', '404 or 403', r.status === 404 || r.status === 403, short(r.body))
  r = await api(c4.tok, 'POST', `/cargo/transfers/${trf.id}/handover-out`, { items: [{ ref: m4.ref, pieces_out: 11 }] })
  ok('count out 11 of 10 planned', '409', r.status === 409, short(r.body))
  const tph = await api(c4.tok, 'POST', '/cargo/custody/upload-url', { transfer_id: trf.id, kind: 'photo', content_type: 'image/png', size: PNG.length })
  const tpath = tph.status === 200 ? await putSigned(tph.body) : null
  ok('photo for the handover (transfer folder)', 'signed link works', !!tpath, short(tph.body))
  r = await api(c4.tok, 'POST', `/cargo/transfers/${trf.id}/handover-out`, { items: [{ ref: m4.ref, pieces_out: 10, condition: 'good' }], photo_paths: tpath ? [tpath] : [] }, H(`ho-${uuid()}`))
  ok('the broken truck\'s driver counts 10 out', '200, in progress', r.status === 200 && r.body.status === 'in_progress' && r.body.items[0].pieces_out === 10, short(r.body))
  r = await api(c4.tok, 'POST', `/cargo/transfers/${trf.id}/cancel`, { reason: 'x' })
  ok('a driver cancels a transfer', '403 (staff only)', r.status === 403, short(r.body))
  r = await api(admin.token, 'POST', `/cargo/transfers/${trf.id}/cancel`, { reason: 'x' })
  ok('cancel a transfer in progress', '409', r.status === 409, short(r.body))
  r = await api(c4.tok, 'POST', `/cargo/transfers/${trf.id}/handover-in`, { items: [{ ref: m4.ref, pieces_in: 10 }] })
  ok('the giving driver counts the goods in', '403 (only the receiving driver or staff)', r.status === 403, short(r.body))
  r = await api(relief.tok, 'POST', `/cargo/transfers/${trf.id}/handover-in`, { items: [{ ref: m4.ref, pieces_in: 10, condition: 'good' }] })
  ok('the relief truck\'s driver counts 10 in', '200 completed, no problems opened', r.status === 200 && r.body.status === 'completed' && (r.body.exceptions_opened ?? []).length === 0, short(r.body))
  const t2 = await api(admin.token, 'GET', `/cargo/transfers/${trf.id}`)
  ok('transfer after completion', 'e-way Part B required (the load has an e-way bill)', t2.body.eway_part_b_required === true && !!t2.body.completed_at && t2.body.items[0].pieces_in === 10, short(t2.body))
  let mrow = await manifestRow(m4.id)
  ok('load after the transfer', 'on the relief truck, in transit, ownership unchanged, e-way Part B flagged', mrow.vehicle_id === relief.id && mrow.current_vehicle_id === relief.id && mrow.status === 'in_transit' && mrow.carrier_org_id === co.id && mrow.vendor_org_id === m4.vendor.orgId || (mrow.vehicle_id === relief.id && mrow.current_vehicle_id === relief.id && mrow.status === 'in_transit' && mrow.carrier_org_id === co.id), short({ v: mrow.vehicle_id, cv: mrow.current_vehicle_id, s: mrow.status, co: mrow.carrier_org_id, vo: mrow.vendor_org_id, pb: mrow.eway_part_b_required }))
  ok('e-way Part B flag on the load', 'update required', mrow.eway_part_b_required === true, short({ pb: mrow.eway_part_b_required, ref: mrow.eway_bill_ref }))
  const old = await vehRow(c4.id), nw = await vehRow(relief.id)
  ok('old truck\'s load released, new truck loaded', 'old 0 kg, new 500 kg', Number(old.current_load_kg) === 0 && Number(nw.current_load_kg) >= 500, short({ old: old.current_load_kg, nw: nw.current_load_kg }))
  const reqRow = (await db('GET', 'vendor_shipment_requests', { query: `id=eq.${m4.requestId}&select=assigned_vehicle_id,status,vendor_id,carrier_org_id` })).body?.[0]
  ok('the vendor\'s request after the transfer', 'still the same vendor and company; shows the relief truck', reqRow?.vendor_id === vendor.id && reqRow?.carrier_org_id === co.id && reqRow?.assigned_vehicle_id === relief.id, short({ ...reqRow, relief: relief.id, old: c4.id }))
  const caseNow = await exc(world.m4case)
  ok('breakdown problem after the transfer', 'resolved: transshipped', caseNow.body.status === 'resolved' && caseNow.body.resolution === 'transshipped', short({ s: caseNow.body.status, r: caseNow.body.resolution }))
  const evs = (await events('manifest_id', m4.id)).map(e => e.kind)
  ok('custody chain around the transfer', 'pickup, hold, handover_out, handover_in', ['pickup', 'hold', 'handover_out', 'handover_in'].every(k => evs.includes(k)), J(evs))
  const mine = await api(vendor.token, 'GET', `/cargo/where/${m4.id}`)
  ok('vendor sees the load on the new truck without driver details', '200, in transit', mine.status === 200 && mine.body.status === 'in_transit', short(mine.body))
  r = await api(admin.token, 'POST', `/cargo/transfers/${trf.id}/eway`, { eway_part_b_ref: 'PARTB-889900' })
  ok('record the new Part B', '200', r.status === 200 && r.body.eway_part_b_ref === 'PARTB-889900', short(r.body))
  mrow = await manifestRow(m4.id)
  ok('e-way flag after Part B is recorded', 'cleared', mrow.eway_part_b_required === false, short({ pb: mrow.eway_part_b_required }))
  r = await api(admin.token, 'POST', `/cargo/transfers/${trf.id}/eway`, { eway_part_b_ref: '' })
  ok('empty Part B reference', '400', r.status === 400, short(r.body))
  // the new driver delivers it
  const dph = await photo(relief.tok, m4.ref)
  r = await cust(relief.tok, { ref: m4.ref, kind: 'delivery', pieces: 10, receiver_name: 'Plant gate', photo_paths: [dph.path] })
  ok('relief driver delivers the load', '201 delivered', r.status === 201 && r.body.status === 'delivered', short(r.body))
  r = await cust(c4.tok, { ref: m4.ref, kind: 'delivery', pieces: 10, receiver_name: 'x', photo_paths: [dph.path] })
  ok('the old driver tries to deliver it', '403/409 (not on their truck)', r.status === 403 || r.status === 409, short(r.body))

  // no e-way bill: no Part B; and a mismatch at handover-in opens a shortage
  const a = await newVehicle('T6'), bb = await newVehicle('T7')
  const m5 = await newManifest(a, { pieces: 10 })
  await cust(a.tok, { ref: m5.ref, kind: 'pickup', pieces: 10, condition: 'good' })
  const tr = await api(admin.token, 'POST', '/cargo/transfers', { from_vehicle_id: a.id, to_vehicle_id: bb.id, items: [{ ref: m5.ref, pieces: 10 }], meet_lat: 19.0, meet_lng: 73.0, meet_address: 'Khalapur toll' })
  ok('plan a transfer on a load without an e-way bill', '201 planned', tr.status === 201 && tr.body.status === 'planned', short(tr.body))
  await api(a.tok, 'POST', `/cargo/transfers/${tr.body.id}/handover-out`, { items: [{ ref: m5.ref, pieces_out: 10 }] })
  r = await api(bb.tok, 'POST', `/cargo/transfers/${tr.body.id}/handover-in`, { items: [{ ref: m5.ref, pieces_in: 8, condition: 'good' }] })
  ok('receiving driver counts only 8 of 10', '200 completed and a shortage problem opened', r.status === 200 && r.body.status === 'completed' && (r.body.exceptions_opened ?? []).length === 1, short(r.body))
  const shortCase = await exc(r.body.exceptions_opened?.[0])
  ok('shortage problem from the handover', 'type shortage, 2 pieces, high', shortCase.body.type === 'shortage' && shortCase.body.severity === 'high' && shortCase.body.items?.[0]?.pieces_affected === 2, short(shortCase.body?.items))
  const m5row = await manifestRow(m5.id)
  ok('load after the short handover', '2 short, 8 on board on the new truck, no Part B', m5row.pieces_short === 2 && m5row.pieces_total === 10 && m5row.current_vehicle_id === bb.id && m5row.eway_part_b_required !== true, short({ s: m5row.pieces_short, t: m5row.pieces_total, pb: m5row.eway_part_b_required }))
  const tget = await api(admin.token, 'GET', `/cargo/transfers/${tr.body.id}`)
  ok('transfer without an e-way bill', 'Part B not required', tget.body.eway_part_b_required === false, short(tget.body))
  const d5 = await photo(bb.tok, m5.ref)
  r = await cust(bb.tok, { ref: m5.ref, kind: 'delivery', pieces: 8, receiver_name: 'Gate', photo_paths: [d5.path] })
  ok('deliver the 8 that arrived', '201 delivered (8) with 2 short on record', r.status === 201 && r.body.pieces.delivered === 8 && r.body.pieces.short === 2, short(r.body))

  // partial transfer splits the load into lots
  const pa = await newVehicle('T8'), pb = await newVehicle('T9')
  const m6 = await newManifest(pa, { pieces: 10 })
  await cust(pa.tok, { ref: m6.ref, kind: 'pickup', pieces: 10, condition: 'good' })
  const tp = await api(admin.token, 'POST', '/cargo/transfers', { from_vehicle_id: pa.id, to_vehicle_id: pb.id, items: [{ ref: m6.ref, pieces: 6 }] })
  ok('transfer 6 of 10 pieces', '201: the load is split into a moving lot and a staying lot', tp.status === 201 && (tp.body.splits ?? []).length === 1 && tp.body.splits[0].moving.pieces === 6 && tp.body.splits[0].staying.pieces === 4, short(tp.body))
  world.partial = { m6, tp: tp.body, pa, pb }
  await api(admin.token, 'POST', `/cargo/transfers/${tp.body.id}/cancel`, { reason: 'test over' })
})

// ═══ 4. Hubs ═══
if (want('hubs')) await guard('hubs', async () => {
  const dep = await db('POST', 'depots', { body: { id: uuid(), name: `Hub ${tag()}`, address: 'Bhiwandi hub', latitude: 19.3, longitude: 73.06, carrier_org_id: co.id } })
  if (dep.status >= 300) throw new Error(`depot: ${short(dep.body)}`)
  const depot = dep.body[0]
  const odep = (await db('POST', 'depots', { body: { id: uuid(), name: `Their Hub ${tag()}`, address: 'Elsewhere', latitude: 19.4, longitude: 73.1, carrier_org_id: other.id } })).body[0]
  world.depot = depot
  const a = await newVehicle('H1'), bv = await newVehicle('H2')
  const m7 = await newManifest(a, { pieces: 10 })
  world.m7 = m7
  await cust(a.tok, { ref: m7.ref, kind: 'pickup', pieces: 10, condition: 'good' })
  let r = await cust(a.tok, { ref: m7.ref, kind: 'hub_in' })
  ok('hub arrival without a hub', '400', r.status === 400, short(r.body))
  {
    const fa = await newVehicle('H0')
    const mx = await newManifest(fa, { pieces: 4 })
    await cust(fa.tok, { ref: mx.ref, kind: 'pickup', pieces: 4 })
    const rx = await cust(fa.tok, { ref: mx.ref, kind: 'hub_in', depot_id: odep.id })
    ok('hub arrival at another company\'s hub', '404 (not your hub)', rx.status === 404, short(rx.body))
    world.mx = mx
  }
  r = await cust(a.tok, { ref: m7.ref, kind: 'hub_in', depot_id: uuid() })
  ok('hub arrival at a hub that does not exist', '404', r.status === 404, short(r.body))
  r = await cust(a.tok, { ref: m7.ref, kind: 'hub_in', depot_id: depot.id, pieces: 9, condition: 'good' })
  ok('hub arrival counting 9 of 10', '201, at hub, a shortage problem opens', r.status === 201 && r.body.current_holder === 'hub' && r.body.pieces.short === 1 && r.body.exception_ids.length === 1, short(r.body))
  const mrow = await manifestRow(m7.id)
  ok('load at the hub', 'held by the hub, depot set, no vehicle', mrow.current_holder === 'hub' && mrow.current_depot_id === depot.id && !mrow.current_vehicle_id, short(mrow))
  ok('the truck is free after dropping at the hub', 'load released from the truck', Number((await vehRow(a.id)).current_load_kg) === 0, short({ l: (await vehRow(a.id)).current_load_kg }))
  const hubs = await api(admin.token, 'GET', '/cargo/hubs')
  const mine = (hubs.body ?? []).find?.(h => h.id === depot.id)
  ok('hub list', 'our hub shows 1 consignment, 9 pieces; their hub is not listed', hubs.status === 200 && mine?.consignments === 1 && mine?.pieces === 9 && !(hubs.body ?? []).some(h => h.id === odep.id), short(hubs.body))
  // ageing
  const hubIn = (await events('manifest_id', m7.id)).find(e => e.kind === 'hub_in')
  await db('PATCH', 'cargo_custody_events', { query: `id=eq.${hubIn.id}`, body: { recorded_at: new Date(Date.now() - 30 * 3600_000).toISOString() } })
  const inv = await api(admin.token, 'GET', `/cargo/hubs/${depot.id}/inventory`)
  const item = inv.body?.items?.[0]
  ok('hub inventory ageing', 'one item, age about 30 h, next leg is the drop', inv.status === 200 && inv.body.items.length === 1 && item.age_hours >= 29.5 && item.age_hours <= 31 && item.pieces === 9 && !!item.next_leg, short(item))
  ok('hub inventory lists the open shortage', 'the problem is attached to the item', (item?.open_exceptions ?? []).some(x => x.type === 'shortage'), short(item?.open_exceptions))
  const hl = (await api(admin.token, 'GET', '/cargo/hubs')).body?.find?.(h => h.id === depot.id)
  ok('hub list ageing', 'oldest age about 30 h', hl?.oldest_age_hours >= 29.5, short(hl))
  r = await api(otherAdmin.token, 'GET', `/cargo/hubs/${depot.id}/inventory`)
  ok('another company reads our hub inventory', '404', r.status === 404, short(r.body))
  r = await api(admin.token, 'GET', `/cargo/hubs/${odep.id}/inventory`)
  ok('we read their hub inventory', '404', r.status === 404, short(r.body))
  // hub out
  r = await cust(a.tok, { ref: m7.ref, kind: 'hub_out', vehicle_id: bv.id })
  ok('the old driver (not on the load) takes it out of the hub', '403/409/400', r.status >= 400, short(r.body))
  r = await cust(admin.token, { ref: m7.ref, kind: 'hub_out' })
  ok('hub departure without naming the vehicle', '400', r.status === 400, short(r.body))
  r = await cust(admin.token, { ref: m7.ref, kind: 'hub_out', vehicle_id: foreign(other) })
  ok('hub departure on a vehicle that does not exist', '404', r.status === 404, short(r.body))
  r = await cust(admin.token, { ref: m7.ref, kind: 'hub_out', vehicle_id: bv.id })
  ok('hub departure on a second truck', '201 in transit on that truck', r.status === 201 && r.body.status === 'in_transit' && r.body.current_holder === 'vehicle', short(r.body))
  const inv2 = await api(admin.token, 'GET', `/cargo/hubs/${depot.id}/inventory`)
  ok('hub empty after departure', 'no items', inv2.body.items.length === 0, short(inv2.body))
  const ph = await photo(bv.tok, m7.ref)
  r = await cust(bv.tok, { ref: m7.ref, kind: 'delivery', pieces: 9, receiver_name: 'Gate', photo_paths: [ph.path] })
  ok('the second truck delivers the 9 pieces', '201 delivered', r.status === 201 && r.body.status === 'delivered', short(r.body))
  r = await cust(admin.token, { ref: m7.ref, kind: 'hub_out', vehicle_id: bv.id })
  ok('hub departure of goods that are not at a hub', '409', r.status === 409, short(r.body))
})
function foreign() { return uuid() }

// ═══ 5. Customer shipments: partial, failed, RTO, delivery code, verify-pod ═══
if (want('shipments')) await guard('shipments', async () => {
  // delivery code
  const a = await newVehicle('S1')
  const s1 = await newShipment(a, { pieces: 5 })
  world.s1 = s1
  let r = await cust(a.tok, { ref: s1.ref, kind: 'pickup', pieces: 5, condition: 'good', seal_number: 'SH-1' })
  ok('shipment pickup 5 of 5', '201 picked up', r.status === 201 && r.body.status === 'picked_up', short(r.body))
  r = await cust(a.tok, { ref: s1.ref, kind: 'departed' })
  ok('shipment departed', 'in transit', r.status === 201 && r.body.status === 'in_transit', short(r.body))
  r = await api(a.tok, 'POST', '/cargo/otp/send', { ref: s1.ref })
  ok('a driver asks for a delivery code', '403 (staff only)', r.status === 403, short(r.body))
  r = await api(admin.token, 'POST', '/cargo/otp/send', { ref: s1.ref })
  ok('staff sends the delivery code', '200 with an expiry', r.status === 200 && !!r.body.expires_at, short(r.body))
  const srow = await shipmentRow(s1.id)
  const hash = srow.delivery_otp_hash
  ok('delivery code is stored as a hash only', '64 hex chars, otp required, expiry about 24 h', /^[0-9a-f]{64}$/.test(hash ?? '') && srow.delivery_otp_required === true && Math.abs(Date.parse(srow.delivery_otp_expires_at) - Date.now() - 24 * 3600_000) < 120_000, short({ h: hash?.slice(0, 8), req: srow.delivery_otp_required, exp: srow.delivery_otp_expires_at }))
  // recover the code from the hash (it is sha256(id:code); proves only the hash is kept)
  let code = null
  for (let i = 0; i < 1_000_000; i++) { const c = String(i).padStart(6, '0'); if (crypto.createHash('sha256').update(`${s1.id}:${c}`).digest('hex') === hash) { code = c; break } }
  ok('the code is not stored anywhere in the clear', 'no plain code in the row or its notices', !!code && !J(srow).includes(`"${code}"`), '')
  const dph = await photo(a.tok, s1.ref)
  const dbody = { ref: s1.ref, kind: 'delivery', pieces: 5, receiver_name: 'Anita', photo_paths: [dph.path] }
  r = await cust(a.tok, dbody)
  ok('delivery with no code when one is required', '400', r.status === 400, short(r.body))
  r = await cust(a.tok, { ...dbody, otp: '12ab56' })
  ok('delivery with a malformed code', '400', r.status === 400, short(r.body))
  let last
  const wrong = code === '000001' ? '000002' : '000001'
  const seen = []
  for (let i = 0; i < 5; i++) { last = await cust(a.tok, { ...dbody, otp: wrong }); seen.push(last.status) }
  ok('five wrong codes', '400 four times then 429 locked', J(seen) === J([400, 400, 400, 400, 429]), J(seen))
  r = await cust(a.tok, { ...dbody, otp: code })
  ok('the right code while locked', '429 (lockout holds for 15 minutes)', r.status === 429, short(r.body))
  r = await api(admin.token, 'POST', '/cargo/otp/send', { ref: s1.ref })
  ok('staff sends a fresh code', '200 and the lock is cleared', r.status === 200, short(r.body))
  const h2 = (await shipmentRow(s1.id)).delivery_otp_hash
  let code2 = null
  for (let i = 0; i < 1_000_000; i++) { const c = String(i).padStart(6, '0'); if (crypto.createHash('sha256').update(`${s1.id}:${c}`).digest('hex') === h2) { code2 = c; break } }
  ok('a new code replaces the old hash', 'different hash', h2 !== hash && !!code2, '')
  r = await cust(a.tok, { ...dbody, otp: code })
  ok('the old code after a new one was sent', '400 wrong', r.status === 400, short(r.body))
  r = await cust(a.tok, { ...dbody, otp: code2 })
  ok('delivery with the right code', '201 delivered, hash cleared', r.status === 201 && r.body.status === 'delivered', short(r.body))
  const after = await shipmentRow(s1.id)
  ok('shipment row after delivery', 'delivered, hash and expiry cleared, received_by saved', after.status === 'delivered' && after.delivery_otp_hash === null && after.received_by === 'Anita', short({ s: after.status, h: after.delivery_otp_hash, r: after.received_by }))
  r = await api(admin.token, 'POST', '/cargo/otp/send', { ref: s1.ref })
  ok('send a code for a delivered shipment', '409', r.status === 409, short(r.body))
  const mOtp = await newManifest(await newVehicle('S0'), { pieces: 2 })
  r = await api(admin.token, 'POST', '/cargo/otp/send', { ref: mOtp.ref })
  ok('send a code for a vendor load', '400 (shipments only)', r.status === 400, short(r.body))
  const sends = []
  const s1b = await newShipment(await newVehicle('S1b'), { pieces: 2 })
  for (let i = 0; i < 6; i++) sends.push((await api(admin.token, 'POST', '/cargo/otp/send', { ref: s1b.ref })).status)
  ok('six codes in an hour for one shipment', 'five go out, the sixth is 429', J(sends) === J([200, 200, 200, 200, 200, 429]), J(sends))

  // verify-pod rules (staff confirms)
  const b = await newVehicle('S2')
  const s2 = await newShipment(b, { pieces: 3 })
  world.s2 = s2
  r = await api(admin.token, 'POST', '/cargo/verify-pod', { tracking_id: s2.tracking, recipient_name: 'Meena', reason: 'Receiver says ok' })
  ok('verify-pod before any pickup', '409 (record the pickup first)', r.status === 409, short(r.body))
  r = await api(admin.token, 'POST', '/cargo/verify-pod', { tracking_id: s2.tracking, recipient_name: 'Meena', allow_without_pickup: true })
  ok('verify-pod without pickup and without a reason', '400', r.status === 400, short(r.body))
  await cust(b.tok, { ref: s2.ref, kind: 'pickup', pieces: 3 })
  await cust(b.tok, { ref: s2.ref, kind: 'departed' })
  r = await api(admin.token, 'POST', '/cargo/verify-pod', { tracking_id: s2.tracking, recipient_name: 'Meena' })
  ok('verify-pod with no evidence and no reason', '400', r.status === 400, short(r.body))
  r = await api(admin.token, 'POST', '/cargo/verify-pod', { tracking_id: s2.tracking, recipient_name: 'Meena', reason: 'ab' })
  ok('verify-pod with a 2-character reason', '400', r.status === 400, short(r.body))
  r = await api(admin.token, 'POST', '/cargo/verify-pod', { tracking_id: s2.tracking, recipient_name: '', reason: 'Spoke to the receiver' })
  ok('verify-pod with no recipient', '400', r.status === 400, short(r.body))
  r = await api(admin.token, 'POST', '/cargo/verify-pod', { tracking_id: s2.tracking, recipient_name: 'Meena', photo_paths: [`cargo/${uuid()}/f.png`] })
  ok('verify-pod with a photo that is not this shipment\'s', '400', r.status === 400, short(r.body))
  r = await api(otherAdmin.token, 'POST', '/cargo/verify-pod', { tracking_id: s2.tracking, recipient_name: 'Intruder', reason: 'I am another company' })
  ok('ANOTHER COMPANY confirms delivery of our shipment', '404 (not theirs)', r.status === 404, short(r.body))
  const stillOurs = await shipmentRow(s2.id)
  ok('our shipment after that attempt', 'still not delivered', stillOurs.status !== 'delivered', short({ s: stillOurs.status }))
  r = await api(admin.token, 'POST', '/cargo/verify-pod', { tracking_id: s2.tracking, recipient_name: 'Meena', reason: 'Receiver confirmed by phone' })
  ok('verify-pod with a written reason', '200 delivered', r.status === 200 && r.body.status === 'delivered', short(r.body))
  const ev2 = (await events('shipment_id', s2.id)).find(e => e.kind === 'delivery')
  ok('the confirmation is a custody delivery with the reason', 'recorded by the staff member, notes carry the reason', !!ev2 && ev2.recorded_by === admin.id && /phone/.test(ev2.notes ?? ''), short(ev2))
  r = await api(admin.token, 'POST', '/cargo/verify-pod', { tracking_id: s2.tracking, recipient_name: 'Meena', reason: 'again please' })
  ok('verify-pod twice', '409', r.status === 409, short(r.body))
  // staff may use the delivery code as evidence; a bad code is refused and counts
  const c3 = await newVehicle('S3')
  const s3 = await newShipment(c3, { pieces: 4 })
  await cust(c3.tok, { ref: s3.ref, kind: 'pickup', pieces: 4 })
  await cust(c3.tok, { ref: s3.ref, kind: 'departed' })
  r = await api(admin.token, 'POST', '/cargo/verify-pod', { tracking_id: s3.tracking, recipient_name: 'Meena', otp: '123456' })
  ok('verify-pod with a code nobody sent', '409 (expired or never sent)', r.status === 409, short(r.body))

  // failed deliveries, re-attempts, return to origin
  const d = await newVehicle('S4')
  const s4 = await newShipment(d, { pieces: 3 })
  world.s4 = s4
  await cust(d.tok, { ref: s4.ref, kind: 'pickup', pieces: 3 })
  await cust(d.tok, { ref: s4.ref, kind: 'departed' })
  r = await cust(d.tok, { ref: s4.ref, kind: 'undelivered' })
  ok('failed delivery without a reason', '400', r.status === 400, short(r.body))
  r = await cust(d.tok, { ref: s4.ref, kind: 'undelivered', reason: 'because' })
  ok('failed delivery with an unknown reason', '400', r.status === 400, short(r.body))
  r = await cust(d.tok, { ref: s4.ref, kind: 'undelivered', reason: 'customer_unavailable', notes: 'Shop shut' })
  ok('failed delivery attempt 1', '201, exception status, a problem opens', r.status === 201 && r.body.status === 'exception' && r.body.exception_ids.length === 1, short(r.body))
  let u = await exc(r.body.exception_ids?.[0])
  ok('undeliverable problem', 'type undeliverable, medium', u.body.type === 'undeliverable' && u.body.severity === 'medium', short({ t: u.body.type, s: u.body.severity }))
  let w = await api(admin.token, 'GET', `/cargo/where/${s4.id}`)
  ok('where after attempt 1', '1 of 3 attempts, 3 on board, not RTO', w.body.delivery_attempts === 1 && w.body.max_delivery_attempts === 3 && w.body.pieces.on_board === 3 && w.body.rto === false, short(w.body))
  r = await act(u.body.id, { action: 'reattempt' })
  ok('plan a re-attempt', '200 action planned, goods back out for delivery', r.status === 200 && r.body.status === 'action_planned', short(r.body))
  r = await cust(d.tok, { ref: s4.ref, kind: 'undelivered', reason: 'address_unreachable' })
  ok('failed delivery attempt 2', '201 exception', r.status === 201 && r.body.status === 'exception', short(r.body))
  u = await exc(r.body.exception_ids?.[0])
  r = await act(u.body.id, { action: 'reattempt' })
  r = await cust(d.tok, { ref: s4.ref, kind: 'undelivered', reason: 'premises_closed' })
  ok('failed delivery attempt 3', '201 returning, return to origin started, no new re-attempt case', r.status === 201 && r.body.status === 'returning', short(r.body))
  const rrow = await shipmentRow(s4.id)
  ok('shipment after the last attempt', 'returning, rto true, attempts 3', rrow.status === 'returning' && rrow.rto === true && rrow.delivery_attempts === 3, short({ s: rrow.status, rto: rrow.rto, a: rrow.delivery_attempts }))
  r = await cust(d.tok, { ref: s4.ref, kind: 'delivery', pieces: 3, receiver_name: 'x', photo_paths: [] })
  ok('deliver goods that are being returned', '409', r.status === 409, short(r.body))
  const pr = await photo(d.tok, s4.ref)
  r = await cust(d.tok, { ref: s4.ref, kind: 'return_delivery', pieces: 3, receiver_name: 'Sender store', photo_paths: [pr.path] })
  ok('return delivery of 3', '201 returned, back with the consignor, 3 returned', r.status === 201 && r.body.status === 'returned' && r.body.current_holder === 'consignor' && r.body.pieces.returned === 3, short(r.body))
  const k4 = (await events('shipment_id', s4.id)).map(e => e.kind)
  ok('custody chain of the returned shipment', 'pickup, departed, 3 failed attempts, return_delivery', k4.filter(k => k === 'undelivered').length === 3 && k4.includes('return_delivery'), J(k4))
  const vh = await vehRow(d.id)
  ok('truck after the return', 'free (no load on it)', Number(vh.current_load_kg) === 0 || vh.current_load_kg == null, short({ l: vh.current_load_kg, s: vh.status }))
  const log = (await db('GET', 'shipment_logs', { query: `shipment_id=eq.${s4.id}&select=status,log_hash,previous_hash&order=index.asc` })).body ?? []
  ok('shipment log hash chain for the returned shipment', 'every entry chains to the one before', log.length >= 5 && log.every((l, i) => i === 0 || l.previous_hash === log[i - 1].log_hash), short(log.slice?.(-3) ?? log))
  const vs = await api(admin.token, 'GET', `/shipments/${s4.id}/verify`)
  ok('the chain verifies', 'valid', vs.status === 200 && vs.body.is_valid === true, short(vs.body))
  // refused for damage: staff partial on a shipment
  const e5 = await newVehicle('S5')
  const s5 = await newShipment(e5, { pieces: 6 })
  world.s5 = s5
  await cust(e5.tok, { ref: s5.ref, kind: 'pickup', pieces: 6 })
  await cust(e5.tok, { ref: s5.ref, kind: 'departed' })
  const p5 = await photo(e5.tok, s5.ref)
  r = await cust(e5.tok, { ref: s5.ref, kind: 'partial_delivery', pieces: 4, pieces_refused: 2, receiver_name: 'Dev', photo_paths: [p5.path], reason: 'damaged_refused' })
  ok('partial delivery of a shipment: 4 accepted, 2 refused', '201 partially delivered, the 2 stay on the truck', r.status === 201 && r.body.status === 'partially_delivered' && r.body.pieces.on_board === 2, short(r.body))
  const inv = (await db('GET', 'invoices', { query: `shipment_id=eq.${s5.id}&select=id` })).body ?? []
  ok('no invoice while part of the goods is still on the truck', 'none yet', inv.length === 0, short(inv))
  r = await cust(e5.tok, { ref: s5.ref, kind: 'return_pickup' })
  ok('send the 2 refused pieces back', '201 returning', r.status === 201 && r.body.status === 'returning', short(r.body))
  const pr5 = await photo(e5.tok, s5.ref)
  r = await cust(e5.tok, { ref: s5.ref, kind: 'return_delivery', pieces: 1, receiver_name: 'Store', photo_paths: [pr5.path] })
  ok('return delivery of 1 of 2 pieces', '201 returned with 1 short and a shortage problem', r.status === 201 && r.body.pieces.returned === 1 && r.body.pieces.short === 1 && r.body.exception_ids.length === 1, short(r.body))
  const s5row = await shipmentRow(s5.id)
  ok('piece arithmetic of that shipment', 'delivered 4 + short 1 + returned 1 = 6, never above total', s5row.pieces_delivered + s5row.pieces_short + s5row.pieces_returned === 6 && s5row.pieces_total === 6, short({ d: s5row.pieces_delivered, s: s5row.pieces_short, r: s5row.pieces_returned, t: s5row.pieces_total }))
  r = await cust(admin.token, { ref: s5.ref, kind: 'lost', pieces: 1 })
  ok('write off a piece that is not held', '409 or no-op, never negative', r.status === 409 || r.status >= 400, short(r.body))
  const after5 = await shipmentRow(s5.id)
  ok('no counter went negative or past the total', 'ok', [after5.pieces_delivered, after5.pieces_short, after5.pieces_returned, after5.pieces_damaged].every(n => n >= 0) && after5.pieces_delivered + after5.pieces_short + after5.pieces_returned <= after5.pieces_total, short(after5))
})

// ═══ 6. Claims ═══
if (want('claims')) await guard('claims', async () => {
  // a delivered, damaged load of the vendor
  const a = await newVehicle('K1')
  const k = await newManifest(a, { pieces: 10 })
  world.k = k
  await cust(a.tok, { ref: k.ref, kind: 'pickup', pieces: 10, condition: 'good' })
  let r = await api(vendor.token, 'POST', '/cargo/claims', { ref: k.ref, claim_type: 'damage', claimed_amount: 5000 })
  ok('vendor claims on a load still on the road', '409 (after delivery only)', r.status === 409, short(r.body))
  const ph = await photo(a.tok, k.ref)
  await cust(a.tok, { ref: k.ref, kind: 'delivery', pieces: 10, receiver_name: 'Gate', photo_paths: [ph.path], condition: 'damaged_goods', pieces_damaged: 3 })
  r = await api(vendor.token, 'POST', '/cargo/claims', { ref: k.ref, claim_type: 'damage', claimed_amount: 999999 })
  ok('vendor claims more than the declared value (50,000)', '422', r.status === 422, short(r.body))
  r = await api(vendor.token, 'POST', '/cargo/claims', { ref: k.ref, claim_type: 'damage', claimed_amount: -5 })
  ok('vendor claims a negative amount', '400', r.status === 400, short(r.body))
  r = await api(vendor.token, 'POST', '/cargo/claims', { ref: k.ref, claim_type: 'bogus', claimed_amount: 100 })
  ok('vendor claims with an unknown type', '400', r.status === 400, short(r.body))
  r = await api(vendor2.token, 'POST', '/cargo/claims', { ref: k.ref, claim_type: 'damage', claimed_amount: 100 })
  ok('ANOTHER VENDOR claims on this load', '404', r.status === 404, short(r.body))
  r = await api(vendor.token, 'POST', '/cargo/claims', { ref: k.ref, claim_type: 'damage', claimed_amount: 12000, notes: '3 boxes crushed' }, H(`cl-${uuid()}`))
  ok('vendor files a damage claim for 12,000', '201, status filed (vendor files directly), declared value 50,000', r.status === 201 && r.body.status === 'filed' && r.body.claimed_amount === 12000 && Number(r.body.declared_value) === 50000 && r.body.raised_by_role === 'vendor', short(r.body))
  const claim = r.body
  world.claim = claim
  r = await api(vendor.token, 'POST', '/cargo/claims', { ref: k.ref, claim_type: 'damage', claimed_amount: 100 })
  ok('a second open claim of the same type', '409', r.status === 409, short(r.body))
  r = await api(vendor.token, 'GET', `/cargo/claims/${claim.id}`)
  ok('vendor reads own claim', '200', r.status === 200 && r.body.id === claim.id, short(r.body))
  r = await api(vendor2.token, 'GET', `/cargo/claims/${claim.id}`)
  ok('another vendor reads the claim', '404', r.status === 404, short(r.body))
  const l1 = await api(vendor.token, 'GET', '/cargo/claims')
  const l2 = await api(vendor2.token, 'GET', '/cargo/claims')
  ok('claim lists are per vendor', 'vendor sees theirs, other vendor sees none of them', l1.body.items?.some(c => c.id === claim.id) && !(l2.body.items ?? []).some(c => c.id === claim.id), short({ a: l1.body.items?.length, b: l2.body.items?.length }))
  r = await api(vendor.token, 'PATCH', `/cargo/claims/${claim.id}`, { status: 'approved', approved_amount: 12000 })
  ok('vendor approves own claim', '403 (staff only)', r.status === 403, short(r.body))
  // documents through the signed flow
  r = await api(vendor.token, 'POST', `/cargo/claims/${claim.id}/documents-upload-url`, { content_type: 'application/pdf', size: 1000 })
  ok('claim document upload link (vendor, PDF)', '200 link', r.status === 200 && !!r.body.signed_url, short(r.body))
  if (r.status === 200) {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF')
    await putSigned(r.body, pdf, 'application/pdf')
    const got = await readObject(r.body.bucket, r.body.path)
    ok('claim document is stored', 'the same bytes come back', got && got.equals(pdf), String(got?.length))
    const again = await api(vendor.token, 'GET', `/cargo/claims/${claim.id}`)
    ok('claim shows the document with a signed link', 'one document with a url', again.body.documents?.length === 1 && !!again.body.documents[0].url, short(again.body.documents))
  }
  r = await api(vendor.token, 'POST', `/cargo/claims/${claim.id}/documents-upload-url`, { content_type: 'text/html', size: 1000 })
  ok('claim document of a bad type', '415', r.status === 415, short(r.body))
  r = await api(vendor.token, 'POST', `/cargo/claims/${claim.id}/documents-upload-url`, { content_type: 'image/png', size: 999_999_999 })
  ok('claim document that is too big', '413', r.status === 413, short(r.body))
  r = await api(vendor2.token, 'POST', `/cargo/claims/${claim.id}/documents-upload-url`, { content_type: 'image/png', size: 100 })
  ok('another vendor uploads to the claim', '404', r.status === 404, short(r.body))
  r = await api(otherAdmin.token, 'POST', `/cargo/claims/${claim.id}/documents-upload-url`, { content_type: 'image/png', size: 100 })
  ok('ANOTHER COMPANY\'S STAFF uploads to our claim', '404', r.status === 404, short(r.body))
  r = await api(otherAdmin.token, 'GET', `/cargo/claims/${claim.id}`)
  ok('another company reads our claim', '404', r.status === 404, short(r.body))
  r = await api(otherAdmin.token, 'PATCH', `/cargo/claims/${claim.id}`, { status: 'rejected' })
  ok('another company rejects our claim', '404', r.status === 404, short(r.body))
  r = await api(otherAdmin.token, 'POST', '/cargo/claims', { ref: k.ref, claim_type: 'theft', claimed_amount: 100 })
  ok('another company\'s staff raise a claim on our load', '404', r.status === 404, short(r.body))
  // staff process: filed -> surveyed -> approved -> settled
  const P = body => api(admin.token, 'PATCH', `/cargo/claims/${claim.id}`, body)
  r = await P({ status: 'settled', settled_amount: 100 })
  ok('settle a claim that is only filed', '409', r.status === 409, short(r.body))
  r = await P({ status: 'surveyed' })
  ok('survey without a surveyor', '400', r.status === 400, short(r.body))
  r = await P({ status: 'surveyed', surveyor_name: 'S. Rao', survey_date: '2026-10-01', insurer: 'New India', policy_number: 'POL-1' })
  ok('survey with a surveyor', '200 surveyed', r.status === 200 && r.body.status === 'surveyed' && r.body.surveyor_name === 'S. Rao', short(r.body))
  r = await P({ status: 'approved' })
  ok('approve without an amount', '400', r.status === 400, short(r.body))
  r = await P({ status: 'approved', approved_amount: 90000 })
  ok('approve more than the claimed amount (12,000)', 'refused (approved may not exceed claimed)', r.status >= 400, short(r.body))
  r = await P({ status: 'approved', approved_amount: 10000 })
  ok('approve 10,000', '200 approved', r.status === 200 && r.body.status === 'approved' && r.body.approved_amount === 10000, short(r.body))
  r = await P({ status: 'settled' })
  ok('settle without an amount', '400', r.status === 400, short(r.body))
  r = await P({ status: 'settled', settled_amount: 50000 })
  ok('settle for more than was approved', 'refused (settled may not exceed approved)', r.status >= 400, short(r.body))
  r = await P({ status: 'settled', settled_amount: 10000 })
  ok('settle 10,000', '200 settled with a time', r.status === 200 && r.body.status === 'settled' && !!r.body.settled_at, short(r.body))
  r = await P({ status: 'withdrawn' })
  ok('withdraw a settled claim', '409', r.status === 409, short(r.body))
  r = await P({ notes: 'edit after settling' })
  ok('edit a settled claim', '409', r.status === 409, short(r.body))
  r = await api(vendor.token, 'POST', `/cargo/claims/${claim.id}/documents-upload-url`, { content_type: 'image/png', size: 100 })
  ok('add a document to a settled claim', '409', r.status === 409, short(r.body))
  const vnote = (await notes(vendor.id, "cargo_claim_update")).map(n => n.body)
  ok('vendor notified as the claim moves', 'filed, surveyed, approved, settled notices', vnote.length >= 3 && vnote.some(t => /settled/.test(t)), J(vnote))
  // staff claim ladder: draft from a problem, then filed, then rejected
  if (world.claim3) {
    const cl = world.claim3
    const Q = body => api(admin.token, 'PATCH', `/cargo/claims/${cl.id}`, body)
    r = await Q({ status: 'approved', approved_amount: 100 })
    ok('approve a draft claim', '409 (file it first)', r.status === 409, short(r.body))
    r = await Q({ status: 'filed' })
    ok('file the draft', '200 filed', r.status === 200 && r.body.status === 'filed', short(r.body))
    r = await Q({ status: 'rejected', notes: 'Not covered' })
    ok('reject a filed claim', '200 rejected', r.status === 200 && r.body.status === 'rejected', short(r.body))
    r = await Q({ status: 'filed' })
    ok('reopen a rejected claim', '409', r.status === 409, short(r.body))
    r = await api(admin.token, 'POST', '/cargo/claims', { ref: world.m3.ref, claim_type: 'shortage', claimed_amount: 900000 })
    ok('staff claim above the declared value', '422', r.status === 422, short(r.body))
    r = await api(admin.token, 'POST', '/cargo/claims', { ref: world.m3.ref, claim_type: 'shortage', claimed_amount: 9000, exception_id: world.shortCase })
    ok('a new claim after the first was rejected', '201 draft', r.status === 201 && r.body.status === 'draft', short(r.body))
    r = await api(admin.token, 'PATCH', `/cargo/claims/${r.body.id}`, { status: 'withdrawn' })
    ok('withdraw a draft', '200', r.status === 200 && r.body.status === 'withdrawn', short(r.body))
  }
})

// ═══ 7. Lots ═══
if (want('lots')) await guard('lots', async () => {
  const a = await newVehicle('L1')
  const m = await newManifest(a, { pieces: 10 })
  world.lotM = m
  let r = await api(admin.token, 'POST', '/cargo/lots/split', { ref: m.ref, reason: 'manual', lots: [{ pieces: 4 }, { pieces: 3 }] })
  ok('split a load nobody counted yet', '409 (count the pieces first)', r.status === 409, short(r.body))
  r = await cust(a.tok, { ref: m.ref, kind: 'pickup', pieces: 10, condition: 'good' })
  ok('pickup of the whole load', '201', r.status === 201, short(r.body))
  r = await api(admin.token, 'POST', '/cargo/lots/split', { ref: m.ref, reason: 'manual', lots: [{ pieces: 4 }, { pieces: 3 }] })
  ok('split the load on the truck into 4 + 3 + the rest', '201 three lots', r.status === 201 && r.body.lots?.length === 3, short(r.body))
  const lots = r.body.lots ?? []
  ok('lots add up', 'pieces 4 + 3 + 3 = 10', lots.reduce((s, l) => s + (l.pieces ?? 0), 0) === 10, short(lots))
  r = await api(admin.token, 'POST', '/cargo/lots/split', { ref: m.ref, reason: 'manual', lots: [{ pieces: 4 }] })
  ok('split the master again', '409 (the master holds no goods)', r.status === 409, short(r.body))
  r = await cust(a.tok, { ref: m.ref, kind: 'delivery', pieces: 10, receiver_name: 'x', reason: 'abc' })
  ok('deliver the master directly', '403/409 (act on a lot)', r.status === 409 || r.status === 403, short(r.body))
  const ov = await api(admin.token, 'GET', `/cargo/lots/${m.id}`)
  ok('lots overview from the master', 'the master and 3 lots with codes', ov.status === 200 && J(ov.body).includes(lots[0]?.code ?? 'zz'), short(ov.body))
  const ovl = await api(admin.token, 'GET', `/cargo/lots/${lots[0]?.code}`)
  ok('lots overview from a lot code', 'same master', ovl.status === 200, short(ovl.body))
  if (lots.length >= 3) {
    const [l1, l2, l3] = lots
    const ph1 = await photo(a.tok, l1.ref)
    r = await cust(a.tok, { ref: l1.ref, kind: 'delivery', pieces: 4, receiver_name: 'Dealer A', photo_paths: [ph1.path] })
    ok('deliver lot A (4 pieces)', '201 delivered', r.status === 201 && r.body.status === 'delivered', short(r.body))
    let mm = await manifestRow(m.id)
    ok('master after one lot is delivered', 'partly delivered (not delivered)', mm.status !== 'delivered' && (await api(admin.token, 'GET', `/cargo/where/${m.id}`)).body?.pieces?.delivered === 4, short({ s: mm.status, d: mm.pieces_delivered }))
    const req = (await db('GET', 'vendor_shipment_requests', { query: `id=eq.${m.requestId}&select=status` })).body?.[0]
    ok('vendor request while lots are open', 'not completed', req?.status !== 'completed', short(req))
    const ph2 = await photo(a.tok, l2.ref)
    r = await cust(a.tok, { ref: l2.ref, kind: 'delivery', pieces: 2, receiver_name: 'Dealer B', photo_paths: [ph2.path] })
    ok('deliver 2 of lot B\'s 3 pieces as a full delivery', '409', r.status === 409, short(r.body))
    r = await cust(a.tok, { ref: l2.ref, kind: 'delivery', pieces: 3, receiver_name: 'Dealer B', photo_paths: [ph2.path] })
    ok('deliver lot B (3)', '201 delivered', r.status === 201, short(r.body))
    const ph3 = await photo(a.tok, l3.ref)
    r = await cust(a.tok, { ref: l3.ref, kind: 'delivery', pieces: 3, receiver_name: 'Dealer C', photo_paths: [ph3.path] })
    ok('deliver lot C (3)', '201 delivered', r.status === 201, short(r.body))
    mm = await manifestRow(m.id)
    ok('master after all lots', 'delivered, 10 of 10 delivered, rolled up', mm.status === 'delivered' && (await api(admin.token, 'GET', `/cargo/where/${m.id}`)).body?.pieces?.delivered === 10, short({ s: mm.status, d: mm.pieces_delivered }))
    const req2 = (await db('GET', 'vendor_shipment_requests', { query: `id=eq.${m.requestId}&select=status` })).body?.[0]
    ok('vendor request after all lots', 'completed', req2?.status === 'completed', short(req2))
    const where = await api(vendor.token, 'GET', `/cargo/where/${m.id}`)
    ok('vendor sees the master rolled up', '200 delivered', where.status === 200 && where.body.status === 'delivered', short(where.body))
    const wl = await api(vendor2.token, 'GET', `/cargo/lots/${m.id}`)
    ok('another vendor reads the lots', '404', wl.status === 404, short(wl.body))
  }
  // a shipment with two drops is created as a master with lots
  const b = await newVehicle('L2')
  const ms = await api(admin.token, 'POST', '/shipments', {
    origin_name: 'Andheri', origin_address: 'MIDC Andheri', origin_lat: 19.1197, origin_lng: 72.8464, total_weight_kg: 300, vehicle_id: b.id, delivery_point_id: null,
    drops: [
      { name: 'Drop 1', address: 'Pune 1', lat: 18.59, lng: 73.73, consignee_name: 'C1', pieces: 3, weight_kg: 100, declared_value: 10000 },
      { name: 'Drop 2', address: 'Pune 2', lat: 18.5, lng: 73.8, consignee_name: 'C2', pieces: 2, weight_kg: 200, declared_value: 20000 },
    ],
  })
  ok('two-drop shipment', '201 master with 2 lots', ms.status === 201, short(ms.body))
  if (ms.status === 201) {
    const ov2 = await api(admin.token, 'GET', `/cargo/lots/${ms.body.id}`)
    const l = ov2.body?.lots ?? []
    ok('two-drop master: lots', '2 lots, pieces 3 + 2', l.length === 2, short(ov2.body))
    world.multi = { id: ms.body.id, tracking: ms.body.tracking_id, lots: l, car: b }
  }
})

// ═══ 8. Isolation ═══
if (want('isolation')) await guard('isolation', async () => {
  const targets = []
  if (world.m1) targets.push(['delivered load', world.m1.id])
  if (world.m4) targets.push(['transferred load', world.m4.id])
  if (world.s1) targets.push(['delivered shipment', world.s1.id])
  if (world.s4) targets.push(['returned shipment', world.s4.id])
  if (world.m7) targets.push(['hub load', world.m7.id])
  for (const [label, id] of targets) {
    for (const [who, tok] of [['other company staff', otherAdmin.token], ['other vendor', vendor2.token], ['other company driver', otherDriver.token]]) {
      for (const p of ['where', 'timeline', 'lots']) {
        const r = await api(tok, 'GET', `/cargo/${p}/${id}`)
        const good = who === 'other company driver' ? [403, 404].includes(r.status) : r.status === 404
        ok(`${who} reads ${p} of the ${label}`, who === 'other company driver' ? '403/404' : '404', good, `${r.status} ${short(r.body)}`)
      }
    }
    const rs = await api(otherAdmin.token, 'POST', '/cargo/custody', { ref: id, kind: 'inspection', condition: 'wet' })
    ok(`other company staff records custody on the ${label}`, '404', rs.status === 404, `${rs.status} ${short(rs.body)}`)
    const rd = await api(otherDriver.token, 'POST', '/cargo/custody', { ref: id, kind: 'inspection', condition: 'wet' })
    ok(`other company driver records custody on the ${label}`, '403/404', [403, 404].includes(rd.status), `${rd.status} ${short(rd.body)}`)
    const rv = await api(vendor2.token, 'POST', '/cargo/custody', { ref: id, kind: 'inspection', condition: 'wet' })
    ok(`other vendor records custody on the ${label}`, '403', rv.status === 403, `${rv.status} ${short(rv.body)}`)
    const ro = await api(otherAdmin.token, 'POST', '/cargo/otp/send', { ref: id })
    ok(`other company sends a delivery code for the ${label}`, '404', ro.status === 404 || ro.status === 400, `${ro.status} ${short(ro.body)}`)
    const rx = await api(otherAdmin.token, 'POST', '/cargo/exceptions', { type: 'other', description: 'intruder', items: [{ ref: id }] })
    ok(`other company opens a problem on the ${label}`, '404', rx.status === 404, `${rx.status} ${short(rx.body)}`)
    const rl = await api(otherAdmin.token, 'POST', '/cargo/lots/split', { ref: id, reason: 'manual', lots: [{ pieces: 1 }] })
    ok(`other company splits the ${label}`, '404', rl.status === 404, `${rl.status} ${short(rl.body)}`)
    const rt = await api(otherAdmin.token, 'POST', '/cargo/claims', { ref: id, claim_type: 'damage', claimed_amount: 10 })
    ok(`other company claims on the ${label}`, '404', rt.status === 404, `${rt.status} ${short(rt.body)}`)
  }
  // cases, transfers, claims, hubs by id
  const caseIds = world.m4case ? [world.m4case] : []
  if (world.shortCase) caseIds.push(world.shortCase)
  for (const id of caseIds) {
    for (const who of [['other company staff', otherAdmin.token]]) {
      let r = await api(who[1], 'GET', `/cargo/exceptions/${id}`)
      ok(`${who[0]} reads the case`, '404', r.status === 404, short(r.body))
      r = await api(who[1], 'POST', `/cargo/exceptions/${id}/actions`, { action: 'add_note', note: 'intruder' })
      ok(`${who[0]} adds a note to the case`, '404', r.status === 404, short(r.body))
      r = await api(who[1], 'POST', `/cargo/exceptions/${id}/actions`, { action: 'resolve', resolution: 'no_action' })
      ok(`${who[0]} resolves the case`, '404', r.status === 404, short(r.body))
      r = await api(who[1], 'GET', `/cargo/exceptions/${id}/relief-vehicles`)
      ok(`${who[0]} asks for relief trucks of the case`, '404', r.status === 404, short(r.body))
    }
    const r = await api(vendor2.token, 'GET', `/cargo/exceptions/${id}`)
    ok('another vendor reads the case', '403', r.status === 403, short(r.body))
    const rv = await api(vendor.token, 'GET', `/cargo/exceptions/${id}`)
    ok('the load\'s own vendor reads the staff case', '403 (staff only)', rv.status === 403, short(rv.body))
  }
  const list = await api(otherAdmin.token, 'GET', '/cargo/exceptions')
  ok('another company\'s problem list', 'none of ours', list.status === 200 && !(list.body ?? []).some(x => caseIds.includes(x.id)), short(list.body?.slice?.(0, 2)))
  if (world.trf) {
    let r = await api(otherAdmin.token, 'GET', `/cargo/transfers/${world.trf.id}`)
    ok('another company reads our transfer', '404', r.status === 404, short(r.body))
    r = await api(otherAdmin.token, 'POST', `/cargo/transfers/${world.trf.id}/eway`, { eway_part_b_ref: 'HIJACK' })
    ok('another company sets Part B on our transfer', '404', r.status === 404, short(r.body))
    r = await api(otherAdmin.token, 'POST', `/cargo/transfers/${world.trf.id}/cancel`, {})
    ok('another company cancels our transfer', '404', r.status === 404, short(r.body))
    r = await api(otherDriver.token, 'GET', `/cargo/transfers/${world.trf.id}`)
    ok('another company\'s driver reads our transfer', '403/404', [403, 404].includes(r.status), short(r.body))
    const tl = await api(otherAdmin.token, 'GET', '/cargo/transfers')
    ok('another company\'s transfer list', 'none of ours', tl.status === 200 && !(tl.body ?? []).some(t => t.id === world.trf.id), short(tl.body?.slice?.(0, 2)))
  }
  const cl = await api(otherAdmin.token, 'GET', '/cargo/claims')
  ok('another company\'s claim list', 'none of ours', cl.status === 200 && !(cl.body.items ?? []).some(c => c.id === world.claim?.id), short(cl.body.items?.slice?.(0, 2)))
  const mine = await api(otherAdmin.token, 'GET', '/cargo/hubs')
  ok('another company\'s hubs', 'none of ours', mine.status === 200 && !(mine.body ?? []).some(h => h.id === world.depot?.id), short(mine.body))
  const oc = await api(otherDriver.token, 'GET', `/cargo/vehicles/${cars[0].id}/on-board`)
  ok('another company reads what is on our truck', '403/404', [403, 404].includes(oc.status), short(oc.body))
  const oc2 = await api(otherAdmin.token, 'GET', `/cargo/vehicles/${cars[0].id}/on-board`)
  ok('another company\'s staff read what is on our truck', '403/404', [403, 404].includes(oc2.status), short(oc2.body))
})

// ── The table ──
const rows = results.map(r => {
  const [step, expected] = r.name.split(' => ')
  return `| ${step.replace(/\|/g, '/')} | ${(expected ?? '').replace(/\|/g, '/')} | ${r.ok ? 'as expected' : `${r.detail}`.replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 200)} | ${r.ok ? 'PASS' : 'FAIL'} |`
})
writeFileSync(process.env.CARGO_TABLE || '/tmp/cargo-steps.md', `| Step | Expected | Result | |\n|---|---|---|---|\n${rows.join('\n')}\n`)
const fails = results.filter(r => !r.ok)
console.log(`\n${results.length - fails.length}/${results.length} passed`)
if (fails.length) { console.log('FAILED:'); for (const f of fails) console.log(' -', f.name, '::', f.detail.slice(0, 200)) }
