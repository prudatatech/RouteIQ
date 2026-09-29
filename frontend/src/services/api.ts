import axios from 'axios'
import { supabase } from '@/services/supabase'


let baseURL = import.meta.env.VITE_API_URL || 'https://routeiq-production-7034.up.railway.app/api/v1';
if (baseURL && !baseURL.endsWith('/api/v1') && !baseURL.startsWith('/api')) {
  baseURL = baseURL.replace(/\/$/, '') + '/api/v1';
}

/** Most calls answer in a second or two; 30 seconds is enough before we tell the person it failed. */
const DEFAULT_TIMEOUT_MS = 30_000
/** The route optimizer can run for minutes on a large fleet, so those calls pass this instead. */
const OPTIMIZER_TIMEOUT_MS = 360_000

export const api = axios.create({
  baseURL,
  timeout: DEFAULT_TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json' },
})

/**
 * Sanitizes an object by removing common "junk" from React Query (context, signals, etc.)
 * that shouldn't be serialized into query strings.
 */
const sanitizeParams = (params: Record<string, unknown> | undefined) => {
  if (!params || typeof params !== 'object') return params
  
  const clean: Record<string, unknown> = {}
  Object.keys(params).forEach(key => {
    const val = params[key]
    // Filter out internal React Query / Event / Signal objects
    if (
      key === 'queryKey' || key === 'signal' || key === 'meta' || key === 'client' || 
      key === 'pageParam' || key === 'direction'
    ) {
      return
    }
    
    // Only keep primitives or simple arrays of primitives
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      clean[key] = val
    }
  })
  return Object.keys(clean).length > 0 ? clean : undefined
}

// Attach Supabase JWT token AND sanitize all requests
api.interceptors.request.use(async (config) => {
  // Get current Supabase session token
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`
  }
  
  // Clean up params for ALL methods (GET, POST, etc.)
  if (config.params) {
    config.params = sanitizeParams(config.params)
  }
  
  return config
})

// Handle 401 — Supabase handles refresh automatically via onAuthStateChange,
// but we still catch 401s to redirect to login if session is truly expired
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    // Tag pure network failures (no response) so UI can handle them gracefully
    if (!error.response && !error.code) {
      error.code = 'ERR_NETWORK'
    }

    if (error.response?.status === 401 && !error.config._retry) {
      error.config._retry = true
      // Try refreshing the Supabase session
      const { data: { session }, error: refreshError } = await supabase.auth.refreshSession()
      
      if (session && !refreshError) {
        // Retry the original request with the new token
        const original = error.config
        original.headers.Authorization = `Bearer ${session.access_token}`
        return api(original)
      } else {
        // Session is dead — sign out and redirect
        await supabase.auth.signOut()
        if (!window.location.pathname.includes('/login')) {
          window.location.href = '/login'
        }
      }
    }
    
    return Promise.reject(error)
  }
)

// ═══════════════════════════════════════════════════════════
// API methods — all use the Supabase JWT via the interceptor
// ═══════════════════════════════════════════════════════════

// Safety helper: ensure API list calls always return arrays
const ensureArray = (data: unknown): unknown[] => Array.isArray(data) ? data : []
// Vehicles API
export const vehiclesAPI = {
  list: (params?: Record<string, unknown>) => api.get('/vehicles/', { params }).then(r => ensureArray(r.data)),
  create: (data: object) => api.post('/vehicles/', data).then(r => r.data),
  update: (id: string, data: object) => api.patch(`/vehicles/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/vehicles/${id}`),
  summary: () => api.get('/vehicles/summary').then(r => r.data),
}

export const optimizationAPI = {
  optimize: (data: Record<string, unknown>) => api.post('/optimize', data, { timeout: OPTIMIZER_TIMEOUT_MS }).then(r => r.data),
  incubate: (vehicleId: string) => api.post(`/optimize/incubate/${vehicleId}`, undefined, { timeout: OPTIMIZER_TIMEOUT_MS }).then(r => r.data),
  reoptimizeRoute: (id: string) => api.post(`/optimize/reoptimize/${id}`, undefined, { timeout: OPTIMIZER_TIMEOUT_MS }).then(r => r.data),
}

export const dashboardAPI = {
  kpis: () => api.get('/dashboard/kpis/').then(r => r.data),
  /** Exact number of shipments in each status, counted by the server (staff only). */
  shipmentCounts: () => api.get('/dashboard/shipment-counts').then(r => r.data as { counts: Record<string, number>; total: number }),
}

export const usersAPI = {
  me: () => api.get('/users/me').then(r => r.data),
  list: () => api.get('/users/').then(r => r.data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/users/${id}`, data).then(r => r.data),
}

