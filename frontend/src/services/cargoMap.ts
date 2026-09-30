/**
 * Maps the `/api/v1/cargo` answers (backend-ts services/cargo, contract in docs/cargo-plan.md)
 * to the shapes the web screens use. Pure functions, covered by cargoMap.test.ts; the backend
 * side of each shape is pinned by backend-ts/test/cargo-web-contract.test.ts.
 *
 * What the backend sends that the screens read differently:
 * - a consignment is `{ ref: { shipment_id } | { manifest_id }, code }`; the screens use flat
 *   `shipment_id` / `manifest_id` / `tracking_id` (ConsignmentLabel);
 * - timeline events embed `from_vehicle`, `to_depot`, `recorded_by` as objects;
 * - the case timeline has `{ at, source: 'case' | 'custody' | 'sos' | 'maintenance', kind, text, by, by_name, role }`;
 * - claims carry `consignment_code`; hub and on-board rows carry `next_leg` / `next_stop` by name and address.
 */
import type {
  CargoClaim, CargoException, CargoTransfer, CargoVehicle, CaseTimelineEntry, ClaimSummary, ConsignmentLabel, CustodyEvent, ExceptionDetail,
  ExceptionItem, HubInventoryRow, HubSummary, OnBoard, OnBoardItem, Pieces, ReliefVehicle, TransferItem, WhereIsIt,
} from './cargo'

type Raw = Record<string, unknown>

const obj = (v: unknown): Raw | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** A list answer: a bare array, or the array under `key` (or `items`). */
export function listOf<T>(data: unknown, key: string): T[] {
  if (Array.isArray(data)) return data as T[]
  const d = obj(data)
  if (d && Array.isArray(d[key])) return d[key] as T[]
  if (d && Array.isArray(d.items)) return d.items as T[]
  return []
}

/**
 * `{ ref: { shipment_id } | { manifest_id }, code, status }` (or flat ids, or `consignment_code`)
 * as the flat identity the screens show and link.
 */
export function labelOf(row: unknown): ConsignmentLabel {
  const r = obj(row) ?? {}
  const ref = obj(r.ref)
  const shipmentId = str(ref?.shipment_id) ?? str(r.shipment_id)
  const manifestId = str(ref?.manifest_id) ?? str(r.manifest_id)
  return {
    shipment_id: shipmentId,
    manifest_id: manifestId,
    // `code` names the goods only next to a `ref`; on a claim row it is the claim's own CLM- code
    tracking_id: str(r.consignment_code) ?? str(r.tracking_id) ?? (ref ? str(r.code) : null),
    status: str(r.status),
  }
}

export function mapPieces(raw: unknown): Pieces {
  const p = obj(raw) ?? {}
  return {
    total: num(p.total),
    delivered: num(p.delivered) ?? 0,
    damaged: num(p.damaged) ?? 0,
    short: num(p.short) ?? 0,
    returned: num(p.returned) ?? 0,
    on_board: num(p.on_board),
  }
}

/** A vehicle embed; the backend uses lat/lng on `where` and latitude/longitude elsewhere. Both are kept. */
export function mapVehicle(raw: unknown): CargoVehicle | null {
  const v = obj(raw)
  if (!v || !str(v.id)) return null
  return {
    ...(v as unknown as CargoVehicle),
    id: String(v.id),
    plate_number: str(v.plate_number) ?? '—',
  }
}

type Brief = WhereIsIt['open_exceptions'][number]
const mapBrief = (raw: unknown): Brief => {
  const e = obj(raw) ?? {}
  return {
    id: String(e.id), code: String(e.code ?? ''), type: e.type as Brief['type'], severity: e.severity as Brief['severity'],
    status: e.status as Brief['status'], sla_due_at: str(e.sla_due_at),
  }
}

