/**
 * Pure rules for the cargo screens: labels, SLA countdown, which actions a case or a
 * consignment allows in its current state, piece arithmetic and ageing. No React here,
 * so everything is covered by logic.test.ts.
 */
import { statusToLabel, type Tone } from '@/components/ui/status'
import { manifestTrackingId } from '@/components/shipments/format'
import type {
  CargoException, CargoRef, ClaimStatus, ClaimType, ConditionCode, ConsignmentLabel, CustodyKind, ExceptionActionName, ExceptionAction,
  ExceptionStatus, ExceptionType, Holder, Pieces, Resolution, Severity, TransferItem, TransferStatus, WhereIsIt,
} from '@/services/cargo'

// ── Labels ─────────────────────────────────────────────────────────────────

export const EXCEPTION_TYPE_LABELS: Record<ExceptionType, string> = {
  vehicle_accident: 'Vehicle accident',
  vehicle_breakdown: 'Vehicle breakdown',
  damage: 'Damage',
  shortage: 'Shortage',
  excess: 'Excess',
  theft: 'Theft',
  refused: 'Refused by receiver',
  undeliverable: 'Could not deliver',
  delay: 'Delay',
  seal_tamper: 'Seal tampered',
  weather: 'Weather',
  other: 'Other',
}

export const CONDITION_LABELS: Record<ConditionCode, string> = {
  good: 'Good',
  damaged_packaging: 'Packaging damaged',
  damaged_goods: 'Goods damaged',
  wet: 'Wet',
  seal_tampered: 'Seal tampered',
  shortage: 'Short',
  excess: 'Excess',
}

export const CONDITION_TONES: Record<ConditionCode, Tone> = {
  good: 'success',
  damaged_packaging: 'warning',
  damaged_goods: 'danger',
  wet: 'warning',
  seal_tampered: 'danger',
  shortage: 'danger',
  excess: 'warning',
}

export const HOLDER_LABELS: Record<Holder, string> = {
  consignor: 'With the sender',
  vehicle: 'On a vehicle',
  hub: 'At a hub',
  consignee: 'With the receiver',
}

export const RESOLUTION_LABELS: Record<Resolution, string> = {
  transshipped: 'Moved to another vehicle',
  repaired_continue: 'Repaired, continued',
  moved_to_hub: 'Moved to a hub',
  returned: 'Returned to sender',
  delivered_with_remarks: 'Delivered with remarks',
  redelivered: 'Delivered on a new attempt',
  written_off: 'Written off',
  claim_settled: 'Claim settled',
  no_action: 'No action needed',
}

export const CLAIM_TYPE_LABELS: Record<ClaimType, string> = {
  damage: 'Damage',
  shortage: 'Shortage',
  loss: 'Loss',
  theft: 'Theft',
  delay: 'Delay',
}

export const SEVERITY_LABELS: Record<Severity, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' }
export const SEVERITY_TONES: Record<Severity, Tone> = { low: 'neutral', medium: 'info', high: 'warning', critical: 'danger' }

export const EXCEPTION_SOURCE_LABELS: Record<string, string> = {
  sos: 'SOS',
  maintenance: 'Maintenance',
  stop_failed: 'Failed stop',
  custody: 'Handover check',
  eta: 'Running late',
  manual: 'Raised by staff',
  driver: 'Raised by the driver',
}

const CUSTODY_LABELS: Record<CustodyKind, string> = {
  booked: 'Booked',
  accepted: 'Driver accepted the job',
  arrived_pickup: 'Arrived at pickup',
  pickup: 'Picked up',
  departed: 'Left pickup',
  arrived_drop: 'Arrived at drop',
  delivery: 'Delivered',
  partial_delivery: 'Partly delivered',
  refused: 'Refused by receiver',
  undelivered: 'Not delivered',
  handover_out: 'Handed over',
  handover_in: 'Received in handover',
  hub_in: 'Arrived at hub',
  hub_out: 'Left hub',
  return_pickup: 'Picked up for return',
  return_delivery: 'Returned to sender',
  inspection: 'Inspected',
  hold: 'Put on hold',
  release_hold: 'Hold released',
  lost: 'Marked lost',
  split: statusToLabel('split', 'custody'),
  merge: statusToLabel('merge', 'custody'),
}

