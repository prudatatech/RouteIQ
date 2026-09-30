/**
 * Pure rules for lots (docs/cargo-plan.md, "Lots: splitting one consignment across drops, trucks
 * and hubs"): sharing weight, value and freight by pieces with the rounding remainder on the last
 * lot, balancing a split, the even split, the split reasons the goods allow, merge eligibility and
 * the progress bar of a master. The master's rolled-up status and progress wording are the
 * backend's (the master row's status, `totals.progress_text`). No React here; covered by lots.test.ts.
 */
import type { Tone } from '@/components/ui/status'
import type { Lot, LotTotals, Pieces, SplitReason, WhereIsIt } from '@/services/cargo'

const n = (x: number) => x.toLocaleString('en-IN')
const pcs = (x: number) => `${n(x)} ${x === 1 ? 'piece' : 'pieces'}`

/** Weight splits must add up within ±0.5 kg, values within ±₹1 (the contract's rounding allowance). */
export const WEIGHT_TOLERANCE_KG = 0.5
export const VALUE_TOLERANCE = 1

// ── Rounding and sharing by pieces ─────────────────────────────────────────

export function roundTo(value: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round((value + Math.sign(value) * Number.EPSILON) * f) / f
}

/**
 * Shares `total` across rows in proportion to `weights` (their pieces), rounded to `decimals`.
 * The last row with a share takes the rounding remainder, so the parts always add up to the total.
 * Rows with no pieces get 0; with no pieces anywhere every row gets 0.
 */
export function allocateByPieces(total: number, weights: number[], decimals = 2): number[] {
  const safe = weights.map(w => (Number.isFinite(w) && w > 0 ? w : 0))
  const sum = safe.reduce((a, w) => a + w, 0)
  if (!(sum > 0) || !Number.isFinite(total)) return safe.map(() => 0)
  const last = safe.reduce((at, w, i) => (w > 0 ? i : at), -1)
  let given = 0
  return safe.map((w, i) => {
    if (w === 0) return 0
    if (i === last) return roundTo(total - given, decimals)
    const part = roundTo((total * w) / sum, decimals)
    given = roundTo(given + part, decimals)
    return part
  })
}

export interface FollowRow {
  pieces: number
  /** An amount the user typed for this row; null follows pieces. */
  override: number | null
}

export interface FollowResult {
  /** Each row's amount: its override, or its share of what is left by pieces. */
  amounts: number[]
  /** What the overrides add up to. */
  fixed: number
  /** Overrides add up to more than the total (beyond the tolerance). */
  over: boolean
  /** Left over with no row to take it (every row overridden); 0 when it was shared. */
  unassigned: number
  balanced: boolean
}

/**
 * Weight or value per row: typed amounts stay, the rest of the total is shared by pieces among the
 * rows that follow pieces. Balanced when everything is placed within the tolerance.
 */
export function followPieces(total: number, rows: FollowRow[], decimals = 2, tolerance = WEIGHT_TOLERANCE_KG): FollowResult {
  const fixed = roundTo(rows.reduce((a, r) => a + (r.override ?? 0), 0), decimals)
  const free = roundTo(total - fixed, decimals)
  const followers = rows.map(r => (r.override == null ? r.pieces : 0))
  const hasFollower = followers.some(p => p > 0)
  const shares = allocateByPieces(Math.max(0, free), followers, decimals)
  const over = free < -tolerance
  const unassigned = hasFollower ? 0 : free
  return {
    amounts: rows.map((r, i) => r.override ?? shares[i]),
    fixed,
    over,
    unassigned,
    balanced: !over && Math.abs(unassigned) <= tolerance,
  }
}

/** `total` pieces across `count` rows as evenly as whole pieces allow; the last row takes the remainder (100 / 3 → 33, 33, 34). */
export function evenSplit(total: number, count: number): number[] {
  if (count < 1 || !Number.isFinite(total) || total < 0) return []
  const base = Math.floor(total / count)
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? total - base * (count - 1) : base))
}

