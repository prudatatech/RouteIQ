/**
 * What the vendor portal shows of a vendor's loads: the stages of the "My loads" board, the one
 * next action per load, and the action items on top. The backend (GET /vendor/loads) decides the
 * stage; this file only words it and decides what the vendor should do next.
 */
import { formatPieces, formatRupees } from '@/utils/display'
import type { LoadItem } from '@/types/load'
import type { KycStatus } from './vendorContext'

export const LOAD_STAGES = ['waiting', 'accepted', 'assigned', 'on_the_way', 'delivered', 'closed'] as const
export type LoadStage = (typeof LOAD_STAGES)[number]

export const STAGE_LABELS: Record<LoadStage, string> = {
  waiting: 'Waiting for us to accept',
  accepted: 'Accepted, truck to be assigned',
  assigned: 'Truck assigned',
  on_the_way: 'On the way',
  delivered: 'Delivered',
  closed: 'Closed',
}

export type LoadOutcome = 'delivered' | 'partly_delivered' | 'returned' | 'lost' | null

export interface LoadProblem {
  id: string
  type: string
  title: string
  message: string
  opened_at: string | null
  revised_eta?: { eta_at: string; eta_text: string } | null
}

export interface LoadInvoice {
  id: string
  invoice_number: string
  status: string
  total: number | null
  issued_at: string | null
  due_date?: string | null
  overdue?: boolean
  days_overdue?: number
  paid_at: string | null
  payment_method?: string | null
  payment_reference?: string | null
}

export interface VendorLoad {
  /** Request id, or the shipment id for return-trip space. */
  id: string
  kind: 'posted' | 'space'
  code: string
  request_id: string | null
  manifest_id: string | null
  shipment_id: string | null
  bid_id: string | null
  stage: LoadStage
  status: string
  outcome: LoadOutcome
  pickup: string | null
  drop: string | null
  weight_kg: number | null
  pieces: number | null
  price: number | null
  price_source: 'agreed' | 'offered' | 'bid' | null
  truck: { plate_number: string | null; vehicle_type: string | null } | null
  tracking_id: string | null
  with_partner: boolean
  rejection_reason: string | null
  created_at: string | null
  delivered_at: string | null
  invoice: LoadInvoice | null
  problems: Pick<LoadProblem, 'id' | 'type' | 'title' | 'message' | 'opened_at'>[]
}

export interface LoadLot {
  ref: { manifest_id?: string; shipment_id?: string }
  code: string
  label: string | null
  status: string
  pieces: { total: number | null; held?: number | null; delivered?: number | null } | null
  consignee: { name: string | null } | null
  drop: { name: string | null; address: string | null } | null
  vehicle: { plate_number: string | null } | null
  text: string
  pod: { received_by: string | null; photo_url: string | null; signature_url: string | null; signature_data: string | null } | null
}

export interface LoadClaimSummary {
  id: string
  code: string
  claim_type: string
  status: string
  claimed_amount: number | null
  approved_amount: number | null
  settled_amount: number | null
  created_at: string
  lot_code: string | null
}

export interface VendorLoadDetail extends Omit<VendorLoad, 'problems'> {
  where: { current_holder: string; depot: { name: string | null } | null; delivery_attempts: number; max_delivery_attempts: number; rto: boolean } | null
  lots: LoadLot[]
  pod: { received_by: string | null; photo_url: string | null; signature_url: string | null; signature_data: string | null } | null
  problems: LoadProblem[]
  claims: LoadClaimSummary[]
  claim_window: { allowed: boolean; reason: string | null; until: string | null }
  /** Set on a load posted through the Post a Load form (MRX-YYYY-NNNNN), with its goods lines. */
  load_number?: string | null
  items?: LoadItem[]
}

export interface VendorInvoice {
  id: string
  invoice_number: string
  reference: string | null
  shipment_id: string | null
  manifest_id: string | null
  vendor_request_id: string | null
  amount: number
  gst_rate: number
  gst_amount: number
  total: number
  status: string
  issued_at: string
  due_date?: string | null
  overdue?: boolean
  days_overdue?: number
  paid_at: string | null
  payment_method?: string | null
  payment_reference?: string | null
}

/** The page of one load. */
export const loadPath = (id: string) => `/vendor/loads/${encodeURIComponent(id)}`

/** The load an invoice is for: the request the vendor posted, or the shipment of space they won. */
export const invoiceLoadId = (i: Pick<VendorInvoice, 'vendor_request_id' | 'shipment_id'>): string | null => i.vendor_request_id ?? i.shipment_id ?? null

export type NextAction =
  | { kind: 'do'; label: string; to: string }
  | { kind: 'wait'; label: string; detail?: string }
  | { kind: 'none'; label: string }

/**
 * The one thing the vendor does next on a load, or who the load is waiting on. A problem comes first,
 * then the money; the rest follows the stage.
 */
