/**
 * margixindia — Public routes (no sign-in)
 *
 * GET /public/stats: platform-wide counts for the landing page. Counts only:
 * no names, addresses, plates or anything else that identifies a person or
 * a company. Cached for 10 minutes and rate limited per IP.
 */
import { Router, Request, Response } from 'express';
import { supabase } from '../core/supabase';
import { cacheGet, cacheSet } from '../core/redis';
import { rateLimitByIp } from '../core/rate-limit';
import { sendError } from '../core/errors';
import { cityFromAddress } from '../services/demand.service';
import { selectIn } from '../services/finance.service';
import { getPublicShare } from '../services/vehicle-location.service';

const router = Router();

export const PUBLIC_STATS_CACHE_KEY = 'public:stats';
export const PUBLIC_STATS_TTL_SECONDS = 10 * 60;
/** Latest delivered shipments looked at to count the cities delivered to. */
const CITY_SAMPLE = 1000;

export interface PublicStats {
  vehicles: number;
  deliveries_completed: number;
  active_partners: number;
  cities_served: number;
}

async function count(table: string, apply: (q: any) => any): Promise<number> {
  const { count: n, error } = await apply(supabase.from(table).select('id', { count: 'exact', head: true }));
  if (error) throw new Error(`Failed to count ${table}: ${error.message}`);
  return n ?? 0;
}

export async function computePublicStats(): Promise<PublicStats> {
  const [vehicles, shipmentsDelivered, manifestsDelivered, partners] = await Promise.all([
    count('vehicles', q => q.neq('status', 'archived').neq('status', 'pending_approval')),
    count('shipments', q => q.eq('status', 'delivered')),
    count('cargo_manifest', q => q.eq('status', 'delivered')),
    count('tpl_partners', q => q.eq('status', 'active')),
  ]);

  // Cities delivered to: the drop-off city of the latest delivered shipments
  const { data: delivered, error } = await supabase
    .from('shipments').select('id').eq('status', 'delivered').neq('is_master', true).order('updated_at', { ascending: false }).limit(CITY_SAMPLE);
  if (error) throw new Error(`Failed to read delivered shipments: ${error.message}`);
  const points = await selectIn<any>('delivery_points', 'shipment_id', (delivered ?? []).map((s: any) => s.id), 'address, name');
  const cities = new Set<string>();
  for (const p of points) {
    const city = cityFromAddress(p.address) ?? cityFromAddress(p.name);
    if (city) cities.add(city.toLowerCase());
  }

  return {
    vehicles,
    deliveries_completed: shipmentsDelivered + manifestsDelivered,
    active_partners: partners,
    cities_served: cities.size,
  };
}

router.get('/stats', rateLimitByIp('public-stats', 60, 60), async (req: Request, res: Response) => {
  try {
    let stats = await cacheGet<PublicStats>(PUBLIC_STATS_CACHE_KEY);
    if (!stats) {
      stats = await computePublicStats();
      await cacheSet(PUBLIC_STATS_CACHE_KEY, stats, PUBLIC_STATS_TTL_SECONDS);
    }
    res.set('Cache-Control', `public, max-age=${PUBLIC_STATS_TTL_SECONDS}`);
    res.json(stats);
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// GET /public/vehicle-share/:token — the live-location page staff share. Read-only, expires,
// shows the position and the last hours of the path, nothing about the load, driver or customers.
router.get('/vehicle-share/:token', rateLimitByIp('vehicle-share', 120, 60), async (req: Request, res: Response) => {
  try {
    const share = await getPublicShare(req.params.token);
    if (!share) {
      res.status(404).json({ detail: 'This link has expired or was closed. Ask the sender for a new one.' });
      return;
    }
    res.set('Cache-Control', 'no-store');
    res.json(share);
  } catch (e: any) {
    sendError(req, res, e);
  }
});

export default router;
