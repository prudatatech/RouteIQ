import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/services/supabase'
import type { Session, AuthChangeEvent } from '@supabase/supabase-js'
import AppLayout from '@/components/ui/AppLayout'
import { ConfirmProvider, Spinner } from '@/components/ui'
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
import AIHubPage from '@/pages/AIHubPage'
import CargoNetworkPage from '@/pages/CargoNetworkPage'
import ShipmentsPage from '@/pages/ShipmentsPage'
import ShipmentManifestPage from '@/pages/ShipmentManifestPage'
import RouteDetailsPage from '@/pages/RouteDetailsPage'
import EmergencyPage from '@/pages/EmergencyPage'
import DriverPage from '@/pages/DriverPage'
import CustomerTrackingPage from '@/pages/CustomerTrackingPage'
import TplNetworkPage from '@/pages/TplNetworkPage'
import TplOnboardingPage from '@/pages/TplOnboardingPage'
import TplTrackApplicationPage from '@/pages/TplTrackApplicationPage'
import TplSetupCredentialsPage from '@/pages/TplSetupCredentialsPage'
import TplVerificationPage from '@/pages/TplVerificationPage'
import TplDashboardPage from '@/pages/TplDashboardPage'
import LiveMapPage from '@/pages/LiveMapPage'
import MobileTrackPage from '@/pages/MobileTrackPage'
import BidsPage from '@/pages/BidsPage'
import VendorPortalPage from '@/pages/VendorPortalPage'
import VendorTrackingPage from '@/pages/VendorTrackingPage'
import VendorShipmentRequestPage from '@/pages/VendorShipmentRequestPage'
import VendorOnboardingPage from '@/pages/VendorOnboardingPage'
import VendorDocumentsPage from '@/pages/VendorDocumentsPage'
import VendorLoginPage from '@/pages/VendorLoginPage'
import VendorLayout from '@/components/ui/VendorLayout'
import VendorShipmentsPage from '@/pages/VendorShipmentsPage'
import VendorCorridorPage from '@/pages/VendorCorridorPage'
import VendorRequestsPage from '@/pages/VendorRequestsPage'

/** Redirect an old address to its new one, keeping the query string and navigation state. */
function MovedTo({ to }: { to: string }) {
  const location = useLocation()
  return <Navigate to={{ pathname: to, search: location.search, hash: location.hash }} state={location.state} replace />
}

function PrivateRoute({ children, allowedRoles }: { children: React.ReactNode, allowedRoles?: string[] }) {
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

  if (!token) return <Navigate to="/login" replace />

  // If this route is restricted to certain roles
  if (allowedRoles) {
    if (!role || !allowedRoles.includes(role)) {
      if (role === 'driver') return <Navigate to="/driver" replace />
      if (role === 'vendor') return <Navigate to="/vendor" replace />
      return <Navigate to="/dashboard" replace />
    }
  }

  return <>{children}</>
}

// Old activation links point here; the real flow is the 3PL credential setup.
// Keep the query string (e.g. ?email=) so the setup form is prefilled.
function TplActivateRedirect() {
  const { search } = useLocation()
  return <Navigate to={`/3pl/onboard/setup${search}`} replace />
}

export default function App() {
  const store = useAuthStore()

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        const { data: user } = await supabase.from('users').select('role').eq('id', session.user.id).maybeSingle()
        const { data: vProfile } = await supabase.from('vendor_profiles').select('id').eq('id', session.user.id).maybeSingle()
        const fallbackRole = session.user.user_metadata?.role;
        let role = user?.role || fallbackRole;
        if (role !== 'admin' && role !== 'superadmin' && vProfile) {
          role = 'vendor';
        }
        store.setSession(session, role)
      } else {
        store.setSession(null)
      }
    }).catch((err) => {
      console.error('Failed to restore session', err)
      store.setSession(null)
    }).finally(() => {
      // Always release the gate, or protected routes would spin forever
      useAuthStore.getState().setAuthInitialized(true)
    })

    const { data: listener } = supabase.auth.onAuthStateChange(async (event: AuthChangeEvent, session: Session | null) => {
      if (event === 'SIGNED_OUT') {
        store.setSession(null)
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        if (session) {
          const { data: user } = await supabase
            .from('users')
            .select('role')
            .eq('id', session.user.id)
            .maybeSingle()

          const { data: vProfile } = await supabase
            .from('vendor_profiles')
            .select('id')
            .eq('id', session.user.id)
            .maybeSingle()

          const fallbackRole = session.user.user_metadata?.role;
          let role = user?.role || fallbackRole;

          // If user is not admin/superadmin, but has a vendor profile, treat as vendor
          if (role !== 'admin' && role !== 'superadmin' && vProfile) {
            role = 'vendor';
          }

          store.setSession(session, role)
        }
      }
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
              before login; corridor bidding itself redirects to /vendor/login when there's no
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
          <Route path="/vendor/login" element={<VendorLoginPage />} />

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
                <TplNetworkPage />
              </PrivateRoute>
            } />
            <Route path="3pl-partners/verify" element={
              <PrivateRoute allowedRoles={['superadmin']}>
                <TplVerificationPage />
              </PrivateRoute>
            } />
            <Route path="ai-hub" element={
              <PrivateRoute allowedRoles={['superadmin', 'admin']}>
                <AIHubPage />
              </PrivateRoute>
            } />
            <Route path="backhaul" element={
              <PrivateRoute allowedRoles={['superadmin', 'admin']}>
                <CargoNetworkPage />
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
