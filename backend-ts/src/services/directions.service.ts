/**
 * margixindia — Road directions for the maps
 *
 * Every map that draws a road line asks the backend, so no map key ever reaches the browser.
 * getDirections() takes the ordered waypoints and returns the road geometry, the distance, the
 * driving time (with live traffic unless asked otherwise) and, from Mapbox, the congestion of each
 * stretch. Mapbox (driving-traffic) answers first; TomTom is the fallback when Mapbox is not set
 * up or fails. Identical requests are answered from the shared cache for a few minutes.
 *
 * Parsing and URL building are plain functions so tests run them without a network.
 */
import { settings } from '../core/config';
import { cacheGet, cacheSet } from '../core/redis';
import { externalHttp } from '../core/http';
import { HttpError } from '../core/errors';
import { MAX_DIRECTIONS_WAYPOINTS } from '../schemas/routing';

/** Mapbox driving-traffic accepts at most 3 coordinates per request; longer trips are asked in pieces of 3. */
const MAPBOX_TRAFFIC_MAX_COORDINATES = 3;
/** Same request within this time is answered from the cache; live traffic moves within minutes. */
export const DIRECTIONS_CACHE_SECONDS = 4 * 60;
/** Coordinates are rounded to 4 decimals (about 11 m) so GPS jitter shares one cache entry. */
const CACHE_DIGITS = 4;
const PROVIDER_TIMEOUT_MS = 12_000;

export interface Waypoint { lat: number; lng: number }

export interface Directions {
  /** Road geometry as [lng, lat] pairs. */
  coordinates: [number, number][];
  distance_meters: number;
  duration_seconds: number;
  /** One level per line segment (coordinates - 1): low, moderate, heavy, severe or unknown. Mapbox only. */
  congestion?: string[];
  /** Length in metres of each line segment; present with `congestion`. */
  segment_meters?: number[];
  /** Duration in seconds of each line segment; present with `congestion`. */
  segment_seconds?: number[];
  provider: 'mapbox' | 'tomtom';
}

type Parsed = Omit<Directions, 'provider'>;

export const NO_DIRECTIONS_MESSAGE = 'Road directions are not set up. Ask an administrator to add a Mapbox or TomTom key to the server.';

export const isDirectionsConfigured = () => !!settings.MAPBOX_ACCESS_TOKEN || !!settings.TOMTOM_API_KEY;

const round = (n: number, digits: number) => Number(n.toFixed(digits));

export function roundWaypoints(points: Waypoint[]): Waypoint[] {
  return points.map(p => ({ lat: round(p.lat, CACHE_DIGITS), lng: round(p.lng, CACHE_DIGITS) }));
}

export function directionsCacheKey(points: Waypoint[], traffic: boolean): string {
  return `directions:v1:${traffic ? 't' : 'f'}:${roundWaypoints(points).map(p => `${p.lat},${p.lng}`).join(';')}`;
}

// ── Mapbox ─────────────────────────────────────────────────

export function buildMapboxDirectionsUrl(points: Waypoint[], traffic: boolean, token: string): string {
  const coords = points.map(p => `${p.lng},${p.lat}`).join(';');
  const profile = traffic ? 'driving-traffic' : 'driving';
  return `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coords}` +
    `?overview=full&geometries=geojson&annotations=congestion,duration,distance&access_token=${encodeURIComponent(token)}`;
}

const finiteOrZero = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Turns one Mapbox directions answer into our shape; null when it holds no route. */
export function parseMapboxDirections(payload: any): Parsed | null {
  const best = Array.isArray(payload?.routes) ? payload.routes[0] : null;
  const raw = best?.geometry?.coordinates;
  if (!best || !Array.isArray(raw)) return null;
  const coordinates = raw
    .filter((c: unknown) => Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]))
    .map((c: number[]) => [c[0], c[1]] as [number, number]);
  if (coordinates.length < 2) return null;
  const legs: any[] = Array.isArray(best.legs) ? best.legs : [];
  const joined = (pick: string): unknown[] => legs.flatMap(l => (Array.isArray(l?.annotation?.[pick]) ? l.annotation[pick] : []));
  const segments = coordinates.length - 1;
  const pad = <T>(values: unknown[], fill: T, map: (v: unknown) => T): T[] =>
    Array.from({ length: segments }, (_, i) => (i < values.length ? map(values[i]) : fill));
  const levels = joined('congestion');
  const out: Parsed = {
    coordinates,
    distance_meters: finiteOrZero(best.distance),
    duration_seconds: finiteOrZero(best.duration),
  };
  if (levels.length > 0) {
    out.congestion = pad<string>(levels, 'unknown', v => (typeof v === 'string' ? v : 'unknown'));
    out.segment_meters = pad<number>(joined('distance'), 0, finiteOrZero);
    out.segment_seconds = pad<number>(joined('duration'), 0, finiteOrZero);
  }
  return out;
}

