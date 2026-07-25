/**
 * RouteIQ — Redis cache client with in-memory fallback
 * Ports: backend/app/core/redis.py
 * 
 * When Redis is unavailable (e.g., local dev without Redis installed),
 * automatically falls back to an in-memory Map. This keeps OTP and
 * other cache flows working without requiring Redis.
 */
import Redis from 'ioredis';
import { settings } from './config';

// ── In-memory fallback ─────────────────────────────────────
const memoryCache = new Map<string, { value: string; expiresAt: number }>();
let redisAvailable = true;

function memGet(key: string): string | null {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value;
}

function memSet(key: string, value: string, ttlSeconds: number): void {
  memoryCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

function memDel(key: string): void {
  memoryCache.delete(key);
}

// ── Redis client ───────────────────────────────────────────
export const redis = new Redis(settings.REDIS_URL, {
  maxRetriesPerRequest: 1,
  lazyConnect: true,
  retryStrategy: (times) => {
    if (times > 2) {
      redisAvailable = false;
      console.warn('Redis unavailable — using in-memory cache fallback');
      return null; // Stop retrying
    }
    return Math.min(times * 200, 1000);
  },
});

redis.on('error', (err) => {
  if (redisAvailable) {
    console.warn(`Redis connection error: ${err.message} — falling back to in-memory cache`);
    redisAvailable = false;
  }
});

redis.on('connect', () => {
  redisAvailable = true;
  console.log('Redis connected');
});

/**
 * Get a cached value, auto-deserializing JSON.
 * Falls back to in-memory cache if Redis is down.
 */
export async function cacheGet<T = any>(key: string): Promise<T | null> {
  // Try Redis first
  if (redisAvailable) {
    try {
      const value = await redis.get(key);
      if (value === null) return null;
      try {
        return JSON.parse(value) as T;
      } catch {
        return value as unknown as T;
      }
    } catch (e: any) {
      redisAvailable = false;
      console.warn(`Redis cacheGet error: ${e.message} — using memory fallback`);
    }
  }

  // Fallback to in-memory
  const value = memGet(key);
  if (value === null) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return value as unknown as T;
  }
}

/**
 * Set a cached value, auto-serializing to JSON.
 * Falls back to in-memory cache if Redis is down.
 */
export async function cacheSet(key: string, value: any, ttl: number = settings.REDIS_CACHE_TTL): Promise<void> {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);

  if (redisAvailable) {
    try {
      await redis.setex(key, ttl, serialized);
      return;
    } catch (e: any) {
      redisAvailable = false;
      console.warn(`Redis cacheSet error: ${e.message} — using memory fallback`);
    }
  }

  // Fallback to in-memory
  memSet(key, serialized, ttl);
}

/**
 * Delete a cached key.
 */
export async function cacheDelete(key: string): Promise<void> {
  memDel(key); // Always clean memory too

  if (redisAvailable) {
    try {
      await redis.del(key);
    } catch (e: any) {
      console.warn(`Redis cacheDelete error: ${e.message}`);
    }
  }
}

/**
 * Delete all keys matching a pattern.
 */
export async function cacheDeletePattern(pattern: string): Promise<number> {
  // Clean memory cache by pattern
  let deleted = 0;
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
  for (const key of memoryCache.keys()) {
    if (regex.test(key)) {
      memoryCache.delete(key);
      deleted++;
    }
  }

  if (redisAvailable) {
    try {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        return await redis.del(...keys);
      }
    } catch (e: any) {
      console.warn(`Redis cacheDeletePattern error: ${e.message}`);
    }
  }

  return deleted;
}