/** A typed whole number of pieces, or null when empty or not a whole number of 1 or more. */
export function parsePieces(raw: string | number | null | undefined): number | null {
  if (raw == null || String(raw).trim() === '') return null
  const v = Number(raw)
  return Number.isInteger(v) && v >= 1 ? v : null
}

/** A typed amount (kg or ₹): null when empty; NaN when not a number of 0 or more. */
export function parseAmount(raw: string | number | null | undefined): number | null {
  if (raw == null || String(raw).trim() === '') return null
  const v = Number(raw)
  return Number.isFinite(v) && v >= 0 ? v : Number.NaN
}

// ── Consignee fields ───────────────────────────────────────────────────────

/** An Indian phone number: 10 digits, optionally with +91 or a leading 0. */
export function phoneError(raw: string, required = false): string | undefined {
  const v = raw.replace(/[\s-]/g, '')
  if (!v) return required ? 'Enter the receiver’s phone number.' : undefined
  return /^(\+91|0)?[6-9]\d{9}$/.test(v) ? undefined : 'Enter a 10-digit mobile number.'
}

/** A GSTIN: 15 characters, the 2-digit state code first (the backend's check). Optional. */
export function gstinError(raw: string): string | undefined {
  const v = raw.trim().toUpperCase()
  if (!v) return undefined
  return /^[0-9]{2}[0-9A-Z]{13}$/.test(v) ? undefined : 'Enter a 15-character GSTIN, like 10ABCDE1234F1Z5.'
}

// ── Splitting a consignment ────────────────────────────────────────────────

/** What the goods being split have: undelivered pieces held, and their weight, value and freight (null when not known). */
export interface SplitAvailable {
  pieces: number
  /**
   * Pieces already delivered, short or returned, which stay on the consignment. With some, one lot
   * is enough (the remainder after a partial delivery going to another consignee).
   */
  accounted?: number
  weight_kg: number | null
  declared_value: number | null
  freight: number | null
}

export interface SplitRowInput {
  pieces: string
  /** Optional; empty follows pieces. */
  weight_kg: string
}

export interface SplitRowFigures {
  pieces: number | null
  weight_kg: number | null
  declared_value: number | null
  freight: number | null
  errors: { pieces?: string; weight_kg?: string }
}

export interface SplitBalance {
  rows: SplitRowFigures[]
  allocated: number
  /** What stays where it is, as its own lot (made automatically by the backend). */
  remainder: { pieces: number; weight_kg: number | null; declared_value: number | null; freight: number | null }
  /** How many lots there will be, the remainder lot included. */
  lots: number
  weightAllocated: number | null
  problems: string[]
  balanced: boolean
}

/**
 * Live totals of a split: the pieces, weight, value and freight of each new lot and of what stays
 * here. Only balanced splits can be sent: every row has pieces, the pieces and typed weights fit in
 * what is here, and the result is at least two lots.
 */
