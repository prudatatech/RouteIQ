/**
 * UAT-008: a bad percent-escape in a URL is the client's mistake (400 "Malformed URL"), not a 500,
 * on a :param route, including the public tracking page. Other errors still read as before.
 */
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import express from 'express';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { errorHandler, HttpError } from '../src/core/errors';

const app = testApp();

describe('a malformed percent-escape in the URL', () => {
  it('gives 400 on a public :param route', async () => {
    supabaseMock.reset({ shipments: [] });
    const res = await request(app).get('/api/v1/shipments/track/%ZZ');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ detail: 'Malformed URL' });
  });

  it('gives 400 on an authenticated :param route too, before any sign-in check', async () => {
    const res = await request(app).get('/api/v1/shipments/%E0%A4%A');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ detail: 'Malformed URL' });
  });

  it('a good escape still reaches the route', async () => {
    supabaseMock.reset({ shipments: [], shipment_logs: [] });
    const res = await request(app).get('/api/v1/shipments/track/RTX-%41BC');
    expect(res.status).not.toBe(400);
    expect(res.status).not.toBe(500);
  });
});

describe('errorHandler', () => {
  const run = (err: unknown) => {
    const small = express();
    small.get('/boom/:id', (_req, _res, next) => next(err));
    small.use(errorHandler);
    return request(small).get('/boom/x');
  };

  it('maps a URIError and a non-HttpError 4xx decode failure to 400', async () => {
    expect((await run(new URIError('URI malformed'))).body).toEqual({ detail: 'Malformed URL' });
    const decode = Object.assign(new Error("Failed to decode param '%ZZ'"), { status: 400, statusCode: 400 });
    const res = await run(decode);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ detail: 'Malformed URL' });
  });

  it('leaves an HttpError and a real failure as they were', async () => {
    const teapot = await run(new HttpError(418, 'I am a teapot'));
    expect(teapot.status).toBe(418);
    expect(teapot.body).toEqual({ detail: 'I am a teapot' });
    const boom = await run(new Error('database exploded'));
    expect(boom.status).toBe(500);
    expect(boom.body.detail).toBe('Internal server error');
  });
});
