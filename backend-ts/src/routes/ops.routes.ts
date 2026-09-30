/**
 * margixindia — Ops routes: what the staff home page (Today) needs, in one call.
 */
import { Router, Request, Response } from 'express';
import { requireAuth, requireRole } from '../core/auth';
import { STAFF_ROLES } from '../core/ownership';
import { sendError } from '../core/errors';
import { getTodayQueues } from '../services/ops-today.service';

const router = Router();

// ── GET /today ─────────────────────────────────────────────
// Every work queue count plus the live strip. A manager gets the operations queues only.
router.get('/today', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    const scope = req.user!.role === 'manager' ? 'operations' : 'all';
    res.json(await getTodayQueues(req.user!.user_id, scope));
  } catch (e) {
    sendError(req, res, e);
  }
});

export default router;
