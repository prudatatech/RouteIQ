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
  open: 'info', tracking: 'info',
  // Needs attention
  pending: 'warning', delayed: 'warning', maintenance: 'warning', paused: 'warning', notified: 'warning',
  pending_escrow: 'warning', under_review: 'warning', on_hold: 'warning', acknowledged: 'warning', low: 'warning',
  // Failed / blocked
  failed: 'danger', rejected: 'danger', cancelled: 'danger', offline: 'danger', exception: 'danger', error: 'danger',
  sos: 'danger', escrow_failed: 'danger', gps_off: 'danger', expired: 'danger', critical: 'danger', denied: 'danger',
  // Neutral
  idle: 'neutral', archived: 'neutral', draft: 'neutral', created: 'neutral', closed: 'neutral', ignored: 'neutral',
  unknown: 'neutral',
}

const statusLabel: Record<string, string> = {
  on_route: 'On route',
  in_transit: 'In transit',
  in_progress: 'In progress',
  picked_up: 'Picked up',
  out_for_delivery: 'Out for delivery',
  gps_off: 'GPS off',
  sos: 'SOS',
  pending_escrow: 'Awaiting payment',
  escrow_held: 'Payment held',
  escrow_failed: 'Payment failed',
  released: 'Payment released',
  bidded: 'Bid placed',
  under_review: 'Under review',
  on_hold: 'On hold',
}

/** "in_transit" → "In transit". */
export function humanize(value: string) {
  const text = value.replace(/[_-]+/g, ' ').trim().toLowerCase()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function statusToTone(status: string | null | undefined): Tone {
  if (!status) return 'neutral'
  return statusTone[status.toLowerCase()] ?? 'neutral'
}

export function statusToLabel(status: string | null | undefined): string {
  if (!status) return 'Unknown'
  return statusLabel[status.toLowerCase()] ?? humanize(status)
}
