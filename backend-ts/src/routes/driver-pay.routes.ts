/**
 * margixindia — Driver pay routes (staff): the rate card per vehicle type, what drivers earned per
 * trip, approval, adjustments, and payouts made outside the app.
 *
 * Admin and superadmin only; managers run operations and have no access to pay. A driver reads
 * their own pay from GET /driver/pay.
 */
import { Router, Request, Response } from 'express';
import { requireAuth, requireRole } from '../core/auth';
import { sendError, HttpError } from '../core/errors';
import {
  adjustEntry, approveEntries, backfillTripPay, createPayout, createRate, listEntries, listPayouts, listRates,
  updateRate, voidEntry, withdrawRate,
} from '../services/driver-pay.service';

const router = Router();
router.use(requireAuth, requireRole('admin'));

const actorOf = (req: Request) => ({ user_id: req.user!.user_id, role: req.user!.role });
const text = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

// ── Rates ──────────────────────────────────────────────────
router.get('/rates', async (req: Request, res: Response) => {
  try { res.json(await listRates(req.query.history === '1')); } catch (e) { sendError(req, res, e); }
});
router.post('/rates', async (req: Request, res: Response) => {
  try { res.status(201).json(await createRate(actorOf(req), req.body ?? {})); } catch (e) { sendError(req, res, e); }
});
router.patch('/rates/:id', async (req: Request, res: Response) => {
  try { res.json(await updateRate(actorOf(req), req.params.id, req.body ?? {})); } catch (e) { sendError(req, res, e); }
});
router.delete('/rates/:id', async (req: Request, res: Response) => {
  try { res.json(await withdrawRate(actorOf(req), req.params.id)); } catch (e) { sendError(req, res, e); }
});

// ── Entries ────────────────────────────────────────────────
router.get('/entries', async (req: Request, res: Response) => {
  try {
    res.json(await listEntries({
      driver_id: text(req.query.driver_id), status: text(req.query.status), from: text(req.query.from), to: text(req.query.to),
      vehicle_type: text(req.query.vehicle_type), rate_missing: req.query.rate_missing === '1',
    }));
  } catch (e) { sendError(req, res, e); }
});
router.post('/entries/approve', async (req: Request, res: Response) => {
  try { res.json(await approveEntries(actorOf(req), req.body?.ids)); } catch (e) { sendError(req, res, e); }
});
router.post('/entries/:id/adjust', async (req: Request, res: Response) => {
  try { res.json(await adjustEntry(actorOf(req), req.params.id, req.body ?? {})); } catch (e) { sendError(req, res, e); }
});
router.post('/entries/:id/void', async (req: Request, res: Response) => {
  try { res.json(await voidEntry(actorOf(req), req.params.id, req.body?.reason)); } catch (e) { sendError(req, res, e); }
});
// Trips that finished before driver pay existed, or on a vehicle that had no driver then (the notice tells the company
// to run this). It reads and writes only the signed-in company's own trips and entries, so a company admin may run it.
router.post('/backfill', async (req: Request, res: Response) => {
  try {
    if (typeof req.body?.from !== 'string') throw new HttpError(400, 'from is required (YYYY-MM-DD)');
    res.json(await backfillTripPay(actorOf(req), req.body.from));
  } catch (e) { sendError(req, res, e); }
});

// ── Payouts ────────────────────────────────────────────────
router.get('/payouts', async (req: Request, res: Response) => {
  try { res.json(await listPayouts(text(req.query.driver_id))); } catch (e) { sendError(req, res, e); }
});
router.post('/payouts', async (req: Request, res: Response) => {
  try { res.status(201).json(await createPayout(actorOf(req), req.body ?? {})); } catch (e) { sendError(req, res, e); }
});

export default router;
