/**
 * margixindia — Driver app routes: parcel scans, proof-of-delivery uploads and
 * the dispatcher's phone number.
 */
import { Router, Request, Response } from 'express';
import { requireAuth, requireRole } from '../core/auth';
import { HttpError, sendError } from '../core/errors';
import { idempotent } from '../core/idempotency';
import { canAccessManifest, canAccessRouteStop } from '../core/ownership';
import { consumeRateLimit } from '../core/rate-limit';
import { scanParcel } from '../services/parcel.service';
import { createPodUploadUrl } from '../services/pod.service';

const router = Router();

// ── POST /driver/scan — verify a parcel at pickup or delivery ──
// Body: { code, purpose: 'pickup' | 'delivery', stop_id?, method?, lat?, lng? }
router.post('/scan', requireAuth, requireRole('driver'), idempotent('scan'), async (req: Request, res: Response) => {
  try {
    res.json(await scanParcel(req.user!.user_id, req.body ?? {}));
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── POST /driver/pod-upload-url — signed upload URL for a delivery photo or signature ──
// Body: { stop_id, kind: 'photo' | 'signature', content_type: 'image/jpeg' | 'image/png', size }
router.post('/pod-upload-url', requireAuth, requireRole('driver'), async (req: Request, res: Response) => {
  try {
    const stopId = typeof req.body?.stop_id === 'string' ? req.body.stop_id : '';
    if (!stopId) throw new HttpError(400, 'stop_id is required');
    // Vendor-load stops have synthetic ids: "<manifest id>_pickup" and "<manifest id>_drop"
    const manifestStop = /^(.+)_(pickup|drop)$/.exec(stopId);
    const allowed = manifestStop
      ? await canAccessManifest(req.user!, manifestStop[1])
      : await canAccessRouteStop(req.user!, stopId);
    if (!allowed) throw new HttpError(403, 'Not authorized for this stop');
    if (!(await consumeRateLimit(`pod-upload:${req.user!.user_id}`, 60, 3600))) {
      throw new HttpError(429, 'Too many uploads. Try again later.');
    }
    res.json(await createPodUploadUrl(stopId, req.body));
  } catch (e) {
    sendError(req, res, e);
  }
});

export default router;