export function splitBalance(available: SplitAvailable, rows: SplitRowInput[]): SplitBalance {
  const problems: string[] = []
  const parsed = rows.map(r => {
    const errors: SplitRowFigures['errors'] = {}
    const pieces = parsePieces(r.pieces)
    if (pieces == null) errors.pieces = String(r.pieces).trim() ? 'Enter a whole number of 1 or more.' : 'Enter the pieces.'
    const weight = parseAmount(r.weight_kg)
    if (weight != null && Number.isNaN(weight)) errors.weight_kg = 'Enter a weight of 0 or more.'
    return { pieces, weight: weight != null && !Number.isNaN(weight) ? weight : null, errors }
  })
  const allocated = parsed.reduce((a, r) => a + (r.pieces ?? 0), 0)
  const remainderPieces = available.pieces - allocated
  if (rows.length === 0) problems.push('Add at least one new lot.')
  if (remainderPieces < 0) problems.push(`That is ${pcs(-remainderPieces)} more than the ${pcs(available.pieces)} here.`)
  const stay = Math.max(0, remainderPieces)
  const pieceWeights = [...parsed.map(r => r.pieces ?? 0), stay]
  const lots = parsed.filter(r => r.pieces != null).length + (stay > 0 ? 1 : 0)
  if (rows.length > 0 && remainderPieces >= 0 && lots < 2 && !(available.accounted ?? 0)) {
    problems.push(`A split makes at least two lots. Move fewer than all ${pcs(available.pieces)}, or add another lot.`)
  }

  let weights: number[] | null = null
  let weightAllocated: number | null = null
  if (available.weight_kg != null) {
    const follow = followPieces(available.weight_kg, [...parsed.map(r => ({ pieces: r.pieces ?? 0, override: r.weight })), { pieces: stay, override: null }], 2, WEIGHT_TOLERANCE_KG)
    weights = follow.amounts
    weightAllocated = roundTo(follow.amounts.slice(0, -1).reduce((a, w) => a + w, 0), 2)
    if (follow.over) problems.push(`The weights add up to ${n(follow.fixed)} kg, more than the ${n(available.weight_kg)} kg here.`)
    else if (!follow.balanced) problems.push(`The weights add up to ${n(follow.fixed)} kg; they must come to ${n(available.weight_kg)} kg.`)
  }
  const values = available.declared_value != null ? allocateByPieces(available.declared_value, pieceWeights, 0) : null
  const freights = available.freight != null ? allocateByPieces(available.freight, pieceWeights, 2) : null

  const figures: SplitRowFigures[] = parsed.map((r, i) => ({
    pieces: r.pieces,
    weight_kg: weights ? weights[i] : r.weight,
    declared_value: values ? values[i] : null,
    freight: freights ? freights[i] : null,
    errors: r.errors,
  }))
  const last = parsed.length
  const rowErrors = figures.some(f => Object.keys(f.errors).length > 0)
  return {
    rows: figures,
    allocated,
    remainder: {
      pieces: stay,
      weight_kg: weights ? weights[last] : null,
      declared_value: values ? values[last] : null,
      freight: freights ? freights[last] : null,
    },
    lots,
    weightAllocated,
    problems,
    balanced: !rowErrors && problems.length === 0,
  }
}

const TERMINAL = ['delivered', 'returned', 'lost', 'cancelled', 'completed']

/** Undelivered pieces the current holder has: what a split can divide. */
export function heldPieces(p: Pieces): number {
  if (p.on_board != null && p.on_board > 0) return p.on_board
  return Math.max(0, (p.total ?? 0) - p.delivered - p.short - p.returned)
}

/** Pieces already delivered, short or returned: a split leaves them on the consignment it splits. */
export const accountedPieces = (p: Pieces) => p.delivered + p.short + p.returned

/**
 * A consignment can be split when it is not a master, is still moving, its pieces are counted,
 * and its holder has at least two pieces, or one when some were already delivered (the remainder
 * after a partial delivery can go on as one lot).
 */
export function canSplit(w: Pick<WhereIsIt, 'status' | 'current_holder' | 'pieces'> & { is_master?: boolean }): boolean {
  if (w.is_master || TERMINAL.includes(w.status) || w.current_holder === 'consignee' || w.pieces.total == null) return false
  const held = heldPieces(w.pieces)
  return held >= 2 || (held >= 1 && accountedPieces(w.pieces) > 0)
}

/** The split_reason that fits where the goods are: cross-dock at a hub, the rest after a partial delivery, else a manual split. */
export function defaultSplitReason(w: Pick<WhereIsIt, 'status' | 'current_holder' | 'pieces'>): SplitReason {
  if (w.current_holder === 'hub') return 'hub_crossdock'
  if (w.pieces.delivered > 0) return 'partial_delivery_remainder'
  return 'manual'
}

/**
 * The split reasons the backend accepts for goods where they are: a partial transfer needs goods on
 * a vehicle, a cross-dock goods at a hub, a remainder some pieces delivered. A multi-drop split is
 * made when the shipment is booked, so it is not offered here.
 */
