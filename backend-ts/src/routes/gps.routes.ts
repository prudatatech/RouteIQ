/**
 * margixindia — GPS Routes
 * Ports: backend/app/api/v1/endpoints/gps.py
 */
import { Router, Request, Response } from 'express';
import { supabase } from '../core/supabase';
import { requireAuth } from '../core/auth';
import { canAccessVehicle, requireVehicleAccess } from '../core/ownership';
import { GPSPointCreateSchema } from '../schemas';
import { HttpError, sendError } from '../core/errors';
import { fixTime, isRealPosition, loadTrack, moveVehicleTo, recordGpsPoints, TRACK_DEFAULT_HOURS, TRACK_DEFAULT_LIMIT, TRACK_MAX_HOURS, TRACK_MAX_LIMIT } from '../services/gps-history.service';

const router = Router();

// ── POST / — Create GPS point ──────────────────────────────
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = GPSPointCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ detail: parsed.error.issues[0].message });
      return;
    }
    if (!(await canAccessVehicle(req.user!, parsed.data.vehicle_id))) {
      res.status(403).json({ detail: 'Not authorized for this vehicle' });
      return;
    }

    if (!isRealPosition(parsed.data.latitude, parsed.data.longitude)) {
      res.status(400).json({ detail: 'A real latitude and longitude are required' });
      return;
    }

    // Verify vehicle exists
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('id, latitude, longitude, last_heartbeat, odometer_km')
      .eq('id', parsed.data.vehicle_id)
      .maybeSingle();

    if (!vehicle) {
      res.status(404).json({ detail: `Vehicle with id ${parsed.data.vehicle_id} not found` });
      return;
    }

    // The point goes to the history (throttled) and becomes the vehicle's current position
    // unless the vehicle already reported something newer.
    const fix = {
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      accuracy: parsed.data.accuracy ?? null,
      recorded_at: fixTime(parsed.data.recorded_at),
    };
    const recorded = await recordGpsPoints(vehicle.id, [fix], 'gps_api');
    await moveVehicleTo(vehicle, fix);
    res.status(recorded > 0 ? 201 : 200).json({
      vehicle_id: vehicle.id,
      latitude: fix.latitude,
      longitude: fix.longitude,
      accuracy: fix.accuracy,
      recorded_at: fix.recorded_at,
      recorded: recorded > 0,
    });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── GET /vehicle/:vehicle_id — Recent GPS points ───────────
router.get('/vehicle/:vehicle_id', requireAuth, requireVehicleAccess(req => req.params.vehicle_id), async (req: Request, res: Response) => {
  try {
    const minutes = parseInt(req.query.minutes as string) || 5;
    const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString();

    const { data: points, error } = await supabase
      .from('gps_points')
      .select('*')
      .eq('vehicle_id', req.params.vehicle_id)
      .gte('recorded_at', cutoff)
      .order('recorded_at', { ascending: false });

    if (error) throw error;
    res.json(points || []);
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── GET /vehicle/:vehicle_id/track — the driven path over a time window ──
// ?from=&to= (ISO times; default the last 24 h, at most 7 days) and ?limit= (newest points kept).
router.get('/vehicle/:vehicle_id/track', requireAuth, requireVehicleAccess(req => req.params.vehicle_id), async (req: Request, res: Response) => {
  try {
    const parse = (v: unknown, label: string): Date | null => {
      if (v === undefined || v === '') return null;
      const d = new Date(String(v));
      if (Number.isNaN(d.getTime())) throw new HttpError(400, `${label} must be a date and time, for example 2026-09-29T08:00:00Z`);
      return d;
    };
    const to = parse(req.query.to, 'to') ?? new Date();
    const from = parse(req.query.from, 'from') ?? new Date(to.getTime() - TRACK_DEFAULT_HOURS * 3_600_000);
    if (from >= to) throw new HttpError(400, 'from must be earlier than to');
    if (to.getTime() - from.getTime() > TRACK_MAX_HOURS * 3_600_000) {
      throw new HttpError(400, `Ask for at most ${TRACK_MAX_HOURS / 24} days at a time`);
    }
    const asked = req.query.limit === undefined ? TRACK_DEFAULT_LIMIT : parseInt(String(req.query.limit), 10);
    if (!Number.isFinite(asked) || asked < 1) throw new HttpError(400, 'limit must be a positive whole number');
    res.json(await loadTrack(req.params.vehicle_id, from, to, Math.min(asked, TRACK_MAX_LIMIT)));
  } catch (e: any) {
    sendError(req, res, e);
  }
});

export default router;
