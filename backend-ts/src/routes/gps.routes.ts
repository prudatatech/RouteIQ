/**
 * RouteIQ — GPS Routes
 * Ports: backend/app/api/v1/endpoints/gps.py
 */
import { Router, Request, Response } from 'express';
import { supabase } from '../core/supabase';
import { requireAuth } from '../core/auth';
import { GPSPointCreateSchema } from '../schemas';

const router = Router();

// ── POST / — Create GPS point ──────────────────────────────
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = GPSPointCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ detail: parsed.error.issues[0].message });
      return;
    }

    // Verify vehicle exists
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('id')
      .eq('id', parsed.data.vehicle_id)
      .single();

    if (!vehicle) {
      res.status(404).json({ detail: `Vehicle with id ${parsed.data.vehicle_id} not found` });
      return;
    }

    const { data: point, error } = await supabase
      .from('gps_points')
      .insert({
        vehicle_id: parsed.data.vehicle_id,
        latitude: parsed.data.latitude,
        longitude: parsed.data.longitude,
        accuracy: parsed.data.accuracy ?? null,
        recorded_at: parsed.data.recorded_at || new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ detail: error.message });
      return;
    }
    res.status(201).json(point);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

// ── GET /vehicle/:vehicle_id — Recent GPS points ───────────
router.get('/vehicle/:vehicle_id', requireAuth, async (req: Request, res: Response) => {
  try {
    const minutes = parseInt(req.query.minutes as string) || 5;
    const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString();

    const { data: points, error } = await supabase
      .from('gps_points')
      .select('*')
      .eq('vehicle_id', req.params.vehicle_id)
      .gte('recorded_at', cutoff)
      .order('recorded_at', { ascending: false });

    if (error) {
      res.status(500).json({ detail: error.message });
      return;
    }
    res.json(points || []);
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

export default router;
