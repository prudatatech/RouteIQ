import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';
import { requestTiming, serverTimingValue, timedFetch, recordDbCall } from '../src/core/timing';

const app = testApp();
const admin = { Authorization: `Bearer ${createAccessToken({ sub: 'admin-1', role: 'admin' })}` };
const FORMAT = /^db;dur=\d+\.\d;desc="(\d+) queries", total;dur=\d+\.\d$/;

beforeEach(() => {
  supabaseMock.reset({ users: [{ id: 'admin-1', role: 'admin', is_active: true }], shipments: [{ id: 's1', status: 'created' }] });
});

describe('Server-Timing', () => {
  it('is on a response that never touches the database', async () => {
    const res = await request(app).get('/health');
    const header = res.headers['server-timing'];
    expect(header).toMatch(FORMAT);
    expect(header).toContain('desc="0 queries"');
  });

  it('counts the database calls the request made', async () => {
    const res = await request(app).get('/api/v1/dashboard/shipment-counts').set(admin);
    expect(res.status).toBe(200);
    const header = res.headers['server-timing'];
    expect(header).toMatch(FORMAT);
    expect(Number(header.match(FORMAT)![1])).toBeGreaterThanOrEqual(1);
  });

  it('is on error responses too', async () => {
    const res = await request(app).get('/api/v1/dashboard/shipment-counts');
    expect(res.status).toBe(401);
    expect(res.headers['server-timing']).toMatch(FORMAT);
  });

  it('formats db and total durations', () => {
    expect(serverTimingValue({ dbCalls: 3, dbMs: 12.34 }, 56.78)).toBe('db;dur=12.3;desc="3 queries", total;dur=56.8');
  });

  it('timedFetch passes the response through and ignores calls outside a request', async () => {
    const res = new Response('ok');
    const wrapped = timedFetch(async () => res);
    await expect(wrapped('http://x')).resolves.toBe(res);
    expect(() => recordDbCall(1)).not.toThrow();
  });
});

describe('SLOW log', () => {
  const miniApp = () => {
    const a = express();
    a.use(requestTiming());
    a.get('/items/:id', (_req, res) => { res.json({ ok: true }); });
    return a;
  };

  it('logs a request of 500 ms or more with its route pattern, not the raw id', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (clock += 300));
    const res = await request(miniApp()).get('/items/42?x=1');
    expect(res.status).toBe(200);
    const line = warn.mock.calls.map(c => String(c[0])).find(l => l.startsWith('SLOW '));
    expect(line).toMatch(/^SLOW GET \/items\/:id 200 \d+ms db=0\/0ms$/);
  });

  it('stays quiet for a fast request', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await request(miniApp()).get('/items/42');
    expect(warn.mock.calls.some(c => String(c[0]).startsWith('SLOW '))).toBe(false);
  });
});
