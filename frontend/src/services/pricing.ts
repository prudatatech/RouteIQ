import { api } from '@/services/api'

// ── Pricing ───────────────────────────────────────────────
export interface QuoteRequest {
  pickup: { lat: number; lng: number; label?: string | null }
  drop: { lat: number; lng: number; label?: string | null }
  weight_kg: number
  vehicle_type?: string | null
  load_type?: string | null
  date?: string | null
  source?: 'backhaul' | 'vendor_request' | 'bid' | 'assign' | 'customer' | 'api'
}

export interface QuoteFactor { key: string; label: string; detail: string; amount_inr: number }

export interface QuoteOk {
  status: 'ok'
  quote_id: string | null
  distance_km: number
  distance_source: 'mappls' | 'google' | 'estimate'
  distance_is_estimate: boolean
  low: number
  suggested: number
  high: number
  per_km_suggested: number
  factors: QuoteFactor[]
  notes: string[]
  demand: { open_loads: number; available_vehicles: number; radius_km: number }
  history: { samples: number; median_per_km: number | null; band_km: [number, number] }
  weather: { checked: boolean; severe: boolean; description: string | null }
}

export type QuoteResponse = QuoteOk | { status: 'unavailable'; reason: string; notes: string[] }

export const pricingAPI = {
  quote: (data: QuoteRequest) => api.post('/pricing/quote', data).then(r => r.data as QuoteResponse),
  settings: () => api.get('/pricing/settings').then(r => r.data.settings as Record<string, number>),
  saveSettings: (settings: Record<string, number | null>) =>
    api.put('/pricing/settings', { settings }).then(r => r.data.settings as Record<string, number>),
}

// ── Traffic and weather ───────────────────────────────────
export interface TrafficIncident {
  id: string
  type: string
  severity: number
  description: string | null
  road: string | null
  lat: number
  lng: number
  delay_seconds: number | null
  starts_at: string | null
  ends_at: string | null
  affected_route_ids: string[]
}

export interface RouteWeather {
  configured: boolean
  available: boolean
  reason?: string
  description?: string
  condition?: string
  temperature_c?: number | null
  wind_kmph?: number | null
  visibility_m?: number | null
  rain_mm_per_hour?: number | null
  severe?: boolean
}

export interface TrafficStatus {
  traffic_configured: boolean
  weather_configured: boolean
  refresh_minutes: number
  last_run: { ran_at: string; routes_checked: number; incidents_found: number; suggestions_created: number; errors: number } | null
}

export const trafficAPI = {
  status: () => api.get('/traffic/status').then(r => r.data as TrafficStatus),
  incidents: (routeId?: string) =>
    api.get('/traffic/incidents', { params: routeId ? { route_id: routeId } : undefined })
      .then(r => r.data as { configured: boolean; incidents: TrafficIncident[] }),
  refresh: () => api.post('/traffic/refresh').then(r => r.data),
}

export const weatherAPI = {
  route: (routeId: string) => api.get(`/weather/route/${routeId}`).then(r => r.data as RouteWeather),
}