/** GET /cargo/where/:ref */
export function mapWhere(raw: unknown): WhereIsIt {
  const w = obj(raw) ?? {}
  const label = labelOf(w)
  const depot = obj(w.depot)
  return {
    ref: {
      ...(label.manifest_id ? { manifest_id: label.manifest_id } : { shipment_id: label.shipment_id ?? '' }),
      tracking_id: label.tracking_id,
    } as WhereIsIt['ref'],
    code: str(w.code),
    status: String(w.status ?? ''),
    current_holder: (str(w.current_holder) ?? 'consignor') as WhereIsIt['current_holder'],
    vehicle: mapVehicle(w.vehicle) as WhereIsIt['vehicle'],
    depot: depot && str(depot.id) ? { id: String(depot.id), name: str(depot.name) ?? 'Hub', address: str(depot.address) } : null,
    pieces: mapPieces(w.pieces),
    seal_number: str(w.seal_number),
    open_exceptions: arr(w.open_exceptions).map(mapBrief),
    delivery_attempts: num(w.delivery_attempts) ?? 0,
    max_delivery_attempts: num(w.max_delivery_attempts),
    delivery_otp_required: w.delivery_otp_required === true,
    rto: w.rto === true,
    on_hold_reason: str(w.on_hold_reason),
  }
}

/** One event of GET /cargo/timeline/:ref: embedded objects flattened to the names the timeline shows. */
export function mapCustodyEvent(raw: unknown): CustodyEvent {
  const e = obj(raw) ?? {}
  const fromVehicle = obj(e.from_vehicle)
  const toVehicle = obj(e.to_vehicle)
  const fromDepot = obj(e.from_depot)
  const toDepot = obj(e.to_depot)
  const recorder = obj(e.recorded_by)
  const driver = obj(e.driver)
  return {
    id: String(e.id),
    kind: e.kind as CustodyEvent['kind'],
    summary: str(e.summary),
    recorded_at: String(e.recorded_at ?? ''),
    from_holder: (str(e.from_holder) as CustodyEvent['from_holder']) ?? null,
    to_holder: (str(e.to_holder) as CustodyEvent['to_holder']) ?? null,
    from_vehicle_id: str(fromVehicle?.id) ?? str(e.from_vehicle_id),
    to_vehicle_id: str(toVehicle?.id) ?? str(e.to_vehicle_id),
    from_depot_id: str(fromDepot?.id) ?? str(e.from_depot_id),
    to_depot_id: str(toDepot?.id) ?? str(e.to_depot_id),
    from_vehicle_plate: str(fromVehicle?.plate_number),
    to_vehicle_plate: str(toVehicle?.plate_number),
    from_depot_name: str(fromDepot?.name),
    to_depot_name: str(toDepot?.name),
    pieces: num(e.pieces),
    weight_kg: num(e.weight_kg),
    condition: (str(e.condition) as CustodyEvent['condition']) ?? null,
    seal_number: str(e.seal_number),
    seal_ok: typeof e.seal_ok === 'boolean' ? e.seal_ok : null,
    receiver_name: str(e.receiver_name),
    otp_verified: typeof e.otp_verified === 'boolean' ? e.otp_verified : null,
    photo_urls: arr(e.photo_urls).filter((u): u is string => typeof u === 'string' && u !== ''),
    signature_url: str(e.signature_url),
    lat: num(e.lat),
    lng: num(e.lng),
    notes: str(e.notes),
    exception_id: str(e.exception_id),
    transfer_id: str(e.transfer_id),
    driver_name: str(driver?.name),
    recorded_by: str(recorder?.id) ?? str(e.recorded_by),
    recorded_by_name: str(recorder?.name),
    recorded_role: str(e.recorded_role) ?? str(recorder?.role),
  }
}

/** An item of a case (list or case page). */
export function mapExceptionItem(raw: unknown, exceptionId: string): ExceptionItem {
  const i = obj(raw) ?? {}
  return {
    ...labelOf(i),
    id: String(i.id),
    exception_id: exceptionId,
    pieces_affected: num(i.pieces_affected),
    weight_affected_kg: num(i.weight_affected_kg),
    condition: (str(i.condition) as ExceptionItem['condition']) ?? null,
    note: str(i.note),
    pieces_total: num(i.pieces_total),
    pieces_held: num(i.pieces_held),
    current_holder: (str(i.current_holder) as ExceptionItem['current_holder']) ?? null,
  }
}

