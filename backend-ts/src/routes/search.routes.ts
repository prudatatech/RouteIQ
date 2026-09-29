/**
 * margixindia — Global search (D1 in docs/ux-plan-2.md)
 * Staff only: tracking IDs, plates, drivers, vendors and 3PL partners.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, requireRole } from '../core/auth';
import { STAFF_ROLES } from '../core/ownership';
import { consumeRateLimit } from '../core/rate-limit';
import { sendError } from '../core/errors';
import { searchService } from '../services/search.service';

const router = Router();

const MIN_QUERY_LENGTH = 2;

/** 30 searches per minute per signed-in user (an authenticated staff endpoint, so keyed by user rather than IP). */
function rateLimitSearch(req: Request, res: Response, next: NextFunction): void {
  consumeRateLimit(`search:user:${req.user!.user_id}`, 30, 60)
    .then(allowed => {
      if (allowed) return next();
      res.status(429).json({ detail: 'Too many requests. Please try again later.' });
    })
    .catch(next);
}

// ── GET / (mounted at /api/v1/search) ───────────────────────
router.get('/', requireAuth, requireRole(...STAFF_ROLES), rateLimitSearch, async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length < MIN_QUERY_LENGTH) {
      res.json({ results: { shipments: [], cargo_manifests: [], vehicles: [], vendors: [], partners: [], users: [] } });
      return;
    }
    const results = await searchService.search(q, req.user!.role === 'superadmin');
    res.json({ results });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

export default router;