export function splitReasonsFor(w: Pick<WhereIsIt, 'current_holder' | 'pieces'>): SplitReason[] {
  const reasons: SplitReason[] = ['partial_transfer', 'hub_crossdock', 'partial_delivery_remainder', 'manual']
  return reasons.filter(r => {
    if (r === 'partial_transfer') return w.current_holder === 'vehicle'
    if (r === 'hub_crossdock') return w.current_holder === 'hub'
    if (r === 'partial_delivery_remainder') return w.pieces.delivered > 0
    return true
  })
}

// ── Partial transfer ───────────────────────────────────────────────────────

/** What a transfer of `pieces` out of `onBoard` does, in words. */
export function partialTransferNote(pieces: number | null, onBoard: number): { partial: boolean; text: string } {
  if (pieces == null || pieces >= onBoard) return { partial: false, text: `All ${pcs(onBoard)} on board move together.` }
  return { partial: true, text: `${n(pieces)} of ${n(onBoard)} will move as a new lot. ${n(onBoard - pieces)} stay on this vehicle as another lot.` }
}

// ── Where a lot is, and the rolled-up progress ─────────────────────────────

/** "Patna" → "Patna hub"; names that already say hub, depot or warehouse are kept. */
export function hubName(name: string): string {
  return /\b(hub|depot|warehouse|godown|dc)\b/i.test(name) ? name : `${name} hub`
}

/** Where a lot's goods are, as a short phrase: "on HR55AB1234", "at Patna hub", "with the sender". */
export function lotPlace(l: Pick<Lot, 'current_holder' | 'vehicle' | 'depot'>): { key: string; text: string } {
  if (l.current_holder === 'vehicle') return { key: `vehicle:${l.vehicle?.id ?? '?'}`, text: l.vehicle ? `on ${l.vehicle.plate_number}` : 'on a vehicle' }
  if (l.current_holder === 'hub') return { key: `hub:${l.depot?.id ?? '?'}`, text: l.depot ? `at ${hubName(l.depot.name)}` : 'at a hub' }
  if (l.current_holder === 'consignee') return { key: 'consignee', text: 'with the receiver' }
  return { key: 'consignor', text: 'with the sender' }
}

export interface ProgressSegment {
  key: string
  label: string
  value: number
  tone: Tone
}

/**
 * The stacked bar of a master's progress from the backend's totals: delivered, then what is on
 * vehicles, at hubs and with the sender, then returned and short. The words are the backend's
 * `progress_text`.
 */
export function progressSegments(t: Pick<LotTotals, 'delivered' | 'returned' | 'short' | 'by_holder'>): ProgressSegment[] {
  return [
    { key: 'delivered', label: 'Delivered', value: t.delivered, tone: 'success' as Tone },
    { key: 'vehicle', label: 'On vehicles', value: t.by_holder.vehicle, tone: 'info' as Tone },
    { key: 'hub', label: 'At hubs', value: t.by_holder.hub, tone: 'brand' as Tone },
    { key: 'consignor', label: 'With the sender', value: t.by_holder.consignor, tone: 'neutral' as Tone },
    { key: 'returned', label: 'Returned', value: t.returned, tone: 'neutral' as Tone },
    { key: 'short', label: 'Short or lost', value: t.short, tone: 'danger' as Tone },
  ].filter(s => s.value > 0)
}

// ── Merging ────────────────────────────────────────────────────────────────

export const lotKey = (l: Pick<Lot, 'shipment_id' | 'manifest_id'>) => l.shipment_id ?? l.manifest_id ?? ''

