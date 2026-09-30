/**
 * margixindia — road distance and duration matrix for the in-process optimizer.
 *
 * Order of preference:
 *   1. Mapbox Matrix API (driving-traffic when traffic matters, else driving)
 *   2. TomTom Matrix Routing v2
 *   3. Straight-line distance x ROAD_FACTOR at an average speed, marked as estimated
 *
 * Both providers cap the size of one request, so the matrix is filled in
 * blocks (see planMatrixChunks) and stitched together.
 */
import { settings } from '../../core/config';
import { externalHttp } from '../../core/http';
import { haversineKm, LatLng, ROAD_FACTOR } from '../geo';

export type MatrixSource = 'mapbox' | 'tomtom' | 'estimated';

export interface CostMatrix {
  /** distanceKm[i][j]: road (or estimated) distance from point i to point j. */
  distanceKm: number[][];
  /** durationMin[i][j]: driving minutes from point i to point j. */
  durationMin: number[][];
  source: MatrixSource;
  /** True when any figure is straight-line x road factor rather than a routed value. */
  estimated: boolean;
  /** Provider requests made. */
  requests: number;
  /** Why an estimate was used, in plain words. Null when every figure is routed. */
  note: string | null;
}

export interface MatrixChunk {
  sources: number[];
  destinations: number[];
}

/** Mapbox limits: 25 coordinates per request, 10 for driving-traffic. */
export const MAPBOX_MAX_COORDS = { driving: 25, 'driving-traffic': 10 } as const;
/** TomTom synchronous Matrix Routing: origins x destinations at most 100. */
export const TOMTOM_MAX_CELLS = 100;
/** Mapbox allows 60 matrix requests a minute; stay under it. */
export const MAX_MATRIX_REQUESTS = 50;
/** Average road speed used by the estimate (km/h). */
export const ESTIMATE_SPEED_KMPH = 40;

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/**
 * Splits an n x n matrix into blocks a provider accepts.
 * - maxCoords: the most distinct coordinates one request may carry (sources plus destinations).
 * - maxCells: the most source x destination cells one request may ask for.
 * Every (i, j) pair falls in exactly one block.
 */
export function planMatrixChunks(n: number, limits: { maxCoords?: number; maxCells?: number }): MatrixChunk[] {
  if (n <= 0) return [];
  const maxCoords = limits.maxCoords ?? Infinity;
  const maxCells = limits.maxCells ?? Infinity;
  if (n <= maxCoords && n * n <= maxCells) return [{ sources: range(n), destinations: range(n) }];

  let rows: number;
  let cols: number;
  if (Number.isFinite(maxCells)) {
    rows = cols = Math.max(1, Math.floor(Math.sqrt(maxCells)));
    if (Number.isFinite(maxCoords)) {
      rows = Math.max(1, Math.min(rows, Math.floor(maxCoords / 2)));
      cols = Math.max(1, Math.min(cols, maxCoords - rows));
    }
  } else {
    rows = Math.max(1, Math.floor(maxCoords / 2));
    cols = Math.max(1, maxCoords - rows);
  }

  const chunks: MatrixChunk[] = [];
  for (let r = 0; r < n; r += rows) {
    for (let c = 0; c < n; c += cols) {
      chunks.push({
        sources: range(Math.min(rows, n - r)).map(i => r + i),
        destinations: range(Math.min(cols, n - c)).map(i => c + i),
      });
    }
  }
  return chunks;
}

/** Distinct coordinates a block needs, in a stable order, plus each point's position in that list. */
export function chunkCoordinates(chunk: MatrixChunk): { indices: number[]; local: Map<number, number> } {
  const indices = [...new Set([...chunk.sources, ...chunk.destinations])];
  return { indices, local: new Map(indices.map((g, i) => [g, i])) };
}

