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
import type { NextFunction, Response } from 'express';
import { STAFF_ROLES } from '../core/ownership';
import { HttpError, sendError } from '../core/errors';
import { tplNetworkService, parsePartnerIds, type PartnerSession, type SourceType } from '../services/tpl-network.service';
import { supabase } from '../core/supabase';

const router = Router();
const staff = [requireAuth, requireRole(...STAFF_ROLES)];
// A partner portal caller is a member of a 3PL partner organisation (or the partner's linked user), whatever
// app role the membership maps to: the lookup throws 403 for anyone else.
const requirePartnerMember = (req: Request, res: Response, next: NextFunction): void => {
  tplNetworkService.partnerForUser(req.user!.user_id).then(p => { (req as Request & { tplPartner?: PartnerSession }).tplPartner = p; next(); }, err => failBoth(req, res, err));
};
const partner = [requireAuth, requirePartnerMember];

/** The partner screens read the reason from `detail` (the web dialog shows it as is); older clients read `error`: both are sent. */
function failBoth(req: Request, res: Response, err: unknown): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ ...err.extra, error: err.message, detail: err.message });
    return;
  }
  sendError(req, res, err, 'error');
}
const superadmin = [requireAuth, requireRole('superadmin')];
// Marking a partner paid is money: admin and superadmin only
const moneyStaff = [requireAuth, requireRole('admin')];

const AUTO_ESCALATE_KEY = 'auto_escalate_3pl';

/** A switch stored as `true`, `"true"` or `{ "enabled": true }` reads the same way. */
export function isEnabled(value: unknown): boolean {
  if (value && typeof value === 'object') return isEnabled((value as { enabled?: unknown }).enabled);
  return value === true || value === 'true';
}

// Whether the cascade matcher offers low-confidence loads to 3PL partners by itself.
router.get('/settings', ...staff, async (req, res) => {
  try {
    const { data, error } = await supabase.from('system_settings').select('value').eq('key', AUTO_ESCALATE_KEY).maybeSingle();
    if (error) throw error;
    res.json({ auto_escalate: isEnabled(data?.value) });
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

const myPartner = async (req: Request): Promise<PartnerSession> => (req as Request & { tplPartner?: PartnerSession }).tplPartner ?? tplNetworkService.partnerForUser(req.user!.user_id);

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

// GET /tpl-network/escalations/preview?request_id=|shipment_id=[&partner_ids=a,b]  partners that would receive an offer,
// and { excluded: [{ partner_id, name, reason }] } the ones the company's partner rules keep out
router.get('/escalations/preview', ...staff, async (req, res) => {
  try {
    const { sourceType, id } = parseSource(req.query as Record<string, unknown>);
    const chosen = typeof req.query.partner_ids === 'string' && req.query.partner_ids !== '' ? req.query.partner_ids.split(',') : null;
    res.json(await tplNetworkService.preview(sourceType, id, { partnerIds: parsePartnerIds(chosen) }));
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

// POST /tpl-network/escalations  { request_id | shipment_id, vendor_price?, partner_ids?: uuid[1..10] }
// partner_ids: offer only to those partners of the company (targeted offers); absent: every matching partner
router.post('/escalations', ...staff, async (req, res) => {
  try {
    const { sourceType, id } = parseSource(req.body);
    res.status(201).json(await tplNetworkService.escalate(sourceType, id, req.user!.user_id, { vendorPrice: req.body?.vendor_price, partnerIds: req.body?.partner_ids }));
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

// PUT /tpl-network/requests/:id/price  { cost }  what the vendor pays for a load a partner carries
router.put('/requests/:id/price', ...staff, async (req, res) => {
  try {
    res.json(await tplNetworkService.setVendorPrice(req.params.id, req.body?.cost));
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
router.post('/orders/:id/paid', ...moneyStaff, async (req, res) => {
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
    res.json(await tplNetworkService.statsForAll(true));
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

// GET /tpl-network/partners/:id/stats
router.get('/partners/:id/stats', ...staff, async (req, res) => {
  try {
    res.json(await tplNetworkService.statsForPartner(req.params.id, true));
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

// POST /tpl-network/my/offers/:id/accept  { vehicle_id, driver_id, pickup_eta?, delivery_eta?, agreed_amount? }
router.post('/my/offers/:id/accept', ...partner, async (req, res) => {
  try {
    res.status(201).json(await tplNetworkService.accept(await myPartner(req), req.params.id, req.body ?? {}));
  } catch (error) {
    failBoth(req, res, error);
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
