import {
  BarChart3, Banknote, CalendarCheck, Inbox, MapPinned, Package, Route, Settings, Truck, Users, Waypoints, type LucideIcon,
  ClipboardList, Building2,
} from 'lucide-react'

export type StaffRole = 'admin' | 'superadmin' | 'manager'

/** The counts the menu shows: what needs someone, per section and per sub-link. */
export type NavBadge =
  | 'today' | 'requests' | 'bookings' | 'vendorLoads'
  | 'dispatch' | 'needsVehicle' | 'tripsToSend'
  | 'onTheRoad' | 'problems' | 'sos'
  | 'fleet' | 'vehicleRequests'
  | 'people' | 'documents' | 'kyc'
  | 'returnTrips' | 'bids' | 'pendingPartners'
  | 'money' | 'pendingOrgs'

export interface NavChild {
  /** Path, with the query string when the link opens a filtered view (`/routes?status=active`). */
  to: string
  label: string
  roles: StaffRole[]
  badge?: NavBadge
  /** Other addresses that belong to this link (an invoice's own page lights Invoices). */
  alsoMatch?: string[]
}

export interface NavSection {
  /** The section's landing page. */
  to: string
  label: string
  icon: LucideIcon
  roles: StaffRole[]
  badge?: NavBadge
  /** Extra paths that belong to the section but are not one of its links (detail pages). */
  also?: string[]
  /** The pages of the section, shown under it while it is open. */
  children: NavChild[]
}

const admins: StaffRole[] = ['admin', 'superadmin']
const superadmin: StaffRole[] = ['superadmin']
const everyone: StaffRole[] = ['admin', 'superadmin', 'manager']

/**
 * The staff menu: eleven sections in the order the work happens (docs/workflow-blueprint.html).
 * Managers see the operations sections only: no Money, Reports, Settings, KYC or 3PL.
 */
export const navSections: NavSection[] = [
  {
    to: '/today', label: 'Today', icon: CalendarCheck, roles: everyone, badge: 'today',
    children: [],
  },
  {
    to: '/requests', label: 'Requests', icon: Inbox, roles: everyone, badge: 'requests',
    children: [
      { to: '/bookings', label: 'Customer bookings', roles: everyone, badge: 'bookings' },
      { to: '/vendor-requests', label: 'Vendor loads', roles: everyone, badge: 'vendorLoads' },
    ],
  },
  { to: '/shipments', label: 'Shipments', icon: Package, roles: everyone, children: [] },
  {
    to: '/dispatch', label: 'Dispatch', icon: Route, roles: everyone, badge: 'dispatch',
    children: [
      { to: '/dispatch?tab=needs-vehicle', label: 'Needs a vehicle', roles: everyone, badge: 'needsVehicle' },
      { to: '/routes?status=pending', label: 'Trips to send', roles: everyone, badge: 'tripsToSend' },
      { to: '/routes', label: 'All trips', roles: everyone },
      { to: '/route-planner', label: 'Plan a trip', roles: everyone },
      { to: '/optimize', label: 'Optimize', roles: everyone },
    ],
  },
  {
    to: '/live-map', label: 'On the road', icon: MapPinned, roles: everyone, badge: 'onTheRoad',
    children: [
      { to: '/live-map', label: 'Live map', roles: everyone },
      { to: '/routes?status=active', label: 'Active trips', roles: everyone },
      { to: '/cargo', label: 'Problems', roles: everyone, badge: 'problems' },
      { to: '/emergency', label: 'SOS alerts', roles: everyone, badge: 'sos' },
    ],
  },
  {
    to: '/fleet', label: 'Fleet', icon: Truck, roles: everyone, badge: 'fleet',
    children: [
      { to: '/fleet', label: 'Vehicles', roles: everyone },
      { to: '/vehicle-requests', label: 'Vehicle requests', roles: everyone, badge: 'vehicleRequests' },
    ],
  },
  {
    to: '/admin/users', label: 'People', icon: Users, roles: everyone, badge: 'people',
    children: [
      { to: '/admin/users', label: 'People', roles: everyone, badge: 'documents' },
    ],
  },
  {
    to: '/return-trips', label: 'Return trips', icon: Waypoints, roles: admins, badge: 'returnTrips',
    // A partner's own page is under /3pl-partners; it belongs to this section too
    also: ['/3pl-partners'],
    children: [
      { to: '/return-trips', label: 'Open return trips', roles: admins },
      { to: '/return-trips?tab=bids', label: 'Bids to decide', roles: admins, badge: 'bids' },
      { to: '/return-trips?tab=pool', label: 'Combine loads', roles: admins },
      { to: '/return-trips?tab=partners', label: '3PL partners', roles: superadmin, badge: 'pendingPartners' },
    ],
  },
  {
    to: '/money', label: 'Money', icon: Banknote, roles: admins, badge: 'money',
    // Old claim links and notifications still open /cargo?tab=claims: keep Money lit for them
    also: ['/cargo?tab=claims'],
    children: [
      { to: '/money', label: 'To price', roles: admins, badge: 'money' },
      { to: '/money?tab=invoices', label: 'Invoices', roles: admins, alsoMatch: ['/money/invoices'] },
      { to: '/money?tab=driver-pay', label: 'Driver pay', roles: admins },
      { to: '/money?tab=expenses', label: 'Expenses', roles: admins },
      { to: '/money?tab=claims', label: 'Claims', roles: admins },
    ],
  },
  {
    to: '/analytics', label: 'Reports', icon: BarChart3, roles: admins,
    children: [
      { to: '/analytics', label: 'Analytics', roles: admins },
      { to: '/insights', label: 'Insights', roles: admins },
    ],
  },
  {
    to: '/admin/settings', label: 'Settings', icon: Settings, roles: admins,
    children: [
      { to: '/admin/settings', label: 'Settings', roles: admins },
      { to: '/admin/organisation', label: 'Organisation', roles: admins },
      { to: '/admin/audit', label: 'Audit log', roles: superadmin },
    ],
  },
]