function estimatedMatrix(points: LatLng[], trafficFactor: number): Pick<CostMatrix, 'distanceKm' | 'durationMin'> {
  const n = points.length;
  const distanceKm = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const durationMin = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const km = haversineKm(points[i], points[j]) * ROAD_FACTOR;
      distanceKm[i][j] = km;
      durationMin[i][j] = (km / ESTIMATE_SPEED_KMPH) * 60 * trafficFactor;
    }
  }
  return { distanceKm, durationMin };
}

const blank = (n: number) => Array.from({ length: n }, () => new Array<number | null>(n).fill(null));

async function inBatches<T>(items: T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(run));
  }
}

const fmt = (p: LatLng) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`;

interface Filled { distanceKm: (number | null)[][]; durationMin: (number | null)[][]; requests: number }

async function fillFromMapbox(points: LatLng[], profile: 'driving' | 'driving-traffic', chunks: MatrixChunk[]): Promise<Filled> {
  const n = points.length;
  const distanceKm = blank(n);
  const durationMin = blank(n);
  await inBatches(chunks, 4, async (chunk) => {
    const { indices, local } = chunkCoordinates(chunk);
    const coords = indices.map(g => fmt(points[g])).join(';');
    const qs = new URLSearchParams({
      annotations: 'distance,duration',
      sources: chunk.sources.map(g => local.get(g)).join(';'),
      destinations: chunk.destinations.map(g => local.get(g)).join(';'),
      access_token: settings.MAPBOX_ACCESS_TOKEN,
    });
    const data = await externalHttp.getJson<any>(`https://api.mapbox.com/directions-matrix/v1/mapbox/${profile}/${coords}?${qs}`, 12_000);
    if (data?.code !== 'Ok' || !Array.isArray(data.durations) || !Array.isArray(data.distances)) {
      throw new Error(`Mapbox matrix answered ${data?.code ?? 'with no data'}`);
    }
    chunk.sources.forEach((s, si) => chunk.destinations.forEach((d, di) => {
      const meters = data.distances[si]?.[di];
      const seconds = data.durations[si]?.[di];
      if (typeof meters === 'number' && typeof seconds === 'number') {
        distanceKm[s][d] = meters / 1000;
        durationMin[s][d] = seconds / 60;
      }
    }));
  });
  return { distanceKm, durationMin, requests: chunks.length };
}

async function fillFromTomTom(points: LatLng[], traffic: boolean, chunks: MatrixChunk[]): Promise<Filled> {
  const n = points.length;
  const distanceKm = blank(n);
  const durationMin = blank(n);
  const pt = (g: number) => ({ point: { latitude: points[g].lat, longitude: points[g].lng } });
  await inBatches(chunks, 3, async (chunk) => {
    const data = await externalHttp.postJson<any>(
      `https://api.tomtom.com/routing/matrix/2?key=${encodeURIComponent(settings.TOMTOM_API_KEY)}`,
      {
        origins: chunk.sources.map(pt),
        destinations: chunk.destinations.map(pt),
        options: { routeType: 'fastest', travelMode: 'truck', traffic: traffic ? 'live' : 'historical' },
      },
      15_000,
    );
    if (!Array.isArray(data?.data)) throw new Error('TomTom matrix answered with no data');
    for (const cell of data.data) {
      const s = chunk.sources[cell.originIndex];
      const d = chunk.destinations[cell.destinationIndex];
      const summary = cell.routeSummary;
      if (s !== undefined && d !== undefined && summary && typeof summary.lengthInMeters === 'number' && typeof summary.travelTimeInSeconds === 'number') {
        distanceKm[s][d] = summary.lengthInMeters / 1000;
        durationMin[s][d] = summary.travelTimeInSeconds / 60;
      }
    }
  });
  return { distanceKm, durationMin, requests: chunks.length };
}

/** Fills the pairs a provider had no route for with the estimate. Returns how many were filled. */
function completeWithEstimate(filled: Filled, points: LatLng[], trafficFactor: number): { matrix: Pick<CostMatrix, 'distanceKm' | 'durationMin'>; gaps: number } {
  const est = estimatedMatrix(points, trafficFactor);
  let gaps = 0;
  const distanceKm = filled.distanceKm.map((row, i) => row.map((v, j) => {
    if (i === j) return 0;
    if (v == null) { gaps++; return est.distanceKm[i][j]; }
    return v;
  }));
  const durationMin = filled.durationMin.map((row, i) => row.map((v, j) => (i === j ? 0 : v ?? est.durationMin[i][j])));
  return { matrix: { distanceKm, durationMin }, gaps };
}

