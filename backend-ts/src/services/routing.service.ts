/**
 * margixindia — Truck route planning
 *
 * planRoute() asks TomTom Routing (travelMode=truck) for up to three routes for a vehicle,
 * with live or predicted traffic, and falls back to Mapbox Directions (car routing, no truck
 * restrictions) when TomTom is not set up or fails. optimizeStopOrder() asks TomTom for the best
 * order of the stops between a fixed start and end. The key stays on the server.
 *
 * Everything that turns a provider's answer into our shape, and the fuel and pickup-before-drop
 * rules, are plain functions so they are tested without a network.
 */
import { OWNED, scopeQuery } from '../core/org-scope';
import { createHash } from 'crypto';
import { settings } from '../core/config';
import { supabase } from '../core/supabase';
import { cacheGet, cacheSet } from '../core/redis';
import { externalHttp } from '../core/http';
import { HttpError } from '../core/errors';
import { haversineKm, isValidPoint } from './geo';
import { sortDeliveryPoints } from '../core/destination';

// ── Types ──────────────────────────────────────────────────

export interface PlanPoint { lat: number; lng: number; name?: string | null }
export type StopKind = 'pickup' | 'drop' | 'stop';
export interface PlanStop extends PlanPoint {
  /** Client key, so the order can be reported back. */
  id?: string;
  /** The shipment or load this stop belongs to; a pickup must come before its drops. */
  shipment_id?: string | null;
  kind?: StopKind;
}

export interface AvoidOptions { tolls: boolean; highways: boolean; ferries: boolean; unpaved: boolean }

export interface TruckProfile {
  /** Gross weight in kg (kerb plus load); null when the kerb weight is not known. */
  weight_kg: number | null;
  length_m: number | null;
  width_m: number | null;
  height_m: number | null;
}

export interface TrafficSection {
  category: string;
  label: string;
  delay_seconds: number;
  length_m: number;
  /** 0 unknown, 1 minor, 2 moderate, 3 major */
  magnitude: number;
  effective_speed_kmh: number | null;
  /** [lng, lat] pairs, thinned. */
  coordinates: [number, number][];
}

export interface RouteLeg { distance_km: number; travel_minutes: number }

export interface PlannedRoute {
  id: string;
  /** [lng, lat] pairs. */
  geometry: [number, number][];
  distance_km: number;
  /** With traffic at the departure time. */
  travel_minutes: number;
  /** Free-flow time; null when the provider does not say. */
  no_traffic_minutes: number | null;
  traffic_delay_minutes: number | null;
  /** null when the provider does not report tolls. */
  toll_km: number | null;
  arrival_at: string;
  legs: RouteLeg[];
  traffic_sections: TrafficSection[];
}

export interface FuelEstimate {
  litres: number | null;
  cost: number | null;
  price_per_litre: number | null;
  price_source: 'vehicle_log' | 'fleet_average' | null;
  /** Plain-language reason when litres or cost could not be worked out. */
  note: string | null;
}

export type Provider = 'tomtom' | 'mapbox';

interface RawPlan { provider: Provider; truck_aware: boolean; notes: string[]; departure_at: string; routes: PlannedRoute[] }

export interface VehicleForPlan {
  id: string;
  plate_number: string | null;
  status: string | null;
  capacity_kg: number | null;
  current_load_kg: number | null;
  container_length_ft: number | null;
  container_width_ft: number | null;
  container_height_ft: number | null;
  fuel_type: string | null;
  fuel_efficiency_kmpl: number | null;
}

export interface PlanInput {
  origin: PlanPoint;
  destination: PlanPoint;
  stops: PlanStop[];
  vehicle_id?: string | null;
  load_kg?: number | null;
  kerb_weight_kg?: number | null;
  departure_at?: string | null;
  avoid: AvoidOptions;
}

export { MAX_STOPS } from '../schemas/routing';
const FT_TO_M = 0.3048;
const PLAN_CACHE_SECONDS = 120;
const TOMTOM_TIMEOUT_MS = 20_000;
const MAX_GEOMETRY_POINTS = 2500;
const MAX_SECTION_POINTS = 60;
const MAX_TRAFFIC_SECTIONS = 30;
/** Traffic sections shorter in delay than this are not worth listing. */
const MIN_SECTION_DELAY_S = 30;
const FLEET_PRICE_WINDOW_DAYS = 60;

export const isTomTomConfigured = () => !!settings.TOMTOM_API_KEY;
export const isMapboxConfigured = () => !!settings.MAPBOX_ACCESS_TOKEN;

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const positive = (n: unknown): number | null => {
  const v = typeof n === 'number' ? n : typeof n === 'string' && n.trim() ? Number(n) : NaN;
  return Number.isFinite(v) && v > 0 ? v : null;
};

