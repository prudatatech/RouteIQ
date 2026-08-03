/**
 * RouteIQ — Route Management Routes
 * Ports: backend/app/api/v1/endpoints/routes.py
 */
import { Router, Request, Response } from 'express';
import { supabase } from '../core/supabase';
import { requireAuth, requireRole } from '../core/auth';
import { cacheGet, cacheSet } from '../core/redis';
import { RouteUpdateSchema } from '../schemas';
import { notificationService } from '../services/notification.service';

const router = Router();

// ── GET / ──────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const vehicleId = req.query.vehicle_id as string | undefined;
    const skip = parseInt(req.query.skip as string) || 0;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    let query = supabase
      .from('routes')
      .select('*, vehicles(*), route_stops(*, delivery_points(*))');

    if (req.user!.role === 'driver') {
      // Need to filter by driver — join through vehicles
      const { data: driverVehicles } = await supabase
        .from('vehicles')
        .select('id')
        .eq('driver_id', req.user!.user_id);
      const vehicleIds = (driverVehicles || []).map((v: any) => v.id);
      if (vehicleIds.length === 0) { res.json([]); return; }
      query = query.in('vehicle_id', vehicleIds);
    }

    if (status) query = query.eq('status', status);
    if (vehicleId) query = query.eq('vehicle_id', vehicleId);

    query = query.order('created_at', { ascending: false }).range(skip, skip + limit - 1);

    const { data: routes, error } = await query;
    if (error) { res.status(500).json({ detail: error.message }); return; }
    res.json(routes || []);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── GET /delivery-points ───────────────────────────────────
router.get('/delivery-points', requireAuth, async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabase.from('delivery_points').select('*');
    if (error) { res.status(500).json({ detail: error.message }); return; }
    res.json(data || []);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── GET /:route_id ─────────────────────────────────────────
router.get('/:route_id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { data: route, error } = await supabase
      .from('routes')
      .select('*, vehicles(*), route_stops(*, delivery_points(*))')
      .eq('id', req.params.route_id)
      .single();

    if (error || !route) {
      res.status(404).json({ detail: 'Route not found' });
      return;
    }

    if (req.user!.role === 'driver' && route.vehicles?.driver_id !== req.user!.user_id) {
      res.status(403).json({ detail: 'Not authorized to view this route' });
      return;
    }

    res.json(route);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── PATCH /:route_id/status ────────────────────────────────
router.patch('/:route_id/status', requireAuth, async (req: Request, res: Response) => {
  try {
    const newStatus = req.body.status;

    const { data: route, error } = await supabase
      .from('routes')
      .select('*, vehicles(*)')
      .eq('id', req.params.route_id)
      .single();

    if (error || !route) {
      res.status(404).json({ detail: 'Route not found' });
      return;
    }

    if (newStatus) {
      await supabase.from('routes').update({ status: newStatus }).eq('id', route.id);

      // Side effects on vehicle
      let vehicleStatus = route.vehicles?.status;
      if (['in_progress', 'active'].includes(newStatus)) {
        vehicleStatus = 'on_route';
      } else if (['completed', 'cancelled'].includes(newStatus)) {
        vehicleStatus = 'available';
      }
      if (vehicleStatus !== route.vehicles?.status) {
        await supabase.from('vehicles').update({ status: vehicleStatus }).eq('id', route.vehicle_id);
      }

      // Notify driver when route is activated
      if (['in_progress', 'active'].includes(newStatus) && route.vehicles?.driver_id) {
        try {
          await notificationService.sendNotification(
            route.vehicles.driver_id,
            '🚨 Route Activated',
            'Your route has been activated. Open the app to start your journey.',
            'route_activated',
            { route_id: route.id }
          );
        } catch (notifErr) {
          console.warn('Failed to send route activation notification:', notifErr);
        }
      }

      res.json({ id: route.id, status: newStatus, vehicle_status: vehicleStatus });
    } else {
      res.status(400).json({ detail: 'status is required' });
    }
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
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
    res.status(500).json({ detail: e.message });
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
      .select('*, vehicles(*)')
      .eq('id', req.params.route_id)
      .single();

    if (error || !route) {
      res.status(404).json({ detail: 'Route not found' });
      return;
    }

    const routeUpdate: Record<string, any> = {};
    if (parsed.data.vehicle_id !== undefined && parsed.data.vehicle_id !== null) {
      routeUpdate.vehicle_id = parsed.data.vehicle_id;
    }
    if (parsed.data.status !== undefined && parsed.data.status !== null) {
      routeUpdate.status = parsed.data.status;

      // Vehicle status side effect
      if (['active', 'in_progress'].includes(parsed.data.status)) {
        await supabase.from('vehicles').update({ status: 'on_route' }).eq('id', route.vehicle_id);
      } else if (['completed', 'cancelled'].includes(parsed.data.status)) {
        await supabase.from('vehicles').update({ status: 'available' }).eq('id', route.vehicle_id);
      }
    }

    if (Object.keys(routeUpdate).length > 0) {
      await supabase.from('routes').update(routeUpdate).eq('id', route.id);
    }

    // Re-fetch full route
    const { data: updated } = await supabase
      .from('routes')
      .select('*, vehicles(*), route_stops(*, delivery_points(*))')
      .eq('id', route.id)
      .single();

    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
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

    // Free up vehicle
    if (route.vehicles && route.vehicles.status === 'on_route' && ['active', 'pending'].includes(route.status)) {
      await supabase.from('vehicles').update({ status: 'available' }).eq('id', route.vehicle_id);
    }

    // Delete stops then route
    await supabase.from('route_stops').delete().eq('route_id', route.id);
    await supabase.from('routes').delete().eq('id', route.id);

    res.json({ detail: 'Route deleted successfully' });
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

export default router;
