/**
 * margixindia powered by PRUDATA TECHNOLOGIES — Fleet Intelligence Platform
 * TypeScript/Express Application Entry Point
 * 
 * Ports: backend/app/main.py
 * 
 * This is the main server file. It wires up:
 * - Express middleware (CORS, Helmet, GZip, Request ID, Metrics)
 * - API v1 routes (same /api/v1 prefix as Python backend)
 * - WebSocket server (same /api/v1/telemetry/ws path)
 * - Background services (Fleet Health Monitor, SparkGPS Sync)
 * - Health & readiness endpoints
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';

import { settings } from './core/config';
import { authenticateToken, getBackendSecret } from './core/auth';
import { isStaff } from './core/ownership';
import { errorHandler, notFoundHandler } from './core/errors';
import { redis } from './core/redis';
import { wsManager } from './core/websocket';
import apiRouter from './routes';
import { fleetHealthMonitor } from './services/fleet-health.service';
import { cacheSet } from './core/redis';

// ── Create Express app ─────────────────────────────────────
const app = express();
const server = createServer(app);

// Railway terminates TLS at its proxy; trust one hop so req.ip is the client address
app.set('trust proxy', 1);

// ── Middleware (order matters — outermost first) ────────────

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

// 4. CORS — exact origins from ALLOWED_ORIGINS, margixindia.com and its
// subdomains over https, and optional regexes in CORS_ORIGIN_PATTERNS
// (e.g. this project's Vercel preview URLs). Clients authenticate with
// Bearer tokens, so credentials (cookies) are not allowed cross-origin.
function isAllowedOrigin(origin: string): boolean {
  if (settings.ALLOWED_ORIGINS.includes(origin)) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol === 'https:' && (url.hostname === 'margixindia.com' || url.hostname.endsWith('.margixindia.com'))) {
    return true;
  }
  return settings.CORS_ORIGIN_PATTERNS.some(pattern => pattern.test(origin));
}

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
app.use(express.json({ limit: '10mb' }));
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

// ── WebSocket server ───────────────────────────────────────
// Live fleet feed for staff dashboards. The client passes its access token
// as ?token=... (browsers cannot set headers on WebSocket requests).
const WS_PATH = '/api/v1/telemetry/ws';
const wss = new WebSocket.Server({ noServer: true });

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

// ── Startup lifecycle ──────────────────────────────────────

/** Refuse to run in production with missing or weak auth configuration. */
function assertSecureConfig(): void {
  const problems: string[] = [];
  if (!settings.SUPABASE_URL) problems.push('SUPABASE_URL is not set');
  const secret = getBackendSecret();
  if (!secret) problems.push('SUPABASE_JWT_SECRET (or SECRET_KEY) is not set');
  else if (secret.length < 32) problems.push('backend JWT secret is shorter than 32 characters');

  if (problems.length === 0) return;
  if (settings.isProduction) throw new Error(`Insecure configuration: ${problems.join('; ')}`);
  console.warn(`⚠️  Insecure configuration (allowed outside production): ${problems.join('; ')}`);
}

async function startup(): Promise<void> {
  assertSecureConfig();

  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  ${settings.APP_NAME}`);
  console.log(`  Environment: ${settings.APP_ENV}`);
  console.log('═══════════════════════════════════════════════════════════');

  // 1. Connect Redis (non-fatal — app works without cache)
  try {
    if (redis) await redis.ping();
    console.log('✅ Redis connected successfully');
  } catch (e: any) {
    console.warn(`⚠️  Redis unavailable: ${e.message}. Continuing without cache.`);
  }

  // 2. Start Fleet Health Monitor (background interval)
  fleetHealthMonitor.start();
  console.log('✅ Fleet Health Monitor started');

  // 3. Auto-resolve driver capacity confirmations nobody answered (2 min / 15 min timers)
  const { capacityService } = await import('./services/capacity.service');
  setInterval(() => {
    capacityService.checkConfirmationsTimeout().catch((e) => console.error('Confirmation timeout check failed:', e));
  }, 60_000);
  console.log('✅ Confirmation timeout checker started (60s interval)');

  // 4. Start SparkGPS background sync if enabled
  if (settings.ENABLE_HARDWARE_SYNC) {
    const { SparkGPSService } = await import('./services/spark-gps.service');
    setInterval(async () => {
      try {
        await SparkGPSService.fetchAndSync();
        await cacheSet('system:sparkgps:sync_pulse', 'active', 45);
      } catch (e: any) {
        console.error(`Error in SparkGPS sync task: ${e.message}`);
      }
    }, 30_000); // Every 30 seconds
    console.log('✅ SparkGPS Background Sync started (30s interval)');
  }

  // 5. Start HTTP server
  server.listen(settings.PORT, () => {
    console.log(`🚀 Server listening on http://0.0.0.0:${settings.PORT}`);
    console.log(`📡 WebSocket at ws://0.0.0.0:${settings.PORT}/api/v1/telemetry/ws`);
    console.log(`📋 API docs: http://localhost:${settings.PORT}/health`);
    console.log('═══════════════════════════════════════════════════════════');
  });
}

// ── Shutdown lifecycle ─────────────────────────────────────
async function shutdown(): Promise<void> {
  console.log('\n🛑 Shutting down...');
  fleetHealthMonitor.stop();
  server.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ── Launch ─────────────────────────────────────────────────
startup().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

export default app;
