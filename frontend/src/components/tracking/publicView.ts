/**
 * What the public tracking page shows, worked out from the public answer: which step the progress bar
 * is on, which history lines a customer should see, and how a split booking reads lot by lot.
 */

export interface PublicLot {
  tracking_id: string
  label?: string | null
  status: string
  pieces_total?: number | null
  pieces_delivered?: number | null
  /** Where this lot goes, when the answer carries it. */
  destination?: { name?: string | null; address?: string | null } | null
  /** The truck that carries this lot, when the answer carries it: plate and type only. */
  vehicle?: { plate_number?: string | null; type?: string | null } | null
}

/** One drop of a multi-drop booking, when the answer lists them. */
export interface PublicDrop { name?: string | null; address?: string | null }

export interface PublicHistoryEvent { status: string; at: string }

/** The statuses a customer reads. Custody and staff states (on hold, with a partner) stay out. */
const CUSTOMER_STATUSES = new Set([
  'created', 'assigned', 'dispatched', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'partially_delivered',
  'exception', 'cancelled', 'returned',
])

/**
 * The history a customer sees: only customer statuses, one line per change (a repeat of the line
 * before it is dropped), and a failed attempt only while the shipment is still in that state.
 */
export function publicHistory(events: PublicHistoryEvent[] | null | undefined, currentStatus: string): PublicHistoryEvent[] {
  const out: PublicHistoryEvent[] = []
  for (const e of events ?? []) {
    if (!CUSTOMER_STATUSES.has(e.status)) continue
    if (e.status === 'exception' && currentStatus !== 'exception') continue
    if (out[out.length - 1]?.status === e.status) continue
    out.push(e)
  }
  return out
}

/** A part-delivered booking stays on its last shared step (In transit), with a note saying how much is delivered. */
export const isPartlyDelivered = (status: string) => status === 'partially_delivered'

export const lotIsDone = (l: PublicLot) => l.status === 'delivered' || l.status === 'completed'

/** "Lot A delivered", "Lot B: 23 of 25 pieces delivered", "Lot C on its way". */
export function lotLine(l: PublicLot): string {
  const name = l.label ? `Lot ${l.label}` : l.tracking_id
  if (lotIsDone(l)) return `${name} delivered`
  const total = l.pieces_total ?? null
  const delivered = l.pieces_delivered ?? 0
  if (total != null && delivered > 0) return `${name}: ${delivered.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')} pieces delivered`
  if (l.status === 'in_transit' || l.status === 'out_for_delivery') return `${name} on its way`
  if (l.status === 'cancelled') return `${name} cancelled`
  if (l.status === 'returned') return `${name} returned to the sender`
  if (l.status === 'picked_up' || l.status === 'assigned') return `${name} being collected`
  return `${name} not yet picked up`
}

/**
 * The destination line of a split booking: the drop itself when there is one, the first and last when
 * there are a few, otherwise how many addresses it has. Null when nothing is known.
 */
export function splitDestination(drops: PublicDrop[] | null | undefined, lots: PublicLot[], format: (name?: string | null, address?: string | null) => string): string | null {
  const places = (drops && drops.length > 0 ? drops : lots.map(l => l.destination).filter((d): d is NonNullable<PublicLot['destination']> => !!d))
    .map(p => format(p.name, p.address))
    .filter(Boolean)
  const unique = [...new Set(places)]
  if (unique.length === 1) return unique[0]
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`
  if (unique.length > 2) return `${unique.length.toLocaleString('en-IN')} delivery addresses`
  return lots.length > 0 ? `${lots.length.toLocaleString('en-IN')} delivery ${lots.length === 1 ? 'address' : 'addresses'}` : null
}

/** The bar's steps in order, as the public page draws them. */
export const PROGRESS_STEPS = ['created', 'assigned', 'picked_up', 'in_transit', 'delivered'] as const

/**
 * Where the progress bar sits for a part-delivered booking: the last step every live lot has reached,
 * never Delivered (something is still on its way). A lot not yet picked up holds the bar back; a
 * cancelled or returned lot does not count. Without lots the bar sits on In transit.
 */
export function partDeliveredStep(lots: PublicLot[]): number {
  const inTransit = PROGRESS_STEPS.indexOf('in_transit')
  const live = lots.filter(l => l.status !== 'cancelled' && l.status !== 'returned' && !lotIsDone(l))
  if (live.length === 0) return inTransit
  const steps = live.map(l => {
    const i = (PROGRESS_STEPS as readonly string[]).indexOf(l.status)
    // Part-delivered and failed lots are on the road; any other state (dispatched, ...) is before pickup
    return i >= 0 ? Math.min(i, inTransit) : l.status === 'partially_delivered' || l.status === 'exception' || l.status === 'out_for_delivery' ? inTransit : 0
  })
  return Math.min(...steps)
}

/** "Part delivered: 2 of 3 lots", or just "Part delivered" when the booking is not split. */
export function partDeliveredText(lots: PublicLot[]): string {
  if (lots.length === 0) return 'Part delivered'
  return `Part delivered: ${lots.filter(lotIsDone).length.toLocaleString('en-IN')} of ${lots.length.toLocaleString('en-IN')} lots`
}
