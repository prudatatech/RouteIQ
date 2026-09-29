/**
 * margixindia — Traffic incidents along active routes (TomTom)
 *
 * refreshTrafficIncidents() reads TomTom Traffic Incidents inside the bounding
 * boxes of every active route, stores them in `traffic_incidents`, and raises a
 * reroute suggestion (the same cache that /optimize/incubate and the insights
 * list use) for each active route whose path an incident sits on.
 */
import { settings } from '../core/config';
import { supabase } from '../core/supabase';
import { cacheGet, cacheSet } from '../core/redis';
import { externalHttp } from '../core/http';
import { distanceToPathKm, isValidPoint, LatLng } from './geo';
import { mergeRerouteSuggestions, evaluateReroute, RerouteSuggestion } from './reroute.service';

/** An incident counts as "on the route" when it is within this distance of the route's path. */
export const INCIDENT_ROUTE_RADIUS_KM = 2;
/** Widest bounding box side (degrees, about 90 km) sent to TomTom in one request. */
const TILE_DEG = 0.8;
const BBOX_PAD_DEG = 0.03;
const MAX_TILES = 60;
const STATUS_KEY = 'traffic:last_run';

const CATEGORY_LABEL: Record<number, string> = {
  0: 'Traffic incident', 1: 'Accident', 2: 'Fog', 3: 'Dangerous conditions', 4: 'Heavy rain', 5: 'Ice on the road',
  6: 'Traffic jam', 7: 'Lane closed', 8: 'Road closed', 9: 'Road works', 10: 'Strong wind', 11: 'Flooding',
  14: 'Broken-down vehicle',
};

export interface TrafficIncident {
  id: string;
  type: string;
  severity: number;
  description: string | null;
  road: string | null;
  lat: number;
  lng: number;
  geometry: unknown;
  delay_seconds: number | null;
  starts_at: string | null;
  ends_at: string | null;
}

export interface TrafficRunSummary {
  configured: boolean;
  ran_at: string;
  routes_checked: number;
  incidents_found: number;
  suggestions_created: number;
  errors: number;
}

export function isTrafficConfigured(): boolean {
  return !!settings.TOMTOM_API_KEY;
}

/** Plain-language cause, e.g. "Accident on NH48, +25 min". */
export function describeIncident(i: Pick<TrafficIncident, 'type' | 'road' | 'delay_seconds'>): string {
  const on = i.road ? ` on ${i.road}` : '';
  const delay = i.delay_seconds && i.delay_seconds >= 60 ? `, +${Math.round(i.delay_seconds / 60)} min` : '';
  return `${i.type}${on}${delay}`;
}

export function parseTomTomIncidents(payload: any): TrafficIncident[] {
  const out: TrafficIncident[] = [];
  for (const item of payload?.incidents ?? []) {
    const props = item?.properties;
    const geom = item?.geometry;
    if (!props?.id || !geom?.coordinates) continue;
    const coords: number[][] = geom.type === 'Point' ? [geom.coordinates] : geom.coordinates;
    const mid = coords[Math.floor(coords.length / 2)];
    if (!Array.isArray(mid) || mid.length < 2) continue;
    const road = Array.isArray(props.roadNumbers) && props.roadNumbers.length > 0
      ? String(props.roadNumbers[0])
      : (props.from ? String(props.from) : null);
    const category = typeof props.iconCategory === 'number' ? props.iconCategory : 0;
    out.push({
      id: String(props.id),
      type: CATEGORY_LABEL[category] ?? CATEGORY_LABEL[0],
      severity: typeof props.magnitudeOfDelay === 'number' ? props.magnitudeOfDelay : 0,
      description: props.events?.[0]?.description ?? null,
      road,
      lat: mid[1],
      lng: mid[0],
      geometry: geom,
      delay_seconds: typeof props.delay === 'number' ? props.delay : null,
      starts_at: props.startTime ?? null,
      ends_at: props.endTime ?? null,
    });
  }
  return out;
}

interface ActiveRoute { id: string; vehicle_id: string; path: LatLng[]; plate: string | null }