/** The platform owner's section. Shown only while acting as the platform organisation. */
export const platformSection: NavSection = {
  to: '/platform/organisations', label: 'Platform', icon: Building2, roles: admins, badge: 'pendingOrgs',
  children: [
    { to: '/platform/organisations', label: 'Organisations', roles: admins, badge: 'pendingOrgs' },
    // Vendor verification is the platform's, not a company's (docs/platform-model.md)
    { to: '/admin/kyc', label: 'KYC review', roles: admins, badge: 'kyc' },
  ],
}

/** Sections and links this role may see. A section left with no page of its own is dropped. */
export function menuFor(role: string | null | undefined, actor: 'platform' | 'company' = 'company'): NavSection[] {
  if (!role) return []
  const allowed = (roles: StaffRole[]) => (roles as string[]).includes(role)
  const sections = (actor === 'platform' ? [navSections[0], platformSection, ...navSections.slice(1)] : navSections)
  return sections
    .filter(s => allowed(s.roles))
    .map(s => ({ ...s, children: s.children.filter(c => allowed(c.roles)) }))
}

const splitLink = (link: string) => {
  const [path, query = ''] = link.split('?')
  return { path, params: new URLSearchParams(query) }
}

/** How well a link fits the current address; -1 when it does not. A link with a query needs every part of it. */
function matchScore(link: string, pathname: string, search: string): number {
  const { path, params } = splitLink(link)
  if (pathname !== path && !pathname.startsWith(`${path}/`)) return -1
  const current = new URLSearchParams(search)
  for (const [key, value] of params) if (current.get(key) !== value) return -1
  return path.length + params.size * 1000
}

/** The section the current address belongs to, and the link inside it that fits best (if any). */
export function activeNav(sections: NavSection[], pathname: string, search: string): { section: NavSection | null; child: NavChild | null } {
  let best: { section: NavSection; child: NavChild | null; score: number } | null = null
  for (const section of sections) {
    const candidates: { link: string; child: NavChild | null }[] = [
      { link: section.to, child: null },
      ...section.children.flatMap(child => [child.to, ...(child.alsoMatch ?? [])].map(link => ({ link, child }))),
      ...(section.also ?? []).map(link => ({ link, child: null })),
    ]
    for (const { link, child } of candidates) {
      const score = matchScore(link, pathname, search)
      // A page's own link wins a tie with its section's landing link
      if (score >= 0 && score >= (best?.score ?? -1)) best = { section, child, score }
    }
  }
  return best ? { section: best.section, child: best.child } : { section: null, child: null }
}

/** The queue counts Today returns (GET /ops/today), as far as the menu needs them. */
export interface QueueCounts {
  sos?: { count: number }
  problems?: { count: number; overdue: number }
  requests?: { count: number; bookings: number; vendor_loads: number }
  needs_vehicle?: { count: number }
  trips_to_send?: { count: number }
  vehicle_requests?: { count: number }
  documents?: { count: number }
  kyc?: { count: number }
  bids?: { count: number }
  unpriced?: { count: number }
  payment_reports?: { count: number }
}

/** Menu badge counts from the Today queues (plus 3PL applications, which have no queue on Today). */
export function navBadgeCounts(queues: QueueCounts | undefined, pendingPartners: number, pendingOrgs = 0): Record<NavBadge, number> {
  const n = (q?: { count: number }) => q?.count ?? 0
  const sos = n(queues?.sos)
  const problems = n(queues?.problems)
  const needsVehicle = n(queues?.needs_vehicle)
  const tripsToSend = n(queues?.trips_to_send)
  const vehicleRequests = n(queues?.vehicle_requests)
  const documents = n(queues?.documents)
  const kyc = n(queues?.kyc)
  const bids = n(queues?.bids)
  return {
    today: sos + (queues?.problems?.overdue ?? 0),
    requests: n(queues?.requests),
    bookings: queues?.requests?.bookings ?? 0,
    vendorLoads: queues?.requests?.vendor_loads ?? 0,
    dispatch: needsVehicle + tripsToSend,
    needsVehicle,
    tripsToSend,
    onTheRoad: sos + problems,
    problems,
    sos,
    fleet: vehicleRequests,
    vehicleRequests,
    people: documents + kyc,
    documents,
    kyc,
    returnTrips: bids + pendingPartners,
    bids,
    pendingPartners,
    money: n(queues?.unpriced) + n(queues?.payment_reports),
    pendingOrgs,
  }
}

/** Pages that draw edge to edge (maps) instead of inside the standard content width. */
/** The menu name of the page at an address ("Money" for /money/invoices), or null when it is not in the menu. */
export function pageNameFor(pathname: string): string | null {
  let best: { name: string; length: number } | null = null
  for (const section of navSections) {
    for (const { link, name } of [{ link: section.to, name: section.label }, ...section.children.map(c => ({ link: c.to, name: section.label }))]) {
      const path = link.split('?')[0]
      if ((pathname === path || pathname.startsWith(`${path}/`)) && path.length > (best?.length ?? 0)) best = { name, length: path.length }
    }
  }
  return best?.name ?? null
}

export const fullBleedPaths = ['/live-map']

export const trackingPageLink = { to: '/track', label: 'Customer tracking page', icon: ClipboardList }
