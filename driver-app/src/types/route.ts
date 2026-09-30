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
  /** Lots (docs/cargo-plan.md): a drop made for one lot carries its pieces and its own consignee. */
  pieces?: number | string | null;
  consignee_name?: string | null;
  consignee_phone?: string | null;
  lot_shipment_id?: string | null;
}

/**
 * The parcel to deliver (or, for a vendor load, pick up) at a stop. `code` is the
 * tracking ID printed as a QR code or barcode on the parcel.
 */
export interface StopParcel {
  kind: 'shipment' | 'manifest' | string;
  code: string;
  /** Shipment or load status: created, picked_up, in_transit, scheduled ... */
  status?: string;
  purpose?: 'pickup' | 'delivery' | string;
}

export interface RouteStop {
  id: string;
  sequence: number;
  status: 'pending' | 'completed' | 'failed' | string;
  /** Not sent by the current API; used when present. */
  stop_type?: 'pickup' | 'dropoff' | string;
  delivery_point: DeliveryPoint | null;
  /** Null for a stop with no shipment attached. */
  parcel?: StopParcel | null;
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
