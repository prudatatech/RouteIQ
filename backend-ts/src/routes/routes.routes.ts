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
import { ROUTE_STATUS_TO_MANIFEST, cancelManifest, manifestAsRoute, routeService, vehicleHasOpenWork, setOperatingVehicleStatus } from '../services/route.service';
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

    // Vendor loads (cargo manifests) are routes too: listed with the same statuses, filter and vehicle
    let manifestStatuses: string[] | null = null;
    if (status) manifestStatuses = ROUTE_STATUS_TO_MANIFEST[status] ?? [];
    if (!manifestStatuses || manifestStatuses.length > 0) {
      let manifestQuery = supabase.from('cargo_manifest').select('*, vehicles(*)');
      if (driverVehicleIds) manifestQuery = manifestQuery.in('vehicle_id', driverVehicleIds);
      if (vehicleId) manifestQuery = manifestQuery.eq('vehicle_id', vehicleId);
      if (manifestStatuses) manifestQuery = manifestQuery.in('status', manifestStatuses);
      const { data: manifests, error: manifestsErr } = await manifestQuery;
      if (manifestsErr) throw manifestsErr;
      for (const manifest of manifests ?? []) result.push(manifestAsRoute(manifest));
      result.sort((x: any, y: any) => Date.parse(y.created_at ?? '') - Date.parse(x.created_at ?? ''));
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

      const formattedManifest = { ...manifestAsRoute(manifest), logs: (manifest as any).logs || [] };

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
    if (!isStaff(req.user) && newStatus !== 'active') {
      res.status(403).json({ detail: 'Drivers can only start their own route' });
      return;
    }

    // A vendor load lives in its own table: dispatch can cancel it here, the driver moves it along from the app
    const { data: manifest } = await supabase.from('cargo_manifest').select('id, vehicle_id').eq('id', req.params.route_id).maybeSingle();
    if (manifest) {
      if (!isStaff(req.user)) {
        res.status(403).json({ detail: 'Drivers start a load from the app' });
        return;
      }
      if (newStatus !== 'cancelled') {
        throw new HttpError(409, 'A vendor load is started and delivered by its driver. From here it can only be cancelled.');
      }
      const cancelled = await cancelManifest(manifest.id);
      const { data: veh } = manifest.vehicle_id ? await supabase.from('vehicles').select('status').eq('id', manifest.vehicle_id).maybeSingle() : { data: null };
      res.json({ id: cancelled.id, status: cancelled.status, vehicle_status: veh?.status ?? null });
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

    if (['active', 'completed'].includes(route.status)) {
      res.status(409).json({
        detail: `This route is ${String(route.status).replace('_', ' ')} and can't be deleted. Cancel it instead, or leave it as-is.`,
      });
      return;
    }

    // Free the vehicle, unless it is still running another route or carrying a vendor load
    if (route.vehicles && route.vehicles.status === 'on_route' && route.status === 'pending'
      && !(await vehicleHasOpenWork(route.vehicle_id, { routeId: route.id }))) {
      await setOperatingVehicleStatus(route.vehicle_id, 'available');
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
