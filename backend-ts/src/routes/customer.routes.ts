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
import { confirmReceipt, customerCargo } from '../services/cargo/customer.service';
import { idempotent } from '../core/idempotency';
import { DropInputSchema } from '../schemas';
import { samePlace, validPlace } from '../core/places';
import { listCustomerInvoices } from '../services/customer-invoices.service';
import { clearCustomerPushToken, saveCustomerPushToken } from '../services/customer-push.service';

const router = Router();
router.use(requireAuth, requireRole('customer'));

const DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a pickup date')
  .refine(isRealDate, { message: 'Choose a valid pickup date', params: { status: 422 } });

/** True when `d` (YYYY-MM-DD) is a day that exists: 2026-11-31 is not. */
function isRealDate(d: string): boolean {
  const t = Date.parse(d);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
}

/** The status a validation issue asks for (422 for a well-formed but impossible value), else 400. */
export function issueStatus(issue: unknown): number {
  const status = (issue as { params?: { status?: number } } | undefined)?.params?.status;
  return status === 422 ? 422 : 400;
}

const QuoteBase = z.object({
  pickup_lat: z.number().min(-90).max(90),
  pickup_lng: z.number().min(-180).max(180),
  drop_lat: z.number().min(-90).max(90),
  drop_lng: z.number().min(-180).max(180),
  weight_kg: z.number().positive('Enter the weight of your goods').max(100000),
  vehicle_type: z.string().trim().max(80).optional().nullable(),
  load_type: z.enum(['full', 'part']),
  date: DATE,
});

type Points = { pickup_lat: number; pickup_lng: number; drop_lat: number; drop_lng: number };
function checkPlaces(q: Points, ctx: z.RefinementCtx): void {
  if (!validPlace(q.pickup_lat, q.pickup_lng) || !validPlace(q.drop_lat, q.drop_lng)) {
    ctx.addIssue({ code: 'custom', message: 'Choose a pickup and a drop-off location on the map', params: { status: 422 } });
  } else if (samePlace(q.pickup_lat, q.pickup_lng, q.drop_lat, q.drop_lng)) {
    ctx.addIssue({ code: 'custom', message: 'The pickup and the drop-off are the same place', params: { status: 422 } });
  }
}

export const QuoteSchema = QuoteBase.superRefine(checkPlaces);

// ── POST /customer/quote ───────────────────────────────────
router.post('/quote', rateLimitByIp('customer-quote', 60, 60 * 60), async (req: Request, res: Response) => {
  try {
    const parsed = QuoteSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(issueStatus(parsed.error.issues[0]), parsed.error.issues[0].message);
    if (!isTodayOrLater(parsed.data.date)) throw new HttpError(400, 'Pickup date cannot be in the past');
    res.json(await computeQuote(parsed.data, { userId: req.user?.user_id }));
  } catch (e) {
    sendError(req, res, e);
  }
});

const BookingSchema = QuoteBase.extend({
  pickup_name: z.string().trim().min(1, 'Choose a pickup location').max(200),
  pickup_address: z.string().trim().min(1, 'Choose a pickup location').max(500),
  drop_name: z.string().trim().min(1, 'Choose a drop-off location').max(200),
  drop_address: z.string().trim().min(1, 'Choose a drop-off location').max(500),
  /**
   * Several drops, each to its own consignee with its share of the pieces (docs/cargo-plan.md,
   * Lots). drop_* is still the drop the price is quoted to (the farthest). The weights, when given
   * for every drop, add up to weight_kg.
   */
  drops: z.array(DropInputSchema).min(2, 'A multi-drop booking has at least two drops').max(20).optional(),
}).superRefine((b, ctx) => {
  checkPlaces(b, ctx);
  if (!b.drops) return;
  const named = b.drops.filter(d => d.weight_kg != null);
  if (named.length > 0 && named.length < b.drops.length) ctx.addIssue({ code: 'custom', message: 'Give the weight of every drop, or of none' });
  const sum = named.reduce((s, d) => s + (d.weight_kg ?? 0), 0);
  if (named.length === b.drops.length && Math.abs(sum - b.weight_kg) > 0.5) ctx.addIssue({ code: 'custom', message: `The drops weigh ${sum} kg in all, but the booking is for ${b.weight_kg} kg` });
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
router.post('/bookings', idempotent('customer-booking'), rateLimitByIp('customer-booking', 30, 60 * 60), async (req: Request, res: Response) => {
  try {
    const parsed = BookingSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(issueStatus(parsed.error.issues[0]), parsed.error.issues[0].message);
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

// ── GET /customer/bookings/:id/cargo — where the goods are, timeline, POD, notices, claims ──
router.get('/bookings/:id/cargo', async (req: Request, res: Response) => {
  try {
    res.json(await customerCargo(req.user!.user_id, bookingId(req)));
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── POST /customer/bookings/:id/confirm-receipt — rate the delivery, optionally report a problem ──
router.post('/bookings/:id/confirm-receipt', idempotent('customer-confirm-receipt'), async (req: Request, res: Response) => {
  try {
    res.json(await confirmReceipt(req.user!.user_id, bookingId(req), req.body ?? {}));
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

// ── GET /customer/invoices — my invoices (PDF: GET /invoices/:id/pdf) ──
router.get('/invoices', async (req: Request, res: Response) => {
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await listCustomerInvoices(req.user!.user_id));
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── PUT /customer/push-token — this phone's Expo push token; DELETE on sign-out ──
router.put('/push-token', rateLimitByIp('customer-push-token', 60, 60 * 60), async (req: Request, res: Response) => {
  try {
    res.json(await saveCustomerPushToken(req.user!.user_id, req.body?.token));
  } catch (e) {
    sendError(req, res, e);
  }
});

router.delete('/push-token', async (req: Request, res: Response) => {
  try {
    res.json(await clearCustomerPushToken(req.user!.user_id));
  } catch (e) {
    sendError(req, res, e);
  }
});

export default router;
