/**
 * margixindia — Traffic incident routes (TomTom)
 *
 * GET  /traffic/status     whether traffic is set up and what the last check found
 * GET  /traffic/incidents  open incidents, optionally for one route (?route_id=) or a map viewport
 *                          (?bbox=minLng,minLat,maxLng,maxLat, with &refresh=1 to fetch fresh ones from TomTom)
 * GET  /traffic/tile-token  short-lived token for the flow tiles (staff)
 * GET  /traffic/tiles/flow/:z/:x/:y.png  live congestion tiles (TomTom, key stays here; needs ?t=<tile token>)
 * POST /traffic/refresh    check active routes now
 */
import { Router, Request, Response } from 'express';
import { requireAuth, requireRole } from '../core/auth';
import { STAFF_ROLES } from '../core/ownership';
import { sendError } from '../core/errors';
import { settings } from '../core/config';
import { supabase } from '../core/supabase';
import { rateLimitByUser } from '../core/rate-limit';
import { getLastTrafficRun, isTrafficConfigured, refreshTrafficIncidents } from '../services/traffic.service';
import { incidentsInBbox, parseBbox } from '../services/traffic-area.service';
import {
  TILE_CACHE_SECONDS, TILE_TOKEN_TTL_SECONDS, TRANSPARENT_PNG, getFlowTile, isTrafficTilesConfigured,
  parseTileCoords, signTileToken, tileRateLimit, verifyTileToken,
} from '../services/traffic-tiles.service';
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
    if (req.query.bbox !== undefined) {
      const wantRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
      res.json(await incidentsInBbox(parseBbox(req.query.bbox), wantRefresh));
      return;
    }
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

router.get('/tile-token', requireAuth, requireRole(...STAFF_ROLES), rateLimitByUser('traffic-tile-token', 30, 60), (req: Request, res: Response) => {
  try {
    if (!isTrafficTilesConfigured()) {
      res.json({ configured: false, token: null, expires_in: 0 });
      return;
    }
    res.json({ configured: true, token: signTileToken(req.user!.user_id), expires_in: TILE_TOKEN_TTL_SECONDS });
  } catch (e) {
    sendError(req, res, e);
  }
});

/** Per signed token / per client address, per minute. A busy map asks for dozens of tiles per pan. */
const TILES_PER_USER_MINUTE = 1500;
const TILES_PER_IP_MINUTE = 4000;

router.get('/tiles/flow/:z/:x/:y.png', async (req: Request, res: Response) => {
  try {
    const coords = parseTileCoords(req.params.z, req.params.x, req.params.y);
    if (!coords) {
      res.status(400).json({ detail: 'Invalid tile address' });
      return;
    }
    if (!tileRateLimit(`ip:${req.ip}`, TILES_PER_IP_MINUTE, 60)) {
      res.setHeader('Retry-After', '60').status(429).json({ detail: 'Too many requests. Please try again later.' });
      return;
    }
    const userId = verifyTileToken(req.query.t);
    if (!userId) {
      res.status(401).json({ detail: 'Missing or expired tile token' });
      return;
    }
    if (!tileRateLimit(`user:${userId}`, TILES_PER_USER_MINUTE, 60)) {
      res.setHeader('Retry-After', '60').status(429).json({ detail: 'Too many requests. Please try again later.' });
      return;
    }
    const png = await getFlowTile(coords);
    res.setHeader('Content-Type', 'image/png');
    // The map's page is on another origin than this API
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (png) {
      res.setHeader('Cache-Control', `private, max-age=${TILE_CACHE_SECONDS}`);
      res.setHeader('X-Traffic-Tiles', 'live');
      res.end(png);
    } else {
      // Nothing to draw (not set up, or TomTom is failing): an empty tile keeps the map working
      res.setHeader('Cache-Control', 'private, max-age=20');
      res.setHeader('X-Traffic-Tiles', isTrafficTilesConfigured() ? 'unavailable' : 'not-configured');
      res.end(TRANSPARENT_PNG);
    }
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
