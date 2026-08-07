/**
 * RouteIQ — Redis cache client with in-memory fallback
 * Using Upstash REST Client (@upstash/redis)
 * 
 * When Redis is unavailable (e.g., local dev without Redis installed),
 * automatically falls back to an in-memory Map. This keeps OTP and
 * other cache flows working without requiring Redis.
 */
import { Redis } from '@upstash/redis';
import { settings } from './config';
import dotenv from 'dotenv';
dotenv.config();

// ── In-memory fallback ─────────────────────────────────────
const memoryCache = new Map<string, { value: string; expiresAt: number }>();
let redisAvailable = false;

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
export let redis: Redis | null = null;

if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  redisAvailable = true;
  console.log('Upstash Redis REST client initialized');
} else {
  console.warn('Upstash Redis credentials missing — using in-memory cache fallback');
}

/**
 * Get a cached value, auto-deserializing JSON.
 * Falls back to in-memory cache if Redis is down.
 */
export async function cacheGet<T = any>(key: string): Promise<T | null> {
  // Try Redis first
  if (redisAvailable && redis) {
    try {
      const value = await redis.get(key);
      if (value === null) return null;
      // @upstash/redis automatically parses JSON for Objects!
      if (typeof value === 'object') {
        return value as unknown as T;
      }
      try {
        return JSON.parse(value as string) as T;
      } catch {
        return value as unknown as T;
      }
    } catch (e: any) {
      console.warn(`Upstash cacheGet error: ${e.message} — falling back to memory`);
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
  // We serialize arrays and objects so mem fallback behaves consistently,
  // though Upstash supports passing objects directly.
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);

  if (redisAvailable && redis) {
    try {
      await redis.setex(key, ttl, serialized);
      // Ensure memory mirror is updated or skipped; we'll skip to save memory
      return;
    } catch (e: any) {
      console.warn(`Upstash cacheSet error: ${e.message} — falling back to memory`);
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

  if (redisAvailable && redis) {
    try {
      await redis.del(key);
    } catch (e: any) {
      console.warn(`Upstash cacheDelete error: ${e.message}`);
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

  if (redisAvailable && redis) {
    try {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        return await redis.del(...keys);
      }
    } catch (e: any) {
      console.warn(`Upstash cacheDeletePattern error: ${e.message}`);
    }
  }

  return deleted;
}
