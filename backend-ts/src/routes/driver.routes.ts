/**
 * margixindia — Driver app routes: parcel scans, proof-of-delivery uploads and
 * the dispatcher's phone number.
 */
import { Router, Request, Response } from 'express';
import { requireAuth, requireRole } from '../core/auth';
import { supabase } from '../core/supabase';
import { STAFF_ROLES } from '../core/ownership';
import { HttpError, sendError } from '../core/errors';
import { idempotent } from '../core/idempotency';
import { canAccessManifest, canAccessRouteStop } from '../core/ownership';
import { consumeRateLimit } from '../core/rate-limit';
import { scanParcel } from '../services/parcel.service';
import { createPodUploadUrl } from '../services/pod.service';
import { getDriverPay } from '../services/driver-pay.service';
import { readEffectiveSetting, resolveScope, saveOverrides, savePlatformRows } from '../services/company-settings.service';

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

// ── GET /driver/pay — the driver's own pay: totals, trips and payouts ──
router.get('/pay', requireAuth, requireRole('driver'), async (req: Request, res: Response) => {
  try {
    res.json(await getDriverPay(req.user!.user_id));
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

// ── Dispatcher's phone number ──────────────────────────────────
// Each company has its own (organizations.profile.settings.dispatch_phone); a company that has not set one falls
// back to the platform default in system_settings under `dispatch_phone`. Staff edit it on the Settings page, and
// a driver gets the number of the company they drive for (the company the request acts for).
const DISPATCH_PHONE_KEY = 'dispatch_phone';
const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;

/** A stored setting is a bare string, or an object like {"phone": "+91…"}. */
function phoneOf(value: unknown): string | null {
  const raw = typeof value === 'string' ? value : value && typeof value === 'object' ? (value as Record<string, unknown>).phone : null;
  return typeof raw === 'string' && PHONE_PATTERN.test(raw) ? raw : null;
}

async function readDispatchPhone(): Promise<string | null> {
  return phoneOf(await readEffectiveSetting(DISPATCH_PHONE_KEY));
}

// ── GET /driver/dispatch-contact — the number drivers call (drivers and staff) ──
router.get('/dispatch-contact', requireAuth, requireRole('driver', ...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    res.json({ phone: await readDispatchPhone() });
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── PUT /driver/dispatch-contact — set or clear the number (staff) ──
// Body: { phone: string | null }. Spaces, dashes and brackets are ignored; an empty value clears it.
router.put('/dispatch-contact', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    const input = req.body?.phone;
    if (input !== null && input !== undefined && typeof input !== 'string') throw new HttpError(400, 'phone must be text');
    const phone = typeof input === 'string' ? input.replace(/[\s\-().]/g, '') : '';

    if (phone && !PHONE_PATTERN.test(phone)) throw new HttpError(400, 'Enter a phone number of 7 to 15 digits, with an optional + at the start');

    // A company's own number, or the platform default when acting as the platform. Clearing a company's returns it to the default.
    const scope = await resolveScope();
    if (scope) await saveOverrides(scope, { [DISPATCH_PHONE_KEY]: phone || null });
    else await savePlatformRows({ [DISPATCH_PHONE_KEY]: phone ? { phone } : null });
    res.json({ phone: phone || (scope ? await readDispatchPhone() : null) });
  } catch (e) {
    sendError(req, res, e);
  }
});

export default router;
