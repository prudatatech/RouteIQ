import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { optionalAuth } from '../core/auth';
import { sendError } from '../core/errors';
import { wheelseyeService } from '../services/wheelseye.service';

const router = Router();

/**
 * GET /api/v1/wheelseye/autocomplete?query=...&addressType=...
 */
router.get('/autocomplete', optionalAuth, async (req: Request, res: Response) => {
  try {
    const query = String(req.query.query || '').trim();
    const addressType = String(req.query.addressType || 'CONSIGNEE').trim();

    if (!query) {
      res.json({ suggestions: [] });
      return;
    }

    const suggestions = await wheelseyeService.autocomplete(query, addressType);
    res.json({ suggestions });
  } catch (error: any) {
    sendError(req, res, error);
  }
});

const ResolveSchema = z.object({
  placeId: z.string().min(1),
  fullAddress: z.string().optional()
});

/**
 * POST /api/v1/wheelseye/resolve
 * Resolves coordinates (lat, lng) and pincode for a WheelsEye place
 */
router.post('/resolve', optionalAuth, async (req: Request, res: Response) => {
  try {
    const parsed = ResolveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ detail: parsed.error.issues.map(i => i.message).join('; ') });
      return;
    }

    const result = await wheelseyeService.resolvePlace(parsed.data.placeId, parsed.data.fullAddress);
    res.json(result);
  } catch (error: any) {
    sendError(req, res, error);
  }
});

/**
 * POST /api/v1/wheelseye/pricing-recommendation
 */
router.post('/pricing-recommendation', optionalAuth, async (req: Request, res: Response) => {
  try {
    const result = await wheelseyeService.getPricingRecommendations(req.body);
    res.json(result);
  } catch (error: any) {
    sendError(req, res, error);
  }
});

const QuoteRequestSchema = z.object({
  origin: z.object({
    placeId: z.string().min(1),
    address: z.string().optional(),
    loc: z.object({ lat: z.number(), lng: z.number() }).optional(),
    pincode: z.string().optional(),
    name: z.string().optional()
  }),
  destination: z.object({
    placeId: z.string().min(1),
    address: z.string().optional(),
    loc: z.object({ lat: z.number(), lng: z.number() }).optional(),
    pincode: z.string().optional(),
    name: z.string().optional()
  }),
  tonnage: z.number().positive().default(12),
  bodyType: z.string().default('OPEN')
});

/**
 * POST /api/v1/wheelseye/quote
 * Takes origin & destination, resolves coordinates and pincodes automatically,
 * and calls WheelsEye vehicle pricing recommendation.
 */
router.post('/quote', optionalAuth, async (req: Request, res: Response) => {
  try {
    const parsed = QuoteRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ detail: parsed.error.issues.map(i => i.message).join('; ') });
      return;
    }

    const { origin, destination, tonnage, bodyType } = parsed.data;
    const result = await wheelseyeService.getQuoteFromSuggestions(origin, destination, tonnage, bodyType);
    res.json(result);
  } catch (error: any) {
    sendError(req, res, error);
  }
});

export default router;
