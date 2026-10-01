/**
 * Per-request timing.
 *
 * An AsyncLocalStorage store follows each request through every await. The Supabase client's fetch
 * (see core/supabase.ts) adds each database call to the store, so a response can say how many
 * queries it ran and how long they took in total: the Server-Timing header, and the SLOW log line.
 */
import { AsyncLocalStorage } from 'async_hooks';
import type { NextFunction, Request, Response } from 'express';

export const SLOW_REQUEST_MS = 500;

interface RequestTiming {
  start: number;
  dbCalls: number;
  dbMs: number;
  route?: string;
}

const storage = new AsyncLocalStorage<RequestTiming>();

/** Record one finished database call against the current request (no-op outside a request). */
export function recordDbCall(ms: number): void {
  const t = storage.getStore();
  if (!t) return;
  t.dbCalls += 1;
  t.dbMs += ms;
}

/** Wraps a fetch so every call it makes is timed and counted against the current request. */
export function timedFetch(base: typeof fetch = (...args) => fetch(...args)): typeof fetch {
  return async (input, init) => {
    const t0 = performance.now();
    try {
      return await base(input, init);
    } finally {
      recordDbCall(performance.now() - t0);
    }
  };
}

export function serverTimingValue(t: { dbCalls: number; dbMs: number }, totalMs: number): string {
  return `db;dur=${t.dbMs.toFixed(1)};desc="${t.dbCalls} queries", total;dur=${totalMs.toFixed(1)}`;
}

/** The route pattern ("/api/v1/shipments/:id") when a route matched, else the path without its query. */
function routePattern(req: Request): string {
  const route = (req as Request & { route?: { path?: unknown } }).route;
  if (route && typeof route.path === 'string') return `${req.baseUrl}${route.path}`;
  return 'unmatched';
}

/**
 * Express middleware, mounted first. Sets Server-Timing just before headers go out (a writeHead
 * hook, so it also covers res.json / res.send / res.end) and logs requests that take SLOW_REQUEST_MS or longer.
 */
export function requestTiming(debug: () => boolean = () => false) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const t: RequestTiming = { start: performance.now(), dbCalls: 0, dbMs: 0 };

    const writeHead = res.writeHead as (...args: unknown[]) => Response;
    res.writeHead = function patchedWriteHead(this: Response, ...args: unknown[]) {
      t.route ??= routePattern(req);
      if (!this.headersSent) {
        try { this.setHeader('Server-Timing', serverTimingValue(t, performance.now() - t.start)); } catch { /* headers already flushed */ }
      }
      return writeHead.apply(this, args);
    } as typeof res.writeHead;

    res.on('finish', () => {
      const total = performance.now() - t.start;
      if (debug()) console.log(`${req.method} ${req.path} → ${res.statusCode} (${Math.round(total)}ms)`);
      if (total >= SLOW_REQUEST_MS) {
        console.warn(`SLOW ${req.method} ${t.route ?? routePattern(req)} ${res.statusCode} ${Math.round(total)}ms db=${t.dbCalls}/${Math.round(t.dbMs)}ms`);
      }
    });

    storage.run(t, next);
  };
}
