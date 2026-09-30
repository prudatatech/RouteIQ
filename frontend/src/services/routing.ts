import { api } from '@/services/api'

/** Truck route planner API (backend /routing). The routing keys stay on the server. */

export interface PlanPointInput { lat: number; lng: number; name?: string | null }
export type StopKind = 'pickup' | 'drop' | 'stop'
export interface PlanStopInput extends PlanPointInput {
  id?: string
  /** The shipment or load this stop belongs to. A drop must come after its pickup. */
  shipment_id?: string | null
  kind?: StopKind
}

export interface AvoidOptions { tolls: boolean; highways: boolean; ferries: boolean; unpaved: boolean }

export interface PlanRequest {
  origin: PlanPointInput
  destination: PlanPointInput
  stops: PlanStopInput[]
  vehicle_id?: string | null
  load_kg?: number | null
  kerb_weight_kg?: number | null
  /** ISO time; leave out to leave now. */
  departure_at?: string | null
  avoid: AvoidOptions
}

export interface TrafficSection {
  category: string
  label: string
  delay_seconds: number
  length_m: number
  magnitude: number
  effective_speed_kmh: number | null
  /** [lng, lat] pairs. */
  coordinates: [number, number][]
}

export interface FuelEstimate {
  litres: number | null
  cost: number | null
  price_per_litre: number | null
  price_source: 'vehicle_log' | 'fleet_average' | null
  note: string | null
}

export interface RouteLeg { distance_km: number; travel_minutes: number }

export interface PlannedRoute {
  id: string
  /** [lng, lat] pairs. */
  geometry: [number, number][]
  distance_km: number
  travel_minutes: number
  no_traffic_minutes: number | null
  traffic_delay_minutes: number | null
  toll_km: number | null
  arrival_at: string
  legs: RouteLeg[]
  traffic_sections: TrafficSection[]
  fuel: FuelEstimate | null
}

export interface TruckProfile { weight_kg: number | null; length_m: number | null; width_m: number | null; height_m: number | null }

export interface PlanResult {
  provider: 'tomtom' | 'mapbox'
  truck_aware: boolean
  notes: string[]
  departure_at: string
  routes: PlannedRoute[]
  vehicle: { id: string; plate_number: string | null; fuel_type: string | null; fuel_efficiency_kmpl: number | null } | null
  truck_profile: TruckProfile | null
  cached: boolean
}

export interface OrderResult {
  /** New order as indexes into the entered stops. */
  order: number[]
  changed: boolean
  applicable: boolean
  reason: string | null
  entered: { distance_km: number; travel_minutes: number }
  optimized: { distance_km: number; travel_minutes: number }
  saved_km: number
  saved_minutes: number
}

export interface OpenLoadPoint { delivery_point_id: string | null; name: string; address: string | null; lat: number; lng: number }
export interface OpenLoad {
  id: string
  kind: 'shipment' | 'load'
  reference: string
  weight_kg: number | null
  pickup: OpenLoadPoint | null
  drops: OpenLoadPoint[]
}

export interface RoutingStatus {
  tomtom: boolean
  mapbox: boolean
  truck_routing: boolean
  available: boolean
  max_stops: number
  message: string | null
}

export interface CreateRouteRequest {
  vehicle_id: string
  origin: PlanPointInput
  stops: { name: string; address?: string | null; lat: number; lng: number; delivery_point_id?: string | null }[]
  distance_km: number
  duration_minutes: number
  traffic_delay_minutes: number | null
  estimated_fuel_liters: number | null
  departure_at: string | null
  provider: 'tomtom' | 'mapbox'
  truck_aware: boolean
  toll_km: number | null
  avoid: AvoidOptions
}

export const routingAPI = {
  status: () => api.get('/routing/status').then(r => r.data as RoutingStatus),
  plan: (body: PlanRequest) => api.post('/routing/plan', body, { timeout: 60_000 }).then(r => r.data as PlanResult),
  optimizeOrder: (body: PlanRequest) => api.post('/routing/optimize-order', body, { timeout: 60_000 }).then(r => r.data as OrderResult),
  openLoads: () => api.get('/routing/open-loads').then(r => (r.data as { loads: OpenLoad[] }).loads),
  createRoute: (body: CreateRouteRequest) =>
    api.post('/routing/create-route', body).then(r => r.data as { id: string; vehicle_id: string; status: string }),
}