export interface SearchResultItem {
  id: string
  label: string
  sublabel?: string
  type: string
  path: string
}

export interface SearchResults {
  shipments: SearchResultItem[]
  cargo_manifests: SearchResultItem[]
  vehicles: SearchResultItem[]
  vendors: SearchResultItem[]
  partners: SearchResultItem[]
  users: SearchResultItem[]
}

export const searchAPI = {
  search: (q: string) => api.get('/search', { params: { q } }).then(r => r.data.results as SearchResults),
}

export const cargoAPI = {
  /** Created shipments that are not on a route yet. */
  openLoads: () => api.get('/cargo/open-loads').then(r => ensureArray(r.data)),
  optimizePooling: (shipmentIds: string[], vehicleId: string) =>
    api.post('/cargo/optimize-pooling', { shipment_ids: shipmentIds, vehicle_id: vehicleId }, { timeout: OPTIMIZER_TIMEOUT_MS }).then(r => r.data),
  backhaulMatch: (opportunityId: string, availableCapacityKg: number) =>
    api.post('/cargo/backhaul-match', { opportunity_id: opportunityId, available_capacity_kg: availableCapacityKg }).then(r => r.data),
  verifyPod: (data: { tracking_id: string, recipient_name: string }) =>
    api.post('/cargo/verify-pod', data).then(r => r.data),
}

export const fleetAPI = {
  health: () => api.get('/fleet/health').then(r => ensureArray(r.data)),
  vehicleHealth: (id: string) => api.get(`/fleet/vehicles/${id}/health`).then(r => r.data),
  setOdometer: (id: string, odometerKm: number) =>
    api.put(`/fleet/vehicles/${id}/odometer`, { odometer_km: odometerKm }).then(r => r.data),
  servicePlans: (id: string) => api.get(`/fleet/vehicles/${id}/service-plans`).then(r => ensureArray(r.data)),
  savePlan: (id: string, plan: object) => api.post(`/fleet/vehicles/${id}/service-plans`, plan).then(r => r.data),
  deletePlan: (planId: string) => api.delete(`/fleet/service-plans/${planId}`).then(r => r.data),
  serviceLog: (id: string) => api.get(`/fleet/vehicles/${id}/service-log`).then(r => ensureArray(r.data)),
  logService: (id: string, entry: object) => api.post(`/fleet/vehicles/${id}/service-log`, entry).then(r => r.data),
  serviceDue: () => api.get('/fleet/service-due').then(r => ensureArray(r.data)),
  alerts: (status: 'active' | 'resolved' | 'all') => api.get('/fleet/alerts', { params: { status } }).then(r => ensureArray(r.data)),
  alertSummary: () => api.get('/fleet/alerts/summary').then(r => r.data),
  acknowledgeAlert: (id: string) => api.post(`/fleet/alerts/${id}/acknowledge`).then(r => r.data),
  resolveAlert: (id: string) => api.post(`/fleet/alerts/${id}/resolve`).then(r => r.data),
  alertSettings: () => api.get('/fleet/alert-settings').then(r => r.data),
  saveAlertSettings: (values: object) => api.put('/fleet/alert-settings', values).then(r => r.data),
  sendTestAlarm: (vehicleId: string, event: string) =>
    api.post('/telematics/test-alarm', { vehicle_id: vehicleId, event }).then(r => r.data),
}

export interface PublicStats {
  vehicles: number
  deliveries_completed: number
  active_partners: number
  cities_served: number
}

export const publicAPI = {
  /** Aggregate counts for the landing page. No sign-in needed. */
  stats: () => api.get('/public/stats').then(r => r.data as PublicStats),
}

