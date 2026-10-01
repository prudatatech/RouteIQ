/**
 * margixindia — Customer bookings for staff: list, confirm, assign, cancel.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../core/auth';
import { STAFF_ROLES } from '../core/ownership';
import { HttpError, parseRejectionReason, sendError } from '../core/errors';
import { auditService } from '../services/audit.service';
import { getCustomerProfile, updateCustomerProfile } from '../services/customer-profile.service';
import { assignBooking, BOOKING_STATUSES, cancelBooking, confirmBooking, listAllBookings } from '../services/customer-bookings.service';

const router = Router();
router.use(requireAuth, requireRole(...STAFF_ROLES));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function bookingId(req: Request): string {
  const id = String(req.params.id);
  if (!UUID.test(id)) throw new HttpError(404, 'Booking not found');
  return id;
}
const actor = (req: Request) => ({ id: req.user!.user_id, role: req.user!.role });

// ── GET /bookings?status= ──────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    if (status && !(BOOKING_STATUSES as readonly string[]).includes(status)) throw new HttpError(400, 'Unknown status');
    res.json(await listAllBookings(status));
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── GET and PATCH /bookings/customers/:id/profile — a customer's details, for staff ──
function customerId(req: Request): string {
  const id = String(req.params.id);
  if (!UUID.test(id)) throw new HttpError(404, 'Customer not found');
  return id;
}

router.get('/customers/:id/profile', async (req: Request, res: Response) => {
  try {
    res.json(await getCustomerProfile(customerId(req)));
  } catch (e) {
    sendError(req, res, e);
  }
});

router.patch('/customers/:id/profile', async (req: Request, res: Response) => {
  try {
    const id = customerId(req);
    const profile = await updateCustomerProfile(id, req.body);
    await auditService.record('staff-console', req.user!, 'customer_profile_updated', { customer_id: id, fields: Object.keys(req.body ?? {}) });
    res.json(profile);
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── POST /bookings/:id/confirm — creates the shipment ──────
// Optional { price }: what to charge, in rupees before GST. Left out, the customer's quote is used.
router.post('/:id/confirm', async (req: Request, res: Response) => {
  try {
    const parsed = z.object({ price: z.number().min(0).max(99_999_999.99).nullish() }).safeParse(req.body ?? {});
    if (!parsed.success) throw new HttpError(400, 'The price must be zero or more');
    res.json(await confirmBooking(bookingId(req), actor(req), { price: parsed.data.price }));
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── POST /bookings/:id/assign — { vehicle_id, dispatch? } ─────────────
router.post('/:id/assign', async (req: Request, res: Response) => {
  try {
    const parsed = z.object({ vehicle_id: z.string().uuid('Choose a vehicle'), dispatch: z.boolean().optional() }).safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0].message);
    res.json(await assignBooking(bookingId(req), parsed.data.vehicle_id, actor(req), { dispatch: parsed.data.dispatch === true }));
  } catch (e) {
    sendError(req, res, e);
  }
});

// ── POST /bookings/:id/cancel — { reason } ─────────────────
router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const reason = parseRejectionReason(req.body?.reason);
    const user = req.user!;
    res.json(await cancelBooking(bookingId(req), { role: 'staff', userId: user.user_id, actorRole: user.role }, reason));
  } catch (e) {
    sendError(req, res, e);
  }
});

export default router;
