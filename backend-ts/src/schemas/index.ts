/**
 * margixindia — Zod validation schemas
 * Ports: backend/app/schemas/schemas.py + backend/app/schemas/auth.py
 */
import { z } from 'zod';

// ── Auth ───────────────────────────────────────────────────

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const UserCreateSchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(2).max(255),
  password: z.string().min(8),
  role: z.enum(['superadmin', 'admin', 'manager', 'driver']).default('driver'),
});
export type UserCreate = z.infer<typeof UserCreateSchema>;

export const APP_ROLES = ['superadmin', 'admin', 'manager', 'driver', 'vendor'] as const;

export const UserUpdateSchema = z.object({
  full_name: z.string().optional(),
  role: z.enum(APP_ROLES).optional(),
  is_active: z.boolean().optional(),
});
export type UserUpdate = z.infer<typeof UserUpdateSchema>;

// ── Organizations ────────────────────────────────────────────

export const OrganizationCreateSchema = z.object({
  name: z.string().min(2).max(255),
  entity_type: z.enum(['shipper', 'forwarder', 'fleet_owner', 'broker', '3pl', 'super_admin']),
  participation_type: z.string().optional().nullable(),
  gstin: z.string().max(15).optional().nullable(),
  status: z.enum(['active', 'suspended', 'verification_pending']).default('active'),
});
export type OrganizationCreate = z.infer<typeof OrganizationCreateSchema>;

export const ThirdPartyAgreementCreateSchema = z.object({
  tpl_org_id: z.string().uuid(),
  corridor_structure: z.any(), // Detailed structure to be defined (e.g. state pairs)
  vehicle_types_supported: z.array(z.string()).default([]),
  wholesale_rate_formula: z.any(),
  sla_hours: z.number().int().positive().default(4),
  platform_markup_percent: z.number().min(0).default(0.0),
  status: z.enum(['active', 'paused', 'suspended']).default('active'),
  effective_date: z.string().optional(),
  expiry_date: z.string().optional().nullable(),
});
export type ThirdPartyAgreementCreate = z.infer<typeof ThirdPartyAgreementCreateSchema>;


// ── Vehicles ───────────────────────────────────────────────

export const VehicleCreateSchema = z.object({
  plate_number: z.string().min(4).max(20),
  vehicle_type: z.enum(['truck', 'van', 'bike', 'car']),
  capacity_kg: z.number().positive().max(50000),
  fuel_type: z.string().default('diesel'),
  fuel_capacity_liters: z.number().positive().max(1000).default(60.0),
  fuel_efficiency_kmpl: z.number().positive().max(100).default(12.0),
  status: z.enum(['available', 'on_route', 'idle', 'maintenance', 'offline', 'archived']).optional(),
  spark_id: z.string().max(50).optional().nullable(),
  driver_name: z.string().max(255).optional().nullable(),
  driver_phone: z.string().max(20).optional().nullable(),
  vehicle_model: z.string().max(100).optional().nullable(),
  container_length_ft: z.number().min(0).max(60).optional().nullable(),
  container_width_ft: z.number().min(0).max(15).optional().nullable(),
  container_height_ft: z.number().min(0).max(15).optional().nullable(),
  current_load_kg: z.number().min(0).max(50000).optional().default(0),
  rc_number: z.string().max(50).optional().nullable(),
  rc_expiry: z.string().optional().nullable(),
  rc_document_url: z.string().optional().nullable(),
  insurance_number: z.string().max(50).optional().nullable(),
  insurance_expiry: z.string().optional().nullable(),
  insurance_document_url: z.string().optional().nullable(),
  fitness_certificate_number: z.string().max(50).optional().nullable(),
  fitness_expiry: z.string().optional().nullable(),
  fitness_document_url: z.string().optional().nullable(),
  permit_number: z.string().max(50).optional().nullable(),
  permit_expiry: z.string().optional().nullable(),
  permit_document_url: z.string().optional().nullable(),
  puc_number: z.string().max(50).optional().nullable(),
  puc_expiry: z.string().optional().nullable(),
  puc_document_url: z.string().optional().nullable(),
});
export type VehicleCreate = z.infer<typeof VehicleCreateSchema>;

/**
 * What a driver sends to register a vehicle from the app. The plate is
 * normalised by the approval service; the driver's name and phone come from
 * their account, and the status is always pending approval.
 */
