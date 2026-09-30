import { lazy, type ComponentType } from 'react'

/** A dynamic `import()` for a page module (default export only). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PageImporter = () => Promise<{ default: ComponentType<any> }>

/**
 * One entry per route-split page: `Component` for `React.lazy`, `preload` to
 * warm the chunk ahead of navigation (see `routePrefetch` below and
 * `AppLayout`/`VendorLayout`, which call it on link hover/focus).
 */
function page(importer: PageImporter) {
  return { Component: lazy(importer), preload: importer }
}

// Console (behind AppLayout)
export const today = page(() => import('@/pages/TodayPage'))
export const fleet = page(() => import('@/pages/FleetPage'))
export const fleetVehicle = page(() => import('@/pages/fleet/VehicleDetailPage'))
export const vehicleRequests = page(() => import('@/pages/VehicleRequestsPage'))
export const routes = page(() => import('@/pages/RoutesPage'))
export const routeDetails = page(() => import('@/pages/RouteDetailsPage'))
export const analytics = page(() => import('@/pages/AnalyticsPage'))
export const finance = page(() => import('@/pages/FinancePage'))
export const insights = page(() => import('@/pages/InsightsPage'))
export const optimize = page(() => import('@/pages/OptimizePage'))
export const routePlanner = page(() => import('@/pages/RoutePlannerPage'))
export const shipments = page(() => import('@/pages/ShipmentsPage'))
export const shipmentPage = page(() => import('@/pages/ShipmentPage'))
export const dispatchWorkspace = page(() => import('@/pages/DispatchPage'))
export const shipmentManifest = page(() => import('@/pages/ShipmentManifestPage'))
export const emergency = page(() => import('@/pages/EmergencyPage'))
export const cargo = page(() => import('@/pages/cargo/CargoPage'))
export const cargoException = page(() => import('@/pages/cargo/ExceptionCasePage'))
export const cargoTransfer = page(() => import('@/pages/cargo/TransferPage'))
export const returnTrips = page(() => import('@/pages/ReturnTripsPage'))
export const requests = page(() => import('@/pages/RequestsPage'))
export const liveMap = page(() => import('@/pages/LiveMapPage'))
export const tplPartnerDetail = page(() => import('@/pages/TplPartnerDetailPage'))
export const adminUsers = page(() => import('@/pages/admin/UsersPage'))
export const adminPerson = page(() => import('@/pages/admin/PersonPage'))
export const adminKyc = page(() => import('@/pages/admin/KycReviewPage'))
export const adminAudit = page(() => import('@/pages/admin/AuditLogPage'))
export const adminSettings = page(() => import('@/pages/admin/SettingsPage'))

// Behind VendorLayout
export const vendorPortal = page(() => import('@/pages/VendorPortalPage'))
export const vendorCorridor = page(() => import('@/pages/VendorCorridorPage'))
export const vendorOnboarding = page(() => import('@/pages/VendorOnboardingPage'))
export const vendorDocuments = page(() => import('@/pages/VendorDocumentsPage'))
export const vendorShipments = page(() => import('@/pages/VendorShipmentsPage'))
export const vendorInvoices = page(() => import('@/pages/VendorInvoicesPage'))
export const vendorShipmentRequest = page(() => import('@/pages/VendorShipmentRequestPage'))
export const vendorTracking = page(() => import('@/pages/VendorTrackingPage'))

// No shell (their own top-level route)
export const driver = page(() => import('@/pages/DriverPage'))
export const customerTracking = page(() => import('@/pages/CustomerTrackingPage'))
export const mobileTrack = page(() => import('@/pages/MobileTrackPage'))
export const vehicleShare = page(() => import('@/pages/VehicleSharePage'))
export const tplOnboarding = page(() => import('@/pages/TplOnboardingPage'))
export const tplTrackApplication = page(() => import('@/pages/TplTrackApplicationPage'))
export const tplSetupCredentials = page(() => import('@/pages/TplSetupCredentialsPage'))
export const tplDashboard = page(() => import('@/pages/TplDashboardPage'))

/**
 * Route path → chunk preloader, for warming a page's JS on hover/focus of its
 * nav link (see `AppLayout` and `VendorLayout`). Matches `navSections` and
 * `VendorLayout`'s `links`, plus a few routes reached from within a page.
 */
export const routePrefetch: Record<string, PageImporter> = {
  '/today': today.preload,
  '/fleet': fleet.preload,
  '/vehicle-requests': vehicleRequests.preload,
  '/routes': routes.preload,
  '/live-map': liveMap.preload,
  '/shipments': shipments.preload,
  '/dispatch': dispatchWorkspace.preload,
  '/emergency': emergency.preload,
  '/cargo': cargo.preload,
  '/optimize': optimize.preload,
  '/route-planner': routePlanner.preload,
  '/return-trips': returnTrips.preload,
  '/requests': requests.preload,
  '/analytics': analytics.preload,
  '/finance': finance.preload,
  '/insights': insights.preload,
  '/admin/users': adminUsers.preload,
  '/admin/kyc': adminKyc.preload,
  '/admin/audit': adminAudit.preload,
  '/admin/settings': adminSettings.preload,
  '/track': customerTracking.preload,
  '/vendor': vendorPortal.preload,
  '/vendor/corridor': vendorCorridor.preload,
  '/vendor/shipments': vendorShipments.preload,
  '/vendor/invoices': vendorInvoices.preload,
  '/vendor/tracking': vendorTracking.preload,
  '/vendor/documents': vendorDocuments.preload,
}
