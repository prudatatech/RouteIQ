/**
 * margixindia — Depot Routes
 * Ports: backend/app/api/v1/endpoints/depots.py
 */
import { Router, Request, Response } from 'express';
import { supabase } from '../core/supabase';
import { requireAuth, requireRole } from '../core/auth';
import { STAFF_ROLES } from '../core/ownership';
import { sendError } from '../core/errors';
import { OWNED, scopeQuery } from '../core/org-scope';

const router = Router();

// ── GET / ──────────────────────────────────────────────────
router.get('/', requireAuth, requireRole(...STAFF_ROLES, 'driver'), async (req: Request, res: Response) => {
  try {
    const { data: depots, error } = await scopeQuery(supabase
      .from('depots')
      .select('id, name, latitude, longitude, address'), OWNED.carrier);

    if (error) throw error;

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
    sendError(req, res, e);
  }
});

export default router;
