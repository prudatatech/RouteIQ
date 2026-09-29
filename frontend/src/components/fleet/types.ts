/** A vehicle as the API returns it (GET /vehicles). Shared by the Fleet list and the vehicle page. */
export interface Vehicle {
  id: string
  plate_number: string
  vehicle_type: string
  vehicle_model?: string | null
  status: string
  capacity_kg?: number | null
  current_load_kg?: number | null
  available_capacity_kg?: number | null
  /** What the driver declared from the app, as a share of capacity. */
  declared_load_percentage?: number | null
  container_length_ft?: number | null
  container_width_ft?: number | null
  container_height_ft?: number | null
  cargo_types?: string[] | null
  bidding_window_open?: boolean | null
  bidding_window_closes_at?: string | null
  current_fuel_liters?: number | null
  fuel_capacity_liters?: number | null
  fuel_type?: string | null
  latitude?: number | null
  longitude?: number | null
  current_location_name?: string | null
  last_sync?: string | null
  last_heartbeat?: string | null
  driver_id?: string | null
  driver_name?: string | null
  driver_phone?: string | null
  spark_id?: string | null
  speed_kmh?: number | null
  rc_number?: string | null
  rc_expiry?: string | null
  rc_document_url?: string | null
  insurance_number?: string | null
  insurance_expiry?: string | null
  insurance_document_url?: string | null
  fitness_certificate_number?: string | null
  fitness_expiry?: string | null
  fitness_document_url?: string | null
  permit_number?: string | null
  permit_expiry?: string | null
  permit_document_url?: string | null
  puc_number?: string | null
  puc_expiry?: string | null
  puc_document_url?: string | null
  odometer_km?: number | null
}

export const hasContainer = (v: Vehicle) => (v.container_length_ft ?? 0) > 0

/** "12 × 6 × 6 ft", or null when the vehicle has no container size on record. */
export const containerSize = (v: Vehicle): string | null =>
  hasContainer(v) ? `${v.container_length_ft} × ${v.container_width_ft ?? 0} × ${v.container_height_ft ?? 0} ft` : null
