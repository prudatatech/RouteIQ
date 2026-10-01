import type { TodayResponse } from '@/services/api'

export type QueueId =
  | 'sos' | 'problems' | 'requests' | 'needsVehicle' | 'tripsToSend' | 'unpriced' | 'paymentReports'
  | 'vehicleRequests' | 'documents' | 'kyc' | 'bids' | 'driverActions'

export type QueueTone = 'danger' | 'warning' | 'info'

export interface Queue {
  id: QueueId
  title: string
  count: number
  /** One line under the title: what the number is made of, or why it matters. */
  hint: string
  tone: QueueTone
  /** The exact filtered list this queue opens. */
  to: string
  cta: string
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`

/**
 * The work queues in the order of urgency: what is unsafe now, then what is waiting on a
 * decision, then the routine reviews. A queue the caller's role has no access to is absent from
 * the response and so from this list.
 */
export function buildQueues(data: TodayResponse): Queue[] {
  const q = data.queues
  const list: Queue[] = [
    {
      id: 'sos', title: 'Open SOS alerts', count: q.sos.count, tone: 'danger',
      hint: 'A driver has asked for help. Acknowledge, then resolve.',
      to: '/emergency', cta: 'Respond',
    },
    {
      id: 'problems', title: 'Open problems', count: q.problems.count, tone: q.problems.overdue > 0 ? 'danger' : 'warning',
      hint: q.problems.overdue > 0 ? `${q.problems.overdue.toLocaleString('en-IN')} overdue` : 'None overdue yet',
      to: q.problems.overdue > 0 ? '/cargo?overdue=1' : '/cargo?tab=exceptions', cta: q.problems.overdue > 0 ? 'Open overdue problems' : 'Review problems',
    },
    {
      id: 'requests', title: 'New requests to accept', count: q.requests.count, tone: 'warning',
      hint: [
        q.requests.bookings > 0 && plural(q.requests.bookings, 'customer booking', 'customer bookings'),
        q.requests.vendor_loads > 0 && plural(q.requests.vendor_loads, 'vendor load', 'vendor loads'),
      ].filter(Boolean).join(' · ') || 'Nothing waiting',
      to: '/requests', cta: 'Review requests',
    },
    {
      id: 'needsVehicle', title: 'Shipments needing a vehicle', count: q.needs_vehicle.count, tone: 'warning',
      hint: [
        q.needs_vehicle.shipments > 0 && plural(q.needs_vehicle.shipments, 'shipment', 'shipments'),
        q.needs_vehicle.vendor_loads > 0 && plural(q.needs_vehicle.vendor_loads, 'vendor load', 'vendor loads'),
      ].filter(Boolean).join(' · ') || 'Everything has a vehicle',
      to: '/dispatch?tab=needs-vehicle', cta: 'Assign vehicles',
    },
    {
      id: 'tripsToSend', title: 'Trips planned but not sent', count: q.trips_to_send.count, tone: 'warning',
      hint: 'The driver is told only when you send a trip.',
      to: '/routes?status=pending', cta: 'Send trips',
    },
  ]
  if (q.unpriced) {
    list.push({
      id: 'unpriced', title: 'Deliveries with no invoice', count: q.unpriced.count, tone: 'warning',
      hint: q.unpriced.no_price > 0
        ? `${plural(q.unpriced.no_price, 'has', 'have')} no price yet; the rest can be invoiced`
        : 'All have a price and can be invoiced',
      to: '/money?tab=to-price', cta: 'Price deliveries',
    })
  }
  if (q.payment_reports) {
    list.push({
      id: 'paymentReports', title: 'Payments reported by customers', count: q.payment_reports.count, tone: 'warning',
      hint: 'Customers say they paid an invoice. Check the money arrived, then confirm or reject.',
      to: '/money?tab=invoices&reports=open', cta: 'Review payments',
    })
  }
  list.push(
    {
      id: 'vehicleRequests', title: 'Vehicle requests', count: q.vehicle_requests.count, tone: 'info',
      hint: 'Vehicles drivers registered. They take no work until approved.',
      to: '/vehicle-requests', cta: 'Review vehicles',
    },
    {
      id: 'documents', title: 'Documents to review', count: q.documents.count, tone: 'info',
      hint: 'Uploaded by drivers and staff, waiting to be verified.',
      to: '/admin/users?tab=attention', cta: 'Review documents',
    },
  )
  if (q.kyc) {
    list.push({
      id: 'kyc', title: 'KYC to review', count: q.kyc.count, tone: 'info',
      hint: 'Vendors can bid only after approval.',
      to: '/admin/kyc', cta: 'Review KYC',
    })
  }
  if (q.bids) {
    list.push({
      id: 'bids', title: 'Bids to decide', count: q.bids.count, tone: 'info',
      hint: 'Return-trip windows that closed with bids waiting.',
      to: '/bids?tab=decide', cta: 'Decide bids',
    })
  }
  list.push({
    id: 'driverActions', title: 'Driver actions refused or stops flagged', count: q.driver_actions.count, tone: 'warning',
    hint: 'Unread notifications: the server refused a driver action, or a driver flagged a stop.',
    to: '/routes?status=active', cta: 'Open active trips',
  })
  return list
}

/** Queues with something waiting, in urgency order, then those that are clear. */
export function splitQueues(queues: Queue[]): { waiting: Queue[]; clear: Queue[] } {
  return { waiting: queues.filter(q => q.count > 0), clear: queues.filter(q => q.count === 0) }
}
