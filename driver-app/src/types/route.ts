/**
 * Shapes returned by GET /telemetry/driver-ping/my-route. Coordinates may
 * arrive as numbers or numeric strings, so read them through stopCoord().
 */
export interface DeliveryPoint {
  id?: string;
  name?: string | null;
  address?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  demand_kg?: number | null;
}

export interface RouteStop {
  id: string;
  sequence: number;
  status: 'pending' | 'completed' | 'failed' | string;
  /** Not sent by the current API; used when present. */
  stop_type?: 'pickup' | 'dropoff' | string;
  delivery_point: DeliveryPoint | null;
}

export interface Depot {
  name?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
}

export interface DriverRoute {
  id: string;
  status: 'pending' | 'active' | 'completed' | string;
  route_type?: string;
  total_distance_km?: number | null;
  total_duration_minutes?: number | null;
  depot?: Depot | null;
  stops?: RouteStop[];
  completed_stops?: number;
  remaining_stops?: number;
  progress_pct?: number;
}

export interface MyRouteResponse {
  active: boolean;
  is_manifest?: boolean;
  message?: string;
  route?: DriverRoute;
}

export interface LatLng {
  lat: number;
  lng: number;
}
