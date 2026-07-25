/**
 * RouteIQ — Zod validation schemas
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

export const UserUpdateSchema = z.object({
  full_name: z.string().optional(),
  role: z.string().optional(),
  is_active: z.boolean().optional(),
});
export type UserUpdate = z.infer<typeof UserUpdateSchema>;

// ── Vehicles ───────────────────────────────────────────────

export const VehicleCreateSchema = z.object({
  plate_number: z.string().min(4).max(20),
  vehicle_type: z.enum(['truck', 'van', 'bike', 'car']),
  capacity_kg: z.number().positive().max(50000),
  fuel_type: z.string().default('diesel'),
  fuel_capacity_liters: z.number().positive().max(1000).default(60.0),
  fuel_efficiency_kmpl: z.number().positive().max(100).default(12.0),
  spark_id: z.string().max(50).optional().nullable(),
});
export type VehicleCreate = z.infer<typeof VehicleCreateSchema>;

export const VehicleUpdateSchema = z.object({
  plate_number: z.string().min(4).max(20).optional(),
  vehicle_type: z.enum(['truck', 'van', 'bike', 'car']).optional(),
  capacity_kg: z.number().positive().max(50000).optional(),
  fuel_type: z.string().optional(),
  fuel_capacity_liters: z.number().positive().max(1000).optional(),
  fuel_efficiency_kmpl: z.number().positive().max(100).optional(),
  spark_id: z.string().max(50).optional().nullable(),
  status: z.enum(['available', 'on_route', 'idle', 'maintenance', 'offline']).optional(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  driver_id: z.string().uuid().optional().nullable(),
  declared_load_percentage: z.number().min(0).max(100).optional().nullable(),
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

export const ShipmentCreateSchema = z.object({
  tracking_id: z.string().optional().nullable(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  parcels: z.array(ParcelCreateSchema).default([]),
  delivery_point_id: z.any(),
  origin_name: z.string().optional().nullable(),
  origin_address: z.string().optional().nullable(),
  origin_lat: z.number().optional().nullable(),
  origin_lng: z.number().optional().nullable(),
  dest_name: z.string().optional().nullable(),
  dest_address: z.string().optional().nullable(),
  dest_lat: z.number().optional().nullable(),
  dest_lng: z.number().optional().nullable(),
  total_items: z.number().int().default(1),
  total_weight_kg: z.number().default(0.0),
  declared_load_kg: z.number().default(0.0),
  load_type: z.enum(['full', 'partial']).default('full'),
  enable_mobile_gps: z.boolean().default(false),
  vehicle_id: z.string().uuid().optional().nullable(),
  open_bidding: z.boolean().optional(),
  bidding_opens_at: z.string().optional().nullable(),
  bidding_closes_at: z.string().optional().nullable(),
  asking_price: z.number().optional().nullable(),
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
  delivery_point_ids: z.array(z.string().uuid()).max(500).default([]),
  algorithm: z.enum(['ortools', 'genetic', 'reinforcement']).default('ortools'),
  consider_traffic: z.boolean().default(true),
  consider_weather: z.boolean().default(true),
  traffic_density: z.number().min(0).max(1).default(0.5),
  weather_severity: z.number().min(0).max(1).default(0.0),
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
  fuel_level_pct: z.number().min(0).max(100),
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