const consigneeKey = (l: Pick<Lot, 'consignee'>) => {
  const name = (l.consignee?.name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  const phone = (l.consignee?.phone ?? '').replace(/\D/g, '').slice(-10)
  return `${name}|${phone}`
}

const dropKey = (l: Pick<Lot, 'drop'>) => {
  if (!l.drop) return ''
  if (l.drop.lat != null && l.drop.lng != null) return `${l.drop.lat.toFixed(4)},${l.drop.lng.toFixed(4)}`
  return (l.drop.address ?? l.drop.name ?? '').trim().toLowerCase()
}

type MergeLot = Pick<Lot, 'shipment_id' | 'manifest_id' | 'label' | 'status' | 'current_holder' | 'vehicle' | 'depot' | 'consignee' | 'drop' | 'pieces'>

/**
 * Why a lot can never be merged in its state (null when it can): the backend refuses lots that are
 * settled or have delivered, short or returned pieces. Whether a lot moved since the split (a
 * custody event) or is on a transfer is only known to the backend, which answers 409.
 */
export function mergeBlock(l: MergeLot): string | null {
  if (l.status === 'delivered' || l.status === 'partially_delivered' || l.pieces.delivered > 0) return 'Already delivered'
  if (TERMINAL.includes(l.status) || l.pieces.short + l.pieces.returned > 0) return 'Finished'
  return null
}

/** Why lot `l` cannot be merged with lot `anchor` (null when it can). */
export function mergeMismatch(l: MergeLot, anchor: MergeLot): string | null {
  const place = lotPlace(l)
  const anchorPlace = lotPlace(anchor)
  if (place.key !== anchorPlace.key) return `It is ${place.text}, lot ${anchor.label ?? ''} is ${anchorPlace.text}`.replace(/\s+/g, ' ')
  if (l.status !== anchor.status) return `It is at a different stage from lot ${anchor.label ?? ''}`.replace(/\s+/g, ' ')
  if (consigneeKey(l) !== consigneeKey(anchor)) return 'It goes to a different consignee'
  if (dropKey(l) !== dropKey(anchor)) return 'It goes to a different drop'
  return null
}

export interface MergeCheck {
  ok: boolean
  /** Shown under the merge button when it is disabled. */
  reason: string | null
  /** Why each lot can't join the current selection (null when it can). */
  perLot: Record<string, string | null>
}

/**
 * Lots can be merged when they are of the same master (every lot in one view is), have the same
 * holder, place, consignee and drop, and none has left. The first chosen lot is the anchor.
 */
export function mergeCheck(lots: MergeLot[], selected: string[]): MergeCheck {
  const chosen = selected.map(k => lots.find(l => lotKey(l) === k)).filter((l): l is MergeLot => !!l)
  const anchor = chosen.find(l => !mergeBlock(l)) ?? null
  const perLot: Record<string, string | null> = {}
  for (const l of lots) {
    const block = mergeBlock(l)
    perLot[lotKey(l)] = block ?? (anchor && anchor !== l ? mergeMismatch(l, anchor) : null)
  }
  let reason: string | null = null
  const bad = chosen.find(l => perLot[lotKey(l)])
  if (bad) reason = `Lot ${bad.label ?? ''} can't be merged: ${perLot[lotKey(bad)]!.charAt(0).toLowerCase()}${perLot[lotKey(bad)]!.slice(1)}.`.replace(/\s+/g, ' ')
  else if (chosen.length < 2) reason = 'Choose at least two lots that are in the same place, for the same consignee and drop.'
  return { ok: !reason, reason, perLot }
}

// ── Lists: a master and its lots ───────────────────────────────────────────

export interface LotRowLike {
  id: string
  tracking_id?: string | null
  is_master?: boolean | null
  parent_shipment_id?: string | null
  parent_manifest_id?: string | null
  lot_seq?: number | null
}

/**
 * Groups a flat list into top-level rows with their lots: a lot sits under its master (in lot
 * order) when the master is in the list, and stands on its own otherwise.
 */
export function groupLots<T extends LotRowLike>(rows: T[]): { row: T; lots: T[] }[] {
  const ids = new Set(rows.map(r => r.id))
  const parentOf = (r: T) => r.parent_shipment_id ?? r.parent_manifest_id ?? null
  const lotsBy = new Map<string, T[]>()
  for (const r of rows) {
    const p = parentOf(r)
    if (p && ids.has(p)) lotsBy.set(p, [...(lotsBy.get(p) ?? []), r])
  }
  const order = (a: T, b: T) => (a.lot_seq ?? 0) - (b.lot_seq ?? 0) || (a.tracking_id ?? '').localeCompare(b.tracking_id ?? '', undefined, { numeric: true })
  return rows
    .filter(r => { const p = parentOf(r); return !p || !ids.has(p) })
    .map(row => ({ row, lots: (lotsBy.get(row.id) ?? []).sort(order) }))
}

/** A split master holds no goods, so it is never dispatched or assigned; its lots are. */
export const isMasterRow = (r: Pick<LotRowLike, 'is_master'>) => r.is_master === true

// ── Multi-drop booking ─────────────────────────────────────────────────────

export interface DropRowInput {
  pieces: string
  /** Empty follows pieces. */
  weight_kg: string
  /** Empty follows pieces. */
  declared_value: string
}

export interface DropFigures {
  pieces: number | null
  weight_kg: number
  declared_value: number | null
  /** The weight or value was typed rather than following pieces. */
  weightTyped: boolean
  valueTyped: boolean
  errors: { pieces?: string; weight_kg?: string; declared_value?: string }
}

export interface DropsBalance {
  rows: DropFigures[]
  allocated: number
  /** Pieces still to give to a drop (negative when over). */
  left: number
  problems: string[]
  balanced: boolean
}

/**
 * The pieces split of a multi-drop booking: the drops' pieces must add up to the total, and the
 * weight and value follow pieces unless typed for a drop (then the rest is shared by pieces).
 */
export function dropsBalance(totals: { pieces: number; weight_kg: number; declared_value: number | null }, rows: DropRowInput[]): DropsBalance {
  const problems: string[] = []
  const parsed = rows.map(r => {
    const errors: DropFigures['errors'] = {}
    const pieces = parsePieces(r.pieces)
    if (pieces == null) errors.pieces = String(r.pieces).trim() ? 'Enter a whole number of 1 or more.' : 'Enter the pieces.'
    const w = parseAmount(r.weight_kg)
    if (w != null && Number.isNaN(w)) errors.weight_kg = 'Enter a weight of 0 or more.'
    const v = parseAmount(r.declared_value)
    if (v != null && Number.isNaN(v)) errors.declared_value = 'Enter a value of 0 or more.'
    return { pieces, w: w != null && !Number.isNaN(w) ? w : null, v: v != null && !Number.isNaN(v) ? v : null, errors }
  })
  if (rows.length < 2) problems.push('Add at least two drops, or deliver to one destination.')
  const allocated = parsed.reduce((a, r) => a + (r.pieces ?? 0), 0)
  const left = totals.pieces - allocated
  if (left > 0) problems.push(`${pcs(left)} not given to a drop yet.`)
  if (left < 0) problems.push(`The drops have ${pcs(-left)} more than the ${pcs(totals.pieces)} booked.`)

  const weight = followPieces(totals.weight_kg, parsed.map(r => ({ pieces: r.pieces ?? 0, override: r.w })), 2, WEIGHT_TOLERANCE_KG)
  if (weight.over) problems.push(`The drop weights add up to ${n(weight.fixed)} kg, more than the ${n(totals.weight_kg)} kg booked.`)
  else if (!weight.balanced) problems.push(`The drop weights add up to ${n(weight.fixed)} kg; they must come to ${n(totals.weight_kg)} kg.`)

  let values: (number | null)[] = parsed.map(r => r.v)
  if (totals.declared_value != null) {
    const value = followPieces(totals.declared_value, parsed.map(r => ({ pieces: r.pieces ?? 0, override: r.v })), 0, VALUE_TOLERANCE)
    values = value.amounts
    if (value.over) problems.push(`The drop values add up to ₹${n(value.fixed)}, more than the ₹${n(totals.declared_value)} declared.`)
    else if (!value.balanced) problems.push(`The drop values add up to ₹${n(value.fixed)}; they must come to ₹${n(totals.declared_value)}.`)
  }

  const figures = parsed.map((r, i): DropFigures => ({
    pieces: r.pieces,
    weight_kg: weight.amounts[i],
    declared_value: values[i],
    weightTyped: r.w != null,
    valueTyped: r.v != null,
    errors: r.errors,
  }))
  const rowErrors = figures.some(f => Object.keys(f.errors).length > 0)
  return { rows: figures, allocated, left, problems, balanced: !rowErrors && problems.length === 0 }
}
