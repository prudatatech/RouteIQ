/**
 * margixindia — Route Management Routes
 * Ports: backend/app/api/v1/endpoints/routes.py
 */
import { Router, Request, Response } from 'express';
import { supabase } from '../core/supabase';
import { requireAuth, requireRole } from '../core/auth';
import { cacheGet, cacheSet } from '../core/redis';
import { STAFF_ROLES, canAccessRoute, getDriverVehicleIds, isStaff } from '../core/ownership';
import { RouteUpdateSchema } from '../schemas';
import { routeService } from '../services/route.service';
import { HttpError, sendError } from '../core/errors';
import { OPERATING_VEHICLE_STATUSES, ROUTE_STATUSES } from '../core/transitions';

const router = Router();

// ── GET / ──────────────────────────────────────────────────
router.get('/', requireAuth, requireRole(...STAFF_ROLES, 'driver'), async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const vehicleId = req.query.vehicle_id as string | undefined;
    const skip = parseInt(req.query.skip as string) || 0;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    let query = supabase
      .from('routes')
      .select('*, vehicles(*), route_stops(*, delivery_points(*))');

    // Drivers only see routes and manifests for their own vehicles
    const driverVehicleIds = req.user!.role === 'driver' ? await getDriverVehicleIds(req.user!.user_id) : null;
    if (driverVehicleIds) {
      if (driverVehicleIds.length === 0) { res.json([]); return; }
      query = query.in('vehicle_id', driverVehicleIds);
    }

    if (status) query = query.eq('status', status);
    if (vehicleId) query = query.eq('vehicle_id', vehicleId);

    query = query.order('created_at', { ascending: false }).range(skip, skip + limit - 1);

    const { data: routes, error } = await query;
    if (error) throw error;

    const result = routes ? [...routes] : [];

    // Also fetch cargo manifests and map them to standard routes so the admin dashboard LiveMap can plot them
    let manifestQuery = supabase.from('cargo_manifest').select('*');
    if (driverVehicleIds) manifestQuery = manifestQuery.in('vehicle_id', driverVehicleIds);
    if (vehicleId) manifestQuery = manifestQuery.eq('vehicle_id', vehicleId);
    if (status === 'active' || status === 'pending') {
      manifestQuery = manifestQuery.in('status', ['scheduled', 'in_transit']);
    }

    const { data: manifests } = await manifestQuery;

    if (manifests) {
      for (const manifest of manifests) {
        result.push({
          id: manifest.id,
          vehicle_id: manifest.vehicle_id,
          status: manifest.status === 'scheduled' ? 'pending' : (manifest.status === 'in_transit' ? 'active' : manifest.status),
          is_manifest: true,
          total_distance_km: 0,
          total_duration_minutes: 0,
          route_stops: [
            {
              id: manifest.id + '_pickup',
              sequence: 1,
              status: manifest.status === 'scheduled' ? 'pending' : 'completed',
              delivery_points: {
                id: manifest.id + '_pickup_dp',
                name: "Pickup: " + (manifest.pickup_location || '').substring(0, 20),
                address: manifest.pickup_location,
                latitude: manifest.pickup_lat,
                longitude: manifest.pickup_lng,
                demand_kg: manifest.capacity_kg
              }
            },
            {
              id: manifest.id + '_drop',
              sequence: 2,
              status: 'pending',
              delivery_points: {
                id: manifest.id + '_drop_dp',
                name: "Drop: " + (manifest.drop_location || '').substring(0, 20),
                address: manifest.drop_location,
                latitude: manifest.drop_lat,
                longitude: manifest.drop_lng,
                demand_kg: manifest.capacity_kg
              }
            }
          ]
        });
      }
    }

    res.json(result);
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── GET /delivery-points ───────────────────────────────────
router.get('/delivery-points', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    const { data, error } = await supabase.from('delivery_points').select('*');
    if (error) throw error;
    res.json(data || []);
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── GET /:route_id ─────────────────────────────────────────
router.get('/:route_id', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!(await canAccessRoute(req.user!, req.params.route_id))) {
      res.status(403).json({ detail: 'Not authorized to view this route' });
      return;
    }

    const { data: route, error } = await supabase
      .from('routes')
      .select('*, vehicles(*), route_stops(*, delivery_points(*))')
      .eq('id', req.params.route_id)
      .maybeSingle();

    if (!route) {
      // Try fetching from cargo_manifest
      const { data: manifest, error: manifestErr } = await supabase
        .from('cargo_manifest')
        .select('*, vehicles(*)')
        .eq('id', req.params.route_id)
        .maybeSingle();

      if (manifestErr || !manifest) {
        res.status(404).json({ detail: 'Route or Cargo Manifest not found' });
        return;
      }

      // Format manifest to match the route schema so the UI doesn't break
      const formattedManifest = {
        id: manifest.id,
        vehicle_id: manifest.vehicle_id,
        status: manifest.status === 'scheduled' ? 'pending' : (manifest.status === 'in_transit' ? 'active' : manifest.status),
        is_manifest: true,
        created_at: manifest.created_at,
        updated_at: manifest.updated_at,
        total_distance_km: 0,
        total_duration_minutes: 0,
        estimated_fuel_liters: 0,
        optimization_score: null,
        vehicles: manifest.vehicles,
        logs: manifest.logs || [],
        route_stops: [
          {
            id: manifest.id + '_pickup',
            sequence: 1,
            status: manifest.status === 'scheduled' ? 'pending' : 'completed',
            delivery_point_id: manifest.id + '_pickup_dp',
            delivery_points: {
              id: manifest.id + '_pickup_dp',
              name: "Pickup: " + (manifest.pickup_location || '').substring(0, 20),
              address: manifest.pickup_location,
              latitude: manifest.pickup_lat,
              longitude: manifest.pickup_lng,
              demand_kg: manifest.capacity_kg
            }
          },
          {
            id: manifest.id + '_drop',
            sequence: 2,
            status: ['delivered', 'completed'].includes(manifest.status) ? 'completed' : 'pending',
            delivery_point_id: manifest.id + '_drop_dp',
            delivery_points: {
              id: manifest.id + '_drop_dp',
              name: "Drop: " + (manifest.drop_location || '').substring(0, 20),
              address: manifest.drop_location,
              latitude: manifest.drop_lat,
              longitude: manifest.drop_lng,
              demand_kg: manifest.capacity_kg
            }
          }
        ]
      };

      res.json(formattedManifest);
      return;
    }

    res.json(route);
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── PATCH /:route_id/status ────────────────────────────────
// Staff move a route along its lifecycle (pending -> active -> completed, or
// cancelled); a driver may only start their own route. Every change follows
// ROUTE_TRANSITIONS, so a completed or cancelled route cannot be re-opened.
router.patch('/:route_id/status', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!(await canAccessRoute(req.user!, req.params.route_id))) {
      res.status(403).json({ detail: 'Not authorized to update this route' });
      return;
    }
    const newStatus = req.body?.status;
    if (typeof newStatus !== 'string' || !newStatus) {
      res.status(400).json({ detail: 'status is required' });
      return;
    }
    if (!ROUTE_STATUSES.includes(newStatus)) {
      res.status(400).json({ detail: `status must be one of: ${ROUTE_STATUSES.join(', ')}` });
      return;
    }
    if (!isStaff(req.user) && !['active', 'in_progress'].includes(newStatus)) {
      res.status(403).json({ detail: 'Drivers can only start their own route' });
      return;
    }

    const result = await routeService.changeStatus(req.params.route_id, newStatus);
    res.json({ id: result.id, status: result.status, vehicle_status: result.vehicle_status });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── POST /:route_id/reroute ────────────────────────────────
router.post('/:route_id/reroute', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!['admin', 'superadmin', 'manager'].includes(req.user!.role)) {
      res.status(403).json({ detail: 'Not authorized to apply reroutes' });
      return;
    }

    const newSequence = req.body.new_sequence as string[];
    if (!newSequence || !Array.isArray(newSequence)) {
      res.status(400).json({ detail: 'new_sequence is required' });
      return;
    }

    // Fetch route with stops
    const { data: route, error } = await supabase
      .from('routes')
      .select('*, route_stops(*)')
      .eq('id', req.params.route_id)
      .single();

    if (error || !route) {
      res.status(404).json({ detail: 'Route not found' });
      return;
    }

    // Re-sequence pending stops
    const pendingStops = (route.route_stops || []).filter((s: any) => s.status === 'pending');
    const stopMap = new Map<string, any>(pendingStops.map((s: any) => [s.delivery_point_id, s]));

    for (let i = 0; i < newSequence.length; i++) {
      const stop = stopMap.get(newSequence[i]);
      if (stop) {
        await supabase.from('route_stops').update({ sequence: i }).eq('id', stop.id);
      }
    }

    // Clear reroute suggestions for this vehicle from cache
    const existing = (await cacheGet<any[]>('active_reroute_suggestions')) || [];
    const updated = existing.filter((s: any) => s.vehicle_id !== route.vehicle_id);
    await cacheSet('active_reroute_suggestions', updated, 3600);

    res.json({ status: 'rerouted', route_id: route.id, new_sequence_count: newSequence.length });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── PATCH /:route_id ───────────────────────────────────────
router.patch('/:route_id', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!['admin', 'superadmin', 'manager'].includes(req.user!.role)) {
      res.status(403).json({ detail: 'Not authorized to edit routes' });
      return;
    }

    const parsed = RouteUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ detail: parsed.error.issues[0].message });
      return;
    }

    const { data: route, error } = await supabase
      .from('routes')
      .select('id, status, vehicle_id')
      .eq('id', req.params.route_id)
      .maybeSingle();

    if (error || !route) {
      res.status(404).json({ detail: 'Route not found' });
      return;
    }

    // Reassigning a route: only before it starts, and only to a vehicle that can take it
    const newVehicleId = parsed.data.vehicle_id;
    if (newVehicleId && newVehicleId !== route.vehicle_id) {
      if (!['pending', 'optimizing'].includes(route.status)) {
        throw new HttpError(409, `This route is ${String(route.status).replace('_', ' ')}. Only a route that has not started can change vehicle.`);
      }
      const { data: vehicle } = await supabase.from('vehicles').select('id, status').eq('id', newVehicleId).maybeSingle();
      if (!vehicle) throw new HttpError(404, 'Vehicle not found');
      if (!(OPERATING_VEHICLE_STATUSES as readonly string[]).includes(String(vehicle.status))) {
        throw new HttpError(409, `That vehicle is in ${vehicle.status} and can't take a route.`);
      }
      const { error: vehicleErr } = await supabase.from('routes').update({ vehicle_id: newVehicleId }).eq('id', route.id).eq('status', route.status);
      if (vehicleErr) throw new Error(vehicleErr.message);
    }

    if (parsed.data.status) await routeService.changeStatus(route.id, parsed.data.status);

    // Re-fetch full route
    const { data: updated } = await supabase
      .from('routes')
      .select('*, vehicles(*), route_stops(*, delivery_points(*))')
      .eq('id', route.id)
      .single();

    res.json(updated);
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── DELETE /:route_id ──────────────────────────────────────
router.delete('/:route_id', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!['admin', 'superadmin', 'manager'].includes(req.user!.role)) {
      res.status(403).json({ detail: 'Not authorized to delete routes' });
      return;
    }

    const { data: route, error } = await supabase
      .from('routes')
      .select('*, vehicles(*)')
      .eq('id', req.params.route_id)
      .single();

    if (error || !route) {
      res.status(404).json({ detail: 'Route not found' });
      return;
    }

    if (['active', 'in_progress', 'completed'].includes(route.status)) {
      res.status(409).json({
        detail: `This route is ${String(route.status).replace('_', ' ')} and can't be deleted. Cancel it instead, or leave it as-is.`,
      });
      return;
    }

    // Free up vehicle
    if (route.vehicles && route.vehicles.status === 'on_route' && ['active', 'pending'].includes(route.status)) {
      await supabase.from('vehicles').update({ status: 'available' }).eq('id', route.vehicle_id);
    }

    // Delete stops then route
    await supabase.from('route_stops').delete().eq('route_id', route.id);
    await supabase.from('routes').delete().eq('id', route.id);

    res.json({ detail: 'Route deleted successfully' });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

export default router;
