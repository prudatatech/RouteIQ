import axios from 'axios'
import { supabase } from '@/services/supabase'
import { orgHeaders } from '@/store/orgStore'
import type {
  PeopleAttention, PeopleSettings, DuplicateMatch, ImportReport, PersonDetail, PersonDocument, PersonRow, EmergencyContact, BankAccount, PersonNote,
} from '@/components/people/types'
import type { ShipmentOverview } from '@/components/shipments/types'
import type {
  ClosedSettlement, DispatchCheck, DocumentHistory, DocumentInput, DocumentPatch, GenerateKind, LoadDocument, LoadDocumentsResponse,
  LoadTimelineResponse, Settlement, UploadUrl,
} from '@/types/loadDocuments'
import type { CompanyProfile, InvoiceDetail, InvoiceReport, InvoiceReportKind, InvoiceReportStatus, InvoiceSummary } from '@/utils/finance'
import type { QuoteRequest, QuoteResponse } from '@/services/pricing'
import type { CustomerProfile, CustomerProfileInput } from '@/utils/customerProfile'
import type {
  AssistResult, BulkResult, BusinessProfile, BusinessProfileView, GoodsCategory, HsnHit, LoadListPage, LoadPayload, LoadSummary, PincodeInfo, PostedLoad, VehicleClass, VendorSession,
} from '@/types/load'

import type { Membership, OrgMember, OrgPage, OrgProfile, OrgProfileInput, OrgRegistration, OrgRole, OrgRow } from '@/utils/orgs'

let baseURL = import.meta.env.VITE_API_URL || 'https://api.margixindia.com/api/v1';
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
  
  // The organisation the person is working in; absent when none is active (older backend)
  for (const [name, value] of Object.entries(orgHeaders())) config.headers.set(name, value)

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
  get: (id: string) => api.get(`/vehicles/${id}`).then(r => r.data),
  create: (data: object) => api.post('/vehicles/', data).then(r => r.data),
  update: (id: string, data: object) => api.patch(`/vehicles/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/vehicles/${id}`),
  summary: () => api.get('/vehicles/summary').then(r => r.data),
  /** How many times each vehicle has raised an SOS: { [vehicle_id]: { total, last_30_days, open, cancelled } }. Staff only. */
  sosCounts: () => api.get('/vehicles/sos-counts').then(r => r.data as Record<string, { total: number; last_30_days: number; open: number; cancelled: number }>),
  /** One vehicle's SOS history (newest first) with its counts. Staff only. */
  sosHistory: (id: string) => api.get(`/vehicles/${id}/sos`).then(r => r.data as {
    counts: { total: number; last_30_days: number; open: number; cancelled: number }
    alerts: {
      id: string; driver_id: string | null; alert_type: string | null; description: string | null; severity: string | null
      latitude: number | null; longitude: number | null; status: string | null; created_at: string; updated_at: string | null
    }[]
  }),
  /** Staff raise an SOS for a vehicle. `severity` is whether injuries are reported. */
  raiseSos: (id: string, data: {
    alert_type: 'panic_button' | 'accident' | 'breakdown' | 'medical' | 'theft' | 'other'
    severity?: 'serious' | 'minor'
    description?: string
  }) => api.post(`/vehicles/${id}/sos`, data).then(r => r.data),
}

/** A stored vehicle photo; `url` is a short-lived signed link. */
export interface VehiclePhoto {
  slot: 'front' | 'side' | 'back' | 'interior' | 'cargo'
  url: string | null
  updated_at: string | null
}

/** A vehicle a driver registered from the app, waiting for a decision. */
export interface VehicleRequest {
  vehicle: Record<string, unknown> & { id: string; plate_number: string; vehicle_type: string; capacity_kg?: number | null }
  driver: { id: string; full_name: string | null; phone: string | null; email: string | null } | null
  photos: VehiclePhoto[]
  primary_photo_url: string | null
  submitted_at: string | null
}

/** Approval of vehicles registered from the driver app (admin and manager). */
export const orgAPI = {
  mine: () => api.get('/orgs/mine').then(r => (Array.isArray(r.data) ? r.data : []) as Membership[]),
  get: () => api.get('/org').then(r => r.data as OrgProfile),
  update: (data: Partial<OrgProfileInput>) => api.patch('/org', data).then(r => r.data as OrgProfile),
  members: () => api.get('/org/members').then(r => (Array.isArray(r.data) ? r.data : []) as OrgMember[]),
  addMember: (data: { email?: string; phone?: string; role: OrgRole }) => api.post('/org/members', data).then(r => r.data as OrgMember),
  updateMember: (userId: string, data: { role?: OrgRole; status?: 'active' | 'removed' }) =>
    api.patch(`/org/members/${userId}`, data).then(r => r.data as OrgMember),
}

export const orgRegisterAPI = {
  /** POST /orgs: a new organisation, pending until the platform approves it. Empty fields are left out. */
  create: (kind: 'logistic_company' | 'vendor', data: Partial<OrgRegistration>) => {
    const body: Record<string, string> = {}
    for (const [key, value] of Object.entries(data)) if (typeof value === 'string' && value.trim()) body[key] = value.trim()
    return api.post('/orgs', { kind, ...body }).then(r => r.data as OrgRow)
  },
  /** PATCH /org: the owner corrects the registration (also while it is pending or rejected). */
  update: (data: Partial<OrgRegistration>) => api.patch('/org', data).then(r => r.data as OrgRow),
}

