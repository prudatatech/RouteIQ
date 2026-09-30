export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand'

export const toneClasses: Record<Tone, { pill: string; dot: string; text: string }> = {
  success: { pill: 'bg-success-soft text-success', dot: 'bg-success', text: 'text-success' },
  warning: { pill: 'bg-warning-soft text-warning', dot: 'bg-warning', text: 'text-warning' },
  danger: { pill: 'bg-danger-soft text-danger', dot: 'bg-danger', text: 'text-danger' },
  info: { pill: 'bg-info-soft text-info', dot: 'bg-info', text: 'text-info' },
  neutral: { pill: 'bg-neutral-soft text-neutral', dot: 'bg-neutral', text: 'text-neutral' },
  brand: { pill: 'bg-brand-soft text-brand', dot: 'bg-brand-fill', text: 'text-brand' },
}

/**
 * One place that decides how every status value in the product looks. Values are
 * the raw strings stored in the database (shipments, routes, bids, vehicles, KYC,
 * vendor requests, escrow, SOS).
 */
const statusTone: Record<string, Tone> = {
  // Done / good
  delivered: 'success', completed: 'success', approved: 'success', active: 'success', available: 'success',
  fulfilled: 'success', accepted: 'success', verified: 'success', resolved: 'success', released: 'success',
  online: 'success', paid: 'success', success: 'success',
  // Moving / assigned
  in_transit: 'info', on_route: 'info', assigned: 'info', scheduled: 'info', in_progress: 'info', dispatched: 'info',
  picked_up: 'info', out_for_delivery: 'info', escrow_held: 'info', bidded: 'info', submitted: 'info', planned: 'info',
  open: 'info', tracking: 'info', escalated: 'info', assigned_to_partner: 'info', offered: 'warning',
  // Needs attention
  pending: 'warning', pending_approval: 'warning', delayed: 'warning', maintenance: 'warning', paused: 'warning', notified: 'warning',
  pending_escrow: 'warning', under_review: 'warning', on_hold: 'warning', acknowledged: 'warning', medium: 'warning', gps_off: 'warning',
  // Failed / blocked
  failed: 'danger', rejected: 'danger', declined: 'danger', exception: 'danger', error: 'danger',
  sos: 'danger', escrow_failed: 'danger', expired: 'danger', critical: 'danger', denied: 'danger', high: 'danger',
  // Neutral
  taken: 'neutral', withdrawn: 'neutral', idle: 'neutral', offline: 'neutral', archived: 'neutral', draft: 'neutral', created: 'neutral', closed: 'neutral', ignored: 'neutral',
  unknown: 'neutral', cancelled: 'neutral', void: 'neutral', optimizing: 'info', issued: 'info', low: 'info', won: 'success', lost: 'neutral',
  // Cargo custody (shipments and vendor loads), exception cases, transfers and claims
  at_hub: 'info', partially_delivered: 'warning', returning: 'warning', returned: 'neutral',
  investigating: 'warning', action_planned: 'info', filed: 'info', surveyed: 'info', settled: 'success',
}

const statusLabel: Record<string, string> = {
  on_route: 'On trip',
  in_transit: 'In transit',
  in_progress: 'In progress',
  picked_up: 'Picked up',
  out_for_delivery: 'Out for delivery',
  gps_off: 'GPS off',
  maintenance: 'In maintenance',
  pending_approval: 'Awaiting approval',
  sos: 'SOS',
  pending_escrow: 'Awaiting payment',
  escrow_held: 'Payment held',
  escrow_failed: 'Payment failed',
  released: 'Payment released',
  bidded: 'Bid placed',
  under_review: 'Under review',
  on_hold: 'On hold',
  escalated: 'With 3PL partners',
  assigned_to_partner: 'Assigned to partner',
  offered: 'Waiting for answer',
  taken: 'Taken by another partner',
  exception: 'Delivery failed',
  assigned: 'Vehicle assigned',
  optimizing: 'Planning',
  won: 'Approved',
  lost: 'Not selected',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  fulfilled: 'Completed',
  cancelled: 'Cancelled',
  at_hub: 'At hub',
  partially_delivered: 'Partly delivered',
  returning: 'Returning to sender',
  returned: 'Returned to sender',
  action_planned: 'Action planned',
}

