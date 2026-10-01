/**
 * margixindia powered by PRUDATA TECHNOLOGIES — Fleet Intelligence Platform
 * Express application and HTTP server
 *
 * Builds the app without side effects (no timers, no listen, no process
 * handlers), so src/index.ts can start it and tests can exercise it directly:
 * - Express middleware (CORS, Helmet, Request ID, Metrics)
 * - API v1 routes (same /api/v1 prefix as Python backend)
 * - Health & readiness endpoints
 * - Authenticated WebSocket server (same /api/v1/telemetry/ws path)
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import http from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';

import { settings } from './core/config';
import { authenticateToken } from './core/auth';
import { isStaff } from './core/ownership';
import { errorHandler, notFoundHandler } from './core/errors';
import { redis } from './core/redis';
import { supabase } from './core/supabase';
import { wsManager } from './core/websocket';
import { requestTiming } from './core/timing';
import apiRouter from './routes';

export const WS_PATH = '/api/v1/telemetry/ws';

// CORS — exact origins from ALLOWED_ORIGINS (each stage's web app, set by infra/main.bicep),
// margixindia.com and its subdomains over https (portal., staging., …), and optional regexes in
// CORS_ORIGIN_PATTERNS. Clients authenticate with Bearer tokens, so credentials (cookies) are not
// allowed cross-origin.

function isAllowedOrigin(origin: string): boolean {
  if (settings.ALLOWED_ORIGINS.includes(origin)) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol === 'https:' && (
    url.hostname === 'margixindia.com'
    || url.hostname.endsWith('.margixindia.com')
  )) {
    return true;
  }
  return settings.CORS_ORIGIN_PATTERNS.some(pattern => pattern.test(origin));
}

// ── Helpers ────────────────────────────────────────────────
const READY_TIMEOUT_MS = 2000;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

/** The client's X-Request-ID when it is 1 to 64 letters, digits or hyphens; otherwise a new UUID. */
export function requestIdFrom(header: string | string[] | undefined): string {
  return typeof header === 'string' && REQUEST_ID_PATTERN.test(header) ? header : uuidv4();
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms); });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

// ── Express app ────────────────────────────────────────────
export function createApp(): express.Express {
  const app = express();

  // Railway terminates TLS at its proxy; trust one hop so req.ip is the client address
  app.set('trust proxy', 1);

  // ── Middleware (order matters — outermost first) ──────────

  // 1. Request ID — adds X-Request-ID header to every response. A client's id is kept only when it
  // is a plain id; anything else (markup, long or non-ASCII values) is replaced, so logs cannot be forged.
  app.use((req, res, next) => {
    const requestId = requestIdFrom(req.headers['x-request-id']);
    res.setHeader('X-Request-ID', requestId);
    next();
  });

  // 2. Request timing: Server-Timing header, per-request DB call count, SLOW log (>= 500 ms), DEBUG request log
  app.use(requestTiming(() => settings.DEBUG));

  // 3. Security headers
  app.use(helmet({ contentSecurityPolicy: false }));
  // The API never needs the camera, microphone or location of whoever opens it in a browser
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  // 4. CORS
  app.use(cors({
    origin: (origin, callback) => {
      // Requests without an Origin header (mobile apps, curl, server-to-server) are not subject to CORS
      callback(null, !origin || isAllowedOrigin(origin));
    },
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Org-Id'],
  }));

  // 5. Body parsers
  app.use(express.json({
    limit: '10mb',
    // Kept for webhooks that sign the raw body (see routes/telematics.routes.ts)
    verify: (req, _res, buf) => { (req as express.Request & { rawBody?: Buffer }).rawBody = buf; },
  }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // ── API Routes ─────────────────────────────────────────────
  app.use('/api/v1', apiRouter);

  // ── Health endpoints ───────────────────────────────────────
  app.get('/', (_req, res) => {
    res.json({
      status: 'online',
      message: 'margixindia API is running.',
      version: '1.0.0',
    });
  });

  app.get('/health', (_req, res) => {
    res.json({
      status: 'healthy',
      app: settings.APP_NAME,
      version: '1.0.0',
    });
  });

  // Ready only when the database answers (and Redis, when it is configured), each within 2 s
  app.get('/ready', async (_req, res) => {
    const check = (work: PromiseLike<unknown>): Promise<boolean> =>
      withTimeout(Promise.resolve(work), READY_TIMEOUT_MS).then(() => true, (e: unknown) => { console.error('[ready] dependency check failed:', e); return false; });
    const [database, cache] = await Promise.all([
      check(Promise.resolve(supabase.from('users').select('id').limit(1)).then(({ error }) => { if (error) throw new Error(error.message); })),
      redis ? check(redis.ping()) : Promise.resolve(true),
    ]);
    const body = { status: database && cache ? 'ready' : 'not_ready', database: database ? 'ok' : 'down', redis: redis ? (cache ? 'ok' : 'down') : 'not_configured' };
    res.status(database && cache ? 200 : 503).json(body);
  });

  // ── Fallthrough handlers (must be registered last) ─────────
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

// ── HTTP server + WebSocket ────────────────────────────────
/**
 * HTTP server for `app` with the live fleet feed for staff dashboards.
 * The WebSocket client passes its access token as ?token=... (browsers
 * cannot set headers on WebSocket requests). Does not start listening.
 */
export function createHttpServer(app: express.Express = createApp()): http.Server {
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    const reject = (status: string) => {
      socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };

    const url = new URL(req.url ?? '', 'http://localhost');
    if (url.pathname !== WS_PATH) return reject('404 Not Found');

    const token = url.searchParams.get('token');
    if (!token) return reject('401 Unauthorized');
    try {
      const user = await authenticateToken(token);
      if (!isStaff(user)) return reject('403 Forbidden');
    } catch {
      return reject('401 Unauthorized');
    }

    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket) => {
    wsManager.connect(ws);

    ws.on('close', () => {
      wsManager.disconnect(ws);
    });

    ws.on('error', () => {
      wsManager.disconnect(ws);
    });
  });

  return server;
}
