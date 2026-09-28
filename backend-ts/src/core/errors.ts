/**
 * margixindia — Error responses
 *
 * HttpError messages are written for clients and returned as-is. Anything
 * else is logged with the request ID and returned as a generic 500, so
 * database and library messages never reach clients.
 */
import { Request, Response, NextFunction } from 'express';

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

type ErrorKey = 'detail' | 'error';

/**
 * Send an error response. `key` keeps each route's existing response shape
 * (most routes use `detail`, some use `error`).
 */
export function sendError(req: Request, res: Response, err: unknown, key: ErrorKey = 'detail'): void {
  if (res.headersSent) return;
  if (err instanceof HttpError) {
    res.status(err.status).json({ [key]: err.message });
    return;
  }
  const requestId = res.getHeader('X-Request-ID');
  console.error(`[${requestId ?? '-'}] ${req.method} ${req.originalUrl}:`, err);
  res.status(500).json({ [key]: 'Internal server error', request_id: requestId });
}

/** Final Express error handler. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  // Malformed JSON bodies from express.json()
  if ((err as { type?: string })?.type === 'entity.parse.failed') {
    res.status(400).json({ detail: 'Malformed JSON body' });
    return;
  }
  sendError(req, res, err);
}

/** 404 for unmatched routes. */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ detail: 'Not found' });
}
