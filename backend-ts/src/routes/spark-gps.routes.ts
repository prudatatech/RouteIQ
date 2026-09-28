/**
 * margixindia — Spark GPS Push API Routes
 * Ports: backend/app/api/v1/endpoints/spark_gps.py
 * 
 * This endpoint receives hardware GPS data pushed from SparkGPS/Roadcast devices.
 * The provider authenticates with the shared SPARK_GPS_PUSH_SECRET, sent as
 * `Authorization: Bearer <secret>`, `X-Spark-Key: <secret>` or `?key=<secret>`.
 */
import crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { supabase } from '../core/supabase';
import { settings } from '../core/config';

const router = Router();

function providedKey(req: Request): string {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  const header = req.headers['x-spark-key'];
  if (typeof header === 'string') return header;
  return typeof req.query.key === 'string' ? req.query.key : '';
}

function requirePushSecret(req: Request, res: Response, next: NextFunction): void {
  const secret = settings.SPARK_GPS_PUSH_SECRET;
  if (!secret) {
    if (settings.isProduction) {
      res.status(503).json({ detail: 'GPS push is not configured' });
      return;
    }
    next();
    return;
  }
  const given = Buffer.from(providedKey(req));
  const expected = Buffer.from(secret);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    res.status(401).json({ detail: 'Invalid push credentials' });
    return;
  }
  next();
}

// ── POST / — Receive Spark GPS push ────────────────────────
router.post('/', requirePushSecret, async (req: Request, res: Response) => {
  try {
    const vehicleNo = req.body.vehicleNo;
    if (!vehicleNo) {
      res.status(400).json({ detail: 'vehicleNo missing' });
      return;
    }

    // Find vehicle by plate number
    const { data: vehicle, error: vErr } = await supabase
      .from('vehicles')
      .select('id')
      .eq('plate_number', vehicleNo)
      .single();

    if (vErr || !vehicle) {
      res.status(404).json({ detail: 'Vehicle not found' });
      return;
    }

    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      res.status(400).json({ detail: 'Valid lat/lng are required' });
      return;
    }

    const { data: point, error } = await supabase
      .from('gps_points')
      .insert({
        vehicle_id: vehicle.id,
        latitude: lat,
        longitude: lng,
        accuracy: null,
        recorded_at: req.body.timestamp || new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      res.status(500).json({ detail: error.message });
      return;
    }

    res.status(201).json({ status: 'success', gps_point_id: point?.id });
  } catch (e: any) {
    res.status(500).json({ detail: e.message });
  }
});

export default router;
