import { Suspense, useEffect, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/services/supabase'
import type { Session, AuthChangeEvent } from '@supabase/supabase-js'
import AppLayout from '@/components/ui/AppLayout'
import { Button, ConfirmProvider, EmptyState, LoadingState, Spinner } from '@/components/ui'
import { Lock } from 'lucide-react'
import { loadAccount } from '@/services/account'
import { ChunkErrorBoundary } from '@/components/ChunkErrorBoundary'
import { inboxLink, type RequestSource } from '@/components/requests/model'
import LoginPage from '@/pages/LoginPage'
import LandingPage from '@/pages/LandingPage'
import NotFoundPage from '@/pages/NotFoundPage'
import VendorLayout from '@/components/ui/VendorLayout'
import {
  today, fleet, fleetVehicle, vehicleRequests, routes, routeDetails, analytics, insights, optimize, routePlanner, shipments, shipmentPage, dispatchWorkspace, shipmentManifest, emergency, cargo, cargoException, cargoTransfer, bids,
  backhaul, requests, liveMap, tplPartners, tplPartnerDetail, adminUsers, adminPerson, adminKyc, adminAudit, finance, adminSettings, vendorInvoices,
  vendorPortal, vendorCorridor, vendorOnboarding, vendorDocuments, vendorShipments, vendorShipmentRequest, vendorTracking,
  driver, customerTracking, mobileTrack, vehicleShare, tplOnboarding, tplTrackApplication, tplSetupCredentials, tplDashboard,
} from '@/config/lazyPages'

const TodayPage = today.Component
const FleetPage = fleet.Component
const VehicleDetailPage = fleetVehicle.Component
const VehicleRequestsPage = vehicleRequests.Component
const RoutesPage = routes.Component
const RouteDetailsPage = routeDetails.Component
const AnalyticsPage = analytics.Component
const InsightsPage = insights.Component
const OptimizePage = optimize.Component
const RoutePlannerPage = routePlanner.Component
const UsersPage = adminUsers.Component
const PersonPage = adminPerson.Component
const KycReviewPage = adminKyc.Component
const AuditLogPage = adminAudit.Component
const FinancePage = finance.Component
const SettingsPage = adminSettings.Component
const VendorInvoicesPage = vendorInvoices.Component
const BackhaulPage = backhaul.Component
const ShipmentsPage = shipments.Component
const ShipmentManifestPage = shipmentManifest.Component
const ShipmentPage = shipmentPage.Component
const DispatchPage = dispatchWorkspace.Component
const EmergencyPage = emergency.Component
const CargoPage = cargo.Component
const ExceptionCasePage = cargoException.Component
const TransferPage = cargoTransfer.Component
const DriverPage = driver.Component
const CustomerTrackingPage = customerTracking.Component
const TplPartnersPage = tplPartners.Component
const TplPartnerDetailPage = tplPartnerDetail.Component
const TplOnboardingPage = tplOnboarding.Component
const TplTrackApplicationPage = tplTrackApplication.Component
const TplSetupCredentialsPage = tplSetupCredentials.Component
const TplDashboardPage = tplDashboard.Component
const LiveMapPage = liveMap.Component
const MobileTrackPage = mobileTrack.Component
const VehicleSharePage = vehicleShare.Component
const BidsPage = bids.Component
const VendorPortalPage = vendorPortal.Component
const VendorTrackingPage = vendorTracking.Component
const VendorShipmentRequestPage = vendorShipmentRequest.Component
const VendorOnboardingPage = vendorOnboarding.Component
const VendorDocumentsPage = vendorDocuments.Component
const VendorShipmentsPage = vendorShipments.Component
const VendorCorridorPage = vendorCorridor.Component
const RequestsPage = requests.Component

/** Who may open which part of the console. Managers run operations only: no money, settings, audit, KYC or 3PL. */
const OPERATIONS = ['superadmin', 'admin', 'manager']
const ADMINS = ['superadmin', 'admin']
const SUPERADMIN = ['superadmin']

/** Fallback for a route that isn't behind a shell (no sidebar/header to keep on screen). */
function PageFallback() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-bg">
      <LoadingState label="Loading" />
    </div>
  )
}

/** Suspense boundary for a lazy page that has no `AppLayout`/`VendorLayout` around it. */
function LazyRoute({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageFallback />}>{children}</Suspense>
}

/** Redirect an old address to its new one, keeping the query string and navigation state. */
function MovedTo({ to }: { to: string }) {
  const location = useLocation()
  return <Navigate to={{ pathname: to, search: location.search, hash: location.hash }} state={location.state} replace />
}

/** Send an old bookings or vendor-loads address to the Requests inbox, with the source, tab and ?open= carried over. */
function MovedToRequests({ source }: { source: RequestSource }) {
  const location = useLocation()
  return <Navigate to={inboxLink(source, location.search)} state={location.state} replace />
}

