/**
 * margixindia — The company's side of order routing (docs/order-routing.md): the loads it can see (its market), quotes,
 * and accepting a load directly. Scoped to the logistic company the caller acts for.
 *
 *   GET    /company/loads/market?tab=new|quoted|won|lost
 *   GET    /company/loads/:id
 *   POST   /company/loads/:id/quotes        { amount_inr, valid_until?, vehicle_class?, pickup_eta?, notes? }
 *   DELETE /company/loads/:id/quotes/mine
 *   POST   /company/loads/:id/accept        { amount_inr? }
 */
import { Router } from 'express';
import type { Request } from 'express';
import { requireAuth, requireRole } from '../core/auth';
import { STAFF_ROLES } from '../core/ownership';
import { HttpError, sendError } from '../core/errors';
import { uuidParam } from '../core/validate';
import { rateLimitByUser } from '../core/rate-limit';
import { DirectAcceptSchema, MarketQuery, QuoteSchema } from '../schemas/loads';
import { parseBody } from '../schemas/vendor';
import {
  acceptDirect, companyLoadDetail, listMarket, submitQuote, withdrawQuote,
} from '../services/loads/order-routing';

const router = Router();

/** The logistic company the caller acts for; a 403 for anyone else (a vendor, the platform, a 3PL partner). */
function actingCompany(req: Request): string {
  if (req.org?.kind !== 'logistic_company') throw new HttpError(403, 'Switch to your logistic company to work with loads.');
  return req.org.id;
}

router.get('/market', requireAuth, requireRole(...STAFF_ROLES), async (req: any, res: any) => {
  try {
    const { tab } = parseBody(MarketQuery, req.query);
    res.json(await listMarket(actingCompany(req), tab, { isPlatformAdmin: !!req.isPlatformAdmin }));
  } catch (error: any) {
    sendError(req, res, error);
  }
});

router.get('/:id', requireAuth, requireRole(...STAFF_ROLES), async (req: any, res: any) => {
  try {
    res.json(await companyLoadDetail(actingCompany(req), uuidParam(req.params.id, 'Load not found')));
  } catch (error: any) {
    sendError(req, res, error);
  }
});

router.post('/:id/quotes', requireAuth, requireRole(...STAFF_ROLES), rateLimitByUser('company-quote', 120, 60 * 60), async (req: any, res: any) => {
  try {
    const body = parseBody(QuoteSchema, req.body);
    const out = await submitQuote(actingCompany(req), req.user.user_id, uuidParam(req.params.id, 'Load not found'), body);
    res.status(out.replaced ? 200 : 201).json(out);
  } catch (error: any) {
    sendError(req, res, error);
  }
});

router.delete('/:id/quotes/mine', requireAuth, requireRole(...STAFF_ROLES), async (req: any, res: any) => {
  try {
    res.json({ quote: await withdrawQuote(actingCompany(req), uuidParam(req.params.id, 'Load not found')) });
  } catch (error: any) {
    sendError(req, res, error);
  }
});

router.post('/:id/accept', requireAuth, requireRole(...STAFF_ROLES), rateLimitByUser('company-accept', 60, 60 * 60), async (req: any, res: any) => {
  try {
    const body = parseBody(DirectAcceptSchema, req.body);
    res.json(await acceptDirect(actingCompany(req), req.user.user_id, uuidParam(req.params.id, 'Load not found'), { amount: body.amount_inr ?? null }));
  } catch (error: any) {
    sendError(req, res, error);
  }
});

export default router;