export const adminOrgsAPI = {
  list: (params: { kind?: string; status?: string; limit?: number; offset?: number }) =>
    api.get('/admin/orgs', { params }).then(r => r.data as OrgPage),
  decide: (id: string, decision: 'approve' | 'reject' | 'suspend', reason?: string) =>
    api.put(`/admin/orgs/${id}/${decision}`, reason ? { reason } : {}).then(r => r.data as OrgRow),
}

export const vehicleRequestsAPI = {
  list: () => api.get('/vehicles/requests').then(r => r.data as { pending: number; requests: VehicleRequest[] }),
  count: () => api.get('/vehicles/requests/count').then(r => r.data as { pending: number }),
  approve: (id: string) => api.post(`/vehicles/${id}/approve`).then(r => r.data),
  reject: (id: string, reason: string) => api.post(`/vehicles/${id}/reject`, { reason }).then(r => r.data),
}

export const vehiclePhotosAPI = {
  list: (id: string) => api.get(`/vehicles/${id}/photos`).then(r => ensureArray(r.data) as VehiclePhoto[]),
  uploadUrl: (id: string, data: { slot: string; content_type: string; size: number }) =>
    api.post(`/vehicles/${id}/photos/upload-url`, data).then(r => r.data as { path: string; token: string; bucket: string }),
  save: (id: string, slot: string, file_path: string) => api.put(`/vehicles/${id}/photos/${slot}`, { file_path }).then(r => r.data as VehiclePhoto),
  remove: (id: string, slot: string) => api.delete(`/vehicles/${id}/photos/${slot}`),
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

/** GET /ops/today: the work queue counts and live strip of the Today page. A manager gets the operations queues only. */
export interface TodayResponse {
  scope: 'all' | 'operations'
  generated_at: string
  queues: {
    sos: { count: number }
    problems: { count: number; overdue: number }
    requests: { count: number; bookings: number; vendor_loads: number }
    needs_vehicle: { count: number; shipments: number; vendor_loads: number }
    trips_to_send: { count: number }
    vehicle_requests: { count: number }
    documents: { count: number }
    driver_actions: { count: number }
    unpriced?: { count: number; no_price: number }
    /** Payments customers say they made, waiting to be confirmed or rejected (admin and superadmin). */
    payment_reports?: { count: number }
    kyc?: { count: number }
    bids?: { count: number }
  }
  live: { active_trips: number; vehicles_on_road: number; on_time_rate_pct: number | null }
}

export const opsAPI = {
  today: () => api.get('/ops/today').then(r => r.data as TodayResponse),
}

export const usersAPI = {
  me: () => api.get('/users/me').then(r => r.data),
  list: () => api.get('/users/').then(r => r.data),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/users/${id}`, data).then(r => r.data),
}

export interface PeopleListParams {
  role?: string
  status?: string
  q?: string
  docs?: 'expiring' | 'expired' | 'missing' | 'pending'
  limit?: number
  offset?: number
}

/** People profiles (docs/people-plan.md). Staff manage them; drivers use the `me` calls in their app. */
export const peopleAPI = {
  list: (params?: PeopleListParams) => api.get('/people', { params }).then(r => {
    const d = r.data
    return (Array.isArray(d) ? d : Array.isArray(d?.items) ? d.items : []) as PersonRow[]
  }),
  create: (data: {
    role: string; full_name: string; phone?: string; email?: string; profile?: Record<string, unknown>
  }) => api.post('/people', data).then(r => r.data as { id?: string; user?: { id: string } }),
  get: (id: string) => api.get(`/people/${id}`).then(r => r.data as PersonDetail),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/people/${id}`, data).then(r => r.data),
  setStatus: (id: string, status: string, reason?: string, dates?: { leave_from?: string; leave_until?: string; suspended_until?: string }) =>
    api.post(`/people/${id}/status`, { status, reason, ...dates }).then(r => r.data),
  /** Sends (or resends) the sign-in invite. The server allows one every 10 minutes. */
  resendInvite: (id: string) => api.post(`/people/${id}/invite`).then(r => r.data),
  /** Superadmin, inactive people only. Clears personal data and keeps the record id. */
  anonymise: (id: string) => api.post(`/people/${id}/anonymise`).then(r => r.data),
  /** Matches on phone or a document number (normalised on the server). */
  duplicates: (params: { phone?: string; doc_type?: string; doc_number?: string }) =>
    api.get('/people/duplicates', { params }).then(r => {
      const d = r.data
      return (Array.isArray(d) ? d : Array.isArray(d?.duplicates) ? d.duplicates : Array.isArray(d?.matches) ? d.matches : []) as DuplicateMatch[]
    }),
  settings: () => api.get('/people/settings').then(r => r.data as PeopleSettings),
  saveSettings: (data: Partial<PeopleSettings>) => api.put('/people/settings', data).then(r => r.data as PeopleSettings),
  /** A CSV file. A dry run by default; `commit` creates the people. */
  importCsv: (file: File, commit: boolean) => {
    const body = new FormData()
    body.append('file', file)
    return api.post('/people/import', body, { params: commit ? { commit: true } : undefined, headers: { 'Content-Type': 'multipart/form-data' } })
      .then(r => r.data as ImportReport)
  },
  exportCsv: (kind: 'people' | 'expiring', days = 30) =>
    api.get(kind === 'people' ? '/people/export.csv' : '/people/documents/expiring.csv', {
      params: kind === 'expiring' ? { days } : undefined, responseType: 'blob',
    }).then(r => r.data as Blob),
  attention: () => api.get('/dashboard/people-attention').then(r => r.data as PeopleAttention),

  documentUploadUrl: (id: string, data: { doc_type: string; file_name: string; content_type: string }) =>
    api.post(`/people/${id}/documents/upload-url`, data).then(r => r.data as { path: string; signed_url: string; token: string }),
  addDocument: (id: string, data: {
    doc_type: string; doc_number?: string; issued_on?: string; expires_on?: string; review_by?: string; name_on_document?: string
    file_path: string; extra_file_paths?: string[]; metadata?: Record<string, unknown>
  }) => api.post(`/people/${id}/documents`, data).then(r => r.data as PersonDocument),
  updateDocument: (id: string, docId: string, data: Record<string, unknown>) =>
    api.patch(`/people/${id}/documents/${docId}`, data).then(r => r.data),
  /** `index` picks an extra page (back of a card); leave it out for the main file. */
  documentFile: (id: string, docId: string, index?: number) =>
    api.get(`/people/${id}/documents/${docId}/file`, { params: index === undefined ? undefined : { index } }).then(r => r.data as { url: string }),
  archiveDocument: (id: string, docId: string) => api.delete(`/people/${id}/documents/${docId}`).then(r => r.data),

  emergencyContacts: (id: string) => api.get(`/people/${id}/emergency-contacts`).then(r => ensureArray(r.data) as EmergencyContact[]),
  addEmergencyContact: (id: string, data: Partial<EmergencyContact>) => api.post(`/people/${id}/emergency-contacts`, data).then(r => r.data),
  updateEmergencyContact: (id: string, contactId: string, data: Partial<EmergencyContact>) =>
    api.patch(`/people/${id}/emergency-contacts/${contactId}`, data).then(r => r.data),
  deleteEmergencyContact: (id: string, contactId: string) => api.delete(`/people/${id}/emergency-contacts/${contactId}`).then(r => r.data),

  bankAccounts: (id: string) => api.get(`/people/${id}/bank-accounts`).then(r => ensureArray(r.data) as BankAccount[]),
  addBankAccount: (id: string, data: Partial<BankAccount>) => api.post(`/people/${id}/bank-accounts`, data).then(r => r.data),
  updateBankAccount: (id: string, accountId: string, data: Partial<BankAccount>) =>
    api.patch(`/people/${id}/bank-accounts/${accountId}`, data).then(r => r.data),
  deleteBankAccount: (id: string, accountId: string) => api.delete(`/people/${id}/bank-accounts/${accountId}`).then(r => r.data),
  /** Superadmin only; the backend logs every reveal. */
  revealBankAccount: (id: string, accountId: string) =>
    api.post(`/people/${id}/bank-accounts/${accountId}/reveal`).then(r => r.data as { account_number: string }),

  notes: (id: string) => api.get(`/people/${id}/notes`).then(r => ensureArray(r.data) as PersonNote[]),
  addNote: (id: string, body: string) => api.post(`/people/${id}/notes`, { body }).then(r => r.data),
}