/** Home page for a role, from the store. Vendors without a profile are routed later by the vendor pages. */
function homeForRole(role: string | null): string | null {
  if (role === 'admin' || role === 'superadmin' || role === 'manager') return '/today'
  if (role === 'driver') return '/driver'
  if (role === 'vendor') return '/vendor'
  return null
}

function NoAccess() {
  const clearAuth = useAuthStore(s => s.clearAuth)
  const signOut = async () => {
    try { await supabase.auth.signOut() } catch (err) { console.error('Sign-out failed', err) }
    clearAuth()
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <EmptyState
        icon={<Lock size={22} />}
        title="This account can't use the web app"
        description="Ask your MargixIndia administrator to give your account access, or sign in with a different account."
        action={<Button variant="secondary" onClick={signOut}>Sign out</Button>}
      />
    </div>
  )
}

function PrivateRoute({ children, allowedRoles }: { children: React.ReactNode, allowedRoles?: string[] }) {
  const location = useLocation()
  const token = useAuthStore(s => s.token)
  const role = useAuthStore(s => s.role)
  const authInitialized = useAuthStore(s => s.authInitialized)

  // Supabase's session (and this store) haven't finished restoring yet — e.g. a hard
  // reload of a deep link. Show a spinner instead of bouncing to /login prematurely.
  if (!authInitialized) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-bg">
        <Spinner size={32} />
      </div>
    )
  }

  if (!token) {
    // Come back here after signing in; vendor and 3PL pages open the partner sign-in.
    const params = new URLSearchParams({ next: `${location.pathname}${location.search}` })
    if (location.pathname.startsWith('/vendor') || location.pathname.startsWith('/3pl-portal')) params.set('as', 'vendor')
    return <Navigate to={`/login?${params}`} replace />
  }

  // If this route is restricted to certain roles
  if (allowedRoles && (!role || !allowedRoles.includes(role))) {
    const home = homeForRole(role)
    // Accounts with no area in the web app (no role, customers) would
    // otherwise bounce between redirects forever.
    if (!home || home === location.pathname) return <NoAccess />
    return <Navigate to={home} replace />
  }

  return <>{children}</>
}

// The vendor sign-in page is now the partner option of /login. Keep ?next= and the rest.
function VendorLoginRedirect() {
  const { search, hash } = useLocation()
  const params = new URLSearchParams(search)
  params.set('as', 'vendor')
  return <Navigate to={{ pathname: '/login', search: `?${params}`, hash }} replace />
}

// Old activation links point here; the real flow is the 3PL credential setup.
// Keep the query string (e.g. ?email=) so the setup form is prefilled.
function TplActivateRedirect() {
  const { search } = useLocation()
  return <Navigate to={`/3pl/onboard/setup${search}`} replace />
}

// The verification page merged into the partner detail page at /3pl-partners/:id.
function TplVerifyRedirect() {
  const [searchParams] = useSearchParams()
  const id = searchParams.get('id')
  return <Navigate to={id ? `/3pl-partners/${id}` : '/3pl-partners'} replace />
}

