/**
 * margixindia — Public routes (no sign-in)
 *
 * GET /public/stats: platform-wide counts for the landing page. Counts only:
 * no names, addresses, plates or anything else that identifies a person or
 * a company. Cached for 10 minutes and rate limited per IP.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { supabase } from '../core/supabase';
import { cacheGet, cacheSet } from '../core/redis';
import { rateLimitByIp } from '../core/rate-limit';
import { sendError } from '../core/errors';
import { cityFromAddress } from '../services/demand.service';
import { selectIn } from '../services/finance.service';
import { getPublicShare } from '../services/vehicle-location.service';
import { freeCapacityKg } from '../services/capacity.service';
import { pricingService } from '../services/pricing.service';
import { normalizePlace } from '../utils/corridor-match';
import { assessLoad, findHsn, isPincode, loadGoodsCategories, loadHsnIndex, loadVehicleClasses, LoadDraft, LoadDraftSchema, lookupPincode, searchHsn, toHit } from '../services/goods';

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

// ── Vendor exploration without an account (docs/vendor-public.md) ──────────────────────────────
// Read-only, explicit allow-list mappers (never a spread of a row), active logistic companies only.
// No plate, vehicle id, driver, contact, GSTIN, position or user id ever leaves here.

const PUBLIC_LIMIT = 50;
const PUBLIC_CACHE = 'public, max-age=60';
const WINDOW_SCAN = 200;
const COMPANY_SCAN = 200;

const one = <T>(embed: T | T[] | null | undefined): T | null => (Array.isArray(embed) ? embed[0] : embed) ?? null;
const sameText = (a: unknown, b: unknown) => normalizePlace(a) === normalizePlace(b);
const text = (max: number) => z.string().trim().max(max).optional().transform(v => (v ? v : undefined));

function badRequest(res: Response, error: z.ZodError) {
  res.status(400).json({ detail: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') });
}

/** Active logistic companies among the given ids, by id. */
async function activeCompanies(ids: string[]): Promise<Map<string, any>> {
  const rows = await selectIn<any>('organizations', 'id', ids, 'id, name, city, kind, status');
  return new Map(rows.filter(o => o.kind === 'logistic_company' && o.status === 'active').map(o => [o.id, o]));
}

export interface PublicSpareSpace {
  id: string;
  company: { id: string; name: string; city: string | null };
  from_city: string | null;
  to_city: string | null;
  departs_from: string;
  departs_to: string;
  vehicle_type: string | null;
  free_kg: number;
  price_per_kg_from: number | null;
}

function toPublicSpareSpace(w: any, company: any, vehicle: any, toCity: string | null): PublicSpareSpace {
  const freeKg = freeCapacityKg(vehicle);
  const floor = Number(w.floor_price);
  return {
    id: w.id,
    company: { id: company.id, name: company.name, city: company.city ?? null },
    from_city: cityFromAddress(vehicle.current_location_name),
    to_city: toCity,
    departs_from: w.opens_at,
    departs_to: w.closes_at,
    vehicle_type: vehicle.vehicle_type ?? null,
    free_kg: freeKg,
    price_per_kg_from: Number.isFinite(floor) && floor > 0 && freeKg > 0 ? Math.round((floor / freeKg) * 100) / 100 : null,
  };
}

const SpareSpaceQuery = z.object({
  from: text(80), to: text(80), vehicle_type: text(60),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD').optional(),
  min_kg: z.coerce.number().positive().max(1_000_000).optional(),
});

