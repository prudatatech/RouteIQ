/**
 * What's next for a shipment: where it stands in the core flow (Request, Shipment, Dispatch,
 * On the road, Delivered, Close and bill) and the one thing that moves it on, or who it is waiting
 * on (docs/workflow-blueprint.html). Pure: the shipment page gathers the facts and renders this.
 */
import type { Tone } from '@/components/ui/status'

export const FLOW_STAGES = [
  { id: 'request', label: 'Request' },
  { id: 'shipment', label: 'Shipment' },
  { id: 'dispatch', label: 'Dispatch' },
  { id: 'on_the_road', label: 'On the road' },
  { id: 'delivered', label: 'Delivered' },
  { id: 'close_and_bill', label: 'Close & bill' },
] as const

export type FlowStage = (typeof FLOW_STAGES)[number]['id']

/** What the person can do next. The page turns each into a button or a link. */
export type NextAction =
  | { kind: 'assign'; label: string }
  | { kind: 'send'; label: string }
  | { kind: 'set_price'; label: string }
  | { kind: 'open_problem'; label: string; problemId: string }
  | { kind: 'open_invoice'; label: string }
  | { kind: 'open_cargo'; label: string }
  | { kind: 'open_lots'; label: string }
  | { kind: 'open_bids'; label: string }
  /** The vendor's request in the Requests inbox, where it is decided, priced and given a vehicle. */
  | { kind: 'open_request'; label: string }

export interface NextStepFacts {
  /** A shipment (RTX-), a vendor load (CM-), or a vendor's request that has no load yet (VR-). */
  kind: 'shipment' | 'manifest' | 'request'
  /** The status as the shipment list shows it (a vendor load's scheduled reads as created). */
  status: string | null | undefined
  /** A split master holds no goods; its lots move. */
  isMaster?: boolean
  lots?: { count: number; delivered: number } | null
  holder?: string | null
  onHoldReason?: string | null
  /** Open to vendor bids: a vehicle comes from accepting a bid. */
  biddingOpen?: boolean
  plate?: string | null
  /** Its live trip: the newest one that is not cancelled. */
  trip?: { status: string; stopCount: number; stopsDone: number } | null
  openProblems?: { id: string; code: string }[]
  /** The price the customer or vendor pays. Null while nobody set one. */
  price?: number | null
  invoice?: { status: string; number: string | null } | null
}

export interface NextStep {
  /** Null for a shipment that left the flow (cancelled, lost). */
  stage: FlowStage | null
  tone: Tone
  headline: string
  /** One line of context under the headline. */
  detail: string | null
  action: NextAction | null
  /** Who it is waiting on when nobody here has anything to do. */
  waitingOn: string | null
}

const step = (s: Partial<NextStep> & Pick<NextStep, 'stage' | 'tone' | 'headline'>): NextStep => ({ detail: null, action: null, waitingOn: null, ...s })

