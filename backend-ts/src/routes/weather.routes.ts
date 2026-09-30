/**
 * margixindia — Weather routes (OpenWeather)
 *
 * GET /weather/route/:route_id  current conditions at the middle of a route
 *                               (a vendor load's cargo manifest id works too;
 *                               the console shows vendor loads as routes)
 */
import { Router, Request, Response } from 'express';
import { requireAuth, requireRole } from '../core/auth';
import { STAFF_ROLES } from '../core/ownership';
import { HttpError, sendError } from '../core/errors';
import { supabase } from '../core/supabase';
import { getWeather, isConditions } from '../services/weather.service';
import { isValidPoint, LatLng, midpoint } from '../services/geo';

const router = Router();

router.get('/route/:route_id', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    const { data: route, error } = await supabase
      .from('routes')
      .select('id, vehicles(latitude, longitude), route_stops(sequence, delivery_points(latitude, longitude))')
      .eq('id', req.params.route_id)
      .maybeSingle();
    if (error) throw error;

    const path: LatLng[] = [];
    const push = (lat: unknown, lng: unknown) => { const p = { lat: Number(lat), lng: Number(lng) }; if (isValidPoint(p)) path.push(p); };
    if (route) {
      const r = route as any;
      push(r.vehicles?.latitude, r.vehicles?.longitude);
      for (const s of [...(r.route_stops ?? [])].sort((a: any, b: any) => a.sequence - b.sequence)) push(s.delivery_points?.latitude, s.delivery_points?.longitude);
    } else {
      const { data: manifest, error: mErr } = await supabase
        .from('cargo_manifest')
        .select('id, pickup_lat, pickup_lng, drop_lat, drop_lng, vehicles(latitude, longitude)')
        .eq('id', req.params.route_id)
        .maybeSingle();
      if (mErr) throw mErr;
      if (!manifest) throw new HttpError(404, 'Trip not found');
      const m = manifest as any;
      push(m.vehicles?.latitude, m.vehicles?.longitude);
      if (path.length === 0) push(m.pickup_lat, m.pickup_lng);
      push(m.drop_lat, m.drop_lng);
    }
    if (path.length === 0) {
      res.json({ configured: true, available: false, reason: 'This route has no locations yet.' });
      return;
    }

    const point = path.length === 1 ? path[0] : midpoint(path[0], path[path.length - 1]);
    const w = await getWeather(point);
    if (!w.configured) {
      res.json({ configured: false, available: false, reason: 'Weather is not set up. Add an OpenWeather key to turn it on.' });
    } else if (!isConditions(w)) {
      res.json({ configured: true, available: false, reason: 'The weather service did not answer. Try again in a few minutes.' });
    } else {
      res.json({ available: true, point, ...w });
    }
  } catch (e) {
    sendError(req, res, e);
  }
});

export default router;
