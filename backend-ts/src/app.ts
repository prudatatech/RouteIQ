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
import { wsManager } from './core/websocket';
import apiRouter from './routes';

export const WS_PATH = '/api/v1/telemetry/ws';

// CORS — exact origins from ALLOWED_ORIGINS, margixindia.com and its
// subdomains over https, the web app's own Vercel production address,
// and optional regexes in CORS_ORIGIN_PATTERNS
// (e.g. this project's Vercel preview URLs). Clients authenticate with
// Bearer tokens, so credentials (cookies) are not allowed cross-origin.
/** Production address of the web app on Vercel (the project's own deployment). */
const WEB_APP_VERCEL_HOST = 'margixindia.vercel.app';

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
    || url.hostname === WEB_APP_VERCEL_HOST
  )) {
    return true;
  }
  return settings.CORS_ORIGIN_PATTERNS.some(pattern => pattern.test(origin));
}

// ── Express app ────────────────────────────────────────────
export function createApp(): express.Express {
  const app = express();

  // Railway terminates TLS at its proxy; trust one hop so req.ip is the client address
  app.set('trust proxy', 1);

  // ── Middleware (order matters — outermost first) ──────────

  // 1. Request ID — adds X-Request-ID header to every response
  app.use((req, res, next) => {
    const requestId = req.headers['x-request-id'] as string || uuidv4();
    res.setHeader('X-Request-ID', requestId);
    next();
  });

  // 2. Request metrics logging
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      if (settings.DEBUG) {
        console.log(`${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`);
      }
    });
    next();
  });

  // 3. Security headers
  app.use(helmet({ contentSecurityPolicy: false }));

  // 4. CORS
  app.use(cors({
    origin: (origin, callback) => {
      // Requests without an Origin header (mobile apps, curl, server-to-server) are not subject to CORS
      callback(null, !origin || isAllowedOrigin(origin));
    },
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
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

  app.get('/ready', async (_req, res) => {
    try {
      if (redis) await redis.ping();
      res.json({ status: 'ready', redis: 'ok', database: 'ok' });
    } catch (e: any) {
      console.error('[ready] Redis ping failed:', e);
      res.status(503).json({ status: 'not_ready' });
    }
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