/** "vehicle_breakdown" → "Vehicle breakdown"; unknown values are humanised. */
function lookup(map: Record<string, string>, value: string | null | undefined): string {
  if (!value) return '—'
  if (map[value]) return map[value]
  const text = value.replace(/[_-]+/g, ' ').trim().toLowerCase()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export const exceptionTypeLabel = (t: string | null | undefined) => lookup(EXCEPTION_TYPE_LABELS, t)
export const conditionLabel = (c: string | null | undefined) => lookup(CONDITION_LABELS, c)
export const holderLabel = (h: string | null | undefined) => lookup(HOLDER_LABELS, h)
export const resolutionLabel = (r: string | null | undefined) => lookup(RESOLUTION_LABELS, r)
export const claimTypeLabel = (t: string | null | undefined) => lookup(CLAIM_TYPE_LABELS, t)
export const custodyKindLabel = (k: string | null | undefined) => lookup(CUSTODY_LABELS, k)
export const sourceLabel = (s: string | null | undefined) => lookup(EXCEPTION_SOURCE_LABELS, s)

// ── Consignment identity ───────────────────────────────────────────────────

/** RTX-… or CM-…, or a short id when the row carries nothing better. */
export function consignmentCode(c: ConsignmentLabel): string {
  if (c.tracking_id) return c.tracking_id
  if (c.manifest_id) return manifestTrackingId(c.manifest_id)
  if (c.shipment_id) return c.shipment_id.slice(0, 8).toUpperCase()
  return '—'
}

export function refOf(c: ConsignmentLabel): CargoRef | null {
  if (c.shipment_id) return { shipment_id: c.shipment_id }
  if (c.manifest_id) return { manifest_id: c.manifest_id }
  return null
}

/** The ref of a row from the shipments list, where vendor loads carry a CM- tracking id and their manifest id. */
export function refOfShipmentRow(row: { id: string; tracking_id: string }): CargoRef {
  return row.tracking_id.startsWith('CM-') ? { manifest_id: row.id } : { shipment_id: row.id }
}

/** Where a consignment's page is: /shipments/:id, for a shipment or a vendor load. */
export function consignmentHref(c: ConsignmentLabel): string | null {
  const id = c.shipment_id ?? c.manifest_id
  return id ? `/shipments/${encodeURIComponent(id)}` : null
}

// ── SLA ────────────────────────────────────────────────────────────────────

/** Hours to act on a case, by severity (the backend sets `sla_due_at` from these). */
export const SLA_HOURS: Record<Severity, number> = { critical: 1, high: 4, medium: 24, low: 72 }
/** Under this much time left the countdown turns amber. */
export const SLA_SOON_MS = 60 * 60 * 1000

const OPEN_STATUSES: readonly ExceptionStatus[] = ['open', 'investigating', 'action_planned']
export const isOpenException = (status: string | null | undefined) => OPEN_STATUSES.includes(status as ExceptionStatus)

/** "2 d 3 h", "3 h 12 min", "45 min", "under 1 min". */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(Math.abs(ms) / 60_000)
  if (minutes < 1) return 'under 1 min'
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  if (d > 0) return h > 0 ? `${d} d ${h} h` : `${d} d`
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`
  return `${m} min`
}

export interface SlaState {
  state: 'none' | 'ok' | 'soon' | 'overdue' | 'stopped'
  /** Negative once overdue. Null without a deadline or once the case is closed. */
  msLeft: number | null
  label: string
  tone: Tone
}

/** The countdown for a case: time left, or how long it has been overdue. Stops once resolved or closed. */
export function slaState(dueAt: string | null | undefined, status: string | null | undefined, now: number): SlaState {
  if (!isOpenException(status)) return { state: 'stopped', msLeft: null, label: status === 'resolved' ? 'Resolved' : 'Closed', tone: 'neutral' }
  const due = dueAt ? new Date(dueAt).getTime() : NaN
  if (Number.isNaN(due)) return { state: 'none', msLeft: null, label: 'No deadline', tone: 'neutral' }
  const msLeft = due - now
  if (msLeft < 0) return { state: 'overdue', msLeft, label: `Overdue by ${formatDuration(msLeft)}`, tone: 'danger' }
  if (msLeft < SLA_SOON_MS) return { state: 'soon', msLeft, label: `${formatDuration(msLeft)} left`, tone: 'warning' }
  return { state: 'ok', msLeft, label: `${formatDuration(msLeft)} left`, tone: 'success' }
}

/** Queue order: overdue first (most overdue on top), then the nearest deadline, then no deadline, closed last. */
export function compareBySla(a: Pick<CargoException, 'sla_due_at' | 'status' | 'created_at'>, b: Pick<CargoException, 'sla_due_at' | 'status' | 'created_at'>): number {
  const rank = (e: Pick<CargoException, 'sla_due_at' | 'status'>) => (!isOpenException(e.status) ? 2 : e.sla_due_at ? 0 : 1)
  const ra = rank(a)
  const rb = rank(b)
  if (ra !== rb) return ra - rb
  if (ra === 0) return new Date(a.sla_due_at!).getTime() - new Date(b.sla_due_at!).getTime()
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
}

// ── Case actions ───────────────────────────────────────────────────────────

/** Actions shown in the guided panel, in this order. assign_owner and set_status live in the header. */
export const PANEL_ACTIONS = [
  'transship', 'move_to_hub', 'wait_for_repair', 'continue_after_repair', 'return_to_origin', 'reattempt',
  'deliver_with_remarks', 'write_off', 'raise_claim', 'resolve', 'add_note',
] as const satisfies readonly ExceptionActionName[]
export type PanelAction = (typeof PANEL_ACTIONS)[number]

export const ACTION_META: Record<PanelAction, { label: string; description: string; tone?: 'danger' }> = {
  transship: { label: 'Plan a transfer to a vehicle', description: 'Plan a handover of the goods to a relief vehicle.' },
  move_to_hub: { label: 'Move to hub', description: 'Take the goods to a depot and hold them there.' },
  wait_for_repair: { label: 'Wait for repair', description: 'Keep the goods on the vehicle until it is fixed.' },
  continue_after_repair: { label: 'Continue after repair', description: 'Release the hold and carry on with the same vehicle.' },
  return_to_origin: { label: 'Return to origin', description: 'Send the goods back to the sender.' },
  reattempt: { label: 'Re-attempt delivery', description: 'Schedule another delivery attempt.' },
  deliver_with_remarks: { label: 'Deliver with remarks', description: 'Deliver and note the problem on the proof of delivery.' },
  write_off: { label: 'Write off', description: 'Mark pieces as lost or damaged beyond use.', tone: 'danger' },
  raise_claim: { label: 'Raise claim', description: 'Open an insurance or carrier claim for the loss.' },
  resolve: { label: 'Resolve', description: 'Close the case with its outcome.' },
  add_note: { label: 'Add note', description: 'Record what was found or agreed.' },
}

const VEHICLE_TYPES: readonly ExceptionType[] = ['vehicle_accident', 'vehicle_breakdown']
const REATTEMPT_TYPES: readonly ExceptionType[] = ['refused', 'undeliverable', 'delay']
const DELIVER_TYPES: readonly ExceptionType[] = ['damage', 'shortage', 'excess', 'seal_tamper', 'refused', 'delay', 'weather', 'other']
const LOSS_TYPES: readonly ExceptionType[] = ['damage', 'shortage', 'theft', 'vehicle_accident', 'seal_tamper', 'weather', 'other']
const CLAIM_TYPES_FOR: readonly ExceptionType[] = ['damage', 'shortage', 'theft', 'vehicle_accident', 'seal_tamper', 'delay', 'weather', 'other']

/** Part B of the e-way bill is due: the goods changed vehicle and the new reference is not saved yet. Not on a cancelled transfer. */
export const partBDue = (t: { status: string; eway_part_b_required?: boolean | null; eway_part_b_ref?: string | null }) =>
  !!t.eway_part_b_required && !t.eway_part_b_ref && t.status !== 'cancelled'

/** A transfer that is still moving the goods blocks every other plan for them. */
export const isActiveTransfer = (status: TransferStatus | string) => status === 'planned' || status === 'in_progress'

/**
 * The guided actions valid for a case right now. A closed case only takes notes; a resolved
 * one can still get a claim. While a transfer is planned or under way, the goods cannot be
 * given another plan until it completes or is cancelled.
 */
export function exceptionActions(
  e: Pick<CargoException, 'status' | 'type' | 'vehicle_id' | 'items'>,
  opts: { activeTransfer?: boolean } = {},
): PanelAction[] {
  const hasItems = (e.items?.length ?? 0) > 0
  if (e.status === 'resolved') return hasItems && CLAIM_TYPES_FOR.includes(e.type) ? ['raise_claim', 'add_note'] : ['add_note']
  if (!isOpenException(e.status)) return ['add_note']

  const moving = !!opts.activeTransfer
  const onVehicle = !!e.vehicle_id
  const vehicleCase = VEHICLE_TYPES.includes(e.type)
  const out: PanelAction[] = []
  if (hasItems && onVehicle && !moving) out.push('transship', 'move_to_hub')
  if (vehicleCase && onVehicle && !moving) out.push('wait_for_repair', 'continue_after_repair')
  if (hasItems && !moving) out.push('return_to_origin')
  if (hasItems && !moving && REATTEMPT_TYPES.includes(e.type)) out.push('reattempt')
  if (hasItems && !moving && DELIVER_TYPES.includes(e.type)) out.push('deliver_with_remarks')
  if (hasItems && LOSS_TYPES.includes(e.type)) out.push('write_off')
  if (hasItems && CLAIM_TYPES_FOR.includes(e.type)) out.push('raise_claim')
  out.push('resolve', 'add_note')
  return out
}

/** The status moves offered in the case header. */
export function statusMoves(status: ExceptionStatus): ExceptionStatus[] {
  if (status === 'open') return ['investigating', 'closed']
  if (status === 'investigating') return ['action_planned', 'closed']
  if (status === 'action_planned') return ['investigating', 'closed']
  return []
}

/** Values typed into an action form; every field arrives as text. */
export type ActionValues = Record<string, string>

/** Checks one action form. Returns field → message; empty when it can be sent. */
export function validateAction(action: PanelAction, v: ActionValues, ctx: { maxPieces?: number; now?: number; needsRef?: boolean } = {}): Record<string, string> {
  const errors: Record<string, string> = {}
  const text = (k: string) => (v[k] ?? '').trim()
  const future = (k: string, message: string) => {
    const at = new Date(text(k)).getTime()
    if (!text(k)) errors[k] = message
    else if (Number.isNaN(at)) errors[k] = 'Enter a valid date and time.'
    else if (at < (ctx.now ?? Date.now()) - 60_000) errors[k] = 'Pick a time in the future.'
  }
  switch (action) {
    case 'transship':
      if (!text('to_vehicle_id')) errors.to_vehicle_id = 'Choose the relief vehicle.'
      if (!text('meet_address')) errors.meet_address = 'Say where the vehicles meet.'
      break
    case 'move_to_hub':
      if (!text('depot_id')) errors.depot_id = 'Choose the hub.'
      break
    case 'wait_for_repair':
      future('expected_at', 'Say when the repair should be done.')
      break
    case 'reattempt':
      future('scheduled_for', 'Say when to try again.')
      break
    case 'deliver_with_remarks':
      if (!text('receiver_name')) errors.receiver_name = 'Enter who received the goods.'
      // The remarks are the logged reason that stands in for a photo when staff record the delivery
      if (!text('note')) errors.note = 'Write the remarks for the proof of delivery.'
      else if (text('note').length < 3) errors.note = 'Write at least a few words.'
      break
    case 'write_off': {
      if (ctx.needsRef && !text('ref')) errors.ref = 'Choose the shipment.'
      const n = Number(text('pieces'))
      if (!text('pieces')) errors.pieces = 'Enter how many pieces.'
      else if (!Number.isInteger(n) || n < 1) errors.pieces = 'Enter a whole number of 1 or more.'
      else if (ctx.maxPieces !== undefined && n > ctx.maxPieces) errors.pieces = `The case covers ${ctx.maxPieces.toLocaleString('en-IN')} pieces at most.`
      if (!text('note')) errors.note = 'Say why the pieces are written off.'
      break
    }
    case 'raise_claim': {
      const amount = Number(text('claimed_amount'))
      if (!text('claim_type')) errors.claim_type = 'Choose the kind of claim.'
      if (!text('claimed_amount')) errors.claimed_amount = 'Enter the amount claimed.'
      else if (!Number.isFinite(amount) || amount <= 0) errors.claimed_amount = 'Enter an amount above ₹0.'
      break
    }
    case 'resolve':
      if (!text('resolution')) errors.resolution = 'Choose the outcome.'
      if (!text('note')) errors.note = 'Add a short note on how it was settled.'
      break
    case 'add_note':
      if (!text('note')) errors.note = 'Write the note.'
      break
    default:
      break
  }
  return errors
}

/** `shipment:<id>` / `manifest:<id>`, the value a consignment picker in an action form uses. */
export const refKey = (c: ConsignmentLabel) => (c.shipment_id ? `shipment:${c.shipment_id}` : c.manifest_id ? `manifest:${c.manifest_id}` : '')
function refFromKey(key: string): CargoRef | undefined {
  const [kind, id] = key.split(':')
  if (!id) return undefined
  return kind === 'manifest' ? { manifest_id: id } : { shipment_id: id }
}

/** Turns a checked form into the request body for POST /cargo/exceptions/:id/actions. */
export function buildAction(action: PanelAction, v: ActionValues): ExceptionAction {
  const text = (k: string) => (v[k] ?? '').trim()
  const iso = (k: string) => new Date(text(k)).toISOString()
  const ref = refFromKey(text('ref'))
  switch (action) {
    case 'transship': {
      const lat = Number(text('meet_lat'))
      const lng = Number(text('meet_lng'))
      const hasPoint = text('meet_lat') !== '' && text('meet_lng') !== '' && Number.isFinite(lat) && Number.isFinite(lng)
      return { action, to_vehicle_id: text('to_vehicle_id'), meet_address: text('meet_address'), ...(hasPoint ? { meet_lat: lat, meet_lng: lng } : {}) }
    }
    case 'move_to_hub': return { action, depot_id: text('depot_id') }
    case 'wait_for_repair': return { action, expected_at: iso('expected_at') }
    case 'continue_after_repair': return { action }
    case 'return_to_origin': return { action }
    case 'reattempt': return { action, scheduled_for: iso('scheduled_for') }
    case 'deliver_with_remarks': {
      const damaged = Number(text('pieces_damaged'))
      return {
        action,
        receiver_name: text('receiver_name'),
        note: text('note'),
        ...(text('condition') ? { condition: text('condition') as ConditionCode } : {}),
        ...(text('pieces_damaged') && Number.isInteger(damaged) && damaged > 0 ? { pieces_damaged: damaged } : {}),
        ...(text('otp') ? { otp: text('otp') } : {}),
      }
    }
    case 'write_off': return { action, pieces: Number(text('pieces')), note: text('note'), ...(ref ? { ref } : {}) }
    case 'raise_claim': return { action, claim_type: text('claim_type') as ClaimType, claimed_amount: Number(text('claimed_amount')), ...(ref ? { ref } : {}) }
    case 'resolve': return { action, resolution: text('resolution') as Resolution, note: text('note') }
    case 'add_note': return { action, note: text('note') }
  }
}

// ── Consignment actions (shipment drawer, vendor loads) ────────────────────

const TERMINAL_SHIPMENT = ['delivered', 'returned', 'lost', 'cancelled']
const HUB_IN_FROM = ['picked_up', 'in_transit', 'out_for_delivery', 'returning', 'on_hold', 'exception']
const NOT_YET_MOVING = ['created', 'assigned', 'scheduled']
/** Statuses a pickup is recorded from (a vendor load's `scheduled` is created or assigned). */
const PICKUP_FROM = ['created', 'assigned', 'scheduled', 'on_hold', 'exception']
/** Statuses a delivery is recorded from (a vendor load on the road is `in_transit`). */
const DELIVER_FROM = ['picked_up', 'in_transit', 'out_for_delivery', 'exception', 'partially_delivered']

export interface ConsignmentActions {
  /** Record the pickup (custody `pickup`, counted) on the planned vehicle. */
  pickup: boolean
  /** The goods leave the pickup: custody `departed`, picked up → in transit. */
  depart: boolean
  /** Record a full delivery (custody `delivery`) with the receiver and proof. */
  deliver: boolean
  raiseException: boolean
  moveToVehicle: boolean
  hold: boolean
  release: boolean
  /** The open refused / undeliverable case a re-attempt is scheduled on, if any. */
  reattemptOn: string | null
  startReturn: boolean
  hubIn: boolean
  hubOut: boolean
  sendOtp: boolean
}

/** What staff can do with a consignment, from where it is now. */
export function consignmentActions(
  w: Pick<WhereIsIt, 'status' | 'current_holder' | 'vehicle' | 'pieces' | 'open_exceptions' | 'delivery_otp_required' | 'rto'> & { is_master?: boolean },
): ConsignmentActions {
  // A split master holds no goods of its own: only its lots are picked up, moved or delivered
  if (w.is_master) {
    return {
      pickup: false, depart: false, deliver: false, raiseException: false, moveToVehicle: false, hold: false, release: false,
      reattemptOn: null, startReturn: false, hubIn: false, hubOut: false, sendOtp: false,
    }
  }
  const terminal = TERMINAL_SHIPMENT.includes(w.status) || w.status === 'completed'
  const onVehicle = w.current_holder === 'vehicle' && !!w.vehicle
  const atHub = w.current_holder === 'hub'
  const reattemptCase = w.open_exceptions.find(e => (e.type === 'refused' || e.type === 'undeliverable') && isOpenException(e.status))
  return {
    // Mirrors custody.service: a pickup needs goods still with the sender and a vehicle to put them on
    pickup: !terminal && w.current_holder === 'consignor' && !!w.vehicle && PICKUP_FROM.includes(w.status),
    depart: !terminal && onVehicle && w.status === 'picked_up',
    deliver: !terminal && onVehicle && DELIVER_FROM.includes(w.status) && !w.rto && onBoardCount(w.pieces) > 0,
    raiseException: !terminal,
    moveToVehicle: !terminal && onVehicle && onBoardCount(w.pieces) > 0,
    hold: !terminal && w.status !== 'on_hold',
    release: w.status === 'on_hold',
    reattemptOn: !terminal && reattemptCase ? reattemptCase.id : null,
    startReturn: !terminal && !w.rto && w.status !== 'returning' && !NOT_YET_MOVING.includes(w.status) && (onVehicle || atHub),
    hubIn: !terminal && onVehicle && HUB_IN_FROM.includes(w.status),
    hubOut: !terminal && atHub,
    sendOtp: !terminal && onVehicle && (w.delivery_otp_required === true || w.status === 'out_for_delivery'),
  }
}

// ── Pieces ─────────────────────────────────────────────────────────────────

/** Pieces still on the vehicle; the backend's figure, else what is not yet accounted for. */
export function onBoardCount(p: Pieces): number {
  if (p.on_board != null && Number.isFinite(p.on_board)) return Math.max(0, p.on_board)
  return Math.max(0, (p.total ?? 0) - p.delivered - p.short - p.returned)
}

export interface PieceSegment {
  key: 'delivered' | 'on_board' | 'returned' | 'short'
  label: string
  value: number
  tone: Tone
}

export interface PieceSummary {
  total: number | null
  segments: PieceSegment[]
  /** Pieces within delivered or returned that arrived damaged. */
  damaged: number
  /** Pieces the counts do not account for (total minus every bucket); never negative. */
  unaccounted: number
  /** True when the buckets add up to more than the total, which the backend should never allow. */
  overCounted: boolean
  headline: string
}

/** Splits a consignment's pieces into delivered, on board, returned and short, for bars and text. */
export function pieceSummary(p: Pieces, opts: { pickedUp?: boolean } = {}): PieceSummary {
  const onBoard = onBoardCount(p)
  const segments: PieceSegment[] = ([
    { key: 'delivered', label: 'Delivered', value: p.delivered, tone: 'success' },
    { key: 'on_board', label: 'On board', value: onBoard, tone: 'info' },
    { key: 'returned', label: 'Returned', value: p.returned, tone: 'neutral' },
    { key: 'short', label: 'Short', value: p.short, tone: 'danger' },
  ] as PieceSegment[]).filter(s => s.value > 0)
  const counted = p.delivered + onBoard + p.returned + p.short
  const total = p.total
  // Goods nobody has picked up yet are with the sender, not missing
  const unaccounted = total == null || opts.pickedUp === false ? 0 : Math.max(0, total - counted)
  const overCounted = total != null && counted > total
  const n = (x: number) => x.toLocaleString('en-IN')
  const headline = total == null
    ? (counted > 0 ? `${n(counted)} pieces counted` : 'Pieces not counted yet')
    : segments.length === 0
      ? `${n(total)} ${total === 1 ? 'piece' : 'pieces'}`
      : `${n(total)} ${total === 1 ? 'piece' : 'pieces'}: ${segments.map(s => `${n(s.value)} ${s.label.toLowerCase()}`).join(', ')}`
  return { total, segments, damaged: p.damaged, unaccounted, overCounted, headline }
}

export interface TransferItemCount {
  planned: number
  out: number | null
  in: number | null
  /** Out differs from planned, or in differs from out. */
  mismatch: boolean
  /** Pieces missing between the two counts (positive = fewer arrived). */
  gap: number
  note: string | null
}

/** Compares a transfer item's three counts: planned, handed out and received. */
export function transferItemCount(i: Pick<TransferItem, 'pieces_planned' | 'pieces_out' | 'pieces_in'>): TransferItemCount {
  const out = i.pieces_out
  const received = i.pieces_in
  const n = (x: number) => x.toLocaleString('en-IN')
  let gap = 0
  let note: string | null = null
  if (out != null && received != null && received !== out) {
    gap = out - received
    note = gap > 0 ? `${n(gap)} fewer received than handed over` : `${n(-gap)} more received than handed over`
  } else if (out != null && out !== i.pieces_planned) {
    gap = i.pieces_planned - out
    note = gap > 0 ? `${n(gap)} fewer handed over than planned` : `${n(-gap)} more handed over than planned`
  }
  return { planned: i.pieces_planned, out, in: received, mismatch: note !== null, gap, note }
}

// ── Steps and ageing ───────────────────────────────────────────────────────

export type StepState = 'done' | 'current' | 'todo' | 'stopped'

/** Planned → in progress → completed; a cancelled transfer stops where it was. */
export function transferSteps(t: { status: TransferStatus; started_at?: string | null }): { key: TransferStatus; label: string; state: StepState }[] {
  const order: TransferStatus[] = ['planned', 'in_progress', 'completed']
  const labels: Record<string, string> = { planned: 'Planned', in_progress: 'Handover under way', completed: 'Completed' }
  if (t.status === 'cancelled') {
    const reached = t.started_at ? 1 : 0
    return order.map((key, i) => ({ key, label: labels[key], state: i < reached ? 'done' : i === reached ? 'stopped' : 'todo' }))
  }
  const at = order.indexOf(t.status)
  return order.map((key, i) => ({ key, label: labels[key], state: i < at || t.status === 'completed' ? 'done' : i === at ? 'current' : 'todo' }))
}

const CLAIM_FLOW: ClaimStatus[] = ['draft', 'filed', 'surveyed', 'approved', 'settled']

/** The claim stepper: draft → filed → surveyed → approved → settled; rejected or withdrawn stop it. */
export function claimSteps(status: ClaimStatus, reached?: ClaimStatus): { key: ClaimStatus; label: string; state: StepState }[] {
  const labels: Record<string, string> = { draft: 'Draft', filed: 'Filed', surveyed: 'Surveyed', approved: 'Approved', settled: 'Settled', rejected: 'Rejected', withdrawn: 'Withdrawn' }
  if (status === 'rejected' || status === 'withdrawn') {
    // Stopped after the last step it reached (surveyed by default for a rejection, draft for a withdrawal)
    const last = CLAIM_FLOW.indexOf(reached ?? (status === 'rejected' ? 'surveyed' : 'draft'))
    const steps = CLAIM_FLOW.slice(0, last + 1).map(key => ({ key, label: labels[key], state: 'done' as StepState }))
    return [...steps, { key: status, label: labels[status], state: 'stopped' }]
  }
  const at = CLAIM_FLOW.indexOf(status)
  return CLAIM_FLOW.map((key, i) => ({ key, label: labels[key], state: i < at || status === 'settled' ? 'done' : i === at ? 'current' : 'todo' }))
}

/** The statuses a claim can move to next (staff). */
export function claimMoves(status: ClaimStatus): ClaimStatus[] {
  switch (status) {
    case 'draft': return ['filed', 'withdrawn']
    case 'filed': return ['surveyed', 'rejected', 'withdrawn']
    case 'surveyed': return ['approved', 'rejected', 'withdrawn']
    case 'approved': return ['settled']
    default: return []
  }
}

/** What a claim move needs filled in before it can be made. */
export function claimMoveErrors(to: ClaimStatus, c: { approved_amount?: number | null; settled_amount?: number | null; surveyor_name?: string | null; insurer?: string | null }): string[] {
  const errors: string[] = []
  if (to === 'filed' && !c.insurer?.trim()) errors.push('Add the insurer before filing.')
  if (to === 'surveyed' && !c.surveyor_name?.trim()) errors.push('Add the surveyor before marking it surveyed.')
  if (to === 'approved' && !(Number(c.approved_amount) > 0)) errors.push('Enter the approved amount before approving.')
  if (to === 'settled' && !(Number(c.settled_amount) > 0)) errors.push('Enter the settled amount before settling.')
  return errors
}

/** A map position from a vehicle or depot, whichever field names it uses; null when unknown or 0,0. */
export function positionOf(v: { lat?: number | null; lng?: number | null; latitude?: number | null; longitude?: number | null } | null | undefined): { lat: number; lng: number } | null {
  if (!v) return null
  const lat = v.lat ?? v.latitude
  const lng = v.lng ?? v.longitude
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null
  return { lat, lng }
}

/** How long goods have sat at a hub: under a day is fine, 1 to 3 days needs a look, longer is a problem. */
export function hubAgeing(since: string | null | undefined, now: number): { hours: number; label: string; tone: Tone } {
  const at = since ? new Date(since).getTime() : NaN
  if (Number.isNaN(at)) return { hours: 0, label: '—', tone: 'neutral' }
  const ms = Math.max(0, now - at)
  const hours = ms / 3_600_000
  const tone: Tone = hours >= 72 ? 'danger' : hours >= 24 ? 'warning' : 'neutral'
  return { hours, label: formatDuration(ms), tone }
}

// ── The case holding a vehicle's goods ─────────────────────────────────────

/** Case types and sources the backend uses for goods held on a vehicle that lost its work (exception.service openHoldCase). */
const HOLD_CASE_TYPES: readonly string[] = ['vehicle_breakdown', 'vehicle_accident', 'other']
const HOLD_CASE_SOURCES: readonly string[] = ['sos', 'maintenance', 'manual']

/**
 * The open case holding the goods on a vehicle, the way the backend picks it: one open case per
 * vehicle (type breakdown, accident or other; source SOS, maintenance or a manual route or load
 * cancel). A second trigger adds to that case, so the case of an SOS may carry another alert's id,
 * or none: the one naming this alert or job comes first, then the newest hold case.
 */
export function holdCaseFor<T extends Pick<CargoException, 'id' | 'type' | 'source' | 'status' | 'sos_alert_id' | 'maintenance_job_id' | 'created_at'>>(
  cases: T[],
  link: { sosAlertId?: string | null; maintenanceJobId?: string | null } = {},
): T | null {
  const open = cases.filter(c => isOpenException(c.status) && HOLD_CASE_TYPES.includes(c.type) && HOLD_CASE_SOURCES.includes(c.source ?? ''))
  const linked = open.find(c => (link.sosAlertId && c.sos_alert_id === link.sosAlertId) || (link.maintenanceJobId && c.maintenance_job_id === link.maintenanceJobId))
  if (linked) return linked
  return [...open].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] ?? null
}