export default function App() {
  useEffect(() => {
    const store = useAuthStore.getState()
    // Roles come from the database (users, vendor_profiles, tpl_partners), never from
    // user_metadata, which users can edit themselves.
    const restore = async (session: Session | null) => {
      if (!session) {
        store.setSession(null)
        return
      }
      try {
        const account = await loadAccount(session.user.id)
        store.setSession(session, account.role)
      } catch (err) {
        console.error('Failed to load the account role', err)
        store.setSession(session, null)
      }
    }

    supabase.auth.getSession()
      .then(({ data: { session } }) => restore(session))
      .catch(err => {
        console.error('Failed to restore session', err)
        store.setSession(null)
      })
      // Always release the gate, or protected routes would spin forever
      .finally(() => useAuthStore.getState().setAuthInitialized(true))

    const { data: listener } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      if (event === 'SIGNED_OUT') store.setSession(null)
      else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') restore(session)
    })

    return () => {
      listener.subscription.unsubscribe()
    }
  }, [])

  return (
    <>
      <Toaster
        position="top-center"
        toastOptions={{
          className: '!rounded-control !border !border-border !bg-surface !text-sm !text-text !shadow-raised',
          success: { iconTheme: { primary: 'var(--color-success)', secondary: 'var(--color-surface)' } },
          error: { iconTheme: { primary: 'var(--color-danger)', secondary: 'var(--color-surface)' } },
        }}
      />
      <ConfirmProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ChunkErrorBoundary>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/track" element={<LazyRoute><CustomerTrackingPage /></LazyRoute>} />
          <Route path="/track/:trackingId" element={<LazyRoute><CustomerTrackingPage /></LazyRoute>} />
          {/* Public mobile GPS tracking page — no auth needed */}
          <Route path="/m/:token" element={<LazyRoute><MobileTrackPage /></LazyRoute>} />
          <Route path="/share/:token" element={<LazyRoute><VehicleSharePage /></LazyRoute>} />
          <Route path="/driver" element={
            <LazyRoute><PrivateRoute allowedRoles={['superadmin', 'admin', 'driver']}>
              <DriverPage />
            </PrivateRoute></LazyRoute>
          } />
          <Route path="/driver/dashboard" element={
            <LazyRoute><PrivateRoute allowedRoles={['superadmin', 'admin', 'driver']}>
              <DriverPage />
            </PrivateRoute></LazyRoute>
          } />
          {/* Vendor Portal — home/discover and corridors are intentionally public (browsable
              before login; corridor bidding itself redirects to sign-in when there's no
              session). Everything that needs a vendor account is gated below. */}
          <Route path="/vendor" element={<VendorLayout />}>
            <Route index element={<VendorPortalPage />} />
            <Route path="corridor" element={<VendorCorridorPage />} />
            <Route path="onboarding" element={
              <PrivateRoute allowedRoles={['vendor']}>
                <VendorOnboardingPage />
              </PrivateRoute>
            } />
            <Route path="documents" element={
              <PrivateRoute allowedRoles={['vendor']}>
                <VendorDocumentsPage />
              </PrivateRoute>
            } />
            <Route path="shipments" element={
              <PrivateRoute allowedRoles={['vendor']}>
                <VendorShipmentsPage />
              </PrivateRoute>
            } />
            <Route path="invoices" element={
              <PrivateRoute allowedRoles={['vendor']}>
                <VendorInvoicesPage />
              </PrivateRoute>
            } />
            <Route path="request" element={
              <PrivateRoute allowedRoles={['vendor']}>
                <VendorShipmentRequestPage />
              </PrivateRoute>
            } />
            <Route path="tracking" element={
              <PrivateRoute allowedRoles={['vendor']}>
                <VendorTrackingPage />
              </PrivateRoute>
            } />
          </Route>

          <Route path="/vendor/login" element={<VendorLoginRedirect />} />

          {/* 3PL Public/Partner Routes */}
          <Route path="/3pl/onboard" element={<LazyRoute><TplOnboardingPage /></LazyRoute>} />
          <Route path="/3pl/onboard/track" element={<LazyRoute><TplTrackApplicationPage /></LazyRoute>} />
          <Route path="/3pl/onboard/setup" element={<LazyRoute><TplSetupCredentialsPage /></LazyRoute>} />
          <Route path="/3pl-portal/activate" element={<TplActivateRedirect />} />
          <Route path="/3pl-portal/:id" element={
            <LazyRoute><PrivateRoute allowedRoles={['vendor']}>
              <TplDashboardPage />
            </PrivateRoute></LazyRoute>
          } />

          {/* Public Landing Page */}
          <Route path="/" element={<LandingPage />} />

          <Route element={
            <PrivateRoute>
              <AppLayout />
            </PrivateRoute>
          }>
            <Route path="today" element={
              <PrivateRoute allowedRoles={OPERATIONS}>
                <TodayPage />
              </PrivateRoute>
            } />
            {/* Today replaced the dashboard as the staff home page */}
            <Route path="dashboard" element={<MovedTo to="/today" />} />
            <Route path="shipments" element={
              <PrivateRoute allowedRoles={OPERATIONS}>
                <ShipmentsPage />
              </PrivateRoute>
            } />
            <Route path="shipments/:id" element={
              <PrivateRoute allowedRoles={['superadmin', 'admin', 'manager']}>
                <ShipmentPage />
              </PrivateRoute>
            } />
            <Route path="dispatch" element={
              <PrivateRoute allowedRoles={['superadmin', 'admin', 'manager']}>
                <DispatchPage />
              </PrivateRoute>
            } />
            <Route path="shipments/:id/manifest" element={
              <PrivateRoute allowedRoles={OPERATIONS}>
                <ShipmentManifestPage />
              </PrivateRoute>
            } />
            <Route path="cargo" element={
              <PrivateRoute allowedRoles={OPERATIONS}>
                <CargoPage />
              </PrivateRoute>
            } />
            <Route path="cargo/exceptions/:id" element={
              <PrivateRoute allowedRoles={OPERATIONS}>
                <ExceptionCasePage />
              </PrivateRoute>
            } />
            <Route path="cargo/transfers/:id" element={
              <PrivateRoute allowedRoles={OPERATIONS}>
                <TransferPage />
              </PrivateRoute>
            } />
            <Route path="fleet" element={
              <PrivateRoute allowedRoles={OPERATIONS}>
                <FleetPage />
              </PrivateRoute>
            } />
            <Route path="fleet/:vehicleId" element={
              <PrivateRoute allowedRoles={OPERATIONS}>
                <VehicleDetailPage />
              </PrivateRoute>
            } />
            <Route path="vehicle-requests" element={
              <PrivateRoute allowedRoles={OPERATIONS}>
                <VehicleRequestsPage />
              </PrivateRoute>
            } />
            <Route path="routes" element={
              <PrivateRoute allowedRoles={OPERATIONS}>
                <RoutesPage />
              </PrivateRoute>
            } />
            <Route path="routes/:id" element={
              <PrivateRoute allowedRoles={OPERATIONS}>
                <RouteDetailsPage />
              </PrivateRoute>
            } />
            <Route path="emergency" element={
              <PrivateRoute allowedRoles={OPERATIONS}>
                <EmergencyPage />
              </PrivateRoute>
            } />
            <Route path="optimize" element={
              <PrivateRoute allowedRoles={OPERATIONS}>
                <OptimizePage />
              </PrivateRoute>
            } />
            <Route path="route-planner" element={
              <PrivateRoute allowedRoles={OPERATIONS}>
                <RoutePlannerPage />
              </PrivateRoute>
            } />
            <Route path="bids" element={
              <PrivateRoute allowedRoles={ADMINS}>
                <BidsPage />
              </PrivateRoute>
            } />
            <Route path="analytics" element={
              <PrivateRoute allowedRoles={ADMINS}>
                <AnalyticsPage />
              </PrivateRoute>
            } />
            <Route path="finance" element={
              <PrivateRoute allowedRoles={ADMINS}>
                <FinancePage />
              </PrivateRoute>
            } />
            <Route path="admin/settings" element={
              <PrivateRoute allowedRoles={ADMINS}>
                <SettingsPage />
              </PrivateRoute>
            } />
            <Route path="admin/users" element={
              <PrivateRoute allowedRoles={OPERATIONS}>
                <UsersPage />
              </PrivateRoute>
            } />
            <Route path="admin/users/:id" element={
              <PrivateRoute allowedRoles={OPERATIONS}>
                <PersonPage />
              </PrivateRoute>
            } />
            <Route path="admin/kyc" element={
              <PrivateRoute allowedRoles={ADMINS}>
                <KycReviewPage />
              </PrivateRoute>
            } />
            <Route path="admin/audit" element={
              <PrivateRoute allowedRoles={SUPERADMIN}>
                <AuditLogPage />
              </PrivateRoute>
            } />
            <Route path="3pl-partners" element={
              <PrivateRoute allowedRoles={SUPERADMIN}>
                <TplPartnersPage />
              </PrivateRoute>
            } />
            <Route path="3pl-partners/verify" element={<TplVerifyRedirect />} />
            <Route path="3pl-partners/:id" element={
              <PrivateRoute allowedRoles={SUPERADMIN}>
                <TplPartnerDetailPage />
              </PrivateRoute>
            } />
            <Route path="insights" element={
              <PrivateRoute allowedRoles={ADMINS}>
                <InsightsPage />
              </PrivateRoute>
            } />
            {/* AI Hub came back as Insights */}
            <Route path="ai-hub" element={<MovedTo to="/insights" />} />
            <Route path="backhaul" element={
              <PrivateRoute allowedRoles={ADMINS}>
                <BackhaulPage />
              </PrivateRoute>
            } />
            <Route path="requests" element={
              <PrivateRoute allowedRoles={OPERATIONS}>
                <RequestsPage />
              </PrivateRoute>
            } />
            {/* Bookings and vendor loads are one inbox now; old links and notifications keep their filters and ?open= */}
            <Route path="bookings" element={<MovedToRequests source="customer" />} />
            <Route path="vendor-requests" element={<MovedToRequests source="vendor" />} />
            {/* Old addresses, kept so bookmarks and links in emails still work */}
            <Route path="capacity-bidding" element={<MovedTo to="/bids" />} />
            <Route path="cargo-network" element={<MovedTo to="/backhaul" />} />
            <Route path="3pl-network" element={<MovedTo to="/3pl-partners" />} />
            <Route path="3pl-network/verify" element={<MovedTo to="/3pl-partners/verify" />} />
            <Route path="superadmin" element={<MovedTo to="/admin/users" />} />
            <Route path="admin" element={<MovedTo to="/admin/users" />} />
            <Route path="admin/bids" element={<MovedTo to="/bids" />} />
            <Route path="admin/requests" element={<MovedToRequests source="vendor" />} />
            <Route path="live-map" element={
              <PrivateRoute allowedRoles={OPERATIONS}>
                <LiveMapPage />
              </PrivateRoute>
            } />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        </ChunkErrorBoundary>
      </BrowserRouter>
      </ConfirmProvider>
    </>
  )
}
