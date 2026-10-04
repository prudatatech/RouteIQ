import { api } from '@/services/api'
import type { FreightEstimate } from '@/types/load'

// ── Pricing ───────────────────────────────────────────────
export interface QuoteRequest {
  pickup: { lat: number; lng: number; label?: string | null }
  drop: { lat: number; lng: number; label?: string | null }
  weight_kg: number
  vehicle_type?: string | null
  vehicle_capacity_t?: number | null
  body_type?: 'open' | 'closed' | 'container' | 'reefer' | 'tanker' | 'trailer' | null
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
  basis?: FreightEstimate['basis']
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

/** Icon family of an incident on the map (the server derives it from the type). */
export type TrafficIncidentKind = 'accident' | 'roadworks' | 'closure' | 'jam' | 'flooding' | 'weather' | 'hazard' | 'breakdown' | 'other'

/** An open incident inside a map view (GET /traffic/incidents?bbox=). */
export interface AreaIncident {
  id: string
  type: string
  kind: TrafficIncidentKind
  severity: number
  description: string | null
  road: string | null
  lat: number
  lng: number
  delay_seconds: number | null
  starts_at: string | null
  ends_at: string | null
  last_seen_at: string | null
}

export interface AreaIncidents {
  configured: boolean
  incidents: AreaIncident[]
  /** What happened to the request for fresh data: fetched, fresh (recent enough), not_requested, not_configured, area_too_large or failed. */
  refresh: string
  fetched_at: string | null
}

export interface TileToken {
  configured: boolean
  token: string | null
  /** Seconds the token works for. */
  expires_in: number
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
  /** Open incidents inside a view, `minLng,minLat,maxLng,maxLat`. With `refresh`, the server also asks TomTom when its data for the area is older than 5 minutes. */
  incidentsInBbox: (bbox: string, refresh: boolean, signal?: AbortSignal) =>
    api.get('/traffic/incidents', { params: { bbox, refresh: refresh ? '1' : undefined }, signal }).then(r => r.data as AreaIncidents),
  /** Short-lived token for the live traffic tiles (the map cannot send the login header for tiles). */
  tileToken: () => api.get('/traffic/tile-token').then(r => r.data as TileToken),
}

export const weatherAPI = {
  route: (routeId: string) => api.get(`/weather/route/${routeId}`).then(r => r.data as RouteWeather),
}