async function loadActiveRoutes(): Promise<ActiveRoute[]> {
  const { data, error } = await supabase
    .from('routes')
    .select('id, vehicle_id, vehicles(plate_number, latitude, longitude), route_stops(sequence, status, delivery_points(latitude, longitude))')
    .eq('status', 'active');
  if (error) throw new Error(error.message);
  const routes: ActiveRoute[] = [];
  for (const r of (data ?? []) as any[]) {
    const path: LatLng[] = [];
    const vehicle = { lat: Number(r.vehicles?.latitude), lng: Number(r.vehicles?.longitude) };
    if (isValidPoint(vehicle)) path.push(vehicle);
    const stops = (r.route_stops ?? []).filter((s: any) => s.status === 'pending').sort((a: any, b: any) => a.sequence - b.sequence);
    for (const s of stops) {
      const p = { lat: Number(s.delivery_points?.latitude), lng: Number(s.delivery_points?.longitude) };
      if (isValidPoint(p)) path.push(p);
    }
    if (path.length >= 2) routes.push({ id: r.id, vehicle_id: r.vehicle_id, path, plate: r.vehicles?.plate_number ?? null });
  }

  // Vendor loads on the road are routes too: truck (or pickup, before it has a position) to drop.
  const { data: loads, error: loadsErr } = await supabase
    .from('cargo_manifest')
    .select('id, vehicle_id, pickup_lat, pickup_lng, drop_lat, drop_lng, vehicles(plate_number, latitude, longitude)')
    .eq('status', 'in_transit');
  if (loadsErr) throw new Error(loadsErr.message);
  for (const m of (loads ?? []) as any[]) {
    if (!m.vehicle_id) continue;
    const truck = { lat: Number(m.vehicles?.latitude), lng: Number(m.vehicles?.longitude) };
    const start = isValidPoint(truck) ? truck : { lat: Number(m.pickup_lat), lng: Number(m.pickup_lng) };
    const drop = { lat: Number(m.drop_lat), lng: Number(m.drop_lng) };
    if (isValidPoint(start) && isValidPoint(drop)) {
      routes.push({ id: m.id, vehicle_id: m.vehicle_id, path: [start, drop], plate: m.vehicles?.plate_number ?? null });
    }
  }
  return routes;
}

/** Bounding boxes (minLng,minLat,maxLng,maxLat) covering a path in pieces small enough for TomTom. */
export function tilesForPath(path: LatLng[]): [number, number, number, number][] {
  const tiles = new Map<string, [number, number, number, number]>();
  const add = (a: LatLng, b: LatLng) => {
    const t: [number, number, number, number] = [
      Math.min(a.lng, b.lng) - BBOX_PAD_DEG, Math.min(a.lat, b.lat) - BBOX_PAD_DEG,
      Math.max(a.lng, b.lng) + BBOX_PAD_DEG, Math.max(a.lat, b.lat) + BBOX_PAD_DEG,
    ];
    tiles.set(t.map(n => n.toFixed(3)).join(','), t);
  };
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b.lat - a.lat), Math.abs(b.lng - a.lng)) / TILE_DEG));
    for (let s = 0; s < steps; s++) {
      const p = { lat: a.lat + ((b.lat - a.lat) * s) / steps, lng: a.lng + ((b.lng - a.lng) * s) / steps };
      const q = { lat: a.lat + ((b.lat - a.lat) * (s + 1)) / steps, lng: a.lng + ((b.lng - a.lng) * (s + 1)) / steps };
      add(p, q);
    }
  }
  return [...tiles.values()];
}

const FIELDS = '{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code,iconCategory},startTime,endTime,from,to,length,delay,roadNumbers,timeValidity}}}';

async function fetchTile(bbox: [number, number, number, number]): Promise<TrafficIncident[]> {
  const url = `https://api.tomtom.com/traffic/services/5/incidentDetails?key=${encodeURIComponent(settings.TOMTOM_API_KEY)}`
    + `&bbox=${bbox.map(n => n.toFixed(4)).join(',')}&fields=${encodeURIComponent(FIELDS)}&language=en-GB&timeValidityFilter=present`;
  return parseTomTomIncidents(await externalHttp.getJson<any>(url, 15000));
}

function incidentPoints(i: TrafficIncident): LatLng[] {
  const g = i.geometry as { type?: string; coordinates?: any } | null;
  if (g?.type === 'LineString' && Array.isArray(g.coordinates)) {
    const pts = g.coordinates.map((c: number[]) => ({ lat: c[1], lng: c[0] })).filter(isValidPoint);
    if (pts.length) return pts;
  }
  return [{ lat: i.lat, lng: i.lng }];
}

