/**
 * Where a notification takes the person who clicks it, per its `type` and `data`.
 * Staff, shippers (vendors) and 3PL partners get different sets: the backend sends
 * each type to one audience only, and this lists every type it sends.
 */

export type NotificationAudience = 'staff' | 'vendor'

export interface NotificationLike {
  type: string
  data: Record<string, unknown> | null
}

type Resolver = (data: Record<string, unknown>) => string | null

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const withOpen = (base: string, id: unknown) => {
  const open = str(id)
  return open ? `${base}${base.includes('?') ? '&' : '?'}open=${encodeURIComponent(open)}` : base
}

/** The 3PL partner dashboard lives at /3pl-portal/<partner id>; without the id there is nowhere to go. */
const partnerPage = (tab: string, openKey?: string): Resolver => data => {
  const partnerId = str(data.partner_id)
  if (!partnerId) return null
  return withOpen(`/3pl-portal/${partnerId}?tab=${tab}`, openKey ? data[openKey] : null)
}

const STAFF: Record<string, Resolver> = {
  sos: d => withOpen('/emergency', d.alert_id),
  vendor_request: d => withOpen('/vendor-requests', d.request_id),
  vendor_request_cancelled: d => withOpen('/vendor-requests', d.request_id),
  customer_booking: d => withOpen('/bookings', d.booking_id),
  capacity_bid: d => withOpen('/bids', d.bid_id),
  capacity_window_closed: d => withOpen('/bids', d.window_id),
  stop_flagged: d => withOpen('/bids', d.bid_id ?? d.window_id),
  kyc_submitted: d => withOpen('/admin/kyc', d.profile_id),
  tpl_application: d => withOpen('/3pl-partners', d.partner_id),
  tpl_update: d => withOpen('/3pl-partners', d.partner_id),
  tpl_order_status: d => str(d.partner_id) ? `/3pl-partners/${str(d.partner_id)}` : '/3pl-partners',
  tpl_order_accepted: d => str(d.partner_id) ? `/3pl-partners/${str(d.partner_id)}` : '/3pl-partners',
  tpl_offer_declined: d => str(d.partner_id) ? `/3pl-partners/${str(d.partner_id)}` : '/3pl-partners',
  stop_failed: d => withOpen('/shipments', d.manifest_id),
  route_postponed: d => (str(d.route_id) ? `/routes/${str(d.route_id)}` : '/routes'),
  vehicle_request: d => withOpen('/vehicle-requests', d.vehicle_id),
  fleet_alert: d => withOpen('/fleet?tab=alerts', d.alert_id),
  document_expiring: d => (str(d.user_id) ? `/admin/users/${str(d.user_id)}?tab=documents` : '/admin/users?tab=attention'),
}

const VENDOR: Record<string, Resolver> = {
  // Loads they posted
  request_approved: d => withOpen('/vendor/shipments', d.request_id),
  request_rejected: d => withOpen('/vendor/shipments', d.request_id),
  vehicle_assigned: d => withOpen('/vendor/shipments', d.request_id),
  request_escalated: d => withOpen('/vendor/shipments', d.request_id),
  request_assigned_partner: d => withOpen('/vendor/shipments', d.request_id),
  request_completed: d => withOpen('/vendor/shipments', d.request_id),
  load_picked_up: d => withOpen('/vendor/shipments', d.request_id),
  load_in_transit: d => withOpen('/vendor/shipments', d.request_id),
  // KYC
  kyc_approved: () => '/vendor/documents',
  kyc_rejected: () => '/vendor/documents',
  // Capacity bids
  bid_accepted: d => withOpen('/vendor/shipments', d.bid_id),
  bid_lost: d => withOpen('/vendor/shipments', d.bid_id),
  bid_rejected: d => withOpen('/vendor/shipments', d.bid_id),
  bid_expired: d => withOpen('/vendor/shipments', d.bid_id),
  bid_reopened: d => withOpen('/vendor/shipments', d.bid_id),
  passing_route: () => '/vendor/corridor',
  // 3PL partner
  tpl_offer: partnerPage('orders', 'offer_id'),
  tpl_offer_taken: partnerPage('orders'),
  tpl_offer_withdrawn: partnerPage('orders'),
  tpl_order_paid: partnerPage('earnings'),
  tpl_approved: partnerPage('overview'),
  tpl_paused: partnerPage('overview'),
  tpl_resumed: partnerPage('overview'),
  tpl_rejected: partnerPage('overview'),
}

/** The page a notification opens, or null when it has no page (it is then only marked read). */
export function notificationPath(n: NotificationLike, audience: NotificationAudience): string | null {
  const resolver = (audience === 'staff' ? STAFF : VENDOR)[n.type]
  return resolver ? resolver(n.data ?? {}) : null
}

/** Every type with a target, for tests that check the backend's types are all covered. */
export const STAFF_NOTIFICATION_TYPES = Object.keys(STAFF)
export const VENDOR_NOTIFICATION_TYPES = Object.keys(VENDOR)