/** "stop 2 of 4": the stop the truck is heading for, counted from the stops already decided. */
export function stopProgress(trip: { stopCount: number; stopsDone: number } | null | undefined): string | null {
  if (!trip || trip.stopCount < 1) return null
  return `stop ${Math.min(trip.stopsDone + 1, trip.stopCount)} of ${trip.stopCount}`
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`

/** A vendor's request, before any vehicle is assigned and so before there is a load. */
function requestStep(f: NextStepFacts): NextStep {
  const money = (n: number) => `₹${n.toLocaleString('en-IN')}`
  const priced = f.price != null && f.price > 0
  switch (f.status) {
    case 'pending':
      return step({ stage: 'request', tone: 'warning', headline: 'New request', detail: 'Accept it with a price, or reject it.', action: { kind: 'open_request', label: 'Review request' } })
    case 'approved':
      return priced
        ? step({ stage: 'dispatch', tone: 'warning', headline: 'Needs a vehicle', detail: `Accepted at ${money(f.price!)}.`, action: { kind: 'open_request', label: 'Assign vehicle' } })
        : step({ stage: 'shipment', tone: 'warning', headline: 'Accepted, no price', detail: 'A vehicle can be assigned once it has a price.', action: { kind: 'open_request', label: 'Set price' } })
    case 'escalated':
      return step({ stage: 'dispatch', tone: 'info', headline: 'With 3PL partners', detail: 'Waiting for a partner to take it.', waitingOn: '3PL partners' })
    case 'assigned':
      return step({ stage: 'dispatch', tone: 'info', headline: f.plate ? `Truck assigned: ${f.plate}` : 'Truck assigned', waitingOn: 'the driver' })
    case 'completed':
      return step({ stage: 'delivered', tone: 'success', headline: 'Delivered' })
    case 'rejected':
      return step({ stage: null, tone: 'neutral', headline: 'Rejected', detail: 'The vendor was told.' })
    case 'cancelled':
      return step({ stage: null, tone: 'neutral', headline: 'Cancelled by the vendor' })
    default:
      return step({ stage: 'request', tone: 'neutral', headline: (f.status ?? 'Request').replace(/_/g, ' ') })
  }
}

export function nextStep(f: NextStepFacts): NextStep {
  if (f.kind === 'request') return requestStep(f)
  const status = f.status ?? ''
  const problems = f.openProblems ?? []
  const plate = f.plate ?? null

  if (status === 'cancelled') return step({ stage: null, tone: 'neutral', headline: 'Cancelled', detail: 'This shipment will not move.' })
  if (status === 'lost') return step({ stage: 'close_and_bill', tone: 'danger', headline: 'Marked lost', detail: 'Settle it with a claim.' })

  // A split master holds no goods: its lots carry them
  if (f.isMaster) {
    const total = f.lots?.count ?? 0
    const done = f.lots?.delivered ?? 0
    return step({
      stage: status === 'delivered' ? 'delivered' : total > 0 && done === 0 && ['created', 'assigned'].includes(status) ? 'dispatch' : 'on_the_road',
      tone: status === 'delivered' ? 'success' : 'info',
      headline: total > 0 ? `Split into ${plural(total, 'lot', 'lots')} · ${done.toLocaleString('en-IN')} delivered` : 'Split into lots',
      detail: 'A split shipment holds no goods itself. Each lot is assigned, moved and delivered on its own.',
      action: total > 0 && status !== 'delivered' ? { kind: 'open_lots', label: 'Work the lots' } : null,
    })
  }

  // A problem outranks everything else in flight
  if (problems.length > 0 && !['delivered', 'returned'].includes(status)) {
    const first = problems[0]
    return step({
      stage: 'on_the_road',
      tone: 'danger',
      headline: problems.length === 1 ? `Problem open: ${first.code} · Plan the cargo` : `${plural(problems.length, 'problem', 'problems')} open: ${problems.map(p => p.code).join(', ')}`,
      detail: 'The goods stay where they are until the case says what happens next.',
      action: { kind: 'open_problem', label: 'Plan the cargo', problemId: first.id },
    })
  }

  switch (status) {
    case 'created': {
      if (f.biddingOpen) {
        return step({ stage: 'dispatch', tone: 'info', headline: 'Open to vendor bids', detail: 'A vehicle comes from the bid you accept.', waitingOn: 'vendors', action: { kind: 'open_bids', label: 'See the bids' } })
      }
      if (f.kind === 'manifest') {
        return step({
          stage: 'dispatch', tone: 'info',
          headline: plate ? `Truck assigned: ${plate}` : 'Truck assigned',
          detail: 'The driver starts the trip from the app.',
          waitingOn: 'the driver',
        })
      }
      return step({ stage: 'dispatch', tone: 'warning', headline: 'Needs a vehicle', detail: 'Accepted, with no trip yet.', action: { kind: 'assign', label: 'Assign vehicle' } })
    }
    case 'assigned': {
      if (f.trip?.status === 'pending') {
        return step({
          stage: 'dispatch', tone: 'warning',
          headline: 'Trip planned, not sent',
          detail: `${plate ? `${plate} · ` : ''}${plural(f.trip.stopCount, 'stop', 'stops')}. The driver hears about it when you send it.`,
          action: { kind: 'send', label: 'Send to driver' },
        })
      }
      return step({
        stage: 'on_the_road', tone: 'info',
        headline: plate ? `Trip sent. Waiting for pickup by ${plate}` : 'Trip sent. Waiting for pickup',
        detail: stopProgress(f.trip),
        waitingOn: 'the driver',
      })
    }
    case 'picked_up':
    case 'in_transit':
    case 'out_for_delivery':
    case 'partially_delivered': {
      const progress = stopProgress(f.trip)
      return step({
        stage: 'on_the_road', tone: 'info',
        headline: `On the road${plate ? ` with ${plate}` : ''}${progress ? ` · ${progress}` : ''}`,
        detail: status === 'partially_delivered' ? 'Some pieces are delivered. The rest are still on board.' : null,
        waitingOn: 'the driver',
      })
    }
    case 'at_hub':
      return step({ stage: 'on_the_road', tone: 'warning', headline: 'At a hub', detail: 'Waiting for a vehicle to take it on.', action: { kind: 'open_cargo', label: 'Plan the onward move' } })
    case 'on_hold':
      // Held before pickup: it never left the sender, so it is still in dispatch and there is only a hold to release
      return f.holder === 'consignor'
        ? step({ stage: 'dispatch', tone: 'warning', headline: 'On hold', detail: f.onHoldReason ?? null, action: { kind: 'open_cargo', label: 'Release hold' } })
        : step({ stage: 'on_the_road', tone: 'warning', headline: 'On hold', detail: f.onHoldReason ?? null, action: { kind: 'open_cargo', label: 'Release or move it' } })
    case 'returning':
      return step({ stage: 'on_the_road', tone: 'warning', headline: `Returning to the sender${plate ? ` with ${plate}` : ''}`, waitingOn: 'the driver' })
    case 'exception':
      // A failed delivery with no case open: back with the sender it can be planned again, else on the truck
      return f.holder && f.holder !== 'consignor'
        ? step({ stage: 'on_the_road', tone: 'danger', headline: 'Delivery failed', detail: 'The goods are still on the vehicle.', action: { kind: 'open_cargo', label: 'Re-attempt, move or return' } })
        : step({ stage: 'dispatch', tone: 'danger', headline: 'Delivery failed', detail: 'It is back with the sender.', action: { kind: 'assign', label: 'Assign again' } })
    case 'returned':
      return step({ stage: 'close_and_bill', tone: 'neutral', headline: 'Returned to the sender' })
    case 'delivered': {
      if (f.invoice?.status === 'paid') {
        return step({ stage: 'close_and_bill', tone: 'success', headline: `Closed. Invoice${f.invoice.number ? ` ${f.invoice.number}` : ''} paid` })
      }
      if (f.invoice) {
        return step({
          stage: 'close_and_bill', tone: 'warning',
          headline: `Invoice${f.invoice.number ? ` ${f.invoice.number}` : ''} issued · unpaid`,
          waitingOn: 'payment',
          action: { kind: 'open_invoice', label: 'Open the invoice' },
        })
      }
      if (f.price == null || !(f.price > 0)) {
        return step({ stage: 'delivered', tone: 'warning', headline: 'Delivered, no price', detail: 'Without a price there is no invoice.', action: { kind: 'set_price', label: 'Set price' } })
      }
      return step({ stage: 'close_and_bill', tone: 'info', headline: 'Delivered. Invoice not issued yet', waitingOn: 'finance', action: { kind: 'open_invoice', label: 'Go to invoices' } })
    }
    default:
      return step({ stage: 'shipment', tone: 'neutral', headline: status ? status.replace(/_/g, ' ') : 'Shipment' })
  }
}

/** How far along the flow a stage is, for the stepper: done, the current one, or still to come. */
export function stageState(stage: FlowStage | null, id: FlowStage): 'done' | 'current' | 'todo' {
  if (!stage) return 'todo'
  const order = FLOW_STAGES.map(s => s.id)
  const at = order.indexOf(stage)
  const i = order.indexOf(id)
  return i < at ? 'done' : i === at ? 'current' : 'todo'
}
