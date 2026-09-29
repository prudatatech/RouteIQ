/**
 * margixindia — Customer routes: quotes and bookings (signed-in customers only).
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../core/auth';
import { HttpError, sendError } from '../core/errors';
import { rateLimitByIp } from '../core/rate-limit';
import { computeQuote, isTodayOrLater } from '../services/customer-booking.service';

const router = Router();
router.use(requireAuth, requireRole('customer'));

const DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a pickup date')
  .refine((d) => !Number.isNaN(Date.parse(d)), 'Choose a valid pickup date');

export const QuoteSchema = z.object({
  pickup_lat: z.number().min(-90).max(90),
  pickup_lng: z.number().min(-180).max(180),
  drop_lat: z.number().min(-90).max(90),
  drop_lng: z.number().min(-180).max(180),
  weight_kg: z.number().positive('Enter the weight of your goods').max(100000),
  vehicle_type: z.string().trim().max(80).optional().nullable(),
  load_type: z.enum(['full', 'part']),
  date: DATE,
});

// ── POST /customer/quote ───────────────────────────────────
router.post('/quote', rateLimitByIp('customer-quote', 60, 60 * 60), async (req: Request, res: Response) => {
  try {
    const parsed = QuoteSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);
    if (!isTodayOrLater(parsed.data.date)) throw new HttpError(400, 'Pickup date cannot be in the past');
    res.json(await computeQuote(parsed.data));
  } catch (e) {
    sendError(req, res, e);
  }
});

export default router;
