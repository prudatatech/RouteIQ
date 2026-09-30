import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settings } from '../src/core/config';
import { externalHttp } from '../src/core/http';
import { buildCostMatrix, chunkCoordinates, MAPBOX_MAX_COORDS, planMatrixChunks, TOMTOM_MAX_CELLS } from '../src/services/optimizer/matrix';

/** Every (i, j) pair appears in exactly one block. */
function coverage(n: number, chunks: ReturnType<typeof planMatrixChunks>): Map<string, number> {
  const seen = new Map<string, number>();
  for (const c of chunks) for (const s of c.sources) for (const d of c.destinations) seen.set(`${s}:${d}`, (seen.get(`${s}:${d}`) ?? 0) + 1);
  expect(seen.size).toBe(n * n);
  return seen;
}

describe('matrix chunking', () => {
  it('uses one request when the points fit', () => {
    expect(planMatrixChunks(7, { maxCoords: 25 })).toHaveLength(1);
    expect(planMatrixChunks(1, { maxCoords: 25 })).toHaveLength(1);
    expect(planMatrixChunks(0, { maxCoords: 25 })).toEqual([]);
  });

  it.each([26, 40, 61])('splits %i points for Mapbox into blocks of at most 25 coordinates covering every pair once', (n) => {
    const chunks = planMatrixChunks(n, { maxCoords: MAPBOX_MAX_COORDS.driving });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(chunkCoordinates(c).indices.length).toBeLessThanOrEqual(25);
    for (const times of coverage(n, chunks).values()) expect(times).toBe(1);
  });

  it('keeps driving-traffic blocks to 10 coordinates', () => {
    const chunks = planMatrixChunks(23, { maxCoords: MAPBOX_MAX_COORDS['driving-traffic'] });
    for (const c of chunks) expect(chunkCoordinates(c).indices.length).toBeLessThanOrEqual(10);
    for (const times of coverage(23, chunks).values()) expect(times).toBe(1);
  });

  it('keeps TomTom blocks to 100 cells', () => {
    const chunks = planMatrixChunks(35, { maxCells: TOMTOM_MAX_CELLS });
    for (const c of chunks) expect(c.sources.length * c.destinations.length).toBeLessThanOrEqual(100);
    for (const times of coverage(35, chunks).values()) expect(times).toBe(1);
  });
});

const points = (n: number) => Array.from({ length: n }, (_, i) => ({ lat: 21 + i * 0.01, lng: 79 + i * 0.01 }));

