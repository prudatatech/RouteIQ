/**
 * margixindia — Customer routes: quotes and bookings (signed-in customers only).
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../core/auth';
import { HttpError, sendError } from '../core/errors';
import { consumeRateLimit, rateLimitByIp } from '../core/rate-limit';
import { computeQuote, isTodayOrLater } from '../services/customer-booking.service';
import { cancelBooking, createBooking, getCustomerBooking, listCustomerBookings } from '../services/customer-bookings.service';

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
    res.json(await computeQuote(parsed.data, { userId: req.user?.user_id }));
  } catch (e) {
    sendError(req, res, e);
  }
});

const BookingSchema = QuoteSchema.extend({
  pickup_name: z.string().trim().min(1, 'Choose a pickup location').max(200),
  pickup_address: z.string().trim().min(1, 'Choose a pickup location').max(500),
  drop_name: z.string().trim().min(1, 'Choose a drop-off location').max(200),
  drop_address: z.string().trim().min(1, 'Choose a drop-off location').max(500),
});

const CancelSchema = z.object({ reason: z.string().trim().max(500).optional().nullable() });

const idParam = (req: Request) => String(req.params.id);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function bookingId(req: Request): string {
  const id = idParam(req);
  if (!UUID.test(id)) throw new HttpError(404, 'Booking not found');
  return id;
}

// ── POST /customer/bookings — book a shipment ──────────────
router.post('/bookings', rateLimitByIp('customer-booking', 30, 60 * 60), async (req: Request, res: Response) => {
  try {
    const parsed = BookingSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);
    // Each customer can send a limited number of bookings an hour.
    if (!(await consumeRateLimit(`customer-booking:user:${req.user!.user_id}`, 10, 60 * 60))) {
      throw new HttpError(429, 'You have sent a lot of bookings. Please try again in a while.');
    }
    res.status(201).json(await createBooking(req.user!.user_id, parsed.data));
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── GET /customer/bookings — my bookings ───────────────────
router.get('/bookings', async (req: Request, res: Response) => {
  try {
    res.json(await listCustomerBookings(req.user!.user_id));
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── GET /customer/bookings/:id — one booking with live tracking ──
router.get('/bookings/:id', async (req: Request, res: Response) => {
  try {
    res.json(await getCustomerBooking(req.user!.user_id, bookingId(req)));
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── POST /customer/bookings/:id/cancel — cancel before pickup ──
router.post('/bookings/:id/cancel', async (req: Request, res: Response) => {
  try {
    const parsed = CancelSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);
    const user = req.user!;
    res.json(await cancelBooking(bookingId(req), { role: 'customer', userId: user.user_id, actorRole: 'customer' }, parsed.data.reason || null));
  } catch (e) {
    sendError(req, res, e);
  }
});

export default router;
