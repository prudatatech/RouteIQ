import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { settings } from '../src/core/config';
import { externalHttp } from '../src/core/http';
import { cacheDeletePattern } from '../src/core/redis';
import { getBackendSecret } from '../src/core/auth';
import {
  TRANSPARENT_PNG, clearTileCache, parseTileCoords, signTileToken, tileRateLimit, verifyTileToken,
} from '../src/services/traffic-tiles.service';
import { bboxAreaKm2, incidentKind, parseBbox, snapBbox } from '../src/services/traffic-area.service';

const app = testApp();
const admin = () => ({ Authorization: `Bearer ${supabaseMock.signUserToken('admin-1')}` });
const vendor = () => ({ Authorization: `Bearer ${supabaseMock.signUserToken('vendor-1')}` });

const FAKE_PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('flow-tile')]);
const png = (body: Buffer = FAKE_PNG) => ({ body, contentType: 'image/png' });

/** supertest parser that keeps the response body as raw bytes. */
const raw = (r: NodeJS.ReadableStream, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  r.on('data', (d: Buffer) => chunks.push(d));
  r.on('end', () => cb(null, Buffer.concat(chunks)));
};
const getTile = (url: string) => request(app).get(url).buffer(true).parse(raw as never);

async function tileToken(): Promise<string> {
  const res = await request(app).get('/api/v1/traffic/tile-token').set(admin());
  return res.body.token;
}