/** A case as GET /cargo/exceptions lists it (the case page adds more, see mapExceptionDetail). */
export function mapException(raw: unknown): CargoException {
  const e = obj(raw) ?? {}
  const id = String(e.id)
  const owner = obj(e.owner)
  const vehicle = mapVehicle(e.vehicle)
    // An older answer carried only the plate
    ?? (str(e.vehicle_id) && str(e.plate_number) ? { id: String(e.vehicle_id), plate_number: String(e.plate_number) } : null)
  const { notes: _notes, sla: _sla, timeline: _t, transfers: _tr, claims: _c, sos_alert: _s, maintenance_job: _m, ...rest } = e
  return {
    ...(rest as unknown as CargoException),
    id,
    escalation_count: num(e.escalation_count) ?? 0,
    items: arr(e.items).map(i => mapExceptionItem(i, id)),
    vehicle,
    owner: owner && str(owner.id) ? { id: String(owner.id), full_name: str(owner.full_name) } : null,
  }
}

const CASE_KIND_TITLE: Record<string, string> = { opened: 'Case opened', resolved: 'Resolved', sos_raised: 'SOS raised', maintenance_opened: 'Moved to maintenance', maintenance_closed: 'Back in service' }

/**
 * The case page's merged timeline. The backend's `source: 'case'` entries are the case log:
 * `kind: 'note'` is a note, `'action'` an action, `'opened'` and `'resolved'` the case itself.
 */
export function mapCaseTimeline(raw: unknown): CaseTimelineEntry[] {
  return arr(raw).map((item, index) => {
    const t = obj(item) ?? {}
    const source = String(t.source ?? 'case')
    const kind = String(t.kind ?? '')
    const text = str(t.text)
    const data = obj(t.data)
    let entrySource: CaseTimelineEntry['source'] = source
    let title: string | null = null
    let note: string | null = text
    if (source === 'case') {
      entrySource = kind === 'note' ? 'note' : 'action'
      if (kind === 'note') title = 'Note'
      else if (kind === 'action') { title = text; note = null }
      else title = CASE_KIND_TITLE[kind] ?? null
    } else if (source === 'sos' || source === 'maintenance') {
      title = CASE_KIND_TITLE[kind] ?? null
    }
    // custody: the title comes from the kind (custodyKindLabel); the text is the plain-words line
    return {
      id: `${index}:${String(t.at ?? '')}:${source}:${kind}`,
      at: String(t.at ?? ''),
      source: entrySource,
      kind,
      title,
      note,
      actor_name: str(t.by_name),
      actor_role: str(t.role),
      ref: labelOf({ ref: t.ref }),
      pieces: num(data?.pieces),
      condition: str(data?.condition),
      transfer_id: str(data?.transfer_id),
    }
  })
}

export function mapTransferItem(raw: unknown, transferId: string): TransferItem {
  const i = obj(raw) ?? {}
  return {
    ...labelOf(i),
    id: String(i.id),
    transfer_id: transferId,
    pieces_planned: num(i.pieces_planned) ?? 0,
    pieces_out: num(i.pieces_out),
    pieces_in: num(i.pieces_in),
    condition_in: (str(i.condition_in) as TransferItem['condition_in']) ?? null,
  }
}

/** GET /cargo/transfers/:id (and each row of the list, and a case's transfers). */
export function mapTransfer(raw: unknown): CargoTransfer {
  const t = obj(raw) ?? {}
  const id = String(t.id)
  const depot = obj(t.to_depot)
  const exc = obj(t.exception)
  return {
    ...(t as unknown as CargoTransfer),
    id,
    eway_part_b_required: t.eway_part_b_required === true,
    items: arr(t.items).map(i => mapTransferItem(i, id)),
    from_vehicle: mapVehicle(t.from_vehicle),
    to_vehicle: mapVehicle(t.to_vehicle),
    to_depot: depot && str(depot.id)
      ? { id: String(depot.id), name: str(depot.name) ?? 'Hub', address: str(depot.address), latitude: num(depot.latitude), longitude: num(depot.longitude) }
      : null,
    exception: exc && str(exc.id) ? { id: String(exc.id), code: String(exc.code ?? ''), type: exc.type as CargoException['type'], status: exc.status as CargoException['status'] } : null,
  }
}

