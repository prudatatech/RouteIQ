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
 * - claims carry `consignment_code`; hub and on-board rows carry `next_leg` / `next_stop` by name and address;
 * - lots (docs/cargo-plan.md "Lots") carry `label` and embedded `vehicle`, `depot`, `drop`, `consignee`;
 *   a lot's code is the master's with a suffix (`RTX-ABC123-B`, a lot of a lot `RTX-ABC123-A3`),
 *   which also gives its label on rows that carry only the code.
 */
import type {
  CargoClaim, CargoException, CargoTransfer, CargoVehicle, CaseTimelineEntry, ClaimSummary, ConsignmentLabel, CustodyEvent, ExceptionDetail,
  ExceptionItem, HubInventoryRow, HubSummary, Lot, LotTotals, LotsView, MergeResult, OnBoard, OnBoardItem, Pieces, ReliefVehicle,
  ShipmentDropInput, SplitLot, SplitResult, TransferItem, TransferSplit, WhereIsIt,
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
 * A lot code: the master's code and the lot label, which is letters and, for a lot of a lot, a
 * number (`RTX-ABC123-B`, `RTX-ABC123-A3`). The backend labels a master's lots A … Z and a lot's
 * lots with its letter and the next free number, so a label is never nested (`A1.1`).
 */
const LOT_CODE = /^((?:RTX|CM)-[A-Z0-9]+)-([A-Z]{1,2}[0-9]*)$/i

/**
 * The lot label in a lot code: `RTX-ABC123-B` → `B`, `CM-AA110000-A3` → `A3`. Null for a
 * master or an unsplit consignment (`RTX-ABC123`).
 */
export function lotLabelFromCode(code: string | null | undefined): string | null {
  const m = typeof code === 'string' ? LOT_CODE.exec(code.trim()) : null
  return m ? m[2].toUpperCase() : null
}

/** The master's code of a lot code: `RTX-ABC123-B` → `RTX-ABC123`. Null when it is not a lot code. */
export function masterCodeOf(code: string | null | undefined): string | null {
  const m = typeof code === 'string' ? LOT_CODE.exec(code.trim()) : null
  return m ? m[1] : null
}

/**
 * `{ ref: { shipment_id } | { manifest_id }, code, status }` (or flat ids, or `consignment_code`)
 * as the flat identity the screens show and link. A lot also gets its label.
 */
export function labelOf(row: unknown): ConsignmentLabel {
  const r = obj(row) ?? {}
  const ref = obj(r.ref)
  const shipmentId = str(ref?.shipment_id) ?? str(r.shipment_id)
  const manifestId = str(ref?.manifest_id) ?? str(r.manifest_id)
  // `code` names the goods only next to a `ref`; on a claim row it is the claim's own CLM- code
  const trackingId = str(r.consignment_code) ?? str(r.tracking_id) ?? (ref ? str(r.code) : null)
  const lotLabel = str(r.lot_label) ?? lotLabelFromCode(trackingId)
  return {
    shipment_id: shipmentId,
    manifest_id: manifestId,
    tracking_id: trackingId,
    status: str(r.status),
    ...(lotLabel ? { lot_label: lotLabel } : {}),
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
  const lot = obj(w.lot)
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
    is_master: w.is_master === true,
    lot_label: str(w.lot_label) ?? str(lot?.label),
    lot_seq: num(lot?.seq),
    master: obj(w.master) ? labelOf(w.master) : lot && obj(lot.master) ? labelOf(lot.master) : null,
    eway_bill_ref: str(w.eway_bill_ref),
    eway_part_b_required: w.eway_part_b_required === true,
    lots: arr(w.lots).map(mapLot),
    totals: obj(w.totals) ? mapLotTotals(w.totals) : null,
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
  const lot = obj(e.lot)
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
    lot: lot ? { ...labelOf(lot), label: str(lot.label) } : null,
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
    splits: arr(t.splits).map(mapTransferSplit),
  }
}

const mapSplitLot = (raw: unknown): SplitLot => {
  const l = obj(raw) ?? {}
  return { ...labelOf(l), label: str(l.label), pieces: num(l.pieces) }
}

/** One split of the POST /cargo/transfers answer: `{ from: {ref, code}, moving: {ref, code, label, pieces}, staying }`. */
function mapTransferSplit(raw: unknown): TransferSplit {
  const s = obj(raw) ?? {}
  return { from: labelOf(s.from), moving: mapSplitLot(s.moving), staying: mapSplitLot(s.staying) }
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
  const lot = obj(r.lot)
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
    lot: lot && str(lot.label) ? { label: String(lot.label), master: labelOf(lot.master) } : null,
    consignee_name: str(r.consignee_name),
    display: str(r.display),
  }
}

/** GET /cargo/vehicles/:id/on-board: `{ vehicle, totals, items }`. */
export function mapOnBoard(raw: unknown, vehicleId: string): OnBoard {
  const d = obj(raw) ?? {}
  return { vehicle_id: vehicleId, vehicle: mapVehicle(d.vehicle), items: listOf<unknown>(raw, 'items').map(mapOnBoardItem) }
}

// ── Lots ───────────────────────────────────────────────────────────────────