export const depotsAPI = {
  list: () => api.get('/depots/').then(r => ensureArray(r.data) as { id: string; name: string }[]),
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
  /**
   * Staff confirm a delivery (recorded as a custody delivery). Needs evidence: a photo uploaded for
   * this shipment (cargoAPI photo upload, `cargo/<shipment id>/`), the delivery OTP, or a reason of
   * at least 3 characters that is logged.
   */
  verifyPod: (data: { tracking_id: string, recipient_name: string, photo_paths?: string[], otp?: string, reason?: string }) =>
    api.post('/cargo/verify-pod', data).then(r => r.data),
}

export const fleetAPI = {
  health: () => api.get('/fleet/health').then(r => ensureArray(r.data)),
  vehicleHealth: (id: string) => api.get(`/fleet/vehicles/${id}/health`).then(r => r.data),
  /** The vehicle row: documents' expiry dates, odometer and when/how it was last updated. */
  vehicle: (id: string) => api.get(`/vehicles/${id}`).then(r => r.data),
  /** A reading lower than the current one needs `correctionReason`. */
  setOdometer: (id: string, odometerKm: number, correctionReason?: string) =>
    api.put(`/fleet/vehicles/${id}/odometer`, { odometer_km: odometerKm, ...(correctionReason ? { correction_reason: correctionReason } : {}) }).then(r => r.data),
  /** Adds the distance driven since the last update (from GPS); returns before, after and the source. */
  syncOdometer: (id: string) => api.post(`/fleet/vehicles/${id}/odometer/sync`).then(r => r.data),
  serviceTemplates: () => api.get('/fleet/service-plan-templates').then(r => ensureArray(r.data)),
  addDefaultPlans: (id: string) => api.post(`/fleet/vehicles/${id}/service-plans/defaults`).then(r => ensureArray(r.data)),
  maintenanceJobs: (params: { status?: 'open' | 'closed'; vehicle_id?: string } = {}) =>
    api.get('/fleet/maintenance/jobs', { params }).then(r => ensureArray(r.data)),
  maintenancePreview: (id: string) => api.get(`/fleet/vehicles/${id}/maintenance/preview`).then(r => r.data),
  openMaintenance: (id: string, body: object) => api.post(`/fleet/vehicles/${id}/maintenance`, body).then(r => r.data),
  updateMaintenanceJob: (jobId: string, body: object) => api.patch(`/fleet/maintenance/jobs/${jobId}`, body).then(r => r.data),
  closeMaintenanceJob: (jobId: string, body: object) => api.post(`/fleet/maintenance/jobs/${jobId}/close`, body).then(r => r.data),
  addJobFiles: (jobId: string, attachments: object[]) => api.post(`/fleet/maintenance/jobs/${jobId}/attachments`, { attachments }).then(r => r.data),
  attachmentUpload: (vehicleId: string, body: { content_type: string; size: number }) =>
    api.post(`/fleet/vehicles/${vehicleId}/service-attachments/upload-url`, body)
      .then(r => r.data as { path: string; token: string; signed_url: string; bucket: string }),
  addRecordFiles: (logId: string, attachments: object[]) => api.post(`/fleet/service-log/${logId}/attachments`, { attachments }).then(r => r.data),
  attachmentUrl: (id: string, download: boolean) =>
    api.get(`/fleet/service-attachments/${id}/url`, { params: download ? { download: 1 } : undefined }).then(r => r.data as { url: string; file_name: string | null }),
  deleteAttachment: (id: string) => api.delete(`/fleet/service-attachments/${id}`).then(r => r.data),
  addServiceItems: (logId: string, items: object[]) => api.post(`/fleet/service-log/${logId}/items`, { items }).then(r => r.data),
  deleteServiceItem: (id: string) => api.delete(`/fleet/service-items/${id}`).then(r => r.data),
  servicePlans: (id: string) => api.get(`/fleet/vehicles/${id}/service-plans`).then(r => ensureArray(r.data)),
  savePlan: (id: string, plan: object) => api.post(`/fleet/vehicles/${id}/service-plans`, plan).then(r => r.data),
  deletePlan: (planId: string) => api.delete(`/fleet/service-plans/${planId}`).then(r => r.data),
  serviceLog: (id: string) => api.get(`/fleet/vehicles/${id}/service-log`).then(r => ensureArray(r.data)),
  logService: (id: string, entry: object) => api.post(`/fleet/vehicles/${id}/service-log`, entry).then(r => r.data),
  serviceDue: () => api.get('/fleet/service-due').then(r => ensureArray(r.data)),
  alerts: (status: 'active' | 'resolved' | 'all') => api.get('/fleet/alerts', { params: { status } }).then(r => ensureArray(r.data)),
  alertSummary: () => api.get('/fleet/alerts/summary').then(r => r.data),
  /** Utilisation, status breakdown, distance, alerts and SOS for the last `days` days. */
  analytics: (days: number) => api.get('/fleet/analytics', { params: { days } }).then(r => r.data),
  acknowledgeAlert: (id: string) => api.post(`/fleet/alerts/${id}/acknowledge`).then(r => r.data),
  resolveAlert: (id: string) => api.post(`/fleet/alerts/${id}/resolve`).then(r => r.data),
  alertSettings: () => api.get('/fleet/alert-settings').then(r => r.data),
  saveAlertSettings: (values: object) => api.put('/fleet/alert-settings', values).then(r => r.data),
  sendTestAlarm: (vehicleId: string, event: string) =>
    api.post('/telematics/test-alarm', { vehicle_id: vehicleId, event }).then(r => r.data),
  /** Current position with speed, heading, accuracy and last seen. */
  vehicleLocation: (id: string) => api.get(`/fleet/vehicles/${id}/location`).then(r => r.data),
  /** Carrying (which load, from where to where, % full), idle (since when) or offline. */
  vehicleActivity: (id: string) => api.get(`/fleet/vehicles/${id}/activity`).then(r => r.data),
  shareLinks: (id: string) => api.get(`/fleet/vehicles/${id}/share-links`).then(r => ensureArray(r.data)),
  /** A public, read-only live-location link that expires after `hours`. */
  createShareLink: (id: string, hours: number) => api.post(`/fleet/vehicles/${id}/share-links`, { hours }).then(r => r.data),
  revokeShareLink: (linkId: string) => api.delete(`/fleet/share-links/${linkId}`).then(r => r.data),
}

