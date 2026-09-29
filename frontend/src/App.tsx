import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/services/supabase'
import type { Session, AuthChangeEvent } from '@supabase/supabase-js'
import AppLayout from '@/components/ui/AppLayout'
import { Button, ConfirmProvider, EmptyState, Spinner } from '@/components/ui'
import { Lock } from 'lucide-react'
import { loadAccount } from '@/services/account'
import LoginPage from '@/pages/LoginPage'
import DashboardPage from '@/pages/DashboardPage'
import FleetPage from '@/pages/FleetPage'
import RoutesPage from '@/pages/RoutesPage'
import AnalyticsPage from '@/pages/AnalyticsPage'
import LandingPage from '@/pages/LandingPage'
import OptimizePage from '@/pages/OptimizePage'
import UsersPage from '@/pages/admin/UsersPage'
import KycReviewPage from '@/pages/admin/KycReviewPage'
import AuditLogPage from '@/pages/admin/AuditLogPage'
import BackhaulPage from '@/pages/BackhaulPage'
import ShipmentsPage from '@/pages/ShipmentsPage'
import ShipmentManifestPage from '@/pages/ShipmentManifestPage'
import RouteDetailsPage from '@/pages/RouteDetailsPage'
import EmergencyPage from '@/pages/EmergencyPage'
import DriverPage from '@/pages/DriverPage'
import CustomerTrackingPage from '@/pages/CustomerTrackingPage'
import TplPartnersPage from '@/pages/TplPartnersPage'
import TplPartnerDetailPage from '@/pages/TplPartnerDetailPage'
import TplOnboardingPage from '@/pages/TplOnboardingPage'
import TplTrackApplicationPage from '@/pages/TplTrackApplicationPage'
import TplSetupCredentialsPage from '@/pages/TplSetupCredentialsPage'
import TplDashboardPage from '@/pages/TplDashboardPage'
import LiveMapPage from '@/pages/LiveMapPage'
import MobileTrackPage from '@/pages/MobileTrackPage'
import BidsPage from '@/pages/BidsPage'
import VendorPortalPage from '@/pages/VendorPortalPage'
import VendorTrackingPage from '@/pages/VendorTrackingPage'
import VendorShipmentRequestPage from '@/pages/VendorShipmentRequestPage'
import VendorOnboardingPage from '@/pages/VendorOnboardingPage'
import VendorDocumentsPage from '@/pages/VendorDocumentsPage'
import VendorLayout from '@/components/ui/VendorLayout'
import VendorShipmentsPage from '@/pages/VendorShipmentsPage'
import VendorCorridorPage from '@/pages/VendorCorridorPage'
import VendorRequestsPage from '@/pages/VendorRequestsPage'

/** Redirect an old address to its new one, keeping the query string and navigation state. */
function MovedTo({ to }: { to: string }) {
  const location = useLocation()
  return <Navigate to={{ pathname: to, search: location.search, hash: location.hash }} state={location.state} replace />
}

