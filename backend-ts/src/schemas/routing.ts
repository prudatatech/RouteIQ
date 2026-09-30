/**
 * margixindia — Request bodies for the route planner (/routing).
 */
import { z } from 'zod';

/** Most stops allowed between the start and the end of a plan. */
export const MAX_STOPS = 20;

const lat = z.number({ invalid_type_error: 'Latitude must be a number' }).min(-90).max(90);
const lng = z.number({ invalid_type_error: 'Longitude must be a number' }).min(-180).max(180);
const name = z.string().trim().max(200).nullish();
const notNullIsland = (p: { lat: number; lng: number }) => !(p.lat === 0 && p.lng === 0);
const REAL_PLACE = { message: 'Every place needs a real location' };

const point = z.object({ lat, lng, name }).refine(notNullIsland, REAL_PLACE);

const stop = z.object({
  lat, lng, name,
  id: z.string().trim().max(80).optional(),
  shipment_id: z.string().trim().max(80).nullish(),
  kind: z.enum(['pickup', 'drop', 'stop']).optional(),
}).refine(notNullIsland, REAL_PLACE);

const avoid = z.object({
  tolls: z.boolean().default(false),
  highways: z.boolean().default(false),
  ferries: z.boolean().default(false),
  unpaved: z.boolean().default(false),
}).default({});

export const PlanRequestSchema = z.object({
  origin: point,
  destination: point,
  stops: z.array(stop).max(MAX_STOPS, `Up to ${MAX_STOPS} stops between the start and the end`).default([]),
  vehicle_id: z.string().uuid().nullish(),
  load_kg: z.number().min(0).max(200_000).nullish(),
  kerb_weight_kg: z.number().positive().max(100_000).nullish(),
  departure_at: z.string().datetime({ offset: true, message: 'Departure must be a date and time' }).nullish(),
  avoid,
});
export type PlanRequest = z.infer<typeof PlanRequestSchema>;

export const CreatePlannedRouteSchema = z.object({
  vehicle_id: z.string().uuid('Choose a vehicle'),
  stops: z.array(z.object({
    name: z.string().trim().min(1, 'Every stop needs a name').max(200),
    address: z.string().trim().max(500).nullish(),
    lat, lng,
    delivery_point_id: z.string().uuid().nullish(),
  }).refine(notNullIsland, REAL_PLACE)).min(1, 'A route needs at least one stop').max(MAX_STOPS + 1),
  origin: point,
  distance_km: z.number().min(0).max(20_000),
  duration_minutes: z.number().min(0).max(60 * 24 * 14),
  traffic_delay_minutes: z.number().min(0).max(60 * 24 * 14).nullish(),
  estimated_fuel_liters: z.number().min(0).max(100_000).nullish(),
  departure_at: z.string().datetime({ offset: true }).nullish(),
  provider: z.enum(['tomtom', 'mapbox']),
  truck_aware: z.boolean(),
  toll_km: z.number().min(0).max(20_000).nullish(),
  avoid,
});
export type CreatePlannedRoute = z.infer<typeof CreatePlannedRouteSchema>;
