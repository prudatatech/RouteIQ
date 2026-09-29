/**
 * margixindia — Telematics webhook
 *
 * POST /api/v1/telematics/webhook        device events (overspeed, tamper, ...)
 * POST /api/v1/telematics/test-alarm     staff "Send test alarm" (superadmin)
 *
 * The webhook is secured with FLEET_TELEMATICS_WEBHOOK_SECRET. Send it either as
 *   Authorization: Bearer <secret>
 * or sign the raw request body and send
 *   X-Signature: sha256=<hex HMAC-SHA256 of the body, keyed with the secret>
 * With no secret configured the webhook answers 503.
 */
import crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../core/auth';
import { settings } from '../core/config';
import { HttpError, sendError } from '../core/errors';
import { DEVICE_EVENT_TYPES } from '../services/alerts.service';
import { processDeviceEvents } from '../services/telematics.service';

const router = Router();

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function requireWebhookSecret(req: Request, res: Response, next: NextFunction): void {
  const secret = settings.FLEET_TELEMATICS_WEBHOOK_SECRET;
  if (!secret) {
    res.status(503).json({ detail: 'The telematics webhook is not configured' });
    return;
  }
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ') && safeEqual(auth.slice(7), secret)) {
    next();
    return;
  }
  const signature = req.headers['x-signature'];
  const raw: Buffer | undefined = (req as Request & { rawBody?: Buffer }).rawBody;
  if (typeof signature === 'string' && raw) {
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
    if (safeEqual(signature, expected)) {
      next();
      return;
    }
  }
  res.status(401).json({ detail: 'Invalid webhook credentials' });
}

// ── POST /webhook ───────────────────────────────────────────
// Body: one event, or { "events": [ ... up to 100 ] }.
router.post('/webhook', requireWebhookSecret, async (req: Request, res: Response) => {
  try {
    const body = req.body;
    const events: unknown[] = Array.isArray(body?.events) ? body.events : [body];
    if (events.length === 0 || events.length > 100) throw new HttpError(400, 'Send between 1 and 100 events');

    const results = await processDeviceEvents(events);
    const anyRecorded = results.some(r => r.status === 'created' || r.status === 'repeat');
    // Every event bad: tell the sender so it does not retry blindly
    if (!anyRecorded && results.every(r => r.status === 'invalid')) {
      res.status(400).json({ detail: results[0].detail, results });
      return;
    }
    res.status(anyRecorded ? 201 : 202).json({ results });
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── POST /test-alarm — staff check that alarms reach the console ──
const TestAlarmSchema = z.object({
  vehicle_id: z.string().uuid('Choose a vehicle'),
  event: z.enum(DEVICE_EVENT_TYPES).default('overspeed'),
});

router.post('/test-alarm', requireAuth, requireRole('superadmin'), async (req: Request, res: Response) => {
  try {
    const parsed = TestAlarmSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);
    const [result] = await processDeviceEvents(
      [{
        event: parsed.data.event,
        vehicle_id: parsed.data.vehicle_id,
        timestamp: new Date().toISOString(),
        message: 'This is a test alarm sent from Settings. No real event happened.',
        test: true,
      }],
      { forceTest: true },
    );
    if (result.status === 'unknown_vehicle') throw new HttpError(404, 'Vehicle not found');
    if (result.status === 'invalid') throw new HttpError(400, result.detail ?? 'Invalid test alarm');
    res.status(result.status === 'created' ? 201 : 200).json(result);
  } catch (e) {
    sendError(req, res, e);
  }
});

export default router;
