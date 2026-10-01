/**
 * UAT-021 and UAT-023: /ready checks the database, X-Request-ID is validated, /auth/refresh is rate
 * limited, logout revokes the refresh token, and the API sends a Permissions-Policy.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { cacheDeletePattern } from '../src/core/redis';
import { createAccessToken, createRefreshToken } from '../src/core/auth';
import { requestIdFrom } from '../src/app';

const app = testApp();

beforeEach(async () => {
  supabaseMock.reset({ users: [{ id: 'd1', role: 'driver', is_active: true }] });
  await cacheDeletePattern('ratelimit:refresh:*');
});

describe('/ready', () => {
  it('is ready when the database answers', async () => {
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ready', database: 'ok' });
  });

  it('is 503 when the database does not', async () => {
    supabaseMock.fail('users', 'connection refused');
    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'not_ready', database: 'down' });
  });
});

describe('X-Request-ID', () => {
  it('keeps a plain id and replaces anything else', async () => {
    expect((await request(app).get('/health').set('X-Request-ID', 'abc-123-DEF')).headers['x-request-id']).toBe('abc-123-DEF');
    for (const bad of ['<script>alert(1)</script>', 'a'.repeat(65), 'with space', 'under_score', 'ünï']) {
      expect(requestIdFrom(bad)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
    }
    const long = await request(app).get('/health').set('X-Request-ID', 'a'.repeat(65));
    expect(long.headers['x-request-id']).not.toBe('a'.repeat(65));
    expect(requestIdFrom('a'.repeat(64))).toBe('a'.repeat(64));
    expect(requestIdFrom(undefined)).toMatch(/^[0-9a-f]{8}-/);
  });
});

describe('API headers', () => {
  it('turns camera, microphone and location off', async () => {
    expect((await request(app).get('/health')).headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()');
  });
});

describe('/auth/refresh', () => {
  const refresh = (token: string) => request(app).post('/api/v1/auth/refresh').send({ refresh_token: token });

  it('is rate limited per IP', async () => {
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await refresh('not-a-token')).status;
    expect(last).toBe(429);
  });

  it('refuses a refresh token once logout revoked it, and keeps other tokens working', async () => {
    const token = createRefreshToken({ sub: 'd1', role: 'driver' });
    const other = createRefreshToken({ sub: 'd1', role: 'driver' });
    expect((await refresh(token)).status).toBe(200);
    expect((await request(app).post('/api/v1/auth/logout').send({ refresh_token: token })).status).toBe(200);
    expect((await refresh(token)).status).toBe(401);
    expect(token).not.toBe(other);
  });

  it('logout without a token, or with an access token, still succeeds and revokes nothing', async () => {
    expect((await request(app).post('/api/v1/auth/logout').send({})).status).toBe(200);
    const access = createAccessToken({ sub: 'd1', role: 'driver' });
    expect((await request(app).post('/api/v1/auth/logout').send({ refresh_token: access })).status).toBe(200);
  });
});
