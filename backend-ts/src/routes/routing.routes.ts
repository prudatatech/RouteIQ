/**
 * margixindia — Truck route planner
 *
 * POST /routing/plan            routes for a truck (TomTom, Mapbox fallback) with traffic, tolls and fuel
 * POST /routing/optimize-order  best order of the stops between a fixed start and end
 * POST /routing/directions      road line through up to 25 waypoints for any map (Mapbox, TomTom fallback); any signed-in user
 * GET  /routing/open-loads     open shipments and loads whose pickup and drop points can be used as stops
 * GET  /routing/status          which routing services are set up
 * POST /routing/create-route    save a plan as a route for a vehicle
 */
import { Router, Request, Response } from 'express';
import { requireAuth, requireRole } from '../core/auth';
import { STAFF_ROLES } from '../core/ownership';
import { rateLimitByUser } from '../core/rate-limit';
import { HttpError, sendError } from '../core/errors';
import { PlanRequestSchema, CreatePlannedRouteSchema, DirectionsRequestSchema, MAX_STOPS } from '../schemas/routing';
import { getDirections } from '../services/directions.service';
import {
  isMapboxConfigured, isTomTomConfigured, listOpenLoads, optimizeStopOrder, planRoute, NO_ROUTING_MESSAGE, type PlanInput,
} from '../services/routing.service';
import { createPlannedRoute } from '../services/route.service';

const router = Router();
const staff = [requireAuth, requireRole(...STAFF_ROLES)] as const;

function firstIssue(issues: { path: (string | number)[]; message: string }[]): string {
  const issue = issues[0];
  return issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message;
}

function parsePlan(req: Request): PlanInput {
  const parsed = PlanRequestSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error.issues));
  return { ...parsed.data, vehicle_id: parsed.data.vehicle_id ?? null };
}

router.get('/status', ...staff, (_req: Request, res: Response) => {
  res.json({
    tomtom: isTomTomConfigured(),
    mapbox: isMapboxConfigured(),
    truck_routing: isTomTomConfigured(),
    available: isTomTomConfigured() || isMapboxConfigured(),
    max_stops: MAX_STOPS,
    message: isTomTomConfigured() ? null : isMapboxConfigured()
      ? 'TomTom is not set up, so routes come from Mapbox and do not consider truck restrictions.'
      : NO_ROUTING_MESSAGE,
  });
});

router.post('/plan', ...staff, rateLimitByUser('routing-plan', 30, 60), async (req: Request, res: Response) => {
  try {
    res.json(await planRoute(parsePlan(req)));
  } catch (e) {
    sendError(req, res, e);
  }
});

router.post('/optimize-order', ...staff, rateLimitByUser('routing-optimize', 10, 60), async (req: Request, res: Response) => {
  try {
    res.json(await optimizeStopOrder(parsePlan(req)));
  } catch (e) {
    sendError(req, res, e);
  }
});

// Every role's maps draw road lines, so this is open to any signed-in user. Rate limited per user, and
// identical requests come from the cache, so it cannot burn the provider quota.
router.post('/directions', requireAuth, rateLimitByUser('routing-directions', 120, 60), async (req: Request, res: Response) => {
  try {
    const parsed = DirectionsRequestSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error.issues));
    const { cached: _cached, ...directions } = await getDirections(parsed.data.waypoints, parsed.data.traffic);
    res.json(directions);
  } catch (e) {
    sendError(req, res, e);
  }
});

router.get('/open-loads', ...staff, async (req: Request, res: Response) => {
  try {
    res.json({ loads: await listOpenLoads() });
  } catch (e) {
    sendError(req, res, e);
  }
});

router.post('/create-route', ...staff, rateLimitByUser('routing-create', 20, 60), async (req: Request, res: Response) => {
  try {
    const parsed = CreatePlannedRouteSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstIssue(parsed.error.issues));
    const b = parsed.data;
    const created = await createPlannedRoute({
      vehicle_id: b.vehicle_id,
      stops: b.stops.map(s => ({ name: s.name, address: s.address ?? null, lat: s.lat, lng: s.lng, delivery_point_id: s.delivery_point_id ?? null })),
      distance_km: b.distance_km,
      duration_minutes: Math.round(b.duration_minutes),
      traffic_delay_minutes: b.traffic_delay_minutes == null ? null : Math.round(b.traffic_delay_minutes),
      estimated_fuel_liters: b.estimated_fuel_liters ?? null,
      plan: {
        source: 'route_planner',
        provider: b.provider,
        truck_aware: b.truck_aware,
        origin: b.origin,
        departure_at: b.departure_at ?? null,
        toll_km: b.toll_km ?? null,
        avoid: b.avoid,
      },
    }, { id: req.user!.user_id });
    res.status(201).json(created);
  } catch (e) {
    sendError(req, res, e);
  }
});

export default router;
