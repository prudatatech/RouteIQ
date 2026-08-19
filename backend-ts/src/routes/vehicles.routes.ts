/**
 * margixindia — Vehicle Routes
 * Ports: backend/app/api/v1/endpoints/vehicles.py
 */
import { Router, Request, Response } from 'express';
import { supabase } from '../core/supabase';
import { requireAuth, requireRole } from '../core/auth';
import { cacheGet, cacheSet } from '../core/redis';
import { VehicleCreateSchema, VehicleUpdateSchema } from '../schemas';

const router = Router();

// ── GET / ──────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const skip = parseInt(req.query.skip as string) || 0;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    const cacheKey = `vehicles:list:${status}:${skip}:${limit}`;
    const cached = await cacheGet(cacheKey);
    if (cached) { res.json(cached); return; }

    let query = supabase.from('vehicles').select('*');

    if (req.user!.role === 'driver') {
      query = query.eq('driver_id', req.user!.user_id);
    } else if (status) {
      query = query.eq('status', status);
    }

    query = query.range(skip, skip + limit - 1);

    const { data: vehicles, error } = await query;
    if (error) { res.status(500).json({ detail: error.message }); return; }

    await cacheSet(cacheKey, vehicles || [], 30);
    res.json(vehicles || []);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── POST / ─────────────────────────────────────────────────
router.post('/', requireAuth, requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const parsed = VehicleCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ detail: parsed.error.issues[0].message });
      return;
    }

    const { data: vehicle, error } = await supabase
      .from('vehicles')
      .insert(parsed.data)
      .select()
      .single();

    if (error) { res.status(500).json({ detail: error.message }); return; }
    res.status(201).json(vehicle);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── GET /summary ───────────────────────────────────────────
