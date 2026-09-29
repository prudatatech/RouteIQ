import {
  BarChart3, Banknote, Briefcase, Building2, ClipboardList, FileCheck2, History, Inbox, LayoutDashboard, Map, MapPinned,
  Package, Route, Settings, ShieldAlert, Smartphone, Truck, Users, Waypoints, type LucideIcon,
} from 'lucide-react'

export type StaffRole = 'admin' | 'superadmin'

/** Counters shown next to a navigation item. Loaded by the app shell. */
export type NavBadge = 'vendorRequests' | 'pendingPartners' | 'pendingKyc'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  roles: StaffRole[]
  badge?: NavBadge
}

export interface NavSection {
  title: string
  items: NavItem[]
}

const staff: StaffRole[] = ['admin', 'superadmin']
const superadmin: StaffRole[] = ['superadmin']

/** The console navigation, grouped by what operators do each day. */
export const navSections: NavSection[] = [
  {
    title: 'Operations',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: staff },
      { to: '/live-map', label: 'Live map', icon: MapPinned, roles: staff },
      { to: '/shipments', label: 'Shipments', icon: Package, roles: staff },
      { to: '/fleet', label: 'Fleet', icon: Truck, roles: staff },
      { to: '/emergency', label: 'Emergencies', icon: ShieldAlert, roles: staff },
    ],
  },
  {
    title: 'Planning',
    items: [
      { to: '/routes', label: 'Routes', icon: Map, roles: staff },
      { to: '/optimize', label: 'Route optimization', icon: Route, roles: staff },
      { to: '/backhaul', label: 'Backhaul pooling', icon: Waypoints, roles: staff },
    ],
  },
  {
    title: 'Marketplace',
    items: [
      { to: '/bids', label: 'Bids', icon: Briefcase, roles: staff },
      { to: '/bookings', label: 'Customer bookings', icon: Smartphone, roles: staff },
      { to: '/vendor-requests', label: 'Vendor requests', icon: Inbox, roles: staff, badge: 'vendorRequests' },
      { to: '/3pl-partners', label: '3PL partners', icon: Building2, roles: superadmin, badge: 'pendingPartners' },
    ],
  },
  {
    title: 'Insights',
    items: [
      { to: '/analytics', label: 'Analytics', icon: BarChart3, roles: staff },
      { to: '/finance', label: 'Finance', icon: Banknote, roles: staff },
    ],
  },
  {
    title: 'Admin',
    items: [
      { to: '/admin/users', label: 'Users', icon: Users, roles: superadmin },
      { to: '/admin/kyc', label: 'KYC review', icon: FileCheck2, roles: superadmin, badge: 'pendingKyc' },
      { to: '/admin/audit', label: 'Audit log', icon: History, roles: superadmin },
      { to: '/admin/settings', label: 'Settings', icon: Settings, roles: staff },
    ],
  },
]

/** Pages that draw edge to edge (maps) instead of inside the standard content width. */
export const fullBleedPaths = ['/live-map']

export const trackingPageLink = { to: '/track', label: 'Customer tracking page', icon: ClipboardList }
