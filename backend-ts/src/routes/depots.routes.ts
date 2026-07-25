/**
 * RouteIQ — Depot Routes
 * Ports: backend/app/api/v1/endpoints/depots.py
 */
import { Router, Request, Response } from 'express';
import { supabase } from '../core/supabase';
import { requireAuth } from '../core/auth';

const router = Router();

// ── GET / ──────────────────────────────────────────────────
router.get('/', requireAuth, async (_req: Request, res: Response) => {
  try {
    const { data: depots, error } = await supabase
      .from('depots')
      .select('id, name, latitude, longitude, address');

    if (error) {
      res.status(500).json({ detail: error.message });
      return;
    }

    res.json(
      (depots || []).map((d: any) => ({
        id: d.id,
        name: d.name,
        latitude: d.latitude,
        longitude: d.longitude,
        address: d.address || '',
      }))
    );
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

export default router;