/** A claim (GET /cargo/claims, /cargo/claims/:id, PATCH answers). */
export function mapClaim(raw: unknown): CargoClaim {
  const c = obj(raw) ?? {}
  const label = labelOf(c)
  return {
    ...(c as unknown as CargoClaim),
    shipment_id: label.shipment_id,
    manifest_id: label.manifest_id,
    tracking_id: label.tracking_id,
    document_paths: arr(c.document_paths).filter((p): p is string => typeof p === 'string'),
    documents: arr(c.documents).map(d => {
      const doc = obj(d) ?? {}
      return { path: String(doc.path ?? ''), url: str(doc.url) }
    }),
  }
}

/** The short claims on a case page: no code of the goods is sent, so the link falls back to the ids. */
export function mapClaimSummary(raw: unknown): ClaimSummary {
  const c = obj(raw) ?? {}
  return { ...(c as unknown as ClaimSummary), ...labelOf({ ...c, status: null }), status: c.status as ClaimSummary['status'] }
}

/** GET /cargo/exceptions/:id */
export function mapExceptionDetail(raw: unknown): ExceptionDetail {
  const d = obj(raw) ?? {}
  const base = mapException(d)
  const vehicle = mapVehicle(d.vehicle)
  return {
    ...base,
    vehicle: vehicle ?? base.vehicle ?? null,
    timeline: mapCaseTimeline(d.timeline),
    transfers: arr(d.transfers).map(mapTransfer),
    claims: arr(d.claims).map(mapClaimSummary),
  }
}

export function mapRelief(raw: unknown): ReliefVehicle {
  const r = obj(raw) ?? {}
  const v = mapVehicle(r.vehicle)
  return {
    vehicle: { ...(v ?? { id: '', plate_number: '—' }), cargo_types: arr(obj(r.vehicle)?.cargo_types) as string[] },
    distance_km: num(r.distance_km) ?? 0,
    free_kg: num(r.free_kg) ?? 0,
    eta_minutes: num(r.eta_minutes),
    fits: r.fits !== false,
    cargo_match: r.cargo_match !== false,
  }
}

export function mapHub(raw: unknown): HubSummary {
  const h = obj(raw) ?? {}
  return {
    id: String(h.id),
    name: str(h.name) ?? 'Hub',
    address: str(h.address),
    latitude: num(h.latitude),
    longitude: num(h.longitude),
    consignments: num(h.consignments) ?? 0,
    pieces: num(h.pieces) ?? 0,
    weight_kg: num(h.weight_kg) ?? 0,
    oldest_since: str(h.oldest_since),
    oldest_age_hours: num(h.oldest_age_hours),
  }
}

export function mapHubInventoryRow(raw: unknown): HubInventoryRow {
  const r = obj(raw) ?? {}
  const leg = obj(r.next_leg)
  const label = leg ? str(leg.name) ?? str(leg.address) : null
  return {
    ...labelOf(r),
    pieces: num(r.pieces),
    pieces_total: num(r.pieces_total),
    weight_kg: num(r.weight_kg),
    since: str(r.since),
    age_hours: num(r.age_hours),
    rto: r.rto === true,
    on_hold_reason: str(r.on_hold_reason),
    next_leg: leg ? { label, address: str(leg.address) } : null,
    destination: leg ? str(leg.address) ?? label : null,
    open_exceptions: arr(r.open_exceptions).map(mapBrief),
  }
}

export function mapOnBoardItem(raw: unknown): OnBoardItem {
  const r = obj(raw) ?? {}
  const stop = obj(r.next_stop)
  return {
    ...labelOf(r),
    pieces_on_board: num(r.pieces_on_board) ?? 0,
    pieces_total: num(r.pieces_total),
    weight_kg: num(r.weight_kg),
    seal_number: str(r.seal_number),
    condition: (str(r.condition) as OnBoardItem['condition']) ?? null,
    rto: r.rto === true,
    on_hold_reason: str(r.on_hold_reason),
    next_stop: stop ? { name: str(stop.name), address: str(stop.address) } : null,
    open_exceptions: arr(r.open_exceptions).map(mapBrief),
  }
}

/** GET /cargo/vehicles/:id/on-board: `{ vehicle, totals, items }`. */
export function mapOnBoard(raw: unknown, vehicleId: string): OnBoard {
  const d = obj(raw) ?? {}
  return { vehicle_id: vehicleId, vehicle: mapVehicle(d.vehicle), items: listOf<unknown>(raw, 'items').map(mapOnBoardItem) }
}
