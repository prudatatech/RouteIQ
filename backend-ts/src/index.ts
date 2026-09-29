/**
 * margixindia powered by PRUDATA TECHNOLOGIES — Fleet Intelligence Platform
 * TypeScript/Express Application Entry Point
 * 
 * Ports: backend/app/main.py
 * 
 * This is the main server file. It starts:
 * - The Express app and WebSocket server (built in ./app)
 * - Background services (Fleet Health Monitor, SparkGPS Sync)
 * - The HTTP listener and shutdown handlers
 */
import { settings } from './core/config';
import { getBackendSecret } from './core/auth';
import { redis, cacheSet } from './core/redis';
import { fleetHealthMonitor } from './services/fleet-health.service';
import { createApp, createHttpServer } from './app';

// ── Create Express app ─────────────────────────────────────
const app = createApp();
const server = createHttpServer(app);

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

  // 5. Check TomTom for traffic incidents along active routes (skipped when TOMTOM_API_KEY is not set)
  const { startTrafficMonitor } = await import('./services/traffic.service');
  if (startTrafficMonitor()) console.log(`✅ Traffic incident check started (every ${settings.TRAFFIC_REFRESH_MINUTES} min)`);
  else console.log('ℹ️  Traffic incident check off: TOMTOM_API_KEY is not set');

  // 6. Start HTTP server
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