export interface MatrixOptions {
  /** Ask for traffic-aware durations (Mapbox driving-traffic, TomTom live). */
  traffic: boolean;
  /** Multiplies the estimated durations only; routed durations already contain traffic. */
  estimateTrafficFactor?: number;
}

/**
 * Road matrix between `points`. Never throws: a provider that fails is logged and the next one is tried,
 * and the last resort is the estimate, which the result says so.
 */
export async function buildCostMatrix(points: LatLng[], options: MatrixOptions): Promise<CostMatrix> {
  const n = points.length;
  const trafficFactor = options.estimateTrafficFactor ?? 1;
  if (n < 2) {
    return { distanceKm: n === 1 ? [[0]] : [], durationMin: n === 1 ? [[0]] : [], source: 'estimated', estimated: false, requests: 0, note: null };
  }
  const reasons: string[] = [];

  if (settings.MAPBOX_ACCESS_TOKEN) {
    let profile: 'driving' | 'driving-traffic' = options.traffic ? 'driving-traffic' : 'driving';
    let chunks = planMatrixChunks(n, { maxCoords: MAPBOX_MAX_COORDS[profile] });
    if (chunks.length > MAX_MATRIX_REQUESTS && profile === 'driving-traffic') {
      profile = 'driving';
      chunks = planMatrixChunks(n, { maxCoords: MAPBOX_MAX_COORDS[profile] });
    }
    if (chunks.length <= MAX_MATRIX_REQUESTS) {
      try {
        const filled = await fillFromMapbox(points, profile, chunks);
        const { matrix, gaps } = completeWithEstimate(filled, points, trafficFactor);
        return {
          ...matrix,
          source: 'mapbox',
          estimated: gaps > 0,
          requests: filled.requests,
          note: gaps > 0 ? `${gaps} pair${gaps === 1 ? '' : 's'} of stops had no road route, so straight-line distance was used for them.` : null,
        };
      } catch (e) {
        console.warn('[optimizer] Mapbox matrix failed:', (e as Error).message);
        reasons.push('Mapbox did not answer');
      }
    } else {
      reasons.push(`${n} points need more Mapbox requests than the ${MAX_MATRIX_REQUESTS} allowed`);
    }
  }

  if (settings.TOMTOM_API_KEY) {
    const chunks = planMatrixChunks(n, { maxCells: TOMTOM_MAX_CELLS });
    if (chunks.length <= MAX_MATRIX_REQUESTS) {
      try {
        const filled = await fillFromTomTom(points, options.traffic, chunks);
        const { matrix, gaps } = completeWithEstimate(filled, points, trafficFactor);
        return {
          ...matrix,
          source: 'tomtom',
          estimated: gaps > 0,
          requests: filled.requests,
          note: gaps > 0 ? `${gaps} pair${gaps === 1 ? '' : 's'} of stops had no road route, so straight-line distance was used for them.` : null,
        };
      } catch (e) {
        console.warn('[optimizer] TomTom matrix failed:', (e as Error).message);
        reasons.push('TomTom did not answer');
      }
    } else {
      reasons.push(`${n} points need more TomTom requests than the ${MAX_MATRIX_REQUESTS} allowed`);
    }
  }

  const note = reasons.length > 0
    ? `${reasons.join('; ')}, so distances are straight-line x ${ROAD_FACTOR}.`
    : `No road-routing key (MAPBOX_ACCESS_TOKEN or TOMTOM_API_KEY) is set, so distances are straight-line x ${ROAD_FACTOR}.`;
  return { ...estimatedMatrix(points, trafficFactor), source: 'estimated', estimated: true, requests: 0, note };
}
