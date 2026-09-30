/**
 * margixindia — Pricing routes
 *
 * POST /pricing/quote     staff, vendors and customers get a price range for a load
 * GET  /pricing/settings  staff read the rate card
 * PUT  /pricing/settings  staff edit the rate card
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../core/auth';
import { STAFF_ROLES } from '../core/ownership';
import { sendError } from '../core/errors';
import { pricingService, readPricingSettings, savePricingSettings } from '../services/pricing.service';

const router = Router();

const point = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  label: z.string().max(255).optional().nullable(),
});

const QuoteSchema = z.object({
  pickup: point,
  drop: point,
  weight_kg: z.number().positive().max(1_000_000),
  vehicle_type: z.string().max(60).optional().nullable(),
  load_type: z.string().max(60).optional().nullable(),
  date: z.string().max(40).optional().nullable(),
  source: z.enum(['backhaul', 'vendor_request', 'bid', 'assign', 'customer', 'api']).optional(),
});

router.post('/quote', requireAuth, requireRole('vendor', 'customer', ...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    const parsed = QuoteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ detail: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') });
      return;
    }
    const { source, ...input } = parsed.data;
    res.json(await pricingService.quote(input, { userId: req.user!.user_id, role: req.user!.role, source }));
  } catch (e) {
    sendError(req, res, e);
  }
});

router.get('/settings', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    res.json({ settings: await readPricingSettings() });
  } catch (e) {
    sendError(req, res, e);
  }
});

const SettingsSchema = z.object({
  settings: z.record(z.string(), z.number().finite().nullable()),
});

router.put('/settings', requireAuth, requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const parsed = SettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ detail: 'Send { settings: { key: number or null } }' });
      return;
    }
    res.json({ settings: await savePricingSettings(parsed.data.settings) });
  } catch (e) {
    sendError(req, res, e);
  }
});

export default router;