/**
 * The same raw value can mean different things on different records ("active" route vs
 * "active" partner, "pending" route vs "pending" vendor load). Pass `kind` to pick the
 * reading that fits the record.
 */
export type StatusKind = 'route' | 'booking' | 'request' | 'bid' | 'kyc' | 'window' | 'cargo' | 'case' | 'split_reason' | 'custody'

const kindOverrides: Record<StatusKind, Record<string, { tone?: Tone; label?: string }>> = {
  route: {
    pending: { tone: 'neutral', label: 'Not started' },
    active: { tone: 'info', label: 'In progress' },
    optimizing: { tone: 'info', label: 'Planning' },
  },
  // Staff view of a customer booking. "New" means staff have not acted on it yet.
  booking: {
    requested: { tone: 'warning', label: 'New' },
    confirmed: { tone: 'info', label: 'Confirmed, needs a vehicle' },
  },
  // A vendor's load request.
  request: {
    pending: { tone: 'warning', label: 'New' },
    approved: { tone: 'success', label: 'Approved' },
    escalated: { tone: 'info', label: 'With 3PL partners' },
    cancelled: { tone: 'neutral', label: 'Cancelled by vendor' },
  },
  bid: {
    pending: { tone: 'warning', label: 'Waiting' },
    won: { tone: 'success', label: 'Approved' },
    lost: { tone: 'neutral', label: 'Not selected' },
    rejected: { tone: 'danger', label: 'Rejected' },
    expired: { tone: 'neutral', label: 'Expired' },
  },
  kyc: {
    submitted: { tone: 'warning', label: 'Waiting for review' },
    pending: { tone: 'neutral', label: 'Not submitted' },
  },
  // Capacity-bidding window states.
  window: {
    open: { tone: 'info', label: 'Open for bids' },
    upcoming: { tone: 'neutral', label: 'Opens soon' },
    decide: { tone: 'warning', label: 'Needs a decision' },
    awarded: { tone: 'success', label: 'Awarded' },
    closed: { tone: 'neutral', label: 'Closed' },
    cancelled: { tone: 'neutral', label: 'Cancelled' },
  },
  // A shipment or vendor load in the cargo custody flow. "lost" is lost goods here, not a lost bid.
  cargo: {
    lost: { tone: 'danger', label: 'Lost' },
    exception: { tone: 'danger', label: 'Problem' },
    on_hold: { tone: 'warning', label: 'On hold' },
  },
  // Why a consignment was split into lots (`split_reason` on a lot).
  split_reason: {
    multi_drop: { tone: 'info', label: 'Multi-drop booking' },
    partial_transfer: { tone: 'info', label: 'Part moved to another vehicle' },
    hub_crossdock: { tone: 'info', label: 'Cross-docked at a hub' },
    partial_delivery_remainder: { tone: 'warning', label: 'Rest of a partial delivery' },
    manual: { tone: 'neutral', label: 'Split by staff' },
  },
  // Custody event kinds that are not handovers: a consignment split into lots, or lots merged back.
  custody: {
    split: { tone: 'brand', label: 'Split into lots' },
    merge: { tone: 'brand', label: 'Lots merged' },
  },
  // A cargo exception case: an open case needs someone, so it is amber rather than blue.
  case: {
    open: { tone: 'warning', label: 'Open' },
    investigating: { tone: 'warning', label: 'Investigating' },
    action_planned: { tone: 'info', label: 'Action planned' },
    resolved: { tone: 'success', label: 'Resolved' },
    closed: { tone: 'neutral', label: 'Closed' },
  },
}

/** "in_transit" → "In transit". */
export function humanize(value: string) {
  const text = value.replace(/[_-]+/g, ' ').trim().toLowerCase()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function statusToTone(status: string | null | undefined, kind?: StatusKind): Tone {
  if (!status) return 'neutral'
  const key = status.toLowerCase()
  return (kind && kindOverrides[kind][key]?.tone) ?? statusTone[key] ?? 'neutral'
}

export function statusToLabel(status: string | null | undefined, kind?: StatusKind): string {
  if (!status) return 'Unknown'
  const key = status.toLowerCase()
  return (kind && kindOverrides[kind][key]?.label) ?? statusLabel[key] ?? humanize(status)
}
