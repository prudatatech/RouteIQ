/**
 * One HTTP server per test file for supertest, listening for the file's
 * whole run instead of a fresh ephemeral server per request.
 *
 * `request(app)`, where `app` is the Express app (a function, not a
 * listening server), makes supertest wrap it in a brand new
 * `http.createServer(app).listen(0)` for *every single call* — see
 * supertest's `lib/index.js`. A file with dozens of requests was churning
 * through that many ephemeral listen/close cycles on 127.0.0.1 per run,
 * and under the concurrent load of the full suite that occasionally
 * desynced a client mid-request: "socket hang up", ECONNRESET, or an HTTP
 * parse error ("Expected HTTP/, RTSP/...") on an otherwise-unrelated call,
 * at a rate of roughly 1 in 15-25 full runs.
 *
 * Passing an already-listening server instead avoids the churn entirely:
 * supertest only auto-creates (and auto-closes) a server when it had to
 * wrap a bare function itself (`lib/test.js` `serverAddress()`) — a server
 * that arrives already listening is treated as caller-owned and reused for
 * every call, exactly like `websocket.test.ts` already does with
 * `createHttpServer()`.
 */
import type express from 'express';
import http from 'node:http';
import { afterAll, beforeAll } from 'vitest';
import { createApp, createHttpServer } from '../../src/app';

export function testApp(app: express.Express = createApp()): http.Server {
  const server = createHttpServer(app);
  beforeAll(() => new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve())));
  afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
  return server;
}