router.get('/summary', requireAuth, async (_req: Request, res: Response) => {
  try {
    const { data: vehicles, error } = await supabase
      .from('vehicles')
      .select('status');

    if (error) { res.status(500).json({ detail: error.message }); return; }

    const counts: Record<string, number> = {};
    for (const v of vehicles || []) {
      counts[v.status] = (counts[v.status] || 0) + 1;
    }

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    res.json({
      total,
      active: counts['on_route'] || 0,
      idle: (counts['idle'] || 0) + (counts['available'] || 0),
      maintenance: counts['maintenance'] || 0,
      offline: counts['offline'] || 0,
    });
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── GET /:vehicle_id ───────────────────────────────────────
router.get('/:vehicle_id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { data: vehicle, error } = await supabase
      .from('vehicles')
      .select('*')
      .eq('id', req.params.vehicle_id)
      .single();

    if (error || !vehicle) {
      res.status(404).json({ detail: 'Vehicle not found' });
      return;
    }

    if (req.user!.role === 'driver' && vehicle.driver_id !== req.user!.user_id) {
      res.status(403).json({ detail: 'Not authorized to view this vehicle' });
      return;
    }

    res.json(vehicle);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── PATCH /:vehicle_id ─────────────────────────────────────
router.patch('/:vehicle_id', requireAuth, requireRole('driver', 'admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const parsed = VehicleUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ detail: parsed.error.issues[0].message });
      return;
    }

    if (req.user!.role === 'driver') {
      const { data: v } = await supabase.from('vehicles').select('driver_id').eq('id', req.params.vehicle_id).single();
      if (v?.driver_id !== req.user!.user_id) {
        return res.status(403).json({ detail: 'Unauthorized to update this vehicle' });
      }
    }

    // Filter undefined values
    const updateData: Record<string, any> = {};
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value !== undefined) updateData[key] = value;
    }

    // If declared_load_percentage is provided, update available_capacity_kg
    if (updateData.declared_load_percentage !== undefined && updateData.declared_load_percentage !== null) {
      const { data: vInfo } = await supabase.from('vehicles').select('capacity_kg').eq('id', req.params.vehicle_id).single();
      if (vInfo && vInfo.capacity_kg) {
        const used = (updateData.declared_load_percentage / 100) * vInfo.capacity_kg;
        const available = Math.max(0, vInfo.capacity_kg - used);
        updateData.available_capacity_kg = available;

        // If they declared 0% load, they are fully available
        if (updateData.declared_load_percentage === 0) {
          updateData.status = 'available';
        }
      }
    }

    const { data: vehicle, error } = await supabase
      .from('vehicles')
      .update(updateData)
      .eq('id', req.params.vehicle_id)
      .select()
      .single();

    if (error) {
      console.error('Vehicle update error:', error);
      res.status(400).json({ detail: error.message });
      return;
    }
    if (!vehicle) {
      res.status(404).json({ detail: 'Vehicle not found' });
      return;
    }
    res.json(vehicle);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── POST /:vehicle_id/sos (Emergency Alert) ───────────────
router.post('/:vehicle_id/sos', requireAuth, requireRole('driver', 'admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const { alert_type, description, latitude, longitude } = req.body;

    // Ensure the driver is reporting for their own vehicle unless admin
    if (req.user!.role === 'driver') {
      const { data: v } = await supabase.from('vehicles').select('driver_id').eq('id', req.params.vehicle_id).single();
      if (v?.driver_id !== req.user!.user_id) {
        return res.status(403).json({ detail: 'Unauthorized to report for this vehicle' });
      }
    }

    const { data: alert, error } = await supabase.from('sos_alerts').insert({
      driver_id: req.user!.user_id,
      vehicle_id: req.params.vehicle_id,
      alert_type: alert_type || 'sos',
      description: description || 'Driver triggered SOS emergency alert',
      latitude: latitude,
      longitude: longitude,
      status: 'active'
    }).select().single();

    if (error) { res.status(500).json({ detail: error.message }); return; }

    // Turn the vehicle status to maintenance or offline?
    await supabase.from('vehicles').update({ status: 'maintenance' }).eq('id', req.params.vehicle_id);

    res.status(201).json(alert);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── POST /:vehicle_id/return-trip ───────────────────────────
router.post('/:vehicle_id/return-trip', requireAuth, requireRole('driver', 'admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const { opens_at, closes_at, floor_price } = req.body;

    if (req.user!.role === 'driver') {
      const { data: v } = await supabase.from('vehicles').select('driver_id').eq('id', req.params.vehicle_id).single();
      if (v?.driver_id !== req.user!.user_id) {
        return res.status(403).json({ detail: 'Unauthorized to report for this vehicle' });
      }
    }

    const { data: window, error } = await supabase.from('capacity_windows').insert({
      vehicle_id: req.params.vehicle_id,
      opens_at: opens_at || new Date().toISOString(),
      closes_at: closes_at || new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours default
      floor_price: floor_price || 100.0,
    }).select().single();

    if (error) { res.status(500).json({ detail: error.message }); return; }

    // Also update vehicle bidding_window_open flag
    await supabase.from('vehicles').update({ bidding_window_open: true, bidding_window_closes_at: window.closes_at }).eq('id', req.params.vehicle_id);

    res.status(201).json(window);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── DELETE /:vehicle_id ────────────────────────────────────
router.delete('/:vehicle_id', requireAuth, requireRole('admin', 'manager'), async (req: Request, res: Response) => {
  try {
    const vehicleId = req.params.vehicle_id;

    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('id')
      .eq('id', vehicleId)
      .single();

    if (!vehicle) {
      res.status(404).json({ detail: 'Vehicle not found' });
      return;
    }

    // Delete dependent objects (no CASCADE in DB schema)
    // 1. Get route IDs
    const { data: routeRows } = await supabase
      .from('routes')
      .select('id')
      .eq('vehicle_id', vehicleId);

    if (routeRows && routeRows.length > 0) {
      const routeIds = routeRows.map((r: any) => r.id);
      await supabase.from('route_stops').delete().in('route_id', routeIds);
      await supabase.from('routes').delete().in('id', routeIds);
    }

    // 2. Delete telemetry, maintenance alerts, stoppages, GPS points
    await supabase.from('telemetry').delete().eq('vehicle_id', vehicleId);
    await supabase.from('maintenance_alerts').delete().eq('vehicle_id', vehicleId);
    await supabase.from('vehicle_stoppages').delete().eq('vehicle_id', vehicleId);
    await supabase.from('gps_points').delete().eq('vehicle_id', vehicleId);

    // 3. Delete vehicle
    await supabase.from('vehicles').delete().eq('id', vehicleId);

    res.status(204).send();
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

export default router;
