import axios from 'axios'
import { supabase } from '@/services/supabase'


export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api/v1',
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
})

/**
 * Sanitizes an object by removing common "junk" from React Query (context, signals, etc.)
 * that shouldn't be serialized into query strings.
 */
const sanitizeParams = (params: any) => {
  if (!params || typeof params !== 'object') return params
  
  const clean: any = {}
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
        window.location.href = '/login'
      }
    }
    
    return Promise.reject(error)
  }
)

// ═══════════════════════════════════════════════════════════
// API methods — all use the Supabase JWT via the interceptor
// ═══════════════════════════════════════════════════════════

// Vehicles API
export const vehiclesAPI = {
  list: (params?: any) => api.get('/vehicles/', { params }).then(r => r.data),
  get: (id: string) => api.get(`/vehicles/${id}`).then(r => r.data),
  create: (data: object) => api.post('/vehicles/', data).then(r => r.data),
  update: (id: string, data: object) => api.patch(`/vehicles/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/vehicles/${id}`),
  summary: () => api.get('/vehicles/summary').then(r => r.data),
}

export const optimizationAPI = {
  optimize: (data: any) => api.post('/optimize/', data).then(r => r.data),
  predictETA: (data: any) => api.post('/optimize/eta/', data).then(r => r.data),
  incubate: (vehicleId: string) => api.post(`/optimize/incubate/${vehicleId}`).then(r => r.data),
  runRiskAnalysis: (vehicleId: string) =>
    api.post(`/agents/risk-analysis/${vehicleId}`).then(r => r.data),
  runCargoMonitoring: (shipmentId: string) =>
    api.post(`/agents/cargo-monitoring/${shipmentId}`).then(r => r.data),
}

export const dashboardAPI = {
  kpis: () => api.get('/dashboard/kpis/').then(r => r.data),
}

export const deliveryPointsAPI = {
  list: (params?: any) => api.get('/routes/delivery-points/', { params }).then(r => r.data),
}



export const usersAPI = {
  list: () => api.get('/users/').then(r => r.data),
  update: (id: string, data: any) => api.patch(`/users/${id}`, data).then(r => r.data),
}

export const trafficAPI = {
  simulateEvent: (lat: number, lng: number, type: string, severity: number) => 
    api.post('/traffic/event', { lat, lng, event_type: type, severity }).then(r => r.data),
}

export const cargoAPI = {
  scenarios: () => api.get('/cargo/scenarios').then(r => r.data),
  securityAlerts: () => api.get('/cargo/security-alerts').then(r => r.data),
  triggerAlert: (type: string, plateNumber: string, message: string) =>
    api.post('/cargo/trigger-alert', { type, plate_number: plateNumber, message }).then(r => r.data),
  resolveAlert: (alertId: string) =>
    api.post(`/cargo/resolve-alert/${alertId}`).then(r => r.data),
  optimizePooling: (demands: any[]) =>
    api.post('/cargo/optimize-pooling', demands).then(r => r.data),
  backhaulMatch: (opportunityId: string, availableCapacityKg: number) =>
    api.post('/cargo/backhaul-match', { opportunity_id: opportunityId, available_capacity_kg: availableCapacityKg }).then(r => r.data),
  verifyPod: (data: { tracking_id: string, otp: string, latitude: number, longitude: number, photo_uploaded: boolean, recipient_name?: string }) =>
    api.post('/cargo/verify-pod', data).then(r => r.data),
  pricingRecommendations: (params: { distance_km: number, weight_kg: number, cargo_type: string, congestion_index: number, weather_severity: number }) =>
    api.get('/cargo/pricing-recommendations', { params }).then(r => r.data),
}

export const capacityAPI = {
  getNearbyVendors: (params: { lat: number, lng: number, radius?: number }) =>
    api.get('/capacity/nearby-vendors', { params }).then(r => r.data),
}

export const shipmentsAPI = {
  list: (params?: any) => api.get('/shipments/', { params }).then(r => r.data),
  get: (id: string) => api.get(`/shipments/${id}`).then(r => r.data),
  trackPublicly: (trackingId: string) => api.get(`/shipments/track/${trackingId}`).then(r => r.data),
  create: (data: object) => api.post('/shipments/', data).then(r => r.data),
  updateStatus: (id: string, status: string, params?: any) => api.patch(`/shipments/${id}`, null, { params: { status, ...params } }).then(r => r.data),
  edit: (id: string, data: any) => api.patch(`/shipments/${id}/edit`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/shipments/${id}`).then(r => r.data),
  getAssignOptions: (id: string, mode: 'near' | 'any') => api.get(`/shipments/${id}/assign-options`, { params: { mode } }).then(r => r.data),
  assignDriver: (id: string, vehicleId: string) => api.post(`/shipments/${id}/assign`, { vehicle_id: vehicleId }).then(r => r.data),
}

export const routesAPI = {
  list: (params?: any) => api.get('/routes/', { params }).then(r => r.data),
  get: (id: string) => api.get(`/routes/${id}`).then(r => r.data),
  update: (id: string, data: any) => api.patch(`/routes/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/routes/${id}`).then(r => r.data),
  updateStatus: (id: string, status: string) => api.patch(`/routes/${id}/status`, { status }).then(r => r.data),
  reroute: (id: string, newSequence: string[]) => api.post(`/routes/${id}/reroute`, { new_sequence: newSequence }).then(r => r.data),
};

export const marketplaceAPI = {
  openLoads: () => api.get('/marketplace/open-loads').then(r => r.data),
}

export const telemetryAPI = {
  ingest: (data: object) => api.post('/telemetry/', data).then(r => r.data),
  history: (vehicleId: string, limit = 100) => api.get(`/telemetry/${vehicleId}/history`, { params: { limit } }).then(r => r.data),
  live: (vehicleId: string) => api.get(`/telemetry/${vehicleId}/live`).then(r => r.data),
  logStoppage: (data: any) => api.post('/telemetry/stoppages', data).then(r => r.data),
  createMobileSession: (vehicleId: string, phone?: string) =>
    api.post('/telemetry/mobile-session', { vehicle_id: vehicleId, phone }).then(r => r.data),
  callDriver: (vehicleId: string) => api.post(`/telemetry/call-driver/${vehicleId}`).then(r => r.data),
}

export const analyticsAPI = {
  insights: () => api.get('/analytics/insights').then(r => r.data),
  metrics: () => api.get('/analytics/metrics').then(r => r.data),
  activeMissions: () => api.get('/analytics/active-missions').then(r => r.data),
  syncSparkGPS: () => api.post('/analytics/sync-sparkgps').then(r => r.data),
  auditLogs: () => api.get('/analytics/audit-logs').then(r => r.data),
}

export const telemetryWS = {
  getURL: () => {
    const apiUrl = import.meta.env.VITE_API_URL || '';
    if (apiUrl) {
      const url = new URL(apiUrl);
      const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${url.host}/api/v1/telemetry/ws`;
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}/api/v1/telemetry/ws`
  },
  connect: (onMessage: (data: any) => void) => {
    const ws = new WebSocket(telemetryWS.getURL())
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        onMessage(data)
      } catch (err) {
        console.error('WS Parse Error', err)
      }
    }
    return ws
  }
}