// ── Truck profile ──────────────────────────────────────────

/**
 * What TomTom is told about the truck. Weight is kerb plus load; without a kerb weight there is
 * no honest gross weight, so none is sent and a note says weight limits were not applied.
 */
export function buildTruckProfile(
  vehicle: Pick<VehicleForPlan, 'capacity_kg' | 'current_load_kg' | 'container_length_ft' | 'container_width_ft' | 'container_height_ft'>,
  opts: { load_kg?: number | null; kerb_weight_kg?: number | null } = {},
): { profile: TruckProfile; notes: string[] } {
  const notes: string[] = [];
  const kerb = positive(opts.kerb_weight_kg);
  const load = opts.load_kg != null ? Math.max(0, Number(opts.load_kg)) : (positive(vehicle.current_load_kg) ?? 0);
  let weight: number | null = null;
  if (kerb !== null) weight = Math.round(kerb + load);
  else notes.push('Kerb weight is not set, so weight limits (bridges, roads) were not checked. Enter the kerb weight to include them.');
  const metres = (ft: number | null) => { const f = positive(ft); return f === null ? null : round2(f * FT_TO_M); };
  const profile: TruckProfile = {
    weight_kg: weight,
    length_m: metres(vehicle.container_length_ft),
    width_m: metres(vehicle.container_width_ft),
    height_m: metres(vehicle.container_height_ft),
  };
  if (profile.length_m === null && profile.width_m === null && profile.height_m === null) {
    notes.push('The vehicle has no container size on file, so height and width limits were not checked.');
  }
  const capacity = positive(vehicle.capacity_kg);
  if (capacity !== null && load > capacity) notes.push(`The load (${Math.round(load)} kg) is above the vehicle's capacity (${Math.round(capacity)} kg).`);
  return { profile, notes };
}

// ── Time helpers ───────────────────────────────────────────

/** ISO time with the +05:30 offset, the form TomTom's departAt takes. */
export function toIstOffsetIso(ms: number): string {
  const d = new Date(ms + 5.5 * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}+05:30`;
}

/** The departure to use: a future time as given, otherwise now. */
export function resolveDeparture(departureAt: string | null | undefined, nowMs = Date.now()): { ms: number; isNow: boolean } {
  const t = departureAt ? Date.parse(departureAt) : NaN;
  if (!Number.isFinite(t) || t <= nowMs + 60_000) return { ms: nowMs, isNow: true };
  return { ms: t, isNow: false };
}

// ── Line thinning ──────────────────────────────────────────

/** Approximate distance in metres from p to segment a-b, on a flat plane (fine at this scale). */
function perpendicularM(p: [number, number], a: [number, number], b: [number, number]): number {
  const kx = 111_320 * Math.cos((p[1] * Math.PI) / 180);
  const ky = 110_570;
  const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky;
  const bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function douglasPeucker(points: [number, number][], toleranceM: number): [number, number][] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let far = -1, farD = toleranceM;
    for (let i = s + 1; i < e; i++) {
      const d = perpendicularM(points[i], points[s], points[e]);
      if (d > farD) { far = i; farD = d; }
    }
    if (far !== -1) { keep[far] = 1; stack.push([s, far], [far, e]); }
  }
  return points.filter((_, i) => keep[i]);
}

/** Thins a line to at most `max` points, keeping its shape (Douglas-Peucker with a growing tolerance). */
export function simplifyLine(points: [number, number][], max: number): [number, number][] {
  if (points.length <= max) return points;
  let tolerance = 5;
  let out = points;
  for (let i = 0; i < 12 && out.length > max; i++) {
    out = douglasPeucker(points, tolerance);
    tolerance *= 2;
  }
  if (out.length > max) {
    const stride = Math.ceil(out.length / max);
    out = out.filter((_, i) => i % stride === 0 || i === out.length - 1);
  }
  return out;
}

function lineKm(points: [number, number][]): number {
  let km = 0;
  for (let i = 1; i < points.length; i++) {
    km += haversineKm({ lat: points[i - 1][1], lng: points[i - 1][0] }, { lat: points[i][1], lng: points[i][0] });
  }
  return km;
}

// ── TomTom ─────────────────────────────────────────────────

export interface TomTomQuery {
  points: PlanPoint[];
  profile: TruckProfile;
  avoid: AvoidOptions;
  departAtMs: number | null;
  alternatives: number;
  bestOrder: boolean;
}

export function buildTomTomUrl(q: TomTomQuery, key = settings.TOMTOM_API_KEY): string {
  const locations = q.points.map(p => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join(':');
  const params: [string, string | number][] = [
    ['key', key],
    ['travelMode', 'truck'],
    ['vehicleCommercial', 'true'],
    ['traffic', 'true'],
    ['routeType', 'fastest'],
    ['computeTravelTimeFor', 'all'],
    ['routeRepresentation', 'polyline'],
    ['instructionsType', 'none'],
    ['departAt', q.departAtMs === null ? 'now' : toIstOffsetIso(q.departAtMs)],
    ['sectionType', 'traffic'],
    ['sectionType', 'toll'],
  ];
  if (q.alternatives > 0 && !q.bestOrder) params.push(['maxAlternatives', q.alternatives]);
  if (q.bestOrder) params.push(['computeBestOrder', 'true']);
  if (q.profile.weight_kg) params.push(['vehicleWeight', q.profile.weight_kg]);
  if (q.profile.length_m) params.push(['vehicleLength', q.profile.length_m]);
  if (q.profile.width_m) params.push(['vehicleWidth', q.profile.width_m]);
  if (q.profile.height_m) params.push(['vehicleHeight', q.profile.height_m]);
  if (q.avoid.tolls) params.push(['avoid', 'tollRoads']);
  if (q.avoid.highways) params.push(['avoid', 'motorways']);
  if (q.avoid.ferries) params.push(['avoid', 'ferries']);
  if (q.avoid.unpaved) params.push(['avoid', 'unpavedRoads']);
  const query = params.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
  return `https://api.tomtom.com/routing/1/calculateRoute/${locations}/json?${query}`;
}