export const capacityAPI = {
  getNearbyVendors: (params: { lat: number, lng: number, radius?: number }) =>
    api.get('/capacity/nearby-vendors', { params }).then(r => r.data),
  placeBid: (data: {
    window_id: string
    bid_amount: number
    weight_kg: number
    dropoff_name: string
    dropoff_address: string
    dropoff_lat: number
    dropoff_lng: number
    eway_bill_ref?: string
    load_configuration?: string
  }) => api.post('/capacity/bids', data).then(r => r.data),
  // Vendor views: no plate, driver or live position (plate only on a won bid)
  openWindows: () => api.get('/capacity/windows/open').then(r => ensureArray(r.data)),
  myBids: () => api.get('/capacity/bids/mine').then(r => ensureArray(r.data)),
  /** Staff: open a bidding window on a vehicle (the vehicle's free space is offered). */
  openWindow: (data: { vehicle_id: string; floor_price: number; duration_minutes: number; shipment_id?: string | null }) =>
    api.post('/capacity/windows', data).then(r => r.data),
  /** Staff: stop new bids; pending bids stay for a decision. */
  closeWindow: (id: string) => api.post(`/capacity/windows/${id}/close`).then(r => r.data),
  /** Staff: stop new bids and turn pending bids down. */
  cancelWindow: (id: string) => api.post(`/capacity/windows/${id}/cancel`).then(r => r.data),
  approveBid: (id: string) => api.post(`/capacity/bids/${id}/approve`).then(r => r.data),
  rejectBid: (id: string, reason: string) => api.post(`/capacity/bids/${id}/reject`, { reason }).then(r => r.data),
}

export const vendorAPI = {
  profile: () => api.get('/vendor/profile').then(r => r.data),
  /** Create or update the company profile without submitting KYC (status stays as it is, "pending" for a new profile). */
  saveProfile: (data: { companyName: string; gstNumber: string; city: string; address: string; lat: number; lng: number }) =>
    api.post('/vendor/profile', data).then(r => r.data),
  submitKyc: (data: Record<string, unknown>) => api.post('/vendor/kyc/submit', data).then(r => r.data),
  passingRoutes: () => api.get('/vendor/passing-routes').then(r => ensureArray(r.data)),
  createShipmentRequest: (data: Record<string, unknown>) => api.post('/vendor/shipment-request', data).then(r => r.data),
  pendingRequests: () => api.get('/vendor/shipment-request/pending').then(r => r.data),
  approveRequest: (id: string) => api.put(`/vendor/shipment-request/${id}/approve`).then(r => r.data),
  rejectRequest: (id: string, reason: string) => api.put(`/vendor/shipment-request/${id}/reject`, { reason }).then(r => r.data),
  /** The vendor withdraws a load they posted, while it has no vehicle yet. */
  cancelRequest: (id: string) => api.put(`/vendor/shipment-request/${id}/cancel`).then(r => r.data),
  approveKyc: (id: string) => api.put(`/vendor/kyc/${id}/approve`).then(r => r.data),
  rejectKyc: (id: string, reason: string) => api.put(`/vendor/kyc/${id}/reject`, { reason }).then(r => r.data),
  /** Signed upload URL for one KYC document; use uploadKycDocument() from services/kycDocuments. */
  kycUploadUrl: (data: { key: string; content_type: string; size: number }): Promise<{ path: string; token: string; signed_url: string }> =>
    api.post('/vendor/kyc/upload-url', data).then(r => r.data),
  /** Saves uploaded document paths on the vendor's profile ahead of the final submit. */
  saveKycDocuments: (data: { docUrls?: Record<string, string>; otherDocs?: { name: string; path: string }[] }) =>
    api.put('/vendor/kyc/documents', data).then(r => r.data),
  /** The vendor's own invoices, newest first. */
  invoices: () => api.get('/vendor/invoices').then(r => ensureArray(r.data)),
  assignVehicle: (id: string, data: { vehicle_id: string, cost?: number, cost_per_km?: number }) =>
    api.put(`/vendor/shipment-request/${id}/assign-vehicle`, data).then(r => r.data),
}

export const authAPI = {
  inviteVendor: (email: string, password: string) =>
    api.post('/auth/invite-vendor', { email, password }).then(r => r.data),
}

