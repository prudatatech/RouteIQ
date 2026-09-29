/**
 * margixindia — Driver app routes: parcel scans, proof-of-delivery uploads and
 * the dispatcher's phone number.
 */
import { Router, Request, Response } from 'express';
import { requireAuth, requireRole } from '../core/auth';
import { sendError } from '../core/errors';
import { scanParcel } from '../services/parcel.service';

const router = Router();

// ── POST /driver/scan — verify a parcel at pickup or delivery ──
// Body: { code, purpose: 'pickup' | 'delivery', stop_id?, method?, lat?, lng? }
router.post('/scan', requireAuth, requireRole('driver'), async (req: Request, res: Response) => {
  try {
    res.json(await scanParcel(req.user!.user_id, req.body ?? {}));
  } catch (e) {
    sendError(req, res, e);
  }
});

export default router;