router.get('/spare-space', rateLimitByIp('public-spare-space', 60, 60), async (req: Request, res: Response) => {
  try {
    const q = SpareSpaceQuery.safeParse(req.query);
    if (!q.success) return badRequest(res, q.error);
    const { from, to, vehicle_type, date, min_kg } = q.data;
    const { data, error } = await supabase
      .from('capacity_windows')
      .select('id, opens_at, closes_at, floor_price, carrier_org_id, vehicle_id, vehicles(vehicle_type, capacity_kg, current_load_kg, available_capacity_kg, current_location_name)')
      .eq('status', 'open').is('winning_bid_id', null).gt('closes_at', new Date().toISOString())
      .order('opens_at', { ascending: true }).limit(WINDOW_SCAN);
    if (error) throw new Error(`Failed to read spare space: ${error.message}`);
    const windows = (data ?? []).filter((w: any) => w.carrier_org_id && new Date(w.closes_at).getTime() > Date.now());

    // Companies, and where each truck heads back to (the depot of its latest route), read together
    const [companies, routes] = await Promise.all([
      activeCompanies(windows.map((w: any) => w.carrier_org_id)),
      selectIn<any>('routes', 'vehicle_id', windows.map((w: any) => w.vehicle_id), 'vehicle_id, depot_id, created_at'),
    ]);
    const depotOf = new Map<string, string>();
    for (const r of [...routes].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) if (r.depot_id) depotOf.set(r.vehicle_id, r.depot_id);
    const depots = await selectIn<any>('depots', 'id', [...depotOf.values()], 'id, address');
    const depotCity = new Map(depots.map(d => [d.id, cityFromAddress(d.address)]));

    const dayStart = date ? new Date(`${date}T00:00:00.000Z`).getTime() : null;
    const items: PublicSpareSpace[] = [];
    for (const w of windows) {
      const company = companies.get(w.carrier_org_id);
      const vehicle = one<any>(w.vehicles);
      if (!company || !vehicle) continue;
      const item = toPublicSpareSpace(w, company, vehicle, depotCity.get(depotOf.get(w.vehicle_id) ?? '') ?? null);
      if (from && !sameText(item.from_city, from)) continue;
      if (to && !sameText(item.to_city, to)) continue;
      if (vehicle_type && !sameText(item.vehicle_type, vehicle_type)) continue;
      if (min_kg && item.free_kg < min_kg) continue;
      if (dayStart !== null && !(new Date(item.departs_from).getTime() < dayStart + 86_400_000 && new Date(item.departs_to).getTime() >= dayStart)) continue;
      items.push(item);
      if (items.length >= PUBLIC_LIMIT) break;
    }
    res.set('Cache-Control', PUBLIC_CACHE);
    res.json({ items });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

export interface PublicCompany { id: string; name: string; city: string | null; vehicle_types: string[]; trips_completed: number }

const CompaniesQuery = z.object({ city: text(80), vehicle_type: text(60) });

router.get('/companies', rateLimitByIp('public-companies', 60, 60), async (req: Request, res: Response) => {
  try {
    const q = CompaniesQuery.safeParse(req.query);
    if (!q.success) return badRequest(res, q.error);
    const { data, error } = await supabase
      .from('organizations').select('id, name, city').eq('kind', 'logistic_company').eq('status', 'active').order('name', { ascending: true }).limit(COMPANY_SCAN);
    if (error) throw new Error(`Failed to read companies: ${error.message}`);
    const orgs = (data ?? []) as any[];
    const ids = orgs.map(o => o.id);
    const [vehicles, delivered] = await Promise.all([
      selectIn<any>('vehicles', 'carrier_org_id', ids, 'carrier_org_id, vehicle_type, status'),
      selectIn<any>('shipments', 'carrier_org_id', ids, 'carrier_org_id', qb => qb.eq('status', 'delivered').neq('is_master', true).limit(5000)),
    ]);
    const types = new Map<string, Set<string>>();
    for (const v of vehicles) {
      if (!v.vehicle_type || v.status === 'archived' || v.status === 'pending_approval') continue;
      if (!types.has(v.carrier_org_id)) types.set(v.carrier_org_id, new Set());
      types.get(v.carrier_org_id)!.add(String(v.vehicle_type));
    }
    const trips = new Map<string, number>();
    for (const s of delivered) trips.set(s.carrier_org_id, (trips.get(s.carrier_org_id) ?? 0) + 1);

    const items: PublicCompany[] = orgs
      .map(o => ({ id: o.id, name: o.name, city: o.city ?? null, vehicle_types: [...(types.get(o.id) ?? [])].sort(), trips_completed: trips.get(o.id) ?? 0 }))
      .filter(c => !q.data.city || sameText(c.city, q.data.city))
      .filter(c => !q.data.vehicle_type || c.vehicle_types.some(t => sameText(t, q.data.vehicle_type)))
      .slice(0, PUBLIC_LIMIT);
    res.set('Cache-Control', PUBLIC_CACHE);
    res.json({ items });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

const point = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), label: z.string().max(255).optional().nullable() });
const PublicQuoteSchema = z.object({
  pickup: point,
  drop: point,
  weight_kg: z.number().positive().max(1_000_000),
  vehicle_type: z.string().max(60).optional().nullable(),
  load_type: z.string().max(60).optional().nullable(),
  date: z.string().max(40).optional().nullable(),
});

// POST /public/quote — the indicative price range only. Nothing is stored, and the rate card, the
// factors behind the price and the demand figures stay private.
router.post('/quote', rateLimitByIp('public-quote', 20, 60), async (req: Request, res: Response) => {
  try {
    const parsed = PublicQuoteSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    const out = await pricingService.quote(parsed.data, { role: 'guest', source: 'api', persist: false });
    res.set('Cache-Control', 'no-store');
    if (out.status !== 'ok') {
      res.json({ status: 'unavailable', reason: 'We cannot give an indicative price for this lane yet. Post the load and companies will quote.' });
      return;
    }
    res.json({
      status: 'ok',
      distance_km: out.distance_km,
      distance_is_estimate: out.distance_is_estimate,
      low: out.low,
      suggested: out.suggested,
      high: out.high,
      per_km_suggested: out.per_km_suggested,
      generated_at: out.generated_at,
    });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// ── Goods master and the load assistant (docs/load-posting-design.md section 1) ──────────────────────
// The HSN master, pin codes, vehicle classes and goods categories are public reference data (no sign-in). The HSN
// index is held in memory for 10 minutes, so a search costs no query.

const GOODS_CACHE = 'public, max-age=600';

const HsnSearchQuery = z.object({ q: z.string().trim().min(3, 'Type at least 3 characters').max(80) });

// GET /public/hsn/search?q= — up to 8 suggestions: code, description, category, GST rate(s), flags
router.get('/hsn/search', rateLimitByIp('public-hsn', 120, 60), async (req: Request, res: Response) => {
  try {
    const parsed = HsnSearchQuery.safeParse(req.query);
    if (!parsed.success) return badRequest(res, parsed.error);
    const items = searchHsn(await loadHsnIndex(), parsed.data.q);
    res.set('Cache-Control', GOODS_CACHE);
    res.json({ items });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// GET /public/hsn/:code — one HSN code with every rate it allows
router.get('/hsn/:code', rateLimitByIp('public-hsn', 120, 60), async (req: Request, res: Response) => {
  try {
    if (!/^\d{2,8}$/.test(req.params.code)) return void res.status(400).json({ detail: 'An HSN code is 2 to 8 digits' });
    const e = findHsn(await loadHsnIndex(), req.params.code);
    if (!e) return void res.status(404).json({ detail: 'We do not have that HSN code. You can still enter it by hand.' });
    res.set('Cache-Control', GOODS_CACHE);
    res.json({ ...toHit(e), gst_rate: e.gst_rate, eway_always: e.eway_always });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// GET /public/pincode/:pin — the state of a pin code (it sets CGST+SGST or IGST)
router.get('/pincode/:pin', rateLimitByIp('public-pincode', 120, 60), async (req: Request, res: Response) => {
  try {
    if (!isPincode(req.params.pin)) return void res.status(400).json({ detail: 'A pin code is 6 digits' });
    const info = await lookupPincode(req.params.pin);
    if (!info) return void res.status(404).json({ detail: 'We could not place that pin code. Check it and try again.' });
    res.set('Cache-Control', 'public, max-age=86400');
    res.json(info);
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// GET /public/vehicle-classes and /public/goods-categories — the reference tables the form offers
router.get('/vehicle-classes', rateLimitByIp('public-goods-ref', 60, 60), async (req: Request, res: Response) => {
  try {
    res.set('Cache-Control', GOODS_CACHE);
    res.json({ items: await loadVehicleClasses() });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

router.get('/goods-categories', rateLimitByIp('public-goods-ref', 60, 60), async (req: Request, res: Response) => {
  try {
    res.set('Cache-Control', GOODS_CACHE);
    res.json({ items: await loadGoodsCategories() });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

// POST /public/loads/assist — totals, GST per line, e-way bill, hazmat, suggested vehicle, the freight estimate and the
// recommendations for the draft load. Nothing is stored.
router.post('/loads/assist', rateLimitByIp('public-load-assist', 60, 60), async (req: Request, res: Response) => {
  try {
    const parsed = LoadDraftSchema.safeParse(req.body);
    if (!parsed.success) return badRequest(res, parsed.error);
    res.set('Cache-Control', 'no-store');
    res.json(await assessLoad(parsed.data as LoadDraft));
  } catch (e: any) {
    sendError(req, res, e);
  }
});

const CitiesQuery = z.object({ q: text(60) });

// GET /public/cities?q= — city suggestions from active companies' home cities and their depots.
router.get('/cities', rateLimitByIp('public-cities', 120, 60), async (req: Request, res: Response) => {
  try {
    const q = CitiesQuery.safeParse(req.query);
    if (!q.success) return badRequest(res, q.error);
    const [orgs, depots] = await Promise.all([
      supabase.from('organizations').select('id, city').eq('kind', 'logistic_company').eq('status', 'active').limit(500),
      supabase.from('depots').select('address, carrier_org_id').limit(500),
    ]);
    if (orgs.error) throw new Error(`Failed to read cities: ${orgs.error.message}`);
    if (depots.error) throw new Error(`Failed to read cities: ${depots.error.message}`);
    const activeIds = new Set((orgs.data ?? []).map((o: any) => o.id));
    const names = new Map<string, string>();
    const add = (c: string | null) => { if (c && !names.has(normalizePlace(c))) names.set(normalizePlace(c), c); };
    for (const o of orgs.data ?? []) add(cityFromAddress((o as any).city));
    for (const d of depots.data ?? []) if (activeIds.has((d as any).carrier_org_id)) add(cityFromAddress((d as any).address));
    const needle = q.data.q ? normalizePlace(q.data.q) : '';
    const cities = [...names.entries()].filter(([k]) => k.includes(needle)).map(([, v]) => v).sort().slice(0, PUBLIC_LIMIT);
    res.set('Cache-Control', PUBLIC_CACHE);
    res.json({ cities });
  } catch (e: any) {
    sendError(req, res, e);
  }
});

export default router;