export const shipmentsAPI = {
  list: (params?: Record<string, unknown>) => api.get('/shipments/', { params }).then(r => ensureArray(r.data)),
  get: (id: string) => api.get(`/shipments/${id}`).then(r => r.data),
  // Public page: no sign-in header (so it never waits on the auth session) and a short timeout, so it always ends in a result or an error.
  trackPublicly: (trackingId: string) => axios
    .get(`${baseURL}/shipments/track/${encodeURIComponent(trackingId)}`, { timeout: 20_000 })
    .then(r => r.data),
  create: (data: object) => api.post('/shipments/', data).then(r => r.data),
  updateStatus: (id: string, status: string, fields?: Record<string, unknown>) => api.patch(`/shipments/${id}`, { status, ...fields }).then(r => r.data),
  edit: (id: string, data: Record<string, unknown>) => api.patch(`/shipments/${id}/edit`, data).then(r => r.data),
  updateMetadata: (id: string, metadata: object) => api.put(`/shipments/${id}/metadata`, metadata).then(r => r.data),
  delete: (id: string) => api.delete(`/shipments/${id}`).then(r => r.data),
  getAssignOptions: (id: string, mode: 'near' | 'any') => api.get(`/shipments/${id}/assign-options`, { params: { mode } }).then(r => r.data),
  assignDriver: (id: string, vehicleId: string) => api.post(`/shipments/${id}/assign`, { vehicle_id: vehicleId }).then(r => r.data),
  /** Ordered status timeline (staff only) — see ShipmentService.getShipmentHistory. */
  history: (id: string) => api.get(`/shipments/${id}/history`).then(r => r.data),
  /** Staff rate the driver of a delivered shipment, 1 to 5. */
  rateDriver: (id: string, rating: number, note?: string | null) =>
    api.post(`/shipments/${id}/rating`, { rating, note: note ?? undefined }).then(r => r.data),
  /** Receiver, delivery photo and signature; the two images are signed links that expire in 10 minutes (staff only). */
  proof: (id: string) => api.get(`/shipments/${id}/proof`).then(r => r.data as {
    received_by: string | null
    photo_url: string | null
    signature_url: string | null
    signature_data: string | null
  }),
}