export const DriverVehicleRegisterSchema = VehicleCreateSchema.pick({
  plate_number: true,
  vehicle_type: true,
  capacity_kg: true,
  vehicle_model: true,
  container_length_ft: true,
  container_width_ft: true,
  container_height_ft: true,
  rc_number: true,
  rc_expiry: true,
  insurance_number: true,
  insurance_expiry: true,
  fitness_certificate_number: true,
  fitness_expiry: true,
  permit_number: true,
  permit_expiry: true,
  puc_number: true,
  puc_expiry: true,
}).extend({ plate_number: z.string().min(4).max(24) });
export type DriverVehicleRegister = z.infer<typeof DriverVehicleRegisterSchema>;

export const VehicleUpdateSchema = z.object({
  plate_number: z.string().min(4).max(20).optional(),
  vehicle_type: z.enum(['truck', 'van', 'bike', 'car']).optional(),
  capacity_kg: z.number().positive().max(50000).optional(),
  fuel_type: z.string().optional(),
  fuel_capacity_liters: z.number().positive().max(1000).optional(),
  fuel_efficiency_kmpl: z.number().positive().max(100).optional(),
  spark_id: z.string().max(50).optional().nullable(),
  status: z.enum(['available', 'on_route', 'idle', 'maintenance', 'offline', 'archived']).optional(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  driver_id: z.string().uuid().optional().nullable(),
  declared_load_percentage: z.number().min(0).max(100).optional().nullable(),
  driver_name: z.string().max(255).optional().nullable(),
  driver_phone: z.string().max(20).optional().nullable(),
  vehicle_model: z.string().max(100).optional().nullable(),
  container_length_ft: z.number().min(0).max(60).optional().nullable(),
  container_width_ft: z.number().min(0).max(15).optional().nullable(),
  container_height_ft: z.number().min(0).max(15).optional().nullable(),
  current_load_kg: z.number().min(0).max(50000).optional().nullable(),
  rc_number: z.string().max(50).optional().nullable(),
  rc_expiry: z.string().optional().nullable(),
  rc_document_url: z.string().optional().nullable(),
  insurance_number: z.string().max(50).optional().nullable(),
  insurance_expiry: z.string().optional().nullable(),
  insurance_document_url: z.string().optional().nullable(),
  fitness_certificate_number: z.string().max(50).optional().nullable(),
  fitness_expiry: z.string().optional().nullable(),
  fitness_document_url: z.string().optional().nullable(),
  permit_number: z.string().max(50).optional().nullable(),
  permit_expiry: z.string().optional().nullable(),
  permit_document_url: z.string().optional().nullable(),
  puc_number: z.string().max(50).optional().nullable(),
  puc_expiry: z.string().optional().nullable(),
  puc_document_url: z.string().optional().nullable(),
});
export type VehicleUpdate = z.infer<typeof VehicleUpdateSchema>;

// ── Shipments ──────────────────────────────────────────────

export const ParcelCreateSchema = z.object({
  weight_kg: z.number().positive(),
  length_cm: z.number().positive(),
  width_cm: z.number().positive(),
  height_cm: z.number().positive(),
  category: z.string().default('General'),
  is_hazardous: z.boolean().default(false),
  is_fragile: z.boolean().default(false),
});
export type ParcelCreate = z.infer<typeof ParcelCreateSchema>;

/** What dispatch can edit on an existing shipment; everything else has its own action. */
export const ShipmentEditSchema = z.object({
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  total_items: z.number().int('Items must be a whole number').min(0, 'Items cannot be negative').max(100000, 'Too many items').optional(),
  total_weight_kg: z.number().positive('Weight must be more than 0 kg').max(50000, 'Weight can be at most 50,000 kg').optional(),
  freight_charge: z.number().min(0, 'Freight charge cannot be negative').max(99_999_999.99, 'Freight charge is too large').optional().nullable(),
});
export type ShipmentEditInput = z.infer<typeof ShipmentEditSchema>;

export const ShipmentCreateSchema = z.object({
  tracking_id: z.string().regex(/^RTX-[A-Z0-9]{6,16}$/, 'tracking_id must look like RTX-XXXXXXXX').optional().nullable(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  parcels: z.array(ParcelCreateSchema).default([]),
  delivery_point_id: z.any(),
  origin_name: z.string().optional().nullable(),
  origin_address: z.string().optional().nullable(),
  origin_lat: z.number().optional(),
  origin_lng: z.number().optional(),
  dest_name: z.string().optional(),
  dest_address: z.string().optional(),
  dest_lat: z.number().optional(),
  dest_lng: z.number().optional(),
  stops: z.array(z.object({
    id: z.string().optional().nullable(),
    name: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    lat: z.number(),
    lng: z.number(),
  })).default([]),
  total_items: z.number().int().default(1),
  total_weight_kg: z.number().default(0.0),
  declared_load_kg: z.number().default(0.0),
  load_type: z.enum(['full', 'partial']).default('full'),
  enable_mobile_gps: z.boolean().default(false),
  vehicle_id: z.string().uuid().optional().nullable(),
  open_bidding: z.boolean().optional(),
  metadata: z.any().optional(),
  bidding_opens_at: z.string().optional().nullable(),
  bidding_closes_at: z.string().optional().nullable(),
  asking_price: z.number().optional().nullable(),
  /** What the customer is charged, in rupees before GST. Used for the invoice when no bid was won. */
  freight_charge: z.number().min(0).max(99_999_999.99).optional().nullable(),
});
export type ShipmentCreate = z.infer<typeof ShipmentCreateSchema>;

export const ShipmentUpdateSchema = z.object({
  status: z.enum(['created', 'picked_up', 'in_transit', 'delivered', 'cancelled']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  received_by: z.string().max(100).optional().nullable(),
  signature_data: z.string().optional().nullable(),
  origin_name: z.string().optional().nullable(),
  origin_address: z.string().optional().nullable(),
  origin_lat: z.number().optional().nullable(),
  origin_lng: z.number().optional().nullable(),
  total_items: z.number().int().optional().nullable(),
  total_weight_kg: z.number().optional().nullable(),
  declared_load_kg: z.number().optional().nullable(),
  load_type: z.enum(['full', 'partial']).optional().nullable(),
});
export type ShipmentUpdate = z.infer<typeof ShipmentUpdateSchema>;

// ── Routes / Optimization ──────────────────────────────────

export const OptimizationRequestSchema = z.object({
  depot_id: z.string().uuid().optional().nullable(),
  vehicle_ids: z.array(z.string().uuid()).max(100).default([]),
  shipment_ids: z.array(z.string().uuid()).max(500).default([]),
  // 'ga' and 'genetic' both select the genetic algorithm in the ML service
  algorithm: z.enum(['ortools', 'ga', 'genetic']).default('ortools'),
  consider_traffic: z.boolean().default(true),
  consider_weather: z.boolean().default(true),
  traffic_density: z.number().min(0).max(1).default(0.5),
  // Manual override. Leave it out to use live OpenWeather conditions (no weather effect when they are unavailable).
  weather_severity: z.number().min(0).max(1).optional(),
  max_solve_time_seconds: z.number().int().min(5).max(300).default(30),
});
export type OptimizationRequest = z.infer<typeof OptimizationRequestSchema>;

export const RouteUpdateSchema = z.object({
  vehicle_id: z.string().uuid().optional().nullable(),
  status: z.enum(['pending', 'optimizing', 'active', 'completed', 'cancelled']).optional().nullable(),
});
export type RouteUpdateInput = z.infer<typeof RouteUpdateSchema>;

// ── Telemetry ──────────────────────────────────────────────

export const TelemetryCreateSchema = z.object({
  vehicle_id: z.string().uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  speed_kmph: z.number().min(0).max(300),
  heading: z.number().min(0).max(360),
  fuel_level_pct: z.number().min(0).max(100).optional(),
  engine_temp: z.number().optional().nullable(),
  odometer_km: z.number().optional().nullable(),
});
export type TelemetryCreate = z.infer<typeof TelemetryCreateSchema>;

// ── GPS ────────────────────────────────────────────────────

export const GPSPointCreateSchema = z.object({
  vehicle_id: z.string().uuid(),
  latitude: z.number(),
  longitude: z.number(),
  accuracy: z.number().optional().nullable(),
  recorded_at: z.string().optional().nullable(),
});
export type GPSPointCreate = z.infer<typeof GPSPointCreateSchema>;
