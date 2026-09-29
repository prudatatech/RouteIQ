/**
 * margixindia — Traffic incident routes (TomTom)
 *
 * GET  /traffic/status     whether traffic is set up and what the last check found
 * GET  /traffic/incidents  open incidents, optionally for one route (?route_id=)
 * POST /traffic/refresh    check active routes now
 */
import { Router, Request, Response } from 'express';
import { requireAuth, requireRole } from '../core/auth';
import { STAFF_ROLES } from '../core/ownership';
import { sendError } from '../core/errors';
import { settings } from '../core/config';
import { supabase } from '../core/supabase';
import { getLastTrafficRun, isTrafficConfigured, refreshTrafficIncidents } from '../services/traffic.service';
import { isWeatherConfigured } from '../services/weather.service';

const router = Router();

router.get('/status', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    res.json({
      traffic_configured: isTrafficConfigured(),
      weather_configured: isWeatherConfigured(),
      refresh_minutes: settings.TRAFFIC_REFRESH_MINUTES,
      last_run: await getLastTrafficRun(),
    });
  } catch (e) {
    sendError(req, res, e);
  }
});

router.get('/incidents', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    const routeId = typeof req.query.route_id === 'string' ? req.query.route_id : null;
    const { data, error } = await supabase
      .from('traffic_incidents')
      .select('id, type, severity, description, road, lat, lng, delay_seconds, starts_at, ends_at, affected_route_ids, last_seen_at')
      .eq('active', true)
      .order('last_seen_at', { ascending: false })
      .limit(500);
    if (error) throw error;
    const rows = (data ?? []).filter(i => !routeId || (Array.isArray(i.affected_route_ids) && i.affected_route_ids.includes(routeId)));
    res.json({ configured: isTrafficConfigured(), incidents: rows });
  } catch (e) {
    sendError(req, res, e);
  }
});

router.post('/refresh', requireAuth, requireRole(...STAFF_ROLES), async (req: Request, res: Response) => {
  try {
    res.json(await refreshTrafficIncidents());
  } catch (e) {
    sendError(req, res, e);
  }
});

export default router;