export const routesAPI = {
  list: (params?: Record<string, unknown>) => api.get('/routes/', { params }).then(r => ensureArray(r.data)),
  get: (id: string) => api.get(`/routes/${id}`).then(r => r.data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/routes/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/routes/${id}`).then(r => r.data),
  updateStatus: (id: string, status: string) => api.patch(`/routes/${id}/status`, { status }).then(r => r.data),
  reroute: (id: string, newSequence: string[]) => api.post(`/routes/${id}/reroute`, { new_sequence: newSequence }).then(r => r.data),
};

export const marketplaceAPI = {
  openLoads: () => api.get('/marketplace/open-loads').then(r => r.data),
}

export const telemetryAPI = {
  /** Driver's own device position (role driver; vehicle resolved server-side). Speed in m/s. */
  driverPing: (ping: { lat: number, lng: number, speed: number, heading: number, accuracy?: number | null, timestamp: string }) =>
    api.post('/telemetry/driver-ping', ping).then(r => r.data),
  history: (vehicleId: string, limit = 100) => api.get(`/telemetry/${vehicleId}/history`, { params: { limit } }).then(r => r.data),
  createMobileSession: (vehicleId: string, phone?: string) =>
    api.post('/telemetry/mobile-session', { vehicle_id: vehicleId, phone }).then(r => r.data),
  callDriver: (vehicleId: string) => api.post(`/telemetry/call-driver/${vehicleId}`).then(r => r.data),
  acknowledgeSos: (id: string) => api.put(`/telemetry/sos/${id}/acknowledge`).then(r => r.data),
  resolveSos: (id: string) => api.put(`/telemetry/sos/${id}/resolve`).then(r => r.data),
  /** Driver raises an SOS for their assigned vehicle. */
  triggerSos: (data: { lat?: number, lng?: number, alert_type?: 'panic_button' | 'accident' | 'breakdown' | 'medical' | 'theft' | 'other' }) =>
    api.post('/telemetry/sos/trigger', data).then(r => r.data),
}

export const analyticsAPI = {
  insights: () => api.get('/analytics/insights').then(r => r.data),
  /** Open loads vs available vehicles per pickup city, and a 7-day load forecast per corridor. */
  demand: () => api.get('/analytics/demand').then(r => r.data),
  /** Pulls the latest positions from the SparkGPS provider. Staff only. */
  syncSparkGPS: () => api.post('/analytics/sync-sparkgps').then(r => r.data as { status: string; message?: string }),
  activeMissions: () => api.get('/analytics/active-missions').then(r => ensureArray(r.data)),
  /** Newest-first, paged. `from`/`to` are YYYY-MM-DD IST calendar days. */
  auditLogs: (params: { limit?: number; offset?: number; from?: string; to?: string } = {}) =>
    api.get('/analytics/audit-logs', { params }).then(r => r.data as { items: unknown[]; limit: number; offset: number; hasMore: boolean }),
  driverPerformance: () => api.get('/analytics/driver-performance').then(r => ensureArray(r.data)),
  vendorPerformance: () => api.get('/analytics/vendor-performance').then(r => ensureArray(r.data)),
  /** `from`/`to` (YYYY-MM-DD, IST calendar days) report on that range instead of "today". */
  fleetOverview: (range?: { from?: string; to?: string }) => api.get('/analytics/fleet-overview', { params: range }).then(r => r.data),
  /** Trips dispatched and deliveries per day, oldest first. `from`/`to` override `days`. */
  dailyActivity: (params: { days?: number; from?: string; to?: string } = { days: 14 }) =>
    api.get('/analytics/daily-activity', { params }).then(r => ensureArray(r.data)),
}

export interface DateParams { from?: string; to?: string }

export interface ExpenseInput {
  vehicle_id?: string | null
  route_id?: string | null
  category: string
  amount: number
  expense_date: string
  litres?: number | null
  note?: string | null
  receipt_path?: string | null
}

/** Invoices, expenses, fuel price and profit and loss (staff). */
export const financeAPI = {
  summary: (range: DateParams) => api.get('/finance/summary', { params: range }).then(r => r.data),
  unpriced: (range: DateParams) => api.get('/finance/unpriced', { params: range }).then(r => ensureArray(r.data)),
  invoices: (params: DateParams & { status?: string }) => api.get('/finance/invoices', { params }).then(r => ensureArray(r.data)),
  createInvoice: (target: { shipment_id: string } | { manifest_id: string }) => api.post('/finance/invoices', target).then(r => r.data),
  payInvoice: (id: string) => api.put(`/finance/invoices/${id}/pay`).then(r => r.data),
  voidInvoice: (id: string) => api.put(`/finance/invoices/${id}/void`).then(r => r.data),
  expenses: (params: DateParams & { category?: string; vehicle_id?: string }) => api.get('/finance/expenses', { params }).then(r => ensureArray(r.data)),
  createExpense: (data: ExpenseInput) => api.post('/finance/expenses', data).then(r => r.data),
  updateExpense: (id: string, data: Partial<ExpenseInput>) => api.put(`/finance/expenses/${id}`, data).then(r => r.data),
  deleteExpense: (id: string) => api.delete(`/finance/expenses/${id}`),
  receiptUpload: (data: { content_type: string; size: number }) =>
    api.post('/finance/expenses/receipt-upload', data).then(r => r.data as { path: string; token: string; bucket: string }),
  receiptUrl: (id: string) => api.get(`/finance/expenses/${id}/receipt-url`).then(r => r.data as { url: string }),
  settings: () => api.get('/finance/settings').then(r => r.data as { fuel_price_per_litre: number | null; rate_per_km: number | null }),
  saveFuelPrice: (fuel_price_per_litre: number) =>
    api.put('/finance/settings', { fuel_price_per_litre }).then(r => r.data as { fuel_price_per_litre: number | null; rate_per_km: number | null }),
}

export interface CustomerBooking {
  id: string
  customer_id: string
  pickup_name: string
  pickup_address: string
  drop_name: string
  drop_address: string
  weight_kg: number
  load_type: 'full' | 'part'
  vehicle_type: string | null
  pickup_date: string
  quoted_price: number | null
  status: 'requested' | 'confirmed' | 'assigned' | 'in_transit' | 'delivered' | 'cancelled'
  /** Status of the linked shipment; `exception` is a failed delivery attempt (the booking status has no state for it). */
  shipment_status?: string | null
  shipment_id: string | null
  tracking_id: string | null
  vehicle_id: string | null
  cancelled_by: 'customer' | 'staff' | null
  cancel_reason: string | null
  created_at: string
  customer: { name: string | null; phone: string | null; company: string | null } | null
}

/** Bookings made by customers in the mobile app. */
export const bookingsAPI = {
  list: () => api.get('/bookings').then(r => ensureArray(r.data) as CustomerBooking[]),
  /** Creates the shipment, so the booking can be dispatched like any other load. `price` (rupees before GST) overrides the customer's quote. */
  confirm: (id: string, price?: number | null) => api.post(`/bookings/${id}/confirm`, price == null ? {} : { price }).then(r => r.data),
  assign: (id: string, vehicle_id: string) => api.post(`/bookings/${id}/assign`, { vehicle_id }).then(r => r.data),
  cancel: (id: string, reason: string) => api.post(`/bookings/${id}/cancel`, { reason }).then(r => r.data),
}

export interface ChatMessage {
  id: string
  route_id: string | null
  shipment_id: string | null
  shipment_tracking_id?: string | null
  sender_id: string | null
  /** 'driver', or the staff member's role. */
  sender_role: string
  sender_name: string | null
  body: string
  created_at: string
  read_at: string | null
}

export interface UnreadThread {
  route_id: string | null
  shipment_id: string | null
  count: number
  last_body: string
  last_at: string
  sender_name: string | null
}

/** Text messages between staff and the driver, per route or shipment. */
export const messagesAPI = {
  thread: (target: { route_id?: string; shipment_id?: string }) =>
    api.get('/messages', { params: target }).then(r => r.data.messages as ChatMessage[]),
  send: (target: { route_id?: string; shipment_id?: string }, body: string) =>
    api.post('/messages', { ...target, body }).then(r => r.data as ChatMessage),
  markRead: (target: { route_id?: string; shipment_id?: string }) =>
    api.post('/messages/read', target).then(r => r.data as { updated: number }),
  unread: () => api.get('/messages/unread').then(r => r.data as { total: number; threads: UnreadThread[] }),
}

/** The dispatcher's phone number, which drivers call from the driver app. */
export const dispatchAPI = {
  contact: () => api.get('/driver/dispatch-contact').then(r => r.data as { phone: string | null }),
  saveContact: (phone: string | null) => api.put('/driver/dispatch-contact', { phone }).then(r => r.data as { phone: string | null }),
}

export const tplAPI = {
  onboard: (data: Record<string, unknown>) => api.post('/tpl/onboard', data).then(r => r.data),
  queue: (status?: string) => api.get('/tpl/queue', { params: { status } }).then(r => r.data),
  /** Full record for staff/the partner, or for an applicant who supplies the application's PAN; otherwise status only. */
  getPartner: (id: string, pan?: string) => api.get(`/tpl/${id}`, { params: pan ? { pan } : undefined }).then(r => r.data),
  approve: (id: string) => api.post(`/tpl/approve/${id}`).then(r => r.data),
  reject: (id: string, reason: string) => api.post(`/tpl/reject/${id}`, { reason }).then(r => r.data),
  updateApplication: (id: string, data: Record<string, unknown>) => api.patch(`/tpl/${id}`, data).then(r => r.data),
  /** Signed upload URL for one application document; use uploadTplDocument() from services/tplDocuments. */
  documentUploadUrl: (data: {
    doc_type: string
    content_type: string
    size: number
    custom_id?: string
    application_id?: string
    verify_pan?: string
  }): Promise<{ path: string; token: string; signed_url: string }> =>
    api.post('/tpl/applications/upload-url', data).then(r => r.data),
  /** The partner swaps one of its documents for a file already uploaded to its folder; goes back to review. */
  replaceDocument: (id: string, docId: string, path: string) =>
    api.post(`/tpl/${id}/documents/${docId}/replace`, { path }).then(r => r.data),
  /** The partner asks to change SLA, tax treatment or corridors; applied only once staff approve. */
  requestSettings: (id: string, data: { sla_commitment: string; tax_treatment: string; corridors: unknown[] }) =>
    api.post(`/tpl/${id}/settings`, data).then(r => r.data),
  pause: (id: string) => api.post(`/tpl/${id}/pause`).then(r => r.data),
  resume: (id: string) => api.post(`/tpl/${id}/resume`).then(r => r.data),
  delete: (id: string) => api.delete(`/tpl/${id}`).then(r => r.data),
  sendSetupOtp: (email: string) => api.post('/tpl/auth/send-otp', { email }).then(r => r.data),
  setupPassword: (email: string, otp: string, password: string) => api.post('/tpl/auth/setup-password', { email, otp, password }).then(r => r.data),
}

export interface OnlineGstin {
  status: 'not_configured' | 'active' | 'inactive' | 'not_found' | 'unavailable'
  legal_name?: string | null
  trade_name?: string | null
  gst_status?: string | null
}

export interface GstinVerification {
  gstin: string
  valid: boolean
  problem?: 'empty' | 'format' | 'checksum'
  message?: string
  stateCode?: string
  pan?: string
  online: OnlineGstin
  /** One plain sentence for the person looking at the screen. */
  summary: string
}

export const gstinAPI = {
  /** Checksum and PAN check on the server, plus the online lookup when the GSP is configured. */
  verify: (gstin: string, pan?: string): Promise<GstinVerification> =>
    api.post('/gstin/verify', { gstin, pan }).then(r => r.data),
}

export type TplSource = { request_id: string } | { shipment_id: string }

export interface TplOffer {
  id: string
  partner_id: string
  partner_name?: string | null
  source_type: 'request' | 'shipment'
  request_id: string | null
  shipment_id: string | null
  corridor_name: string | null
  pickup_location: string | null
  drop_location: string | null
  weight_kg: number | null
  proposed_price: number | null
  status: 'offered' | 'accepted' | 'declined' | 'taken' | 'withdrawn'
  pickup_eta: string | null
  decline_reason: string | null
  offered_at: string
  responded_at: string | null
}

export interface TplOrder {
  id: string
  offer_id: string
  partner_id: string
  partner_name?: string | null
  source_type: 'request' | 'shipment'
  request_id: string | null
  shipment_id: string | null
  pickup_location: string | null
  drop_location: string | null
  weight_kg: number | null
  agreed_amount: number
  status: 'accepted' | 'picked_up' | 'in_transit' | 'delivered' | 'cancelled'
  pickup_eta: string | null
  due_by: string | null
  accepted_at: string
  picked_up_at: string | null
  delivered_at: string | null
  pod_note: string | null
  paid_at: string | null
  paid_reference: string | null
  rating: number | null
  rating_note: string | null
}

export interface TplPartnerStats {
  offers_received: number
  offers_accepted: number
  offers_declined: number
  offers_taken: number
  acceptance_rate: number | null
  avg_response_minutes: number | null
  orders_completed: number
  orders_active: number
  sla_breaches: number
  sla_measured: number
  rating_avg: number | null
  rating_count: number
}

export interface TplEarnings {
  /** paid: delivered and paid. payable: delivered, not paid yet. in_progress: accepted, picked up or in transit. unpaid = payable + in_progress. */
  totals: { total: number; paid: number; payable: number; in_progress: number; unpaid: number }
  months: { month: string; total: number; paid: number; payable: number; in_progress: number; unpaid: number; orders: TplOrder[] }[]
}

const sourceParams = (source: TplSource) => ({ ...source })

export const tplNetworkAPI = {
  settings: (): Promise<{ auto_escalate: boolean }> => api.get('/tpl-network/settings').then(r => r.data),
  saveSettings: (auto_escalate: boolean): Promise<{ auto_escalate: boolean }> => api.put('/tpl-network/settings', { auto_escalate }).then(r => r.data),
  // Staff
  escalations: (source: TplSource): Promise<{ offers: TplOffer[]; order: TplOrder | null }> =>
    api.get('/tpl-network/escalations', { params: sourceParams(source) }).then(r => r.data),
  preview: (source: TplSource): Promise<{ pickup: string; drop: string; distance_km: number | null; partners: { partner_id: string; company_name: string; corridor_name: string; price: number | null; rate: { amount: number; unit: 'per_trip' | 'per_km' } | null }[] }> =>
    api.get('/tpl-network/escalations/preview', { params: sourceParams(source) }).then(r => r.data),
  /** `vendor_price` (requests only) is what the vendor pays for the load, which their invoice is made from. */
  escalate: (source: TplSource, vendorPrice?: number): Promise<{ created: number; already_offered: number; matched: number }> =>
    api.post('/tpl-network/escalations', vendorPrice ? { ...source, vendor_price: vendorPrice } : source).then(r => r.data),
  setVendorPrice: (requestId: string, cost: number): Promise<{ request_id: string; cost: number; invoice: string | null }> =>
    api.put(`/tpl-network/requests/${requestId}/price`, { cost }).then(r => r.data),
  withdrawAll: (source: TplSource) => api.post('/tpl-network/escalations/withdraw', source).then(r => r.data),
  withdrawOffer: (offerId: string) => api.post(`/tpl-network/offers/${offerId}/withdraw`).then(r => r.data),
  orders: (partnerId?: string): Promise<TplOrder[]> =>
    api.get('/tpl-network/orders', { params: partnerId ? { partner_id: partnerId } : undefined }).then(r => r.data),
  rateOrder: (orderId: string, rating: number, note?: string) =>
    api.post(`/tpl-network/orders/${orderId}/rate`, { rating, note }).then(r => r.data),
  markPaid: (orderId: string, paid: boolean, reference?: string) =>
    api.post(`/tpl-network/orders/${orderId}/paid`, { paid, reference }).then(r => r.data),
  allStats: (): Promise<Record<string, TplPartnerStats>> => api.get('/tpl-network/partners/stats').then(r => r.data),
  partnerStats: (partnerId: string): Promise<TplPartnerStats> => api.get(`/tpl-network/partners/${partnerId}/stats`).then(r => r.data),
  // Partner
  myOffers: (): Promise<TplOffer[]> => api.get('/tpl-network/my/offers').then(r => r.data),
  accept: (offerId: string, data: { pickup_eta?: string; delivery_eta?: string; agreed_amount?: number }): Promise<TplOrder> =>
    api.post(`/tpl-network/my/offers/${offerId}/accept`, data).then(r => r.data),
  decline: (offerId: string, reason: string) => api.post(`/tpl-network/my/offers/${offerId}/decline`, { reason }).then(r => r.data),
  myOrders: (): Promise<TplOrder[]> => api.get('/tpl-network/my/orders').then(r => r.data),
  updateOrder: (orderId: string, status: 'picked_up' | 'in_transit' | 'delivered', note?: string): Promise<TplOrder> =>
    api.post(`/tpl-network/my/orders/${orderId}/status`, { status, note }).then(r => r.data),
  myEarnings: (): Promise<TplEarnings> => api.get('/tpl-network/my/earnings').then(r => r.data),
  myStats: (): Promise<TplPartnerStats> => api.get('/tpl-network/my/stats').then(r => r.data),
}

export const telemetryWS = {
  /** WebSocket URL on the same backend the REST client uses (Vercel rewrites cannot proxy WebSockets). */
  getURL: () => {
    const url = new URL(baseURL, window.location.origin)
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${url.host}${url.pathname.replace(/\/$/, '')}/telemetry/ws`
  },
  /**
   * Open the live telemetry feed with the current session token (staff only).
   * Reconnects with a growing delay (5 s, doubling up to 30 s) after the connection drops,
   * and reports whether it is connected through `onStatus`.
   * Returns a handle whose close() also stops reconnecting and cancels a connection still being set up.
   */
  connect: <T = unknown>(onMessage: (data: T) => void, onStatus?: (connected: boolean) => void) => {
    const RETRY_MIN_MS = 5_000
    const RETRY_MAX_MS = 30_000
    let ws: WebSocket | null = null
    let closed = false
    let retryDelay = RETRY_MIN_MS
    let retryTimer: ReturnType<typeof setTimeout> | undefined

    const scheduleRetry = () => {
      if (closed) return
      retryTimer = setTimeout(open, retryDelay)
      retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS)
    }

    const open = () => {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (closed) return
        if (!session?.access_token) { scheduleRetry(); return }
        const socket = new WebSocket(`${telemetryWS.getURL()}?token=${encodeURIComponent(session.access_token)}`)
        ws = socket
        socket.onopen = () => {
          retryDelay = RETRY_MIN_MS
          onStatus?.(true)
        }
        socket.onmessage = (event) => {
          try {
            onMessage(JSON.parse(event.data))
          } catch (err) {
            console.error('WS Parse Error', err)
          }
        }
        socket.onclose = () => {
          if (ws === socket) ws = null
          if (closed) return
          onStatus?.(false)
          scheduleRetry()
        }
      }).catch(() => {
        if (!closed) { onStatus?.(false); scheduleRetry() }
      })
    }
    open()

    return {
      close: () => {
        closed = true
        clearTimeout(retryTimer)
        ws?.close()
      },
    }
  }
}