const TOMTOM_CATEGORY: Record<string, string> = {
  JAM: 'Traffic jam', ROAD_WORK: 'Road works', ROAD_CLOSURE: 'Road closed', OTHER: 'Slow traffic', RAIN: 'Rain', ICE: 'Ice', WIND: 'Strong wind', FOG: 'Fog',
};

/**
 * TomTom's answer in our shape. Returns the routes and, when computeBestOrder was used, the
 * provided index of the waypoint at each optimized position.
 */
export function parseTomTomRoutes(payload: any, departMs: number): { routes: PlannedRoute[]; order: number[] | null } {
  const raw = Array.isArray(payload?.routes) ? payload.routes : [];
  const routes: PlannedRoute[] = [];
  raw.forEach((r: any, index: number) => {
    const s = r?.summary;
    if (!s || !Number.isFinite(Number(s.lengthInMeters)) || !Number.isFinite(Number(s.travelTimeInSeconds))) return;

    // Legs share their joint point: skip the repeat so section indexes line up with the line
    const full: [number, number][] = [];
    const legs: RouteLeg[] = [];
    (r.legs ?? []).forEach((leg: any, li: number) => {
      const pts: { latitude: number; longitude: number }[] = leg?.points ?? [];
      pts.forEach((p, pi) => {
        if (li > 0 && pi === 0) return;
        if (Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) full.push([p.longitude, p.latitude]);
      });
      legs.push({
        distance_km: round1(Number(leg?.summary?.lengthInMeters ?? 0) / 1000),
        travel_minutes: Math.round(Number(leg?.summary?.travelTimeInSeconds ?? 0) / 60),
      });
    });
    if (full.length < 2) return;

    const trafficSections: TrafficSection[] = [];
    let tollKm = 0;
    let sawTollSection = false;
    for (const sec of r.sections ?? []) {
      const a = Number(sec.startPointIndex), b = Number(sec.endPointIndex);
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b >= full.length || b < a) continue;
      const line = full.slice(a, b + 1);
      if (sec.sectionType === 'TOLL') {
        sawTollSection = true;
        tollKm += lineKm(line);
      } else if (sec.sectionType === 'TRAFFIC') {
        const delay = Number(sec.delayInSeconds ?? 0);
        const category = String(sec.simpleCategory ?? 'OTHER');
        if (delay < MIN_SECTION_DELAY_S && category !== 'ROAD_CLOSURE') continue;
        trafficSections.push({
          category,
          label: TOMTOM_CATEGORY[category] ?? 'Slow traffic',
          delay_seconds: Math.round(delay),
          length_m: Math.round(lineKm(line) * 1000),
          magnitude: Number.isFinite(Number(sec.magnitudeOfDelay)) ? Math.min(3, Math.max(0, Number(sec.magnitudeOfDelay))) : 0,
          effective_speed_kmh: Number.isFinite(Number(sec.effectiveSpeedInKmh)) ? Math.round(Number(sec.effectiveSpeedInKmh)) : null,
          coordinates: simplifyLine(line, MAX_SECTION_POINTS),
        });
      }
    }
    trafficSections.sort((x, y) => y.delay_seconds - x.delay_seconds);

    const travelS = Number(s.travelTimeInSeconds);
    const noTrafficS = Number.isFinite(Number(s.noTrafficTravelTimeInSeconds)) ? Number(s.noTrafficTravelTimeInSeconds) : null;
    const delayS = Number.isFinite(Number(s.trafficDelayInSeconds)) ? Number(s.trafficDelayInSeconds) : (noTrafficS !== null ? Math.max(0, travelS - noTrafficS) : null);
    const arrivalMs = Date.parse(String(s.arrivalTime ?? ''));

    routes.push({
      id: `r${index}`,
      geometry: simplifyLine(full, MAX_GEOMETRY_POINTS),
      distance_km: round1(Number(s.lengthInMeters) / 1000),
      travel_minutes: Math.round(travelS / 60),
      no_traffic_minutes: noTrafficS === null ? null : Math.round(noTrafficS / 60),
      traffic_delay_minutes: delayS === null ? null : Math.round(delayS / 60),
      // TomTom lists toll sections when there are any; no sections means a toll-free route
      toll_km: sawTollSection ? round1(tollKm) : 0,
      arrival_at: new Date(Number.isFinite(arrivalMs) ? arrivalMs : departMs + travelS * 1000).toISOString(),
      legs,
      traffic_sections: trafficSections.slice(0, MAX_TRAFFIC_SECTIONS),
    });
  });

  let order: number[] | null = null;
  const opt = payload?.optimizedWaypoints;
  if (Array.isArray(opt) && opt.length > 0) {
    const byOptimized: number[] = [];
    for (const w of opt) {
      if (Number.isInteger(w?.providedIndex) && Number.isInteger(w?.optimizedIndex)) byOptimized[w.optimizedIndex] = w.providedIndex;
    }
    const valid = byOptimized.length === opt.length
      && byOptimized.every(v => Number.isInteger(v))
      && new Set(byOptimized).size === opt.length
      && byOptimized.every(v => v >= 0 && v < opt.length);
    if (valid) order = byOptimized;
  }
  return { routes, order };
}

