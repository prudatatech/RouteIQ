// margixindia App Router
import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/services/supabase'
import type { Session, AuthChangeEvent } from '@supabase/supabase-js'
import AppLayout from '@/components/ui/AppLayout'
import LoginPage from '@/pages/LoginPage'
import DashboardPage from '@/pages/DashboardPage'
import FleetPage from '@/pages/FleetPage'
import RoutesPage from '@/pages/RoutesPage'
import AnalyticsPage from '@/pages/AnalyticsPage'
import OptimizePage from '@/pages/OptimizePage'
import SuperadminPage from '@/pages/SuperadminPage'
import AIHubPage from '@/pages/AIHubPage'
import CargoNetworkPage from '@/pages/CargoNetworkPage'
import ShipmentsPage from '@/pages/ShipmentsPage'
import ShipmentManifestPage from '@/pages/ShipmentManifestPage'
import RouteDetailsPage from '@/pages/RouteDetailsPage'
import EmergencyPage from '@/pages/EmergencyPage'
import DriverPage from '@/pages/DriverPage'
import CustomerTrackingPage from '@/pages/CustomerTrackingPage'
import LiveMapPage from '@/pages/LiveMapPage'
import MobileTrackPage from '@/pages/MobileTrackPage'
import CapacityBiddingPage from '@/pages/CapacityBiddingPage'
import VendorPortalPage from '@/pages/VendorPortalPage'
import VendorTrackingPage from '@/pages/VendorTrackingPage'
import VendorShipmentRequestPage from '@/pages/VendorShipmentRequestPage'
import VendorOnboardingPage from '@/pages/VendorOnboardingPage'
import VendorDocumentsPage from '@/pages/VendorDocumentsPage'
import VendorLoginPage from '@/pages/VendorLoginPage'
import VendorLayout from '@/components/ui/VendorLayout'
import VendorShipmentsPage from '@/pages/VendorShipmentsPage'
import VendorCorridorPage from '@/pages/VendorCorridorPage'

function PrivateRoute({ children, allowedRoles }: { children: React.ReactNode, allowedRoles?: string[] }) {
  const token = useAuthStore(s => s.token)
  const role = useAuthStore(s => s.role)

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
      <Toaster position="top-center" />
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
          {/* Vendor Portal */}
          <Route path="/vendor" element={<VendorLayout />}>
            <Route index element={<VendorPortalPage />} />
            <Route path="documents" element={<VendorDocumentsPage />} />
            <Route path="shipments" element={<VendorShipmentsPage />} />
            <Route path="corridor" element={<VendorCorridorPage />} />
            <Route path="request" element={<VendorShipmentRequestPage />} />
            <Route path="tracking" element={<VendorTrackingPage />} />
          </Route>

          <Route path="/vendor/onboarding" element={
            <PrivateRoute allowedRoles={['vendor', 'admin', 'superadmin']}>
              <VendorOnboardingPage />
            </PrivateRoute>
          } />
          <Route path="/vendor/login" element={<VendorLoginPage />} />
          <Route path="/" element={
            <PrivateRoute>
              <AppLayout />
            </PrivateRoute>
          }>
            <Route index element={<Navigate to="/dashboard" replace />} />
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
            <Route path="capacity-bidding" element={
              <PrivateRoute allowedRoles={['superadmin', 'admin']}>
                <CapacityBiddingPage />
              </PrivateRoute>
            } />
            <Route path="analytics" element={
              <PrivateRoute allowedRoles={['superadmin', 'admin']}>
                <AnalyticsPage />
              </PrivateRoute>
            } />
            <Route path="superadmin" element={
              <PrivateRoute allowedRoles={['superadmin']}>
                <SuperadminPage />
              </PrivateRoute>
            } />
            <Route path="ai-hub" element={
              <PrivateRoute allowedRoles={['superadmin', 'admin']}>
                <AIHubPage />
              </PrivateRoute>
            } />
            <Route path="cargo-network" element={
              <PrivateRoute allowedRoles={['superadmin', 'admin']}>
                <CargoNetworkPage />
              </PrivateRoute>
            } />
          </Route>
          <Route path="live-map" element={<PrivateRoute allowedRoles={['superadmin', 'admin']}><LiveMapPage /></PrivateRoute>} />
        </Routes>
      </BrowserRouter>
    </>
  )
}