/** Home page for a role, from the store. Vendors without a profile are routed later by the vendor pages. */
function homeForRole(role: string | null): string | null {
  if (role === 'admin' || role === 'superadmin') return '/dashboard'
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
    // Accounts with no area in the web app (no role, managers, customers) would
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
  const store = useAuthStore()

  useEffect(() => {
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
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/track" element={<CustomerTrackingPage />} />
          <Route path="/track/:trackingId" element={<CustomerTrackingPage />} />
          {/* Public mobile GPS tracking page — no auth needed */}
          <Route path="/m/:token" element={<MobileTrackPage />} />
          <Route path="/driver" element={
            <PrivateRoute allowedRoles={['superadmin', 'admin', 'driver']}>
              <DriverPage />
            </PrivateRoute>
          } />
          <Route path="/driver/dashboard" element={
            <PrivateRoute allowedRoles={['superadmin', 'admin', 'driver']}>
              <DriverPage />
            </PrivateRoute>
          } />
          {/* Vendor Portal — home/discover and corridors are intentionally public (browsable
              before login; corridor bidding itself redirects to sign-in when there's no
              session). Everything that needs a vendor account is gated below. */}
          <Route path="/vendor" element={<VendorLayout />}>
            <Route index element={<VendorPortalPage />} />
            <Route path="corridor" element={<VendorCorridorPage />} />
            <Route path="documents" element={
              <PrivateRoute allowedRoles={['vendor', 'admin', 'superadmin']}>
                <VendorDocumentsPage />
              </PrivateRoute>
            } />
            <Route path="shipments" element={
              <PrivateRoute allowedRoles={['vendor', 'admin', 'superadmin']}>
                <VendorShipmentsPage />
              </PrivateRoute>
            } />
            <Route path="request" element={
              <PrivateRoute allowedRoles={['vendor', 'admin', 'superadmin']}>
                <VendorShipmentRequestPage />
              </PrivateRoute>
            } />
            <Route path="tracking" element={
              <PrivateRoute allowedRoles={['vendor', 'admin', 'superadmin']}>
                <VendorTrackingPage />
              </PrivateRoute>
            } />
          </Route>

          <Route path="/vendor/onboarding" element={
            <PrivateRoute allowedRoles={['vendor', 'admin', 'superadmin']}>
              <VendorOnboardingPage />
            </PrivateRoute>
          } />
          <Route path="/vendor/login" element={<VendorLoginRedirect />} />

          {/* 3PL Public/Partner Routes */}
          <Route path="/3pl/onboard" element={<TplOnboardingPage />} />
          <Route path="/3pl/onboard/track" element={<TplTrackApplicationPage />} />
          <Route path="/3pl/onboard/setup" element={<TplSetupCredentialsPage />} />
          <Route path="/3pl-portal/activate" element={<TplActivateRedirect />} />
          <Route path="/3pl-portal/:id" element={
            <PrivateRoute allowedRoles={['vendor', 'admin', 'superadmin']}>
              <TplDashboardPage />
            </PrivateRoute>
          } />

          {/* Public Landing Page */}
          <Route path="/" element={<LandingPage />} />

          <Route element={
            <PrivateRoute>
              <AppLayout />
            </PrivateRoute>
          }>
            <Route path="dashboard" element={
              <PrivateRoute allowedRoles={['superadmin', 'admin']}>
                <DashboardPage />
              </PrivateRoute>
            } />
            <Route path="shipments" element={
              <PrivateRoute allowedRoles={['superadmin', 'admin']}>
                <ShipmentsPage />
              </PrivateRoute>
            } />
            <Route path="shipments/:id/manifest" element={
              <PrivateRoute allowedRoles={['superadmin', 'admin']}>
                <ShipmentManifestPage />
              </PrivateRoute>
            } />
            <Route path="fleet" element={
              <PrivateRoute allowedRoles={['superadmin', 'admin']}>
                <FleetPage />
              </PrivateRoute>
            } />
            <Route path="routes" element={
              <PrivateRoute allowedRoles={['superadmin', 'admin']}>
                <RoutesPage />
              </PrivateRoute>
            } />
            <Route path="routes/:id" element={
              <PrivateRoute allowedRoles={['superadmin', 'admin']}>
                <RouteDetailsPage />
              </PrivateRoute>
            } />
            <Route path="emergency" element={
              <PrivateRoute allowedRoles={['superadmin', 'admin']}>
                <EmergencyPage />
              </PrivateRoute>
            } />
            <Route path="optimize" element={
              <PrivateRoute allowedRoles={['superadmin', 'admin']}>
                <OptimizePage />
              </PrivateRoute>
            } />
            <Route path="bids" element={
              <PrivateRoute allowedRoles={['superadmin', 'admin']}>
                <BidsPage />
              </PrivateRoute>
            } />
            <Route path="analytics" element={
              <PrivateRoute allowedRoles={['superadmin', 'admin']}>
                <AnalyticsPage />
              </PrivateRoute>
            } />
            <Route path="admin/users" element={
              <PrivateRoute allowedRoles={['superadmin']}>
                <UsersPage />
              </PrivateRoute>
            } />
            <Route path="admin/kyc" element={
              <PrivateRoute allowedRoles={['superadmin']}>
                <KycReviewPage />
              </PrivateRoute>
            } />
            <Route path="admin/audit" element={
              <PrivateRoute allowedRoles={['superadmin']}>
                <AuditLogPage />
              </PrivateRoute>
            } />
            <Route path="3pl-partners" element={
              <PrivateRoute allowedRoles={['superadmin']}>
                <TplPartnersPage />
              </PrivateRoute>
            } />
            <Route path="3pl-partners/verify" element={<TplVerifyRedirect />} />
            <Route path="3pl-partners/:id" element={
              <PrivateRoute allowedRoles={['superadmin']}>
                <TplPartnerDetailPage />
              </PrivateRoute>
            } />
            {/* AI Hub is retired; its reroute suggestions moved to Route optimization. */}
            <Route path="ai-hub" element={<MovedTo to="/optimize" />} />
            <Route path="backhaul" element={
              <PrivateRoute allowedRoles={['superadmin', 'admin']}>
                <BackhaulPage />
              </PrivateRoute>
            } />
            <Route path="vendor-requests" element={
              <PrivateRoute allowedRoles={['superadmin', 'admin']}>
                <VendorRequestsPage />
              </PrivateRoute>
            } />
            {/* Old addresses, kept so bookmarks and links in emails still work */}
            <Route path="capacity-bidding" element={<MovedTo to="/bids" />} />
            <Route path="cargo-network" element={<MovedTo to="/backhaul" />} />
            <Route path="3pl-network" element={<MovedTo to="/3pl-partners" />} />
            <Route path="3pl-network/verify" element={<MovedTo to="/3pl-partners/verify" />} />
            <Route path="superadmin" element={<MovedTo to="/admin/users" />} />
            <Route path="admin" element={<MovedTo to="/admin/users" />} />
            <Route path="admin/bids" element={<MovedTo to="/bids" />} />
            <Route path="admin/requests" element={<MovedTo to="/vendor-requests" />} />
            <Route path="live-map" element={
              <PrivateRoute allowedRoles={['superadmin', 'admin']}>
                <LiveMapPage />
              </PrivateRoute>
            } />
          </Route>
        </Routes>
      </BrowserRouter>
      </ConfirmProvider>
    </>
  )
}