export function nextAction(load: VendorLoad): NextAction {
  const open = loadPath(load.id)
  if (load.problems.length > 0) return { kind: 'do', label: 'See what happened', to: open }
  switch (load.stage) {
    case 'waiting':
      return { kind: 'wait', label: 'Waiting on MargixIndia', detail: 'To accept the load and set the price' }
    case 'accepted':
      return { kind: 'wait', label: 'Waiting on MargixIndia', detail: load.with_partner ? 'A partner carrier is being lined up' : 'To assign a truck' }
    case 'assigned':
      return { kind: 'do', label: 'Get the load ready for pickup', to: open }
    case 'on_the_way':
      return { kind: 'wait', label: 'Waiting on MargixIndia', detail: 'To deliver the load' }
    case 'delivered':
      if (load.invoice && load.invoice.status !== 'paid') return { kind: 'do', label: `Pay invoice ${load.invoice.invoice_number}`, to: '/vendor/invoices' }
      return load.invoice
        ? { kind: 'do', label: 'View proof of delivery', to: `${open}#proof` }
        : { kind: 'wait', label: 'Waiting on MargixIndia', detail: 'To issue the invoice' }
    case 'closed':
      if (load.status === 'rejected') return { kind: 'do', label: 'Post it again', to: '/vendor/request' }
      return { kind: 'none', label: load.outcome === 'lost' ? 'Reported lost' : load.outcome === 'returned' || load.status === 'returned' ? 'Returned to you' : load.status === 'cancelled' ? 'Cancelled' : 'Nothing to do' }
  }
}

/** The loads of each stage, newest first inside a stage; stages with no load are left out. */
export function groupByStage(loads: VendorLoad[]): { stage: LoadStage; label: string; loads: VendorLoad[] }[] {
  return LOAD_STAGES
    .map(stage => ({
      stage,
      label: STAGE_LABELS[stage],
      loads: loads.filter(l => l.stage === stage).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
    }))
    .filter(g => g.loads.length > 0)
}

export interface ActionItem {
  id: string
  tone: 'danger' | 'warning' | 'info'
  title: string
  detail: string
  /** Where the fix is; null for news that needs nothing from the vendor. */
  to: string | null
  cta?: string
}

export interface BoardState {
  /** Null while the profile is loading; `none` when the vendor has no company profile yet. */
  kyc: KycStatus | 'none' | null
  kycRejectionReason?: string | null
  /** The profile has no pickup location, so a bid can not be awarded. */
  locationMissing: boolean
  loads: VendorLoad[]
  invoices: VendorInvoice[]
}

