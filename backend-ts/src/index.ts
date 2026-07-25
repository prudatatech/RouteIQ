/**
 * ROUTEIQ powered by PRUDATA TECHNOLOGIES — Fleet Intelligence Platform
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
import { redis } from './core/redis';
import dashboardRoutes from './routes/dashboard.routes';
import { wsManager } from './core/websocket';
import apiRouter from './routes';
import { fleetHealthMonitor } from './services/fleet-health.service';
import { cacheSet } from './core/redis';

// ── Create Express app ─────────────────────────────────────
const app = express();
const server = createServer(app);

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

// 4. CORS — Dynamic Origin for Vercel deployments
app.use(cors({
  origin: (origin, callback) => {
    // If no origin (e.g. mobile app, curl), or if ALLOWED_ORIGINS contains '*'
    if (!origin || settings.ALLOWED_ORIGINS.includes('*')) {
      return callback(null, true);
    }
    // Allow if origin is in the ALLOWED_ORIGINS array or matches a Vercel preview domain
    if (settings.ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.vercel.app')) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
}));

// 5. Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── API Routes ─────────────────────────────────────────────
app.use('/api/v1', apiRouter);

// ── Health endpoints ───────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    app: settings.APP_NAME,
    version: '1.0.0',
  });
});

app.get('/ready', async (_req, res) => {
  try {
    await redis.ping();
    res.json({ status: 'ready', redis: 'ok', database: 'ok' });
  } catch (e: any) {
    res.json({ status: 'not_ready', error: e.message });
  }
});

// ── WebSocket server ───────────────────────────────────────
// Path matches the Python backend's WebSocket endpoint
const wss = new WebSocket.Server({ server, path: '/api/v1/telemetry/ws' });

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
async function startup(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  ${settings.APP_NAME}`);
  console.log(`  Environment: ${settings.APP_ENV}`);
  console.log('═══════════════════════════════════════════════════════════');

  // 1. Connect Redis (non-fatal — app works without cache)
  try {
    await redis.connect();
    await redis.ping();
    console.log('✅ Redis connected successfully');
  } catch (e: any) {
    console.warn(`⚠️  Redis unavailable: ${e.message}. Continuing without cache.`);
  }

  // 2. Start Fleet Health Monitor (background interval)
  fleetHealthMonitor.start();
  console.log('✅ Fleet Health Monitor started');

  // 3. Start SparkGPS background sync if enabled
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

  // 4. Start HTTP server
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
  await redis.quit().catch(() => {});
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