/** Joins consecutive pieces of one trip: the shared point is kept once, per-segment lists are appended. */
export function mergeDirections(parts: Parsed[]): Parsed {
  if (parts.length === 1) return parts[0];
  const withCongestion = parts.every(p => p.congestion);
  const merged: Parsed = { coordinates: [], distance_meters: 0, duration_seconds: 0 };
  if (withCongestion) { merged.congestion = []; merged.segment_meters = []; merged.segment_seconds = []; }
  parts.forEach((p, i) => {
    merged.coordinates.push(...(i === 0 ? p.coordinates : p.coordinates.slice(1)));
    merged.distance_meters += p.distance_meters;
    merged.duration_seconds += p.duration_seconds;
    if (withCongestion) {
      merged.congestion!.push(...p.congestion!);
      merged.segment_meters!.push(...p.segment_meters!);
      merged.segment_seconds!.push(...p.segment_seconds!);
    }
  });
  return merged;
}

async function mapboxDirections(points: Waypoint[], traffic: boolean): Promise<Directions | null> {
  const token = settings.MAPBOX_ACCESS_TOKEN;
  const size = traffic ? MAPBOX_TRAFFIC_MAX_COORDINATES : MAX_DIRECTIONS_WAYPOINTS;
  const chunks: Waypoint[][] = [];
  for (let start = 0; start < points.length - 1; start += size - 1) chunks.push(points.slice(start, start + size));
  const parts = await Promise.all(chunks.map(async chunk => parseMapboxDirections(
    await externalHttp.getJson<any>(buildMapboxDirectionsUrl(chunk, traffic, token), PROVIDER_TIMEOUT_MS),
  )));
  if (parts.some(p => p === null)) return null;
  return { ...mergeDirections(parts as Parsed[]), provider: 'mapbox' };
}

// ── TomTom ─────────────────────────────────────────────────

export function buildTomTomDirectionsUrl(points: Waypoint[], traffic: boolean, key: string): string {
  const locations = points.map(p => `${p.lat},${p.lng}`).join(':');
  const params = [
    ['key', key], ['travelMode', 'car'], ['routeType', 'fastest'], ['traffic', String(traffic)],
    ['instructionsType', 'none'], ['routeRepresentation', 'polyline'],
  ];
  return `https://api.tomtom.com/routing/1/calculateRoute/${locations}/json?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}

/** Turns a TomTom routing answer into our shape (no congestion levels); null when it holds no route. */
export function parseTomTomDirections(payload: any): Parsed | null {
  const route = Array.isArray(payload?.routes) ? payload.routes[0] : null;
  if (!route) return null;
  const coordinates: [number, number][] = [];
  for (const leg of Array.isArray(route.legs) ? route.legs : []) {
    for (const p of Array.isArray(leg?.points) ? leg.points : []) {
      if (!Number.isFinite(p?.latitude) || !Number.isFinite(p?.longitude)) continue;
      const next: [number, number] = [p.longitude, p.latitude];
      const last = coordinates[coordinates.length - 1];
      // A leg starts where the previous one ended
      if (last && last[0] === next[0] && last[1] === next[1]) continue;
      coordinates.push(next);
    }
  }
  if (coordinates.length < 2) return null;
  return {
    coordinates,
    distance_meters: finiteOrZero(route.summary?.lengthInMeters),
    duration_seconds: finiteOrZero(route.summary?.travelTimeInSeconds),
  };
}

async function tomTomDirections(points: Waypoint[], traffic: boolean): Promise<Directions | null> {
  const payload = await externalHttp.getJson<any>(buildTomTomDirectionsUrl(points, traffic, settings.TOMTOM_API_KEY), PROVIDER_TIMEOUT_MS);
  const parsed = parseTomTomDirections(payload);
  return parsed ? { ...parsed, provider: 'tomtom' } : null;
}

// ── Entry point ────────────────────────────────────────────

/**
 * Road directions through the waypoints, in order. 503 when no provider is set up, 404 when the
 * providers answered but found no road route, 502 when every configured provider failed.
 */
export async function getDirections(waypoints: Waypoint[], traffic = true): Promise<Directions & { cached: boolean }> {
  if (!isDirectionsConfigured()) throw new HttpError(503, NO_DIRECTIONS_MESSAGE);

  const key = directionsCacheKey(waypoints, traffic);
  const hit = await cacheGet<Directions>(key);
  if (hit) return { ...hit, cached: true };

  const points = roundWaypoints(waypoints);
  const providers: { name: string; run: () => Promise<Directions | null> }[] = [];
  if (settings.MAPBOX_ACCESS_TOKEN) providers.push({ name: 'Mapbox', run: () => mapboxDirections(points, traffic) });
  if (settings.TOMTOM_API_KEY) providers.push({ name: 'TomTom', run: () => tomTomDirections(points, traffic) });

  let failed = false;
  for (const provider of providers) {
    try {
      const result = await provider.run();
      if (result) {
        await cacheSet(key, result, DIRECTIONS_CACHE_SECONDS);
        return { ...result, cached: false };
      }
    } catch (e) {
      failed = true;
      // externalHttp errors carry only the status, never the URL with the key
      console.warn(`[directions] ${provider.name} failed:`, (e as Error).message);
    }
  }
  if (failed) throw new HttpError(502, 'Road directions are not available right now.');
  throw new HttpError(404, 'No driving path was found between these places.');
}
