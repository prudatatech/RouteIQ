/**
 * margixindia — 3PL network routes
 *
 * Staff: escalate a load to partners, see and withdraw offers, follow orders,
 * rate and mark them paid, and read partner statistics.
 * Partners (a vendor-role user linked through tpl_partners.user_id): see their own
 * offers, accept or decline, update their orders and read their earnings.
 */
import { Router, Request } from 'express';
import { requireAuth, requireRole } from '../core/auth';
import { STAFF_ROLES } from '../core/ownership';
import { HttpError, sendError } from '../core/errors';
import { tplNetworkService, type SourceType } from '../services/tpl-network.service';
import { supabase } from '../core/supabase';

const router = Router();
const staff = [requireAuth, requireRole(...STAFF_ROLES)];
const partner = [requireAuth, requireRole('vendor')];
const superadmin = [requireAuth, requireRole('superadmin')];

const AUTO_ESCALATE_KEY = 'auto_escalate_3pl';

// Whether the cascade matcher offers low-confidence loads to 3PL partners by itself.
router.get('/settings', ...staff, async (req, res) => {
  try {
    const { data, error } = await supabase.from('system_settings').select('value').eq('key', AUTO_ESCALATE_KEY).maybeSingle();
    if (error) throw error;
    res.json({ auto_escalate: data?.value === true });
  } catch (e) {
    sendError(req, res, e);
  }
});

router.put('/settings', ...superadmin, async (req, res) => {
  try {
    if (typeof req.body?.auto_escalate !== 'boolean') throw new HttpError(400, 'auto_escalate must be true or false');
    const { error } = await supabase.from('system_settings').upsert({ key: AUTO_ESCALATE_KEY, value: req.body.auto_escalate }, { onConflict: 'key' });
    if (error) throw error;
    res.json({ auto_escalate: req.body.auto_escalate });
  } catch (e) {
    sendError(req, res, e);
  }
});

/** The load named in a body or query: { request_id } or { shipment_id }. */
function parseSource(input: Record<string, unknown> | undefined): { sourceType: SourceType; id: string } {
  const requestId = input?.request_id;
  const shipmentId = input?.shipment_id;
  if ((requestId == null) === (shipmentId == null)) throw new HttpError(400, 'Give either request_id or shipment_id');
  const id = String(requestId ?? shipmentId);
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) throw new HttpError(400, 'The id is not valid');
  return { sourceType: requestId != null ? 'request' : 'shipment', id };
}

const myPartner = (req: Request) => tplNetworkService.partnerForUser(req.user!.user_id);

// ── Staff ────────────────────────────────────────────────────────────

// GET /tpl-network/escalations?request_id=|shipment_id=  offers and the accepted order for one load
router.get('/escalations', ...staff, async (req, res) => {
  try {
    const { sourceType, id } = parseSource(req.query as Record<string, unknown>);
    res.json(await tplNetworkService.listForSource(sourceType, id));
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

// GET /tpl-network/escalations/preview?request_id=|shipment_id=  partners that would receive an offer
router.get('/escalations/preview', ...staff, async (req, res) => {
  try {
    const { sourceType, id } = parseSource(req.query as Record<string, unknown>);
    res.json(await tplNetworkService.preview(sourceType, id));
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

// POST /tpl-network/escalations  { request_id | shipment_id }
router.post('/escalations', ...staff, async (req, res) => {
  try {
    const { sourceType, id } = parseSource(req.body);
    res.status(201).json(await tplNetworkService.escalate(sourceType, id, req.user!.user_id));
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

// POST /tpl-network/escalations/withdraw  { request_id | shipment_id }  withdraws every open offer
router.post('/escalations/withdraw', ...staff, async (req, res) => {
  try {
    const { sourceType, id } = parseSource(req.body);
    res.json({ withdrawn: await tplNetworkService.withdraw(sourceType, id) });
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

// POST /tpl-network/offers/:id/withdraw  withdraws one open offer
router.post('/offers/:id/withdraw', ...staff, async (req, res) => {
  try {
    const source = await tplNetworkService.getOfferSource(req.params.id);
    res.json({ withdrawn: await tplNetworkService.withdraw(source.sourceType, source.id, req.params.id) });
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

// GET /tpl-network/orders?partner_id=
router.get('/orders', ...staff, async (req, res) => {
  try {
    const partnerId = typeof req.query.partner_id === 'string' ? req.query.partner_id : undefined;
    res.json(await tplNetworkService.ordersForStaff(partnerId));
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

// POST /tpl-network/orders/:id/rate  { rating: 1-5, note? }
router.post('/orders/:id/rate', ...staff, async (req, res) => {
  try {
    res.json(await tplNetworkService.rateOrder(req.params.id, req.body?.rating, req.body?.note, req.user!.user_id));
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

// POST /tpl-network/orders/:id/paid  { paid: boolean, reference? }
router.post('/orders/:id/paid', ...staff, async (req, res) => {
  try {
    if (typeof req.body?.paid !== 'boolean') throw new HttpError(400, 'paid must be true or false');
    res.json(await tplNetworkService.markPaid(req.params.id, req.body.paid, req.body.reference));
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

// GET /tpl-network/partners/stats  statistics for every partner, keyed by partner id
router.get('/partners/stats', ...staff, async (req, res) => {
  try {
    res.json(await tplNetworkService.statsForAll());
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

// GET /tpl-network/partners/:id/stats
router.get('/partners/:id/stats', ...staff, async (req, res) => {
  try {
    res.json(await tplNetworkService.statsForPartner(req.params.id));
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

// ── Partner ──────────────────────────────────────────────────────────

// GET /tpl-network/my/offers
router.get('/my/offers', ...partner, async (req, res) => {
  try {
    res.json(await tplNetworkService.offersForPartner((await myPartner(req)).id));
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

// POST /tpl-network/my/offers/:id/accept  { pickup_eta?, delivery_eta?, agreed_amount? }
router.post('/my/offers/:id/accept', ...partner, async (req, res) => {
  try {
    res.status(201).json(await tplNetworkService.accept(await myPartner(req), req.params.id, req.body ?? {}));
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

// POST /tpl-network/my/offers/:id/decline  { reason }
router.post('/my/offers/:id/decline', ...partner, async (req, res) => {
  try {
    res.json(await tplNetworkService.decline(await myPartner(req), req.params.id, req.body?.reason));
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

// GET /tpl-network/my/orders
router.get('/my/orders', ...partner, async (req, res) => {
  try {
    res.json(await tplNetworkService.ordersForPartner((await myPartner(req)).id));
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

// POST /tpl-network/my/orders/:id/status  { status: picked_up | in_transit | delivered, note? }
router.post('/my/orders/:id/status', ...partner, async (req, res) => {
  try {
    res.json(await tplNetworkService.updateOrderStatus(await myPartner(req), req.params.id, req.body?.status, req.body?.note));
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

// GET /tpl-network/my/earnings
router.get('/my/earnings', ...partner, async (req, res) => {
  try {
    res.json(await tplNetworkService.earnings((await myPartner(req)).id));
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

// GET /tpl-network/my/stats
router.get('/my/stats', ...partner, async (req, res) => {
  try {
    res.json(await tplNetworkService.statsForPartner((await myPartner(req)).id));
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

export default router;