/** One LotView (GET /cargo/lots/:ref, a master's `where.lots`, POST /cargo/lots/eway). */
export function mapLot(raw: unknown): Lot {
  const l = obj(raw) ?? {}
  const vehicle = obj(l.vehicle)
  const depot = obj(l.depot)
  const drop = obj(l.drop)
  const consignee = obj(l.consignee)
  const label = str(l.label)
  return {
    ...labelOf(l),
    label,
    lot_label: label,
    seq: num(l.seq),
    status: String(l.status ?? ''),
    current_holder: (str(l.current_holder) ?? 'consignor') as Lot['current_holder'],
    vehicle: vehicle && str(vehicle.id) ? { id: String(vehicle.id), plate_number: str(vehicle.plate_number) ?? '—' } : null,
    depot: depot && str(depot.id) ? { id: String(depot.id), name: str(depot.name) ?? 'Hub' } : null,
    pieces: mapPieces(l.pieces),
    weight_kg: num(l.weight_kg) ?? 0,
    declared_value: num(l.declared_value),
    freight_share: num(l.freight_share),
    drop: drop ? { name: str(drop.name), address: str(drop.address), lat: num(drop.lat), lng: num(drop.lng) } : null,
    consignee: consignee ? { name: str(consignee.name), phone: str(consignee.phone), gstin: str(consignee.gstin) } : null,
    eway_bill_ref: str(l.eway_bill_ref),
    eway_part_b_required: l.eway_part_b_required === true,
    split_reason: (str(l.split_reason) as Lot['split_reason']) ?? null,
    open_exceptions: arr(l.open_exceptions).map(mapBrief),
  }
}

/** The backend's LotTotals: a master's pieces added up across its lots, with its progress line. */
export function mapLotTotals(raw: unknown): LotTotals {
  const t = obj(raw) ?? {}
  const by = obj(t.by_holder) ?? {}
  return {
    pieces: mapPieces(t.pieces),
    lots: num(t.lots) ?? 0,
    pieces_total: num(t.pieces_total),
    delivered: num(t.delivered) ?? 0,
    damaged: num(t.damaged) ?? 0,
    short: num(t.short) ?? 0,
    returned: num(t.returned) ?? 0,
    held: num(t.held) ?? 0,
    by_holder: { consignor: num(by.consignor) ?? 0, vehicle: num(by.vehicle) ?? 0, hub: num(by.hub) ?? 0 },
    weight_kg: num(t.weight_kg) ?? 0,
    progress_text: str(t.progress_text) ?? '',
  }
}

/** GET /cargo/lots/:ref → `{ master, lots, totals }`, lots in the backend's order (by lot number). */
export function mapLots(raw: unknown): LotsView {
  const d = obj(raw) ?? {}
  const m = obj(d.master) ?? {}
  return {
    master: {
      ...labelOf(m),
      is_master: m.is_master === true,
      status: String(m.status ?? ''),
      current_holder: (str(m.current_holder) ?? 'consignor') as LotsView['master']['current_holder'],
      pieces: mapPieces(m.pieces),
      weight_kg: num(m.weight_kg) ?? 0,
      declared_value: num(m.declared_value),
      freight_share: num(m.freight_share),
      freight_charge: num(m.freight_charge),
    },
    lots: arr(d.lots).map(mapLot),
    totals: mapLotTotals(d.totals),
  }
}

/**
 * POST /cargo/lots/split → `{ master: {ref, code}, source: {ref, code}, lots: [{ ref, code, label,
 * pieces, weight_kg, declared_value, freight_share, status, transfer }] }`.
 */
export function mapSplitResult(raw: unknown): SplitResult {
  const d = obj(raw) ?? {}
  return {
    master: labelOf(d.master),
    source: labelOf(d.source),
    lots: arr(d.lots).map(x => {
      const l = obj(x) ?? {}
      const transfer = obj(l.transfer)
      return {
        ...labelOf(l),
        label: str(l.label),
        pieces: num(l.pieces),
        weight_kg: num(l.weight_kg),
        declared_value: num(l.declared_value),
        freight_share: num(l.freight_share),
        transfer: transfer && str(transfer.id) ? { id: String(transfer.id), code: String(transfer.code ?? '') } : null,
      }
    }),
  }
}

/** POST /cargo/lots/merge → `{ ref, code, label, pieces }`: the lot the others were merged into. */
export function mapMergeResult(raw: unknown): MergeResult {
  const d = obj(raw) ?? {}
  return { ...labelOf(d), label: str(d.label), pieces: num(d.pieces) }
}

/** The multi-drop form's rows as POST /shipments `drops[]`; optional fields are left out when empty. */
export function toShipmentDrops(rows: {
  name?: string | null; address: string; lat: number; lng: number; consignee_name: string; consignee_phone?: string | null
  consignee_gstin?: string | null; pieces: number; weight_kg?: number | null; declared_value?: number | null; eway_bill_ref?: string | null
}[]): ShipmentDropInput[] {
  return rows.map(r => ({
    ...(r.name?.trim() ? { name: r.name.trim() } : {}),
    address: r.address,
    lat: r.lat,
    lng: r.lng,
    consignee_name: r.consignee_name.trim(),
    ...(r.consignee_phone?.trim() ? { consignee_phone: r.consignee_phone.trim() } : {}),
    ...(r.consignee_gstin?.trim() ? { consignee_gstin: r.consignee_gstin.trim().toUpperCase() } : {}),
    pieces: r.pieces,
    ...(r.weight_kg != null ? { weight_kg: r.weight_kg } : {}),
    ...(r.declared_value != null ? { declared_value: r.declared_value } : {}),
    ...(r.eway_bill_ref?.trim() ? { eway_bill_ref: r.eway_bill_ref.trim() } : {}),
  }))
}