// ── Mapbox fallback ────────────────────────────────────────

export function buildMapboxUrl(points: PlanPoint[], avoid: AvoidOptions, departMs: number | null, token = settings.MAPBOX_ACCESS_TOKEN): string {
  // driving-traffic takes at most 3 coordinates; longer trips use the plain driving profile
  const traffic = points.length <= 3;
  const profile = traffic ? 'driving-traffic' : 'driving';
  const coords = points.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const params: [string, string][] = [
    ['alternatives', points.length === 2 ? 'true' : 'false'],
    ['geometries', 'geojson'],
    ['overview', 'full'],
    ['steps', 'false'],
    ['access_token', token],
  ];
  const exclude = [avoid.tolls && 'toll', avoid.highways && 'motorway', avoid.ferries && 'ferry', avoid.unpaved && 'unpaved'].filter(Boolean) as string[];
  if (exclude.length) params.push(['exclude', exclude.join(',')]);
  if (traffic && departMs !== null) params.push(['depart_at', new Date(departMs).toISOString().replace(/\.\d{3}Z$/, 'Z')]);
  return `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coords}?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}

export function parseMapboxRoutes(payload: any, departMs: number): PlannedRoute[] {
  const routes: PlannedRoute[] = [];
  (Array.isArray(payload?.routes) ? payload.routes : []).forEach((r: any, index: number) => {
    const coords: [number, number][] = (r?.geometry?.coordinates ?? []).filter((c: any) => Array.isArray(c) && c.length >= 2);
    if (!Number.isFinite(Number(r?.distance)) || !Number.isFinite(Number(r?.duration)) || coords.length < 2) return;
    const typical = Number.isFinite(Number(r.duration_typical)) ? Number(r.duration_typical) : null;
    routes.push({
      id: `r${index}`,
      geometry: simplifyLine(coords, MAX_GEOMETRY_POINTS),
      distance_km: round1(Number(r.distance) / 1000),
      travel_minutes: Math.round(Number(r.duration) / 60),
      no_traffic_minutes: null,
      // Measured against typical traffic for that time, which is what Mapbox reports
      traffic_delay_minutes: typical === null ? null : Math.max(0, Math.round((Number(r.duration) - typical) / 60)),
      toll_km: null,
      arrival_at: new Date(departMs + Number(r.duration) * 1000).toISOString(),
      legs: (r.legs ?? []).map((l: any) => ({ distance_km: round1(Number(l?.distance ?? 0) / 1000), travel_minutes: Math.round(Number(l?.duration ?? 0) / 60) })),
      traffic_sections: [],
    });
  });
  return routes;
}

// ── Fuel ───────────────────────────────────────────────────

/** Litres and cost for a distance. Cost needs a logged price; litres need the vehicle's km per litre. */
export function estimateFuel(
  distanceKm: number,
  kmpl: number | null | undefined,
  price: { price_per_litre: number; source: 'vehicle_log' | 'fleet_average' } | null,
): FuelEstimate {
  const eff = positive(kmpl);
  if (eff === null) {
    return { litres: null, cost: null, price_per_litre: price?.price_per_litre ?? null, price_source: price?.source ?? null, note: 'This vehicle has no fuel efficiency (km per litre) on file, so fuel cannot be estimated.' };
  }
  const litres = round1(distanceKm / eff);
  if (!price) {
    return { litres, cost: null, price_per_litre: null, price_source: null, note: 'No fuel price has been logged yet, so only litres are shown.' };
  }
  return { litres, cost: round2(litres * price.price_per_litre), price_per_litre: price.price_per_litre, price_source: price.source, note: null };
}

/**
 * The fuel price to use: the vehicle's latest logged price per litre, otherwise the average of
 * recent fills across the fleet for the same fuel type. Null when nothing has been logged.
 */
export async function resolveFuelPrice(vehicleId: string, fuelType: string | null, now = Date.now()): Promise<{ price_per_litre: number; source: 'vehicle_log' | 'fleet_average' } | null> {
  const { data: own, error } = await supabase
    .from('vehicle_fuel_logs')
    .select('price_per_litre, filled_at')
    .eq('vehicle_id', vehicleId)
    .order('filled_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  const latest = positive(own?.[0]?.price_per_litre);
  if (latest !== null) return { price_per_litre: round2(latest), source: 'vehicle_log' };

  let sameFuel = scopeQuery(supabase.from('vehicles').select('id'), OWNED.carrier);
  if (fuelType) sameFuel = sameFuel.eq('fuel_type', fuelType);
  const { data: peers, error: peersErr } = await sameFuel.limit(1000);
  if (peersErr) throw peersErr;
  const ids = (peers ?? []).map((v: any) => v.id);
  if (ids.length === 0) return null;
  const since = new Date(now - FLEET_PRICE_WINDOW_DAYS * 86_400_000).toISOString();
  const { data: fills, error: fillsErr } = await supabase
    .from('vehicle_fuel_logs')
    .select('price_per_litre, litres')
    .in('vehicle_id', ids)
    .gte('filled_at', since)
    .limit(2000);
  if (fillsErr) throw fillsErr;
  return averagePrice((fills ?? []) as { price_per_litre: unknown; litres: unknown }[]);
}

/** Litre-weighted average price of some fills, or null when there are none. */
export function averagePrice(fills: { price_per_litre: unknown; litres: unknown }[]): { price_per_litre: number; source: 'fleet_average' } | null {
  let litres = 0, spend = 0;
  for (const f of fills) {
    const p = positive(f.price_per_litre), l = positive(f.litres);
    if (p === null || l === null) continue;
    litres += l; spend += p * l;
  }
  return litres > 0 ? { price_per_litre: round2(spend / litres), source: 'fleet_average' } : null;
}

// ── Pickup before drop ─────────────────────────────────────

/**
 * Checks an order of stops (indexes into `stops`): every drop of a shipment must come after its
 * pickup. Returns a sentence naming the first broken pair, or null when the order is fine.
 */
export function pickupDropViolation(stops: PlanStop[], order: number[]): string | null {
  const position = new Map<number, number>();
  order.forEach((stopIndex, pos) => position.set(stopIndex, pos));
  for (let i = 0; i < stops.length; i++) {
    const drop = stops[i];
    if (drop.kind !== 'drop' || !drop.shipment_id) continue;
    for (let j = 0; j < stops.length; j++) {
      const pickup = stops[j];
      if (pickup.kind !== 'pickup' || pickup.shipment_id !== drop.shipment_id) continue;
      if ((position.get(j) ?? -1) > (position.get(i) ?? -1)) {
        return `${drop.name || 'A drop'} would come before its pickup${pickup.name ? ` (${pickup.name})` : ''}.`;
      }
    }
  }
  return null;
}

// ── Provider calls ─────────────────────────────────────────

const httpStatus = (e: unknown): number | null => {
  const s = (e as { status?: unknown })?.status;
  return typeof s === 'number' ? s : null;
};

async function callTomTom(q: TomTomQuery): Promise<any> {
  return externalHttp.getJson<any>(buildTomTomUrl(q), TOMTOM_TIMEOUT_MS);
}

/** TomTom routes for the trip; retries without alternatives when TomTom refuses them for this trip. */
async function tomTomRoutes(q: TomTomQuery, departMs: number): Promise<{ routes: PlannedRoute[]; notes: string[] }> {
  const notes: string[] = [];
  let payload: any;
  try {
    payload = await callTomTom(q);
  } catch (e) {
    if (q.alternatives > 0 && httpStatus(e) === 400) {
      payload = await callTomTom({ ...q, alternatives: 0 });
      notes.push('TomTom offered no alternative routes for this trip.');
    } else {
      throw e;
    }
  }
  const { routes } = parseTomTomRoutes(payload, departMs);
  if (routes.length === 0) throw Object.assign(new Error('TomTom returned no route'), { status: 404 });
  return { routes, notes };
}

async function mapboxRoutes(points: PlanPoint[], avoid: AvoidOptions, departMs: number, isNow: boolean): Promise<PlannedRoute[]> {
  const payload = await externalHttp.getJson<any>(buildMapboxUrl(points, avoid, isNow ? null : departMs), 15_000);
  const routes = parseMapboxRoutes(payload, departMs);
  if (routes.length === 0) throw Object.assign(new Error('Mapbox returned no route'), { status: 404 });
  return routes;
}

export const NO_ROUTING_MESSAGE = 'Trip planning is not set up. Ask an administrator to add a TomTom or Mapbox key to the server.';

function planCacheKey(input: PlanInput, profile: TruckProfile, isNow: boolean, departMs: number): string {
  const body = JSON.stringify({
    o: [input.origin.lat, input.origin.lng], d: [input.destination.lat, input.destination.lng],
    s: input.stops.map(s => [s.lat, s.lng]), a: input.avoid, p: profile, t: isNow ? 'now' : departMs,
    tt: isTomTomConfigured(), mb: isMapboxConfigured(),
  });
  return `routing:plan:${createHash('sha256').update(body).digest('hex').slice(0, 40)}`;
}

export async function loadVehicleForPlan(vehicleId: string): Promise<VehicleForPlan> {
  // Another company's vehicle is a 404, the same as one that does not exist
  const { data, error } = await scopeQuery(supabase
    .from('vehicles')
    .select('id, plate_number, status, capacity_kg, current_load_kg, container_length_ft, container_width_ft, container_height_ft, fuel_type, fuel_efficiency_kmpl')
    .eq('id', vehicleId), OWNED.carrier)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'Vehicle not found');
  const v = data as any;
  return {
    id: v.id, plate_number: v.plate_number ?? null, status: v.status ?? null,
    capacity_kg: positive(v.capacity_kg), current_load_kg: positive(v.current_load_kg),
    container_length_ft: positive(v.container_length_ft), container_width_ft: positive(v.container_width_ft), container_height_ft: positive(v.container_height_ft),
    fuel_type: v.fuel_type ?? null, fuel_efficiency_kmpl: positive(v.fuel_efficiency_kmpl),
  };
}

export interface PlanResult extends RawPlan {
  vehicle: { id: string; plate_number: string | null; fuel_type: string | null; fuel_efficiency_kmpl: number | null } | null;
  truck_profile: TruckProfile | null;
  routes: (PlannedRoute & { fuel: FuelEstimate | null })[];
  cached: boolean;
}

const allPoints = (input: PlanInput): PlanPoint[] => [input.origin, ...input.stops, input.destination];

/** Plans the trip: TomTom for trucks, Mapbox (car routing) when TomTom is missing or fails. */
export async function planRoute(input: PlanInput): Promise<PlanResult> {
  if (!isTomTomConfigured() && !isMapboxConfigured()) throw new HttpError(503, NO_ROUTING_MESSAGE);
  for (const p of allPoints(input)) if (!isValidPoint(p)) throw new HttpError(400, 'Every place needs a valid location.');

  const vehicle = input.vehicle_id ? await loadVehicleForPlan(input.vehicle_id) : null;
  const truck = vehicle
    ? buildTruckProfile(vehicle, { load_kg: input.load_kg, kerb_weight_kg: input.kerb_weight_kg })
    : { profile: { weight_kg: null, length_m: null, width_m: null, height_m: null } as TruckProfile, notes: ['No vehicle was chosen, so the truck size and weight were not considered.'] };
  const { ms: departMs, isNow } = resolveDeparture(input.departure_at);

  const key = planCacheKey(input, truck.profile, isNow, departMs);
  let raw = await cacheGet<RawPlan>(key);
  const cached = !!raw;
  if (!raw) {
    raw = await fetchPlan(input, truck.profile, truck.notes, departMs, isNow);
    await cacheSet(key, raw, PLAN_CACHE_SECONDS);
  }

  const price = vehicle ? await resolveFuelPrice(vehicle.id, vehicle.fuel_type) : null;
  return {
    ...raw,
    vehicle: vehicle && { id: vehicle.id, plate_number: vehicle.plate_number, fuel_type: vehicle.fuel_type, fuel_efficiency_kmpl: vehicle.fuel_efficiency_kmpl },
    truck_profile: vehicle ? truck.profile : null,
    routes: raw.routes.map(r => ({ ...r, fuel: vehicle ? estimateFuel(r.distance_km, vehicle.fuel_efficiency_kmpl, price) : null })),
    cached,
  };
}

async function fetchPlan(input: PlanInput, profile: TruckProfile, profileNotes: string[], departMs: number, isNow: boolean): Promise<RawPlan> {
  const points = allPoints(input);
  const notes = [...profileNotes];
  let tomtomProblem: string | null = null;

  if (isTomTomConfigured()) {
    try {
      const r = await tomTomRoutes({ points, profile, avoid: input.avoid, departAtMs: isNow ? null : departMs, alternatives: 2, bestOrder: false }, departMs);
      return { provider: 'tomtom', truck_aware: true, notes: [...notes, ...r.notes], departure_at: new Date(departMs).toISOString(), routes: r.routes };
    } catch (e) {
      const status = httpStatus(e);
      console.warn('[routing] TomTom failed:', (e as Error).message);
      tomtomProblem = status === 400 || status === 404
        ? 'TomTom could not find a truck route for these places and this truck.'
        : 'TomTom could not be reached.';
      if (!isMapboxConfigured()) {
        if (status === 400 || status === 404) throw new HttpError(422, `${tomtomProblem} Check the places and the vehicle size, or try avoiding fewer road types.`);
        throw new HttpError(502, `${tomtomProblem} Try again in a moment.`);
      }
    }
  }

  try {
    const routes = await mapboxRoutes(points, input.avoid, departMs, isNow);
    const why = tomtomProblem ?? 'TomTom is not set up.';
    const fallbackNotes = [
      `${why} These routes come from Mapbox and do not consider truck restrictions (weight, height, width or truck-banned roads).`,
    ];
    if (points.length > 3) fallbackNotes.push('With more than one stop, Mapbox times use typical speeds rather than live traffic.');
    return { provider: 'mapbox', truck_aware: false, notes: [...notes, ...fallbackNotes], departure_at: new Date(departMs).toISOString(), routes };
  } catch (e) {
    console.warn('[routing] Mapbox failed:', (e as Error).message);
    const status = httpStatus(e);
    if (status === 400 || status === 404 || status === 422) throw new HttpError(422, 'No drivable route was found between these places.');
    throw new HttpError(502, 'Route services could not be reached. Try again in a moment.');
  }
}

// ── Stop order ─────────────────────────────────────────────

export interface OrderResult {
  /** New order as indexes into the entered stops. */
  order: number[];
  changed: boolean;
  /** false when the best order was not applied (see reason). */
  applicable: boolean;
  reason: string | null;
  entered: { distance_km: number; travel_minutes: number };
  optimized: { distance_km: number; travel_minutes: number };
  saved_km: number;
  saved_minutes: number;
  route: PlannedRoute;
}

/** Asks TomTom for the best order of the stops between the fixed start and end. */
export async function optimizeStopOrder(input: PlanInput): Promise<OrderResult> {
  if (!isTomTomConfigured()) throw new HttpError(503, 'Stop-order optimization needs TomTom, which is not set up on the server.');
  if (input.stops.length < 2) throw new HttpError(400, 'Add at least two stops to reorder.');
  for (const p of allPoints(input)) if (!isValidPoint(p)) throw new HttpError(400, 'Every place needs a valid location.');

  const vehicle = input.vehicle_id ? await loadVehicleForPlan(input.vehicle_id) : null;
  const profile = vehicle ? buildTruckProfile(vehicle, { load_kg: input.load_kg, kerb_weight_kg: input.kerb_weight_kg }).profile : { weight_kg: null, length_m: null, width_m: null, height_m: null };
  const { ms: departMs, isNow } = resolveDeparture(input.departure_at);
  const base = { profile, avoid: input.avoid, departAtMs: isNow ? null : departMs, alternatives: 0 };
  const points = allPoints(input);

  let enteredPayload: any, bestPayload: any;
  try {
    [enteredPayload, bestPayload] = await Promise.all([
      callTomTom({ ...base, points, bestOrder: false }),
      callTomTom({ ...base, points, bestOrder: true }),
    ]);
  } catch (e) {
    console.warn('[routing] TomTom order optimization failed:', (e as Error).message);
    if (httpStatus(e) === 400) throw new HttpError(422, 'TomTom could not reorder these stops. Check that every place is on a road, or try fewer stops.');
    throw new HttpError(502, 'TomTom could not be reached. Try again in a moment.');
  }

  const entered = parseTomTomRoutes(enteredPayload, departMs).routes[0];
  const best = parseTomTomRoutes(bestPayload, departMs);
  if (!entered || !best.routes[0] || !best.order || best.order.length !== input.stops.length) {
    throw new HttpError(502, 'TomTom did not return a usable stop order. Try again.');
  }

  const violation = pickupDropViolation(input.stops, best.order);
  const identity = input.stops.map((_, i) => i);
  const changed = best.order.some((v, i) => v !== identity[i]);
  const enteredSummary = { distance_km: entered.distance_km, travel_minutes: entered.travel_minutes };

  if (violation) {
    return {
      order: identity, changed: false, applicable: false,
      reason: `The fastest order was not used because ${violation.charAt(0).toLowerCase()}${violation.slice(1)} Your order was kept.`,
      entered: enteredSummary, optimized: enteredSummary, saved_km: 0, saved_minutes: 0, route: entered,
    };
  }
  const opt = best.routes[0];
  return {
    order: best.order, changed, applicable: true, reason: null,
    entered: enteredSummary,
    optimized: { distance_km: opt.distance_km, travel_minutes: opt.travel_minutes },
    saved_km: round1(entered.distance_km - opt.distance_km),
    saved_minutes: entered.travel_minutes - opt.travel_minutes,
    route: opt,
  };
}

// ── Open loads to pick stops from ──────────────────────────

export interface OpenLoadPoint { delivery_point_id: string | null; name: string; address: string | null; lat: number; lng: number }
export interface OpenLoad {
  id: string;
  kind: 'shipment' | 'load';
  reference: string;
  weight_kg: number | null;
  pickup: OpenLoadPoint | null;
  drops: OpenLoadPoint[];
}

const point = (id: string | null, name: unknown, address: unknown, lat: unknown, lng: unknown): OpenLoadPoint | null => {
  const p = { lat: Number(lat), lng: Number(lng) };
  if (!isValidPoint(p)) return null;
  return { delivery_point_id: id, name: String(name || address || 'Unnamed place'), address: address ? String(address) : null, ...p };
};

/** Shipments waiting for a vehicle and vendor loads waiting to be picked up, with their real pickup and drop points. */
export async function listOpenLoads(): Promise<OpenLoad[]> {
  const { data: shipments, error } = await scopeQuery(supabase
    .from('shipments')
    .select('id, tracking_id, origin_name, origin_address, origin_lat, origin_lng, total_weight_kg, created_at, delivery_points!delivery_points_shipment_id_fkey(id, name, address, latitude, longitude, created_at)'), OWNED.carrier)
    .in('status', ['created', 'exception'])
    .neq('is_master', true)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  const out: OpenLoad[] = [];
  for (const s of (shipments ?? []) as any[]) {
    const drops = sortDeliveryPoints<any>(s.delivery_points)
      .map(d => point(d.id, d.name, d.address, d.latitude, d.longitude))
      .filter((d): d is OpenLoadPoint => !!d);
    const pickup = point(null, s.origin_name, s.origin_address, s.origin_lat, s.origin_lng);
    if (!pickup && drops.length === 0) continue;
    out.push({ id: s.id, kind: 'shipment', reference: s.tracking_id || String(s.id).slice(0, 8), weight_kg: positive(s.total_weight_kg), pickup, drops });
  }

  const { data: manifests, error: mErr } = await scopeQuery(supabase
    .from('cargo_manifest')
    .select('id, pickup_location, pickup_lat, pickup_lng, drop_location, drop_lat, drop_lng, capacity_kg, status, created_at'), OWNED.carrier)
    .eq('status', 'scheduled')
    .neq('is_master', true)
    .order('created_at', { ascending: false })
    .limit(100);
  if (mErr) throw mErr;
  for (const m of (manifests ?? []) as any[]) {
    const pickup = point(null, m.pickup_location, m.pickup_location, m.pickup_lat, m.pickup_lng);
    const drop = point(null, m.drop_location, m.drop_location, m.drop_lat, m.drop_lng);
    if (!pickup && !drop) continue;
    out.push({ id: m.id, kind: 'load', reference: `Load ${String(m.id).slice(0, 8).toUpperCase()}`, weight_kg: positive(m.capacity_kg), pickup, drops: drop ? [drop] : [] });
  }
  return out;
}
