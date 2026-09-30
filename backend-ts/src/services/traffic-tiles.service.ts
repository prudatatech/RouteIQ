/**
 * margixindia — Live traffic flow map tiles (TomTom), served through this backend
 *
 * The browser never sees the TomTom key: maplibre asks
 * GET /api/v1/traffic/tiles/flow/{z}/{x}/{y}.png and this service fetches, caches and
 * returns the tile.
 *
 * Auth choice: maplibre loads tiles with plain image requests and cannot send an
 * Authorization header, so the tiles are guarded by a short-lived signed token
 * (GET /traffic/tile-token, staff only) passed as ?t=. That keeps the endpoint from being
 * a free public TomTom proxy without making the map code fetch every tile by hand.
 * The token is signed with a key derived from the backend secret, so it can never be
 * accepted as a login token (and a login token is not a tile token), it carries no role,
 * and it lives 30 minutes; the web app renews it before it runs out.
 *
 * Cache: flow changes every minute or two, so a tile is kept for 2 minutes in this
 * process's memory (bounded, oldest first). Memory rather than Redis on purpose: a
 * panned map asks for dozens of tiles, and one Redis round trip each would burn the
 * Upstash quota. Concurrent requests for one tile share a single TomTom call.
 * Failures are remembered for 20 s so a TomTom outage is not hammered.
 */
import jwt from 'jsonwebtoken';
import { settings } from '../core/config';
import { getBackendSecret } from '../core/auth';
import { externalHttp } from '../core/http';

export const TILE_TOKEN_TTL_SECONDS = 30 * 60;
export const TILE_CACHE_SECONDS = 120;
const FAILURE_CACHE_SECONDS = 20;
const MAX_CACHED_TILES = 1500;
/** TomTom serves flow tiles for zoom 0-22; India-wide views start at 3. */
const MAX_ZOOM = 22;

/** 1x1 fully transparent PNG, drawn when there is no traffic data (not set up, or TomTom failed). */
export const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

export interface TileCoords { z: number; x: number; y: number }

/** Parses and range-checks z/x/y from a URL; null when it is not a real tile address. */
export function parseTileCoords(z: unknown, x: unknown, y: unknown): TileCoords | null {
  const int = (v: unknown): number | null => (typeof v === 'string' && /^\d{1,8}$/.test(v) ? Number(v) : null);
  const zi = int(z), xi = int(x), yi = int(y);
  if (zi === null || xi === null || yi === null || zi > MAX_ZOOM) return null;
  const size = 2 ** zi;
  if (xi >= size || yi >= size) return null;
  return { z: zi, x: xi, y: yi };
}

export function isTrafficTilesConfigured(): boolean {
  return !!settings.TOMTOM_API_KEY;
}

// ── Signed tile tokens ─────────────────────────────────────

function tileSecret(): string {
  const base = getBackendSecret();
  if (!base) throw new Error('Backend JWT secret is not configured');
  return `${base}:traffic-tiles`;
}

export function signTileToken(userId: string): string {
  return jwt.sign({ purpose: 'traffic-tiles' }, tileSecret(), {
    algorithm: 'HS256', subject: userId, expiresIn: TILE_TOKEN_TTL_SECONDS,
  });
}

/** The user id inside a valid tile token, or null (missing, expired, forged, or any other kind of token). */
export function verifyTileToken(token: unknown): string | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) return null;
  try {
    const payload = jwt.verify(token, tileSecret(), { algorithms: ['HS256'] }) as jwt.JwtPayload;
    return payload.purpose === 'traffic-tiles' && typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

// ── Rate limit (per process, fixed window) ─────────────────

const windows = new Map<string, { count: number; resetAt: number }>();

/** Counts one request for `key`; false once more than `limit` were made in the last `windowSeconds`. */
export function tileRateLimit(key: string, limit: number, windowSeconds: number, now = Date.now()): boolean {
  if (windows.size > 5000) for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return true;
  }
  current.count++;
  return current.count <= limit;
}

// ── Tile fetch + cache ─────────────────────────────────────

interface CachedTile { png: Buffer | null; expiresAt: number }
const tileCache = new Map<string, CachedTile>();
const inFlight = new Map<string, Promise<Buffer | null>>();

export function clearTileCache(): void {
  tileCache.clear();
  inFlight.clear();
}

function remember(key: string, png: Buffer | null, seconds: number): void {
  if (tileCache.size >= MAX_CACHED_TILES) {
    const now = Date.now();
    for (const [k, v] of tileCache) if (v.expiresAt <= now) tileCache.delete(k);
    // still full: drop the oldest entries (Map keeps insertion order)
    for (const k of tileCache.keys()) {
      if (tileCache.size < MAX_CACHED_TILES * 0.9) break;
      tileCache.delete(k);
    }
  }
  tileCache.set(key, { png, expiresAt: Date.now() + seconds * 1000 });
}

/**
 * The flow tile as PNG bytes, or null when there is nothing to draw (TomTom not
 * configured, or it failed); the caller then sends the transparent tile.
 */
export async function getFlowTile({ z, x, y }: TileCoords): Promise<Buffer | null> {
  if (!isTrafficTilesConfigured()) return null;
  const key = `${z}/${x}/${y}`;
  const hit = tileCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.png;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = (async () => {
    try {
      const url = `https://api.tomtom.com/traffic/map/4/tile/flow/relative/${z}/${x}/${y}.png?key=${encodeURIComponent(settings.TOMTOM_API_KEY)}`;
      const { body, contentType } = await externalHttp.getBuffer(url, 6000);
      if (!contentType.startsWith('image/png') || body.length === 0) throw new Error(`Unexpected TomTom answer (${contentType})`);
      remember(key, body, TILE_CACHE_SECONDS);
      return body;
    } catch (e) {
      console.warn('[traffic] TomTom flow tile failed:', (e as Error).message);
      remember(key, null, FAILURE_CACHE_SECONDS);
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, request);
  return request;
}
