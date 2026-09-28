/**
 * margixindia — Fixed-window rate limiting backed by the shared cache.
 */
import { Request, Response, NextFunction } from 'express';
import { cacheIncr } from './redis';

/**
 * Count one attempt for `key`; returns false once more than `limit`
 * attempts were made within `windowSeconds`.
 */
export async function consumeRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  return (await cacheIncr(`ratelimit:${key}`, windowSeconds)) <= limit;
}

/**
 * Middleware: limit requests per client IP for one named action.
 */
export function rateLimitByIp(action: string, limit: number, windowSeconds: number) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (await consumeRateLimit(`${action}:ip:${req.ip}`, limit, windowSeconds)) {
        next();
        return;
      }
      res.status(429).json({ detail: 'Too many requests. Please try again later.' });
    } catch (e) {
      next(e);
    }
  };
}