describe('buildCostMatrix', () => {
  beforeEach(() => {
    settings.MAPBOX_ACCESS_TOKEN = '';
    settings.TOMTOM_API_KEY = '';
  });
  afterEach(() => {
    settings.MAPBOX_ACCESS_TOKEN = '';
    settings.TOMTOM_API_KEY = '';
    vi.restoreAllMocks();
  });

  it('is marked as an estimate when no routing key is set', async () => {
    const http = vi.spyOn(externalHttp, 'getJson');
    const m = await buildCostMatrix(points(4), { traffic: true });
    expect(m.source).toBe('estimated');
    expect(m.estimated).toBe(true);
    expect(m.note).toMatch(/MAPBOX_ACCESS_TOKEN/);
    expect(http).not.toHaveBeenCalled();
    expect(m.distanceKm[0][0]).toBe(0);
    expect(m.distanceKm[0][3]).toBeGreaterThan(0);
  });

  it('stitches a 30-point Mapbox matrix from several chunked requests', async () => {
    settings.MAPBOX_ACCESS_TOKEN = 'pk.test';
    const urls: string[] = [];
    vi.spyOn(externalHttp, 'getJson').mockImplementation(async (url: string) => {
      urls.push(url);
      const path = new URL(url).pathname;
      const coords = path.split('/').pop()!.split(';');
      const q = new URL(url).searchParams;
      const sources = q.get('sources')!.split(';').map(Number);
      const destinations = q.get('destinations')!.split(';').map(Number);
      // Fake road: distance in metres is 1000 x the index gap of the two real points, taken from their longitudes
      const gap = (a: number, b: number) => Math.round(Math.abs(Number(coords[a].split(',')[0]) - Number(coords[b].split(',')[0])) * 100);
      return {
        code: 'Ok',
        distances: sources.map(s => destinations.map(d => gap(s, d) * 1000)),
        durations: sources.map(s => destinations.map(d => gap(s, d) * 60)),
      };
    });
    const m = await buildCostMatrix(points(30), { traffic: false });
    expect(m.source).toBe('mapbox');
    expect(m.estimated).toBe(false);
    expect(urls.length).toBeGreaterThan(1);
    expect(urls.every(u => u.includes('/mapbox/driving/'))).toBe(true);
    for (const u of urls) expect(new URL(u).pathname.split('/').pop()!.split(';').length).toBeLessThanOrEqual(25);
    // Point i is i x 0.01 degrees east of point 0, so the gap is |i - j|
    expect(m.distanceKm[2][27]).toBe(25);
    expect(m.distanceKm[29][0]).toBe(29);
    expect(m.durationMin[5][6]).toBe(1);
    expect(m.requests).toBe(urls.length);
  });

  it('asks for driving-traffic when traffic matters', async () => {
    settings.MAPBOX_ACCESS_TOKEN = 'pk.test';
    const http = vi.spyOn(externalHttp, 'getJson').mockResolvedValue({ code: 'Ok', distances: [[0, 1000], [1000, 0]], durations: [[0, 60], [60, 0]] });
    await buildCostMatrix(points(2), { traffic: true });
    expect(String(http.mock.calls[0][0])).toContain('/mapbox/driving-traffic/');
  });

  it('fills a pair with no road route from the estimate and says so', async () => {
    settings.MAPBOX_ACCESS_TOKEN = 'pk.test';
    vi.spyOn(externalHttp, 'getJson').mockResolvedValue({ code: 'Ok', distances: [[0, null], [1000, 0]], durations: [[0, null], [60, 0]] });
    const m = await buildCostMatrix(points(2), { traffic: false });
    expect(m.source).toBe('mapbox');
    expect(m.estimated).toBe(true);
    expect(m.note).toMatch(/1 pair/);
    expect(m.distanceKm[0][1]).toBeGreaterThan(0);
  });

  it('falls back to TomTom, then to the estimate, when Mapbox fails', async () => {
    settings.MAPBOX_ACCESS_TOKEN = 'pk.test';
    settings.TOMTOM_API_KEY = 'tt-key';
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(externalHttp, 'getJson').mockRejectedValue(new Error('mapbox down'));
    const post = vi.spyOn(externalHttp, 'postJson').mockResolvedValue({
      data: [
        { originIndex: 0, destinationIndex: 1, routeSummary: { lengthInMeters: 2000, travelTimeInSeconds: 120 } },
        { originIndex: 1, destinationIndex: 0, routeSummary: { lengthInMeters: 2500, travelTimeInSeconds: 150 } },
        { originIndex: 0, destinationIndex: 0, routeSummary: { lengthInMeters: 0, travelTimeInSeconds: 0 } },
        { originIndex: 1, destinationIndex: 1, routeSummary: { lengthInMeters: 0, travelTimeInSeconds: 0 } },
      ],
    });
    const viaTomTom = await buildCostMatrix(points(2), { traffic: true });
    expect(viaTomTom.source).toBe('tomtom');
    expect(viaTomTom.distanceKm[0][1]).toBe(2);
    expect(viaTomTom.durationMin[1][0]).toBe(2.5);
    expect(post).toHaveBeenCalledTimes(1);

    post.mockRejectedValue(new Error('tomtom down'));
    const last = await buildCostMatrix(points(2), { traffic: true });
    expect(last.source).toBe('estimated');
    expect(last.estimated).toBe(true);
    expect(last.note).toMatch(/Mapbox did not answer; TomTom did not answer/);
  });
});
