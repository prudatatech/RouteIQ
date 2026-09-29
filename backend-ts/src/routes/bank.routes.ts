/**
 * IFSC branch lookup. Open to applicants who are not signed in yet (3PL
 * onboarding), so it is rate limited by IP.
 */
import { Router } from 'express';
import { HttpError, sendError } from '../core/errors';
import { rateLimitByIp } from '../core/rate-limit';
import { IFSC_NOT_FOUND_MESSAGE, lookupIfsc } from '../services/ifsc.service';

const router = Router();

// GET /api/v1/bank/ifsc/:code
router.get('/ifsc/:code', rateLimitByIp('bank-ifsc', 60, 10 * 60), async (req, res) => {
  try {
    const result = await lookupIfsc(req.params.code);
    if (!result.found) throw new HttpError(404, IFSC_NOT_FOUND_MESSAGE);
    const { found: _found, ...details } = result;
    res.json(details);
  } catch (error) {
    sendError(req, res, error, 'detail');
  }
});

export default router;
