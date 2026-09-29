/**
 * GSTIN check: format and mod-36 checksum, plus an online lookup when the
 * e-way bill GSP is configured. Open to applicants who are not signed in yet
 * (3PL onboarding), so it is rate limited by IP.
 */
import { Router } from 'express';
import { gstinService } from '../services/gstin.service';
import { HttpError, sendError } from '../core/errors';
import { rateLimitByIp } from '../core/rate-limit';

const router = Router();

// POST /api/v1/gstin/verify  { gstin, pan? }
router.post('/verify', rateLimitByIp('gstin-verify', 30, 10 * 60), async (req, res) => {
  try {
    if (typeof req.body?.gstin !== 'string') throw new HttpError(400, 'gstin is required');
    res.json(await gstinService.verify(req.body.gstin, req.body.pan));
  } catch (error) {
    sendError(req, res, error, 'error');
  }
});

export default router;