describe('traffic flow tiles', () => {
  beforeEach(() => {
    supabaseMock.reset({ users: [{ id: 'admin-1', role: 'admin', is_active: true }, { id: 'vendor-1', role: 'vendor', is_active: true }] });
    clearTileCache();
    settings.TOMTOM_API_KEY = 'tomtom-secret-key';
  });
  afterEach(() => {
    vi.restoreAllMocks();
    settings.TOMTOM_API_KEY = '';
  });

  it('validates the tile address', () => {
    expect(parseTileCoords('12', '2900', '1700')).toEqual({ z: 12, x: 2900, y: 1700 });
    expect(parseTileCoords('0', '0', '0')).toEqual({ z: 0, x: 0, y: 0 });
    expect(parseTileCoords('23', '0', '0')).toBeNull();
    expect(parseTileCoords('3', '8', '0')).toBeNull();
    expect(parseTileCoords('3', '0', '8')).toBeNull();
    expect(parseTileCoords('3', '-1', '0')).toBeNull();
    expect(parseTileCoords('3', '1.5', '0')).toBeNull();
    expect(parseTileCoords('abc', '0', '0')).toBeNull();
    expect(parseTileCoords(undefined, '0', '0')).toBeNull();
  });

  it('answers 400 for a bad address before anything else', async () => {
    const http = vi.spyOn(externalHttp, 'getBuffer');
    const res = await request(app).get('/api/v1/traffic/tiles/flow/3/9/0.png');
    expect(res.status).toBe(400);
    expect(http).not.toHaveBeenCalled();
  });

  it('needs a valid tile token, and a login token is not one', async () => {
    const http = vi.spyOn(externalHttp, 'getBuffer').mockResolvedValue(png());
    expect((await request(app).get('/api/v1/traffic/tiles/flow/5/20/13.png')).status).toBe(401);
    expect((await request(app).get('/api/v1/traffic/tiles/flow/5/20/13.png?t=junk')).status).toBe(401);
    const loginToken = supabaseMock.signUserToken('admin-1');
    expect((await request(app).get(`/api/v1/traffic/tiles/flow/5/20/13.png?t=${loginToken}`)).status).toBe(401);
    // signed with the right key but already expired
    const expired = jwt.sign({ purpose: 'traffic-tiles' }, `${getBackendSecret()}:traffic-tiles`, { subject: 'admin-1', expiresIn: -10 });
    expect(verifyTileToken(expired)).toBeNull();
    expect((await request(app).get(`/api/v1/traffic/tiles/flow/5/20/13.png?t=${expired}`)).status).toBe(401);
    // and a tile token is not a login token
    const tile = signTileToken('admin-1');
    expect((await request(app).get('/api/v1/traffic/incidents').set({ Authorization: `Bearer ${tile}` })).status).toBe(401);
    expect(http).not.toHaveBeenCalled();
  });

  it('issues tile tokens to staff only', async () => {
    expect((await request(app).get('/api/v1/traffic/tile-token').set(vendor())).status).toBe(403);
    expect((await request(app).get('/api/v1/traffic/tile-token')).status).toBe(401);
    const res = await request(app).get('/api/v1/traffic/tile-token').set(admin());
    expect(res.body).toMatchObject({ configured: true, expires_in: 1800 });
    expect(verifyTileToken(res.body.token)).toBe('admin-1');
  });

  it('serves a TomTom tile without exposing the key, and caches it', async () => {
    const http = vi.spyOn(externalHttp, 'getBuffer').mockResolvedValue(png());
    const t = await tileToken();
    const url = `/api/v1/traffic/tiles/flow/5/20/13.png?t=${t}`;
    const first = await getTile(url);
    expect(first.status).toBe(200);
    expect(first.headers['content-type']).toBe('image/png');
    expect(first.headers['cache-control']).toBe('private, max-age=120');
    expect((first.body as Buffer).equals(FAKE_PNG)).toBe(true);
    expect(JSON.stringify(first.headers)).not.toContain('tomtom-secret-key');
    expect(http.mock.calls[0][0]).toContain('api.tomtom.com/traffic/map/4/tile/flow/relative0/5/20/13.png');

    const second = await request(app).get(url);
    expect(second.status).toBe(200);
    expect(http).toHaveBeenCalledTimes(1);
    // another tile is another request
    await request(app).get(`/api/v1/traffic/tiles/flow/5/20/14.png?t=${t}`);
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('shares one TomTom call between simultaneous requests for a tile', async () => {
    let release: (v: ReturnType<typeof png>) => void = () => undefined;
    const http = vi.spyOn(externalHttp, 'getBuffer').mockReturnValue(new Promise(r => { release = r; }));
    const t = await tileToken();
    const a = request(app).get(`/api/v1/traffic/tiles/flow/6/40/26.png?t=${t}`).then(r => r);
    const b = request(app).get(`/api/v1/traffic/tiles/flow/6/40/26.png?t=${t}`).then(r => r);
    await new Promise(r => setTimeout(r, 100));
    release(png());
    expect((await a).status).toBe(200);
    expect((await b).status).toBe(200);
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('sends a transparent tile when TomTom is not configured', async () => {
    const t = await tileToken(); // signed while configured, used after the key is removed
    settings.TOMTOM_API_KEY = '';
    const http = vi.spyOn(externalHttp, 'getBuffer');
    const res = await getTile(`/api/v1/traffic/tiles/flow/5/20/13.png?t=${t}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-traffic-tiles']).toBe('not-configured');
    expect((res.body as Buffer).equals(TRANSPARENT_PNG)).toBe(true);
    expect(http).not.toHaveBeenCalled();
    const issued = await request(app).get('/api/v1/traffic/tile-token').set(admin());
    expect(issued.body).toMatchObject({ configured: false, token: null });
  });

  it('sends a transparent tile when TomTom fails, and does not hammer it', async () => {
    const http = vi.spyOn(externalHttp, 'getBuffer').mockRejectedValue(new Error('TomTom is down'));
    const t = await tileToken();
    const url = `/api/v1/traffic/tiles/flow/7/80/52.png?t=${t}`;
    const res = await getTile(url);
    expect(res.status).toBe(200);
    expect(res.headers['x-traffic-tiles']).toBe('unavailable');
    expect((res.body as Buffer).equals(TRANSPARENT_PNG)).toBe(true);
    await request(app).get(url);
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('does not serve something that is not a PNG', async () => {
    vi.spyOn(externalHttp, 'getBuffer').mockResolvedValue({ body: Buffer.from('<html>'), contentType: 'text/html' });
    const t = await tileToken();
    const res = await getTile(`/api/v1/traffic/tiles/flow/8/160/104.png?t=${t}`);
    expect(res.headers['x-traffic-tiles']).toBe('unavailable');
    expect((res.body as Buffer).equals(TRANSPARENT_PNG)).toBe(true);
  });

  it('limits how many tiles one caller can ask for', () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) expect(tileRateLimit('user:x', 5, 60, now)).toBe(true);
    expect(tileRateLimit('user:x', 5, 60, now)).toBe(false);
    expect(tileRateLimit('user:y', 5, 60, now)).toBe(true);
    expect(tileRateLimit('user:x', 5, 60, now + 61_000)).toBe(true); // next window
  });
});

describe('traffic incidents in a viewport', () => {
  const row = (id: string, over: Record<string, unknown> = {}) => ({
    id, type: 'Accident', severity: 3, description: null, road: 'NH48', lat: 19.0, lng: 72.9, geometry: null,
    delay_seconds: 900, starts_at: '2026-09-30T05:00:00Z', ends_at: null, affected_route_ids: [], active: true,
    first_seen_at: '2026-09-30T05:00:00Z', last_seen_at: new Date().toISOString(), ...over,
  });
  const tomtom = (id: string, lng: number, lat: number, category = 9) => ({
    incidents: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { id, iconCategory: category, magnitudeOfDelay: 2, delay: 600, roadNumbers: ['NH66'] } }],
  });

  beforeEach(async () => {
    supabaseMock.reset({
      users: [{ id: 'admin-1', role: 'admin', is_active: true }, { id: 'vendor-1', role: 'vendor', is_active: true }],
      traffic_incidents: [
        row('in-1'),
        row('in-2', { type: 'Road works', lat: 19.1, lng: 73.0, severity: 1 }),
        row('outside', { lat: 28.6, lng: 77.2 }),
        row('closed', { active: false }),
      ],
    });
    await cacheDeletePattern('traffic:area:*');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    settings.TOMTOM_API_KEY = '';
  });

  it('rejects a box that is not a box', async () => {
    for (const bbox of ['', '1,2,3', 'a,b,c,d', '73,19,72,18', '-200,0,10,10', '70,-95,80,10']) {
      expect((await request(app).get('/api/v1/traffic/incidents').query({ bbox }).set(admin())).status).toBe(400);
    }
    expect(() => parseBbox('72,18,74,20')).not.toThrow();
  });

  it('is for staff only', async () => {
    expect((await request(app).get('/api/v1/traffic/incidents?bbox=72,18,74,20').set(vendor())).status).toBe(403);
    expect((await request(app).get('/api/v1/traffic/incidents?bbox=72,18,74,20')).status).toBe(401);
  });

  it('returns the open incidents inside the box with their icon family, worst first', async () => {
    const res = await request(app).get('/api/v1/traffic/incidents?bbox=72,18,74,20').set(admin());
    expect(res.status).toBe(200);
    expect(res.body.refresh).toBe('not_requested');
    expect(res.body.incidents.map((i: any) => [i.id, i.kind])).toEqual([['in-1', 'accident'], ['in-2', 'roadworks']]);
    expect(res.body.incidents[0]).toMatchObject({ road: 'NH48', delay_seconds: 900, starts_at: '2026-09-30T05:00:00Z' });
  });

  it('does not call TomTom when it is not configured', async () => {
    const http = vi.spyOn(externalHttp, 'getJson');
    const res = await request(app).get('/api/v1/traffic/incidents?bbox=72,18,74,20&refresh=1').set(admin());
    expect(res.body).toMatchObject({ configured: false, refresh: 'not_configured' });
    expect(res.body.incidents).toHaveLength(2);
    expect(http).not.toHaveBeenCalled();
  });

  it('fetches fresh incidents from TomTom for a small box, stores them, and asks again only after 5 minutes', async () => {
    settings.TOMTOM_API_KEY = 'test-key';
    const http = vi.spyOn(externalHttp, 'getJson').mockResolvedValue(tomtom('tt-1', 72.95, 19.05));
    const url = '/api/v1/traffic/incidents?bbox=72.8,18.9,73.1,19.2&refresh=1';
    const first = await request(app).get(url).set(admin());
    expect(first.body.refresh).toBe('fetched');
    expect(http).toHaveBeenCalledTimes(1);
    expect(http.mock.calls[0][0]).toContain('api.tomtom.com/traffic/services/5/incidentDetails');
    expect(first.body.incidents.map((i: any) => i.id).sort()).toEqual(['tt-1']); // in-1/in-2 are no longer reported there
    expect(supabaseMock.rows('traffic_incidents').find(r => r.id === 'tt-1')).toMatchObject({ type: 'Road works', road: 'NH66', active: true });
    expect(supabaseMock.rows('traffic_incidents').find(r => r.id === 'in-1')!.active).toBe(false);
    expect(supabaseMock.rows('traffic_incidents').find(r => r.id === 'outside')!.active).toBe(true);

    // a slightly different viewport in the same area shares the freshness mark
    const second = await request(app).get('/api/v1/traffic/incidents?bbox=72.82,18.92,73.08,19.18&refresh=1').set(admin());
    expect(second.body.refresh).toBe('fresh');
    expect(http).toHaveBeenCalledTimes(1);

    // once the mark has expired (or the route monitor cleared it) TomTom is asked again
    await cacheDeletePattern('traffic:area:*');
    const third = await request(app).get(url).set(admin());
    expect(third.body.refresh).toBe('fetched');
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('keeps what is stored when TomTom fails, and skips boxes that are too big for it', async () => {
    settings.TOMTOM_API_KEY = 'test-key';
    const http = vi.spyOn(externalHttp, 'getJson').mockRejectedValue(new Error('down'));
    const failed = await request(app).get('/api/v1/traffic/incidents?bbox=72.8,18.9,73.1,19.2&refresh=1').set(admin());
    expect(failed.body.refresh).toBe('failed');
    expect(failed.body.incidents.map((i: any) => i.id).sort()).toEqual(['in-1', 'in-2']);

    http.mockClear();
    const big = await request(app).get('/api/v1/traffic/incidents?bbox=68,8,90,30&refresh=1').set(admin());
    expect(big.body.refresh).toBe('area_too_large');
    expect(http).not.toHaveBeenCalled();
    expect(big.body.incidents.map((i: any) => i.id).sort()).toEqual(['in-1', 'in-2', 'outside']);
  });

  it('keeps the route incidents endpoint as it was', async () => {
    const res = await request(app).get('/api/v1/traffic/incidents').set(admin());
    expect(res.body.incidents.map((i: any) => i.id).sort()).toEqual(['in-1', 'in-2', 'outside']);
  });

  it('maps incident types to icon families and measures boxes', () => {
    expect(incidentKind('Accident')).toBe('accident');
    expect(incidentKind('Lane closed')).toBe('closure');
    expect(incidentKind('Heavy rain')).toBe('weather');
    expect(incidentKind('Something new')).toBe('other');
    expect(incidentKind(null)).toBe('other');
    expect(snapBbox([72.83, 18.91, 73.02, 19.11])).toEqual([72.75, 18.75, 73.25, 19.25]);
    expect(bboxAreaKm2([72, 19, 73, 20])).toBeLessThan(12_000);
    expect(bboxAreaKm2([68, 8, 90, 30])).toBeGreaterThan(10_000);
    expect(bboxAreaKm2([72.75, 18.75, 73.25, 19.25])).toBeLessThan(10_000);
  });
});