export const gpsAPI = {
  /** The driven path of a vehicle between two times (default: the last 24 hours), oldest point first. */
  track: (vehicleId: string, params: { from?: string; to?: string; limit?: number } = {}) =>
    api.get(`/gps/vehicle/${vehicleId}/track`, { params }).then(r => r.data),
}

export interface PublicStats {
  vehicles: number
  deliveries_completed: number
  active_partners: number
  cities_served: number
}

/** A company's spare space on a lane, as a guest sees it: cities and a window only, never a plate, driver or position. */
export interface PublicSpareSpace {
  id: string
  company: { id: string; name: string; city: string | null }
  from_city: string
  to_city: string | null
  departs_from: string
  departs_to: string | null
  vehicle_type: string | null
  free_kg: number
  price_per_kg_from: number | null
}

/** A logistic company that serves a lane. Aggregates only: no phone, email or GSTIN. */
export interface PublicCompany {
  id: string
  name: string
  city: string | null
  vehicle_types: string[]
  trips_completed: number
}

export interface PublicSpareSpaceParams { from?: string; to?: string; date?: string; vehicle_type?: string; min_kg?: number }
export interface PublicCompanyParams { city?: string; vehicle_type?: string }

/** Public calls carry no sign-in header and never trigger the sign-in redirect, so they work for a visitor with no session. */
const publicClient = axios.create({ baseURL, timeout: 20_000, headers: { 'Content-Type': 'application/json' } })

/** Drops empty values so a blank filter is not sent. */
const compact = (params: object) => Object.fromEntries(
  Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(typeof v === 'number' && Number.isNaN(v))),
)

interface PublicQuoteReply {
  status: 'ok' | 'unavailable'
  distance_km?: number
  distance_is_estimate?: boolean
  low?: number
  suggested?: number
  high?: number
  per_km_suggested?: number
}

