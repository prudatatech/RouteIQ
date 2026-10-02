import { Suspense, useEffect, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'
import { supabase } from '@/services/supabase'
import type { Session, AuthChangeEvent } from '@supabase/supabase-js'
import AppLayout from '@/components/ui/AppLayout'
import { ConfirmProvider, LoadingState } from '@/components/ui'
import { loadAccount } from '@/services/account'
import { ChunkErrorBoundary } from '@/components/ChunkErrorBoundary'
import { inboxLink, type RequestSource } from '@/components/requests/model'
import { returnTripsLink, type OldReturnTripsPage } from '@/config/returnTripsRedirect'
import LoginPage from '@/pages/LoginPage'
import LandingPage from '@/pages/LandingPage'
import NotFoundPage from '@/pages/NotFoundPage'
import VendorLayout from '@/components/ui/VendorLayout'
import {
  today, fleet, fleetVehicle, vehicleRequests, routes, routeDetails, analytics, insights, optimize, routePlanner, shipments, shipmentPage, dispatchWorkspace, shipmentManifest, emergency, cargo, cargoException, cargoTransfer,
  returnTrips, requests, liveMap, tplPartnerDetail, adminUsers, adminPerson, adminKyc, adminAudit, money, invoicePage, adminSettings, adminOrganisation, platformOrganisations, registerCompany, waitingForApproval, vendorInvoices,
  ship, vendorLoads, vendorLoad, vendorClaims, vendorCorridor, vendorOnboarding, vendorDocuments, vendorShipmentRequest,
  driver, customerTracking, mobileTrack, vehicleShare, tplOnboarding, tplTrackApplication, tplSetupCredentials, tplDashboard,
} from '@/config/lazyPages'
import { OrgSync } from '@/components/OrgSync'
import { OrgGuard } from '@/components/OrgGuard'
import PrivateRoute from '@/components/PrivateRoute'

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
const MoneyPage = money.Component
const InvoicePage = invoicePage.Component
const SettingsPage = adminSettings.Component
const OrganisationPage = adminOrganisation.Component
const PlatformOrganisationsPage = platformOrganisations.Component
const RegisterCompanyPage = registerCompany.Component
const WaitingForApprovalPage = waitingForApproval.Component
const VendorInvoicesPage = vendorInvoices.Component
const ReturnTripsPage = returnTrips.Component
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
const TplPartnerDetailPage = tplPartnerDetail.Component
const TplOnboardingPage = tplOnboarding.Component
const TplTrackApplicationPage = tplTrackApplication.Component
const TplSetupCredentialsPage = tplSetupCredentials.Component
const TplDashboardPage = tplDashboard.Component
const LiveMapPage = liveMap.Component
const MobileTrackPage = mobileTrack.Component
const VehicleSharePage = vehicleShare.Component
const ShipPage = ship.Component
const VendorLoadsPage = vendorLoads.Component
const VendorLoadPage = vendorLoad.Component
const VendorClaimsPage = vendorClaims.Component
const VendorShipmentRequestPage = vendorShipmentRequest.Component
const VendorOnboardingPage = vendorOnboarding.Component
const VendorDocumentsPage = vendorDocuments.Component
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

/** An old vendor address to its new page, with the query kept. */
function KeepQuery({ to }: { to: string }) {
  const location = useLocation()
  return <Navigate to={`${to}${location.search}`} replace />
}

/** The old My shipments page: `?open=` was a posted load or a bid. The load page sends a bid on to Return trips. */
function OldShipmentsLink() {
  const location = useLocation()
  const open = new URLSearchParams(location.search).get('open')
  return <Navigate to={open ? `/vendor/loads/${encodeURIComponent(open)}` : '/vendor/loads'} replace />
}

/** Send an old Backhaul, Bids or 3PL partners address to its Return trips tab, with its filters and ?open= carried over. */
function MovedToReturnTrips({ from }: { from: OldReturnTripsPage }) {
  const location = useLocation()
  return <Navigate to={returnTripsLink(from, location.search)} state={location.state} replace />
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
  return <Navigate to={id ? `/3pl-partners/${id}` : '/return-trips?tab=partners'} replace />
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
        store.setSession(session, account.role, account.tplPartnerId)
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
      <OrgSync />
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
          <Route path="/login" element={<LoginPage audience="staff" />} />
          <Route path="/vendor/login" element={<LoginPage audience="vendor" />} />
          <Route path="/3pl/login" element={<LoginPage audience="tpl" />} />
          {/* A logistics company registers (after signing up or in) and waits for the platform to approve it */}
          <Route path="/register-company" element={<LazyRoute><PrivateRoute><RegisterCompanyPage /></PrivateRoute></LazyRoute>} />
          <Route path="/waiting-for-approval" element={<LazyRoute><PrivateRoute><WaitingForApprovalPage /></PrivateRoute></LazyRoute>} />
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
          {/* Vendor Portal. Return trips is public (browsable before login; bidding itself redirects to
              sign-in when there's no session). Everything that needs a vendor account is gated below. */}
          <Route path="/vendor" element={<VendorLayout />}>
            <Route index element={<Navigate to="/vendor/loads" replace />} />
            <Route path="loads" element={
              <PrivateRoute allowedRoles={['vendor']} kinds={['vendor']}>
                <VendorLoadsPage />
              </PrivateRoute>
            } />
            <Route path="loads/:id" element={
              <PrivateRoute allowedRoles={['vendor']} kinds={['vendor']}>
                <VendorLoadPage />
              </PrivateRoute>
            } />
            <Route path="request" element={
              <VendorShipmentRequestPage />
            } />
            <Route path="return-trips" element={<VendorCorridorPage />} />
            <Route path="invoices" element={
              <PrivateRoute allowedRoles={['vendor']} kinds={['vendor']}>
                <VendorInvoicesPage />
              </PrivateRoute>
            } />
            <Route path="claims" element={
              <PrivateRoute allowedRoles={['vendor']} kinds={['vendor']}>
                <VendorClaimsPage />
              </PrivateRoute>
            } />
            <Route path="company" element={
              <PrivateRoute allowedRoles={['vendor']} kinds={['vendor']}>
                <VendorDocumentsPage />
              </PrivateRoute>
            } />
            <Route path="onboarding" element={
              <PrivateRoute allowedRoles={['vendor']} kinds={['vendor']}>
                <VendorOnboardingPage />
              </PrivateRoute>
            } />
            {/* Old addresses keep working: bookmarks and notifications sent before the portal was rebuilt */}
            <Route path="corridor" element={<KeepQuery to="/vendor/return-trips" />} />
            <Route path="shipments" element={<OldShipmentsLink />} />
            <Route path="documents" element={<KeepQuery to="/vendor/company" />} />
            <Route path="tracking" element={<KeepQuery to="/vendor/loads" />} />
          </Route>

          {/* Find a truck: public, so a visitor can search a lane before any account */}
          <Route path="/ship" element={<VendorLayout />}>
            <Route index element={<ShipPage />} />
          </Route>

          {/* 3PL Public/Partner Routes */}
          <Route path="/3pl/onboard" element={<LazyRoute><TplOnboardingPage /></LazyRoute>} />
          <Route path="/3pl/onboard/track" element={<LazyRoute><TplTrackApplicationPage /></LazyRoute>} />
          <Route path="/3pl/onboard/setup" element={<LazyRoute><TplSetupCredentialsPage /></LazyRoute>} />
          <Route path="/3pl-portal/activate" element={<TplActivateRedirect />} />
          {/* The partner portal has its own pages (Orders, Earnings, Lanes, Documents, Settings) under the id */}
          <Route path="/3pl-portal/:id/*" element={
            <LazyRoute><PrivateRoute allowedRoles={['vendor']} kinds={['tpl']}>
              <TplDashboardPage />
            </PrivateRoute></LazyRoute>
          } />

          {/* Public Landing Page */}
          <Route path="/" element={<LandingPage />} />

          <Route element={
            <PrivateRoute>
              <OrgGuard>
                <AppLayout />
              </OrgGuard>
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
            <Route path="return-trips" element={
              <PrivateRoute allowedRoles={ADMINS}>
                <ReturnTripsPage />
              </PrivateRoute>
            } />
            <Route path="analytics" element={
              <PrivateRoute allowedRoles={ADMINS}>
                <AnalyticsPage />
              </PrivateRoute>
            } />
            <Route path="money" element={
              <PrivateRoute allowedRoles={ADMINS}>
                <MoneyPage />
              </PrivateRoute>
            } />
            {/* The menu's Invoices link: the Invoices tab of Money */}
            <Route path="money/invoices" element={<Navigate to="/money?tab=invoices" replace />} />
            <Route path="money/invoices/:id" element={
              <PrivateRoute allowedRoles={ADMINS}>
                <InvoicePage />
              </PrivateRoute>
            } />
            {/* Finance became Money; keep old links and bookmarks (and their ?tab=) working */}
            <Route path="finance" element={<MovedTo to="/money" />} />
            {/* Driver pay is a tab of Money; the old address opens it there */}
            <Route path="money/driver-pay" element={<Navigate to="/money?tab=driver-pay" replace />} />
            <Route path="admin/settings" element={
              <PrivateRoute allowedRoles={ADMINS}>
                <SettingsPage />
              </PrivateRoute>
            } />
            <Route path="admin/organisation" element={
              <PrivateRoute allowedRoles={ADMINS}>
                <OrganisationPage />
              </PrivateRoute>
            } />
            {/* Platform owner only: OrgGuard sends anyone else back to Today */}
            <Route path="platform/organisations" element={
              <PrivateRoute allowedRoles={ADMINS}>
                <PlatformOrganisationsPage />
              </PrivateRoute>
            } />
            <Route path="platform" element={<MovedTo to="/platform/organisations" />} />
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
            {/* Return trips replaced the Backhaul, Bids and 3PL partners pages; old links keep their tab and ?open= */}
            <Route path="3pl-partners" element={<MovedToReturnTrips from="partners" />} />
            <Route path="3pl-partners/verify" element={<TplVerifyRedirect />} />
            {/* Admins can view a partner; approving, rejecting and pausing stay with the superadmin (in the page and the API) */}
            <Route path="3pl-partners/:id" element={
              <PrivateRoute allowedRoles={ADMINS}>
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
            <Route path="backhaul" element={<MovedToReturnTrips from="backhaul" />} />
            <Route path="bids" element={<MovedToReturnTrips from="bids" />} />
            <Route path="requests" element={
              <PrivateRoute allowedRoles={OPERATIONS}>
                <RequestsPage />
              </PrivateRoute>
            } />
            {/* Bookings and vendor loads are one inbox now; old links and notifications keep their filters and ?open= */}
            <Route path="bookings" element={<MovedToRequests source="customer" />} />
            <Route path="vendor-requests" element={<MovedToRequests source="vendor" />} />
            {/* Old addresses, kept so bookmarks and links in emails still work */}
            <Route path="capacity-bidding" element={<MovedToReturnTrips from="bids" />} />
            <Route path="cargo-network" element={<MovedToReturnTrips from="backhaul" />} />
            <Route path="3pl-network" element={<MovedToReturnTrips from="partners" />} />
            <Route path="3pl-network/verify" element={<MovedTo to="/3pl-partners/verify" />} />
            <Route path="superadmin" element={<MovedTo to="/admin/users" />} />
            <Route path="admin" element={<MovedTo to="/admin/users" />} />
            <Route path="admin/bids" element={<MovedToReturnTrips from="bids" />} />
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
