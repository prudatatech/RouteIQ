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
 *
 * One server is not enough on its own: superagent sends every request with
 * `agent: false`, i.e. a new TCP connection that is closed after one
 * response. The ~1,500 requests of a full run, plus the app's own calls to
 * the mock Supabase server, left ~18k sockets in TIME_WAIT (30s on macOS),
 * which ran out of ephemeral ports and failed connects with EADDRNOTAVAIL.
 * So requests that did not choose an agent go through one keep-alive agent
 * and reuse their connection to this file's server. When the server closes
 * in `afterAll`, it also closes those idle sockets.
 */
import type express from 'express';
import http from 'node:http';
import { Request } from 'superagent';
import { afterAll, beforeAll } from 'vitest';
import { createApp, createHttpServer } from '../../src/app';

const keepAlive = Symbol.for('routeiq.test.superagentKeepAlive');

// superagent is loaded once per worker and shared by every test file it runs,
// so the patch is applied only once
// (`request()` builds the node:http request from `_agent`; neither is in superagent's typings)
const proto = Request.prototype as unknown as { _agent: http.Agent | false; request(): http.ClientRequest };
if (!(keepAlive in proto)) {
  const agent = new http.Agent({ keepAlive: true });
  const send = proto.request;
  Object.defineProperty(proto, keepAlive, { value: agent });
  proto.request = function (this: typeof proto) {
    if (this._agent === false) this._agent = agent;
    return send.call(this);
  };
}

export function testApp(app: express.Express = createApp()): http.Server {
  const server = createHttpServer(app);
  beforeAll(() => new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve())));
  afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));
  return server;
}