export function routesAffectedBy(i: TrafficIncident, routes: ActiveRoute[]): ActiveRoute[] {
  const pts = incidentPoints(i);
  return routes.filter(r => pts.some(p => distanceToPathKm(p, r.path) <= INCIDENT_ROUTE_RADIUS_KM));
}

export async function getLastTrafficRun(): Promise<TrafficRunSummary | null> {
  return cacheGet<TrafficRunSummary>(STATUS_KEY);
}

let running = false;

export async function refreshTrafficIncidents(): Promise<TrafficRunSummary> {
  const ranAt = new Date().toISOString();
  if (!isTrafficConfigured()) return { configured: false, ran_at: ranAt, routes_checked: 0, incidents_found: 0, suggestions_created: 0, errors: 0 };
  if (running) return (await getLastTrafficRun()) ?? { configured: true, ran_at: ranAt, routes_checked: 0, incidents_found: 0, suggestions_created: 0, errors: 0 };
  running = true;
  try {
    const routes = await loadActiveRoutes();
    let errors = 0;
    const found = new Map<string, TrafficIncident>();

    const tiles = new Map<string, [number, number, number, number]>();
    for (const r of routes) for (const t of tilesForPath(r.path)) tiles.set(t.map(n => n.toFixed(3)).join(','), t);
    const tileList = [...tiles.values()].slice(0, MAX_TILES);
    for (const t of tileList) {
      try {
        for (const inc of await fetchTile(t)) found.set(inc.id, inc);
      } catch (e) {
        errors++;
        console.warn('[traffic] TomTom request failed:', (e as Error).message);
      }
    }

    const suggestions: RerouteSuggestion[] = [];
    const now = new Date().toISOString();
    for (const inc of found.values()) {
      const affected = routesAffectedBy(inc, routes);
      const { error } = await supabase.from('traffic_incidents').upsert({
        id: inc.id, type: inc.type, severity: inc.severity, description: inc.description, road: inc.road,
        lat: inc.lat, lng: inc.lng, geometry: inc.geometry, delay_seconds: inc.delay_seconds,
        starts_at: inc.starts_at, ends_at: inc.ends_at,
        affected_route_ids: affected.map(r => r.id), active: true, last_seen_at: now,
      });
      if (error) { errors++; console.error('[traffic] Could not store incident:', error.message); continue; }

      const delayMin = inc.delay_seconds ? Math.round(inc.delay_seconds / 60) : 0;
      if (delayMin < settings.TRAFFIC_MIN_DELAY_MINUTES && inc.severity < 3) continue;
      for (const r of affected) {
        const decision = await evaluateReroute(r.vehicle_id);
        suggestions.push({
          vehicle_id: r.vehicle_id,
          route_id: r.id,
          trigger: describeIncident(inc),
          saved_minutes: decision?.saved_minutes && decision.saved_minutes > 0 ? decision.saved_minutes : null,
          new_stop_sequence: decision?.saved_minutes && decision.saved_minutes > 0 ? decision.new_stop_sequence ?? null : null,
          incident_id: inc.id,
          delay_minutes: delayMin || null,
          source: 'traffic',
        });
      }
    }

    // Incidents in the searched areas that TomTom no longer reports are over
    if (errors === 0) {
      const { error } = await supabase.from('traffic_incidents').update({ active: false }).eq('active', true).lt('last_seen_at', ranAt);
      if (error) console.error('[traffic] Could not close cleared incidents:', error.message);
    }
    await mergeRerouteSuggestions(suggestions, errors === 0 ? new Set(found.keys()) : null);

    const summary: TrafficRunSummary = {
      configured: true, ran_at: ranAt, routes_checked: routes.length,
      incidents_found: found.size, suggestions_created: suggestions.length, errors,
    };
    await cacheSet(STATUS_KEY, summary, 24 * 3600);
    return summary;
  } finally {
    running = false;
  }
}

/** Starts the recurring check. Does nothing (and says so) when TomTom is not configured. */
export function startTrafficMonitor(): boolean {
  if (!isTrafficConfigured()) return false;
  const everyMs = Math.max(1, settings.TRAFFIC_REFRESH_MINUTES) * 60_000;
  const tick = () => refreshTrafficIncidents().catch(e => console.error('[traffic] Refresh failed:', e));
  setTimeout(tick, 30_000);
  setInterval(tick, everyMs);
  return true;
}
