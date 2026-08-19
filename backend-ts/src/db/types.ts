/**
 * margixindia — Database types
 * TypeScript interfaces for all 15+ Supabase tables.
 * Ports: backend/app/models/models.py (SQLAlchemy models)
 */

// ── Users ──────────────────────────────────────────────────
export interface User {
  id: string;
  email: string | null;
  phone: string | null;
  full_name: string;
  hashed_password: string;
  role: 'superadmin' | 'admin' | 'manager' | 'driver';
  is_active: boolean;
  last_login: string | null;
  created_at: string;
  updated_at: string;
}

// ── Vehicles ───────────────────────────────────────────────
export interface Vehicle {
  id: string;
  plate_number: string;
  vehicle_type: 'truck' | 'van' | 'bike' | 'car';
  capacity_kg: number;
  available_capacity_kg?: number;
  capacity_updated_at?: string;
  status: 'available' | 'on_route' | 'idle' | 'maintenance' | 'offline';
  fuel_type: string;
  fuel_capacity_liters: number;
  fuel_efficiency_kmpl: number;
  current_fuel_liters: number | null;
  latitude: number | null;
  longitude: number | null;
  driver_id: string | null;
  spark_id: string | null;
  last_sync: string | null;
  last_heartbeat: string | null;
  cargo_types: string[] | null;
  created_at: string;
}

// ── Depots ─────────────────────────────────────────────────
export interface Depot {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  address: string | null;
  created_at: string;
}

// ── Delivery Points ────────────────────────────────────────
export interface DeliveryPoint {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  demand_kg: number;
  service_time_minutes: number;
  time_window_start: number | null;
  time_window_end: number | null;
  required_cargo_types: string[] | null;
  status: string;
  shipment_id: string | null;
  created_at: string;
}

// ── Routes ─────────────────────────────────────────────────
export interface Route {
  id: string;
  vehicle_id: string;
  depot_id: string | null;
  status: 'pending' | 'optimizing' | 'active' | 'completed' | 'cancelled';
  total_distance_km: number;
  total_duration_minutes: number;
  estimated_fuel_liters: number;
  weather_condition: string;
  traffic_delay_minutes: number;
  optimization_score: number | null;
  waypoints: any[];
  created_at: string;
  // Joined
  vehicle?: Vehicle;
  stops?: RouteStop[];
}

// ── Route Stops ────────────────────────────────────────────
export interface RouteStop {
  id: string;
  route_id: string;
  delivery_point_id: string;
  sequence: number;
  status: string;
  // Joined
  delivery_point?: DeliveryPoint;
}

// ── Telemetry ──────────────────────────────────────────────
export interface Telemetry {
  id: string;
  vehicle_id: string;
  latitude: number;
  longitude: number;
  speed_kmph: number;
  heading: number;
  fuel_level_pct: number | null;
  timestamp: string;
}

// ── Vehicle Stoppages ──────────────────────────────────────
export interface VehicleStoppage {
  id: string;
  vehicle_id: string;
  latitude: number;
  longitude: number;
  reason: string;
  start_time: string;
  end_time: string | null;
}

// ── Maintenance Alerts ─────────────────────────────────────
export interface MaintenanceAlert {
  id: string;
  vehicle_id: string;
  alert_type: string;
  severity: string;
  description: string;
  is_resolved: boolean;
  resolved_at: string | null;
  created_at: string;
}

// ── Shipments ──────────────────────────────────────────────
export interface Shipment {
  id: string;
  tracking_id: string;
  status: 'created' | 'picked_up' | 'in_transit' | 'delivered' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'critical';
  origin_name: string | null;
  origin_address: string | null;
  origin_lat: number | null;
  origin_lng: number | null;
  total_items: number;
  total_weight_kg: number;
  declared_load_kg?: number;
  load_type?: string;
  received_by: string | null;
  signature_data: string | null;
  created_at: string;
  // Joined
  parcels?: Parcel[];
  delivery_point?: DeliveryPoint;
  logs?: ShipmentLog[];
  is_verified?: boolean;
}

// ── Parcels ────────────────────────────────────────────────
export interface Parcel {
  id: string;
  shipment_id: string;
  weight_kg: number;
  length_cm: number;
  width_cm: number;
  height_cm: number;
  category: string;
  is_hazardous: boolean;
  is_fragile: boolean;
}

// ── Shipment Logs (hash chain) ─────────────────────────────
export interface ShipmentLog {
  id: string;
  shipment_id: string;
  status: string;
  location_lat: number | null;
  location_lng: number | null;
  timestamp: string;
  index: number;
  previous_hash: string;
  log_hash: string;
  metadata_json: Record<string, any>;
}

// ── Invoices ───────────────────────────────────────────────
export interface Invoice {
  id: string;
  shipment_id: string;
  amount: number;
  status: string;
  due_date: string | null;
  created_at: string;
}

// ── Payments ───────────────────────────────────────────────
export interface Payment {
  id: string;
  invoice_id: string;
  amount: number;
  method: string;
  status: string;
  paid_at: string | null;
}

// ── GPS Points ─────────────────────────────────────────────
export interface GPSPoint {
  id: string;
  vehicle_id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  recorded_at: string;
}

// ── AI Agent Logs ──────────────────────────────────────────
export interface AIAgentLog {
  id: string;
  agent_name: string;
  task_description: string;
  action_taken: string;
  result: string;
  status: string;
  created_at: string;
}