function toQuoteResponse(r: PublicQuoteReply): QuoteResponse {
  if (r.status !== 'ok' || r.suggested == null || r.low == null || r.high == null) {
    return { status: 'unavailable', reason: 'The price for this lane is on request. Post your load and companies will quote you.', notes: [] }
  }
  return {
    status: 'ok',
    quote_id: null,
    distance_km: r.distance_km ?? 0,
    distance_source: 'estimate',
    distance_is_estimate: r.distance_is_estimate ?? true,
    low: r.low,
    suggested: r.suggested,
    high: r.high,
    per_km_suggested: r.per_km_suggested ?? 0,
    factors: [],
    notes: [],
    demand: { open_loads: 0, available_vehicles: 0, radius_km: 0 },
    history: { samples: 0, median_per_km: null, band_km: [0, 0] },
    weather: { checked: false, severe: false, description: null },
  }
}

export const publicAPI = {
  /** Aggregate counts for the landing page. No sign-in needed. */
  stats: () => publicClient.get('/public/stats').then(r => r.data as PublicStats),
  /** Open spare space on trucks, across active companies. With no filters, the next 50 by departure. */
  spareSpace: (params: PublicSpareSpaceParams = {}) =>
    publicClient.get('/public/spare-space', { params: compact(params) }).then(r => ensureArray(r.data?.items) as PublicSpareSpace[]),
  /** Active logistic companies, optionally by city or vehicle type. */
  companies: (params: PublicCompanyParams = {}) =>
    publicClient.get('/public/companies', { params: compact(params) }).then(r => ensureArray(r.data?.items) as PublicCompany[]),
  /**
   * An indicative price for a load. Writes nothing. Same body as the signed-in price check, without `source`.
   * The answer is shaped like the signed-in one so the same price panel can show it; a public price has no
   * line-by-line reasons.
   */
  quote: (body: Omit<QuoteRequest, 'source'>) =>
    publicClient.post('/public/quote', body).then(r => toQuoteResponse(r.data as PublicQuoteReply)),
  /** City suggestions for a lane search. */
  cities: (q: string) =>
    publicClient.get('/public/cities', { params: { q } }).then(r => ensureArray(r.data?.cities).filter((c): c is string => typeof c === 'string' && c.length > 0)),
  /** HSN suggestions for what the person typed (at least 3 characters), up to 8. */
  hsnSearch: (q: string, signal?: AbortSignal) =>
    publicClient.get('/public/hsn/search', { params: { q }, signal }).then(r => ensureArray(r.data?.items) as HsnHit[]),
  /** One HSN code with its rate or rates; null when the code is not in the master. */
  hsn: (code: string) =>
    publicClient.get(`/public/hsn/${encodeURIComponent(code)}`)
      .then(r => (r.data?.item ?? r.data) as HsnHit)
      .catch(err => { if (axios.isAxiosError(err) && err.response?.status === 404) return null; throw err }),
  /** The state a 6-digit pin code is in; null when it is not known. */
  pincode: (pin: string) =>
    publicClient.get(`/public/pincode/${encodeURIComponent(pin)}`)
      .then(r => r.data as PincodeInfo)
      .catch(err => { if (axios.isAxiosError(err) && err.response?.status === 404) return null; throw err }),
  vehicleClasses: () =>
    publicClient.get('/public/vehicle-classes').then(r => ensureArray(r.data?.items ?? r.data) as VehicleClass[]),
  goodsCategories: () =>
    publicClient.get('/public/goods-categories').then(r => ensureArray(r.data?.items ?? r.data) as GoodsCategory[]),
  /** Totals, tax, e-way, suggestions and the estimate for a load being filled in. Writes nothing. */
  loadAssist: (draft: LoadPayload, signal?: AbortSignal) =>
    publicClient.post('/public/loads/assist', draft, { signal }).then(r => r.data as AssistResult),
  /** The live-location page behind a shared link. No sign-in header, short timeout. */
  vehicleShare: (token: string) => axios
    .get(`${baseURL}/public/vehicle-share/${encodeURIComponent(token)}`, { timeout: 20_000 })
    .then(r => r.data),
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

/** The server sends null for what is not filled in; the form wants text. */
function fromServerProfile(d: Record<string, unknown> | null | undefined): BusinessProfileView {
  const s = (v: unknown) => (typeof v === 'string' ? v : '')
  const p = d ?? {}
  return {
    full_name: s(p.full_name), business_name: s(p.business_name),
    account_type: p.account_type === 'business_partner' ? 'business_partner' : 'customer',
    gstin: s(p.gstin), address: s(p.address), pincode: s(p.pincode), state_code: s(p.state_code), email: s(p.email),
    business_type: s(p.business_type) as BusinessProfile['business_type'],
    monthly_loads: s(p.monthly_loads) as BusinessProfile['monthly_loads'],
    state: s(p.state), complete: p.complete === true, gstin_status: typeof p.gstin_status === 'string' ? p.gstin_status : null,
  }
}

/** The server's enums reject an empty string, so an unchosen option goes as null. */
function toServerProfile(b: BusinessProfile) {
  return {
    full_name: b.full_name, business_name: b.business_name || null, account_type: b.account_type, gstin: b.gstin || null,
    address: b.address, pincode: b.pincode, ...(b.state_code ? { state_code: b.state_code } : {}), email: b.email,
    business_type: b.business_type || null, monthly_loads: b.monthly_loads || null,
  }
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
  /** Accept a load at a price: a flat `cost`, or a `cost_per_km`. Needed unless the load already has a price. */
  approveRequest: (id: string, price?: { cost?: number; cost_per_km?: number }) => api.put(`/vendor/shipment-request/${id}/approve`, price ?? {}).then(r => r.data),
  rejectRequest: (id: string, reason: string) => api.put(`/vendor/shipment-request/${id}/reject`, { reason }).then(r => r.data),
  /** The vendor withdraws a load they posted, while it has no vehicle yet. */
  cancelRequest: (id: string) => api.put(`/vendor/shipment-request/${id}/cancel`).then(r => r.data),
  approveKyc: (id: string) => api.put(`/vendor/kyc/${id}/approve`).then(r => r.data),
  /** Staff place a vendor who has no pickup location (their company details and KYC stay as they are). */
  setLocation: (id: string, data: { lat: number; lng: number; city?: string }) =>
    api.put(`/vendor/${encodeURIComponent(id)}/location`, data).then(r => r.data),
  rejectKyc: (id: string, reason: string) => api.put(`/vendor/kyc/${id}/reject`, { reason }).then(r => r.data),
  /** Signed upload URL for one KYC document; use uploadKycDocument() from services/kycDocuments. */
  kycUploadUrl: (data: { key: string; content_type: string; size: number }): Promise<{ path: string; token: string; signed_url: string }> =>
    api.post('/vendor/kyc/upload-url', data).then(r => r.data),
  /** Saves uploaded document paths on the vendor's profile ahead of the final submit. */
  saveKycDocuments: (data: { docUrls?: Record<string, string>; otherDocs?: { name: string; path: string }[] }) =>
    api.put('/vendor/kyc/documents', data).then(r => r.data),
  /** The vendor's own invoices, newest first. */
  invoices: () => api.get('/vendor/invoices').then(r => ensureArray(r.data)),
  /** The vendor's own loads (posted loads and return-trip space they won) with stage, price, truck, invoice and open problems. */
  loads: () => api.get('/vendor/loads').then(r => ensureArray(r.data)),
  /** One load with where it is, lots, proof of delivery, problems in plain words, claims and whether a claim can be raised. */
  load: (id: string) => api.get(`/vendor/loads/${encodeURIComponent(id)}`).then(r => r.data),
  /** Posts a load. The same client_request_id returns the first load instead of a second one. */
  postLoad: (body: LoadPayload) => api.post('/vendor/loads', body).then(r => r.data as PostedLoad),
  /** The CSV template for a bulk upload, fetched with the sign-in header. */
  bulkTemplate: () => api.get('/vendor/loads/template.csv', { responseType: 'blob' }).then(r => r.data as Blob),
  /** Posts one load per CSV row (up to 50). `csv` is the file's text. */
  bulkPost: (csv: string, fileName?: string) =>
    api.post('/vendor/loads/bulk', { csv, ...(fileName ? { file_name: fileName } : {}) }).then(r => r.data as BulkResult),
  /** The vendor's posted loads, newest first. */
  myPostedLoads: (params: { page?: number } = {}) =>
    api.get('/vendor/loads/mine', { params }).then(r => {
      const d = r.data
      const items = (Array.isArray(d) ? d : ensureArray(d?.items)) as LoadSummary[]
      return { items, total: d?.total, page: d?.page } as LoadListPage
    }),
  /** { draft }: a copy of a posted load with the dates and client_request_id null. Creates nothing. */
  repostLoad: (id: string) =>
    api.post(`/vendor/loads/${encodeURIComponent(id)}/repost`).then(r => r.data.draft as Partial<LoadPayload>),
  businessProfile: () => api.get('/vendor/business-profile').then(r => fromServerProfile(r.data)),
  saveBusinessProfile: (body: BusinessProfile) =>
    api.put('/vendor/business-profile', toServerProfile(body)).then(r => fromServerProfile(r.data)),
  assignVehicle: (id: string, data: { vehicle_id: string, cost?: number, cost_per_km?: number }) =>
    api.put(`/vendor/shipment-request/${id}/assign-vehicle`, data).then(r => r.data),
}

/** Documents, pre-dispatch check, settlement and timeline of one vendor load (backend-ts/src/routes/load-documents.routes.ts). */
const loadBase = (id: string) => `/loads/${encodeURIComponent(id)}`
const docBase = (id: string, docId: string) => `${loadBase(id)}/documents/${encodeURIComponent(docId)}`
export const loadDocumentsAPI = {
  list: (id: string): Promise<LoadDocumentsResponse> => api.get(`${loadBase(id)}/documents`).then(r => r.data),
  /** `size` is in bytes; PDF, JPG or PNG up to 10 MB. Put the file with supabase.storage.from(bucket).uploadToSignedUrl(path, token, file). */
  uploadUrl: (id: string, data: { kind: string; content_type: string; size: number }): Promise<UploadUrl> =>
    api.post(`${loadBase(id)}/documents/upload-url`, data).then(r => r.data),
  create: (id: string, data: DocumentInput): Promise<LoadDocument> =>
    api.post(`${loadBase(id)}/documents`, data).then(r => r.data),
  update: (id: string, docId: string, data: DocumentPatch): Promise<LoadDocument> =>
    api.patch(docBase(id, docId), data).then(r => r.data),
  generate: (id: string, kind: GenerateKind): Promise<LoadDocument> =>
    api.post(`${loadBase(id)}/documents/generate/${kind}`).then(r => r.data),
  /**
   * A generated document streams as application/pdf (returned as a blob); an uploaded file answers { url, expires_in }.
   * Fetched with the sign-in header either way.
   */
  pdf: async (id: string, docId: string): Promise<{ blob: Blob } | { url: string }> => {
    const res = await api.get(`${docBase(id, docId)}/pdf`, { responseType: 'blob' })
    const blob = res.data as Blob
    if (String(blob.type).includes('application/json')) {
      const body = JSON.parse(await blob.text()) as { url?: string }
      if (!body.url) throw new Error('The file is not available')
      return { url: body.url }
    }
    return { blob }
  },
  history: (id: string, docId: string): Promise<DocumentHistory> => api.get(`${docBase(id, docId)}/history`).then(r => r.data),
  dispatchCheck: (id: string): Promise<DispatchCheck> => api.get(`${loadBase(id)}/dispatch-check`).then(r => r.data),
  /** The settlement, or null when none is opened (the API answers 404). */
  settlement: (id: string): Promise<Settlement | null> =>
    api.get(`${loadBase(id)}/settlement`).then(r => r.data as Settlement).catch(err => {
      if (err?.response?.status === 404) return null
      throw err
    }),
  openSettlement: (id: string, data?: { agreed_freight?: number; advance_paid?: number; payment_terms?: Settlement['payment_terms'] }): Promise<Settlement> =>
    api.post(`${loadBase(id)}/settlement`, data ?? {}).then(r => r.data),
  addExtraCharge: (id: string, data: { label: string; amount: number }): Promise<Settlement> =>
    api.post(`${loadBase(id)}/settlement/extra-charges`, data).then(r => r.data),
  approveExtraCharge: (id: string, idx: number): Promise<Settlement> =>
    api.post(`${loadBase(id)}/settlement/extra-charges/${idx}/approve`).then(r => r.data),
  addDeduction: (id: string, data: { label: string; amount: number; reason: string }): Promise<Settlement> =>
    api.post(`${loadBase(id)}/settlement/deductions`, data).then(r => r.data),
  closeSettlement: (id: string, data?: { payment_status?: Settlement['payment_status'] }): Promise<ClosedSettlement> =>
    api.post(`${loadBase(id)}/settlement/close`, data ?? {}).then(r => r.data),
  timeline: (id: string): Promise<LoadTimelineResponse> => api.get(`${loadBase(id)}/timeline`).then(r => r.data),
}

export const authAPI = {
  /** Texts a 6-digit code to a vendor's phone. No sign-in needed. */
  vendorSendOtp: (phone: string) => publicClient.post('/auth/vendor/send-otp', { phone }).then(r => r.data),
  /** Checks the code; the answer carries a session to hand to supabase.auth.setSession. */
  vendorVerifyOtp: (phone: string, otp: string) =>
    publicClient.post('/auth/vendor/verify-otp', { phone, otp }).then(r => r.data as VendorSession),
  inviteVendor: (email: string, password: string) =>
    api.post('/auth/invite-vendor', { email, password }).then(r => r.data),
}

export const shipmentsAPI = {
  list: (params?: Record<string, unknown>) => api.get('/shipments/', { params }).then(r => ensureArray(r.data)),
  get: (id: string) => api.get(`/shipments/${id}`).then(r => r.data),
  /** The shipment page's read: one id, tracking id or CM- code, with its trip, vehicle, driver, requester, problems, claims and invoice. */
  overview: (ref: string) => api.get(`/shipments/${encodeURIComponent(ref)}/overview`).then(r => r.data as ShipmentOverview),
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
  /** `dispatch: true` sends the trip to the driver now; otherwise it waits in Dispatch under Trips to send. */
  assignDriver: (id: string, vehicleId: string, dispatch = false) => api.post(`/shipments/${id}/assign`, { vehicle_id: vehicleId, dispatch }).then(r => r.data),
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
  /** Staff close an alert as a false alarm. (The driver cancels their own from the app.) */
  cancelSos: (id: string) => api.post(`/telemetry/sos/${id}/cancel`).then(r => r.data),
  /** Driver raises an SOS for their assigned vehicle. */
  triggerSos: (data: { lat?: number, lng?: number, alert_type?: 'panic_button' | 'accident' | 'breakdown' | 'medical' | 'theft' | 'other' }) =>
    api.post('/telemetry/sos/trigger', data).then(r => r.data),
  /**
   * Driver completes a route stop. The backend records it as a custody delivery (or a failed
   * attempt), with an implied pickup when none was recorded. Without `outcome` the older evidence
   * rules apply: the receiver's name and a drawn signature are enough.
   */
  completeStop: (data: { stop_id: string, status: 'completed' | 'failed', received_by?: string, signature_data?: string, lat?: number, lng?: number }) =>
    api.post('/telemetry/driver-ping/complete-stop', data, {
      headers: { 'Idempotency-Key': `complete-stop-${data.stop_id}-${data.status}` },
    }).then(r => r.data),
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

/** A fresh key per attempt, so a double click is applied once and a later retry is not mistaken for it. */
const reportKey = (prefix: string) =>
  `${prefix}-${(typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`}`

/** Invoices, expenses, fuel price and profit and loss (staff). */
export const financeAPI = {
  summary: (range: DateParams) => api.get('/finance/summary', { params: range }).then(r => r.data),
  unpriced: (range: DateParams) => api.get('/finance/unpriced', { params: range }).then(r => ensureArray(r.data)),
  invoices: (params: DateParams & { status?: string; requester?: string; overdue?: string; reports?: 'open' }) => api.get('/finance/invoices', { params }).then(r => ensureArray(r.data)),
  createInvoice: (target: { shipment_id: string } | { manifest_id: string }) => api.post('/finance/invoices', target).then(r => r.data),
  invoiceSummary: () => api.get('/finance/invoices/summary').then(r => r.data as InvoiceSummary),
  /** Offline payment: staff record how and when the money arrived. */
  payInvoice: (id: string, data: { method: string; reference?: string; paid_on?: string }) => api.put(`/finance/invoices/${id}/pay`, data).then(r => r.data),
  /** Customers' payment reports and questions on invoices (admin and superadmin). */
  invoiceReports: (params: { status?: InvoiceReportStatus; kind?: InvoiceReportKind; invoice_id?: string }) =>
    api.get('/finance/invoice-reports', { params }).then(r => ensureArray(r.data) as InvoiceReport[]),
  /** Marks the invoice paid. `method` is needed when the customer's method was "other". A part payment is refused (409). */
  confirmInvoiceReport: (id: string, data: { method?: string; reference?: string; paid_on?: string; note?: string }) =>
    api.post(`/finance/invoice-reports/${id}/confirm`, data, { headers: { 'Idempotency-Key': reportKey(`confirm-${id}`) } }).then(r => r.data as { report: InvoiceReport; recorded: unknown }),
  rejectInvoiceReport: (id: string, reason: string) =>
    api.post(`/finance/invoice-reports/${id}/reject`, { reason }, { headers: { 'Idempotency-Key': reportKey(`reject-${id}`) } }).then(r => r.data as InvoiceReport),
  answerInvoiceReport: (id: string, answer: string) =>
    api.post(`/finance/invoice-reports/${id}/answer`, { answer }, { headers: { 'Idempotency-Key': reportKey(`answer-${id}`) } }).then(r => r.data as InvoiceReport),
  voidInvoice: (id: string, reason: string) => api.put(`/finance/invoices/${id}/void`, { reason }).then(r => r.data),
  /** Sets the price of a delivery that has none and issues its invoice. */
  setPrice: (data: { kind: 'shipment' | 'manifest'; id: string; amount: number }) =>
    api.post('/finance/unpriced/price', data).then(r => r.data as { invoice_id: string; invoice_number: string | null; amount: number }),
  company: () => api.get('/finance/company').then(r => r.data as CompanyProfile),
  saveCompany: (data: Partial<CompanyProfile>) => api.put('/finance/company', data).then(r => r.data as CompanyProfile),
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

/** Where to pay: the only part of the company settings a vendor or customer may read. */
export interface PaymentDetails {
  account_name: string | null
  bank_name: string | null
  bank_account_no: string | null
  bank_ifsc: string | null
  upi_id: string | null
  payment_terms_days: number
  available: boolean
}

/** One invoice: the document with its links, and its PDF. */
export const invoicesAPI = {
  paymentDetails: (invoiceId?: string) => api.get('/invoices/payment-details', { params: invoiceId ? { invoice: invoiceId } : undefined }).then(r => r.data as PaymentDetails),
  get: (id: string) => api.get(`/invoices/${id}`).then(r => r.data as InvoiceDetail),
  pdf: (id: string) => api.get(`/invoices/${id}/pdf`, { responseType: 'blob' }).then(r => r.data as Blob),
}

export interface CustomerBooking {
  id: string
  customer_id: string
  pickup_name: string
  pickup_address: string
  pickup_lat?: number | null
  pickup_lng?: number | null
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
  /** `name` is already the display name: company, else the person's name, else "Customer 7701" from the phone. */
  customer: { id?: string; name: string | null; full_name?: string | null; phone: string | null; company: string | null } | null
}

/** Bookings made by customers in the mobile app. */
export const bookingsAPI = {
  list: () => api.get('/bookings').then(r => ensureArray(r.data) as CustomerBooking[]),
  /** Creates the shipment, so the booking can be dispatched like any other load. `price` (rupees before GST) overrides the customer's quote. */
  confirm: (id: string, price?: number | null) => api.post(`/bookings/${id}/confirm`, price == null ? {} : { price }).then(r => r.data),
  assign: (id: string, vehicle_id: string, dispatch = false) => api.post(`/bookings/${id}/assign`, { vehicle_id, dispatch }).then(r => r.data),
  cancel: (id: string, reason: string) => api.post(`/bookings/${id}/cancel`, { reason }).then(r => r.data),
  /** A customer's details for invoices (any staff role). */
  customerProfile: (customerId: string) => api.get(`/bookings/customers/${encodeURIComponent(customerId)}/profile`).then(r => r.data as CustomerProfile),
  /** Sends only the fields that changed; an empty string clears one. A bad value is a 422 with a plain message. */
  saveCustomerProfile: (customerId: string, data: CustomerProfileInput) =>
    api.patch(`/bookings/customers/${encodeURIComponent(customerId)}/profile`, data).then(r => r.data as CustomerProfile),
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
  /** The partner record linked to this sign-in (the caller's own, or any for staff). */
  byUser: (userId: string) => api.get(`/tpl/by-user/${encodeURIComponent(userId)}`).then(r => r.data),
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

export interface IfscDetails {
  ifsc: string
  bank: string | null
  bank_code: string | null
  branch: string | null
  address: string | null
  city: string | null
  district: string | null
  state: string | null
  centre: string | null
  micr: string | null
  contact: string | null
  neft: boolean
  rtgs: boolean
  imps: boolean
  upi: boolean
  swift: string | null
}

export const bankAPI = {
  /** Branch details for an IFSC (Razorpay public IFSC data). 404 when no branch has it, 503 when the lookup is down. */
  ifsc: (code: string): Promise<IfscDetails> => api.get(`/bank/ifsc/${encodeURIComponent(code)}`).then(r => r.data),
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