const TONE_ORDER = { danger: 0, warning: 1, info: 2 } as const
const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`

/** Whole days between two instants, never negative. */
export function daysSince(from: string | null | undefined, now: number): number | null {
  const t = from ? Date.parse(from) : NaN
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86_400_000)) : null
}

/** The strip on top of My loads: what needs the vendor now, most urgent first. */
export function actionItems(state: BoardState): ActionItem[] {
  const items: ActionItem[] = []

  if (state.kyc === 'none') {
    items.push({ id: 'kyc', tone: 'warning', title: 'Set up your company', detail: 'You can post loads and bid once your company and KYC are approved.', to: '/vendor/onboarding', cta: 'Set up company' })
  } else if (state.kyc === 'rejected') {
    items.push({ id: 'kyc', tone: 'danger', title: 'Your KYC needs changes', detail: state.kycRejectionReason || 'Open Company to see what to fix, then submit again.', to: '/vendor/company', cta: 'Fix KYC' })
  } else if (state.kyc === 'pending') {
    items.push({ id: 'kyc', tone: 'warning', title: 'Finish your KYC', detail: 'You can post loads and bid once it is approved.', to: '/vendor/company', cta: 'Finish KYC' })
  } else if (state.kyc === 'submitted') {
    items.push({ id: 'kyc', tone: 'info', title: 'Your KYC is in review', detail: 'You can post loads and bid once we approve it. We will tell you.', to: null })
  }

  if (state.locationMissing && state.kyc !== 'none' && state.kyc !== null) {
    items.push({ id: 'location', tone: 'warning', title: 'Add your pickup location', detail: 'A bid can not be awarded to you until your company has a pickup location.', to: '/vendor/company', cta: 'Add location' })
  }

  const withProblems = state.loads.filter(l => l.problems.length > 0)
  for (const l of withProblems.slice(0, 3)) {
    items.push({ id: `problem-${l.id}`, tone: 'danger', title: `A problem on ${l.code}`, detail: l.problems[0].title, to: loadPath(l.id), cta: 'See what happened' })
  }
  if (withProblems.length > 3) {
    items.push({ id: 'problem-more', tone: 'danger', title: `${plural(withProblems.length - 3, 'more load has', 'more loads have')} a problem`, detail: 'Open the loads marked with a problem below.', to: null })
  }

  const unpaid = state.invoices.filter(i => i.status !== 'paid' && i.status !== 'void')
  if (unpaid.length > 0) {
    const total = unpaid.reduce((s, i) => s + (Number(i.total) || 0), 0)
    items.push({ id: 'invoices', tone: 'warning', title: `${plural(unpaid.length, 'invoice', 'invoices')} to pay`, detail: `${rupees(total)} in all. Payments are made offline.`, to: '/vendor/invoices', cta: 'See invoices' })
  }

  const waiting = state.loads.filter(l => l.stage === 'waiting').length
  if (waiting > 0) {
    items.push({ id: 'waiting', tone: 'info', title: `${plural(waiting, 'load is', 'loads are')} waiting for MargixIndia`, detail: 'We accept each load and set its price, then assign a truck.', to: null })
  }
  const accepted = state.loads.filter(l => l.stage === 'accepted').length
  if (accepted > 0) {
    items.push({ id: 'accepted', tone: 'info', title: `${plural(accepted, 'load is', 'loads are')} accepted and waiting for a truck`, detail: 'You will be told as soon as a truck is assigned.', to: null })
  }

  return items.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone])
}

export interface ClaimableLoad { id: string; label: string; manifest_id: string }

/**
 * Loads a claim can probably be raised on: a load of the vendor's own with a delivery, part
 * delivery, return or loss on record in the last 7 days. The backend makes the final call.
 */
export const CLAIM_WINDOW_DAYS = 7

export function claimableLoads(loads: VendorLoad[], now: number): VendorLoad[] {
  return loads.filter(l => {
    if (l.kind !== 'posted' || !l.manifest_id) return false
    if (l.outcome === null && l.stage !== 'delivered' && l.stage !== 'closed') return false
    const days = daysSince(l.delivered_at, now)
    return days !== null && days <= CLAIM_WINDOW_DAYS
  })
}

/** "Raise by 7 Oct" line for the claim window, or the reason it is closed. */
export function claimWindowText(w: VendorLoadDetail['claim_window'], format: (v: string) => string): string {
  if (!w.allowed) return w.reason ?? 'A claim can not be raised on this load.'
  return w.until ? `You can raise a claim until ${format(w.until)}.` : 'You can raise a claim on this load.'
}

/** What a bid's outcome means and what the vendor does next. `to` starting with # is a place on the same page. */
export function bidNextStep(
  bid: { status: string; rejection_reason: string | null },
  loadId: string | null,
): { text: string; cta?: { label: string; to: string } } {
  const again = { label: 'See open return trips', to: '#open-return-trips' }
  switch (bid.status) {
    case 'pending': return { text: 'Waiting on MargixIndia to decide. We will tell you.' }
    case 'won':
      return loadId
        ? { text: 'Approved. The truck is being routed to your pickup. Have the load ready.', cta: { label: 'Open the load', to: loadPath(loadId) } }
        : { text: 'Approved. The truck is being routed to your pickup. Have the load ready.' }
    case 'lost': return { text: 'Another bid was chosen for this truck. Bid on the next return trip that opens.', cta: again }
    case 'rejected': return { text: `MargixIndia did not accept this bid${bid.rejection_reason ? `: ${bid.rejection_reason}` : ''}. You can bid on another return trip.`, cta: again }
    case 'expired': return { text: 'The return trip closed before this bid was decided. Bid on the next one that opens.', cta: again }
    default: return { text: 'This bid is being looked at.' }
  }
}

/** What a claim's status means for the vendor, in a sentence. */
export function claimStatusText(c: { status: string; approved_amount: number | null; settled_amount: number | null }): string {
  const money = (n: number | null) => (n == null ? '' : ` for ₹${Math.round(n).toLocaleString('en-IN')}`)
  switch (c.status) {
    case 'draft': case 'filed': return 'MargixIndia has your claim and will review it. We will tell you when it changes.'
    case 'surveyed': return 'A surveyor has assessed your claim. A decision is next.'
    case 'approved': return `Your claim was approved${money(c.approved_amount)}. Settlement is next.`
    case 'rejected': return 'Your claim was not approved.'
    case 'settled': return `Your claim was settled${money(c.settled_amount)}.`
    case 'withdrawn': return 'This claim was withdrawn.'
    default: return 'This claim is being looked at.'
  }
}

/** "₹8,000 agreed", "₹12,000 you offered", "₹4,500 your bid"; a load with no price yet says so. */
export function priceText(load: Pick<VendorLoad, 'price' | 'price_source'>): string {
  if (load.price == null) return 'Price to be set'
  const label = load.price_source === 'agreed' ? 'agreed' : load.price_source === 'bid' ? 'your bid' : 'you offered'
  return `${formatRupees(load.price)} ${label}`
}

export function piecesText(pieces: number | null): string | null {
  return pieces == null ? null : formatPieces(pieces)
}

/** The live tracking page of a load: open to anyone with the code, so a vendor can share it with the receiver. */
export function trackingPath(load: Pick<VendorLoad, 'tracking_id'>): string | null {
  return load.tracking_id ? `/track/${encodeURIComponent(load.tracking_id)}` : null
}

/** Whether the truck can be followed: assigned or moving. */
export const isTrackable = (load: Pick<VendorLoad, 'stage' | 'tracking_id'>) => !!load.tracking_id && (load.stage === 'assigned' || load.stage === 'on_the_way')


/** "Overdue by 5 days", or null when the invoice is not overdue. */
export function overdueText(i: { overdue?: boolean; days_overdue?: number }): string | null {
  if (!i.overdue) return null
  const n = i.days_overdue ?? 0
  return `Overdue by ${n} ${n === 1 ? 'day' : 'days'}`
}
