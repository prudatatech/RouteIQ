/**
 * margixindia — Error responses
 *
 * HttpError messages are written for clients and returned as-is. Anything
 * else is logged with the request ID and returned as a generic 500, so
 * database and library messages never reach clients.
 */
import { Request, Response, NextFunction } from 'express';

export class HttpError extends Error {
  /** `extra` is merged into the JSON body next to the message (e.g. the existing record behind a 409). */
  constructor(public readonly status: number, message: string, public readonly extra?: Record<string, unknown>) {
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
    res.status(err.status).json({ ...err.extra, [key]: err.message });
    return;
  }
  const requestId = res.getHeader('X-Request-ID');
  console.error(`[${requestId ?? '-'}] ${req.method} ${req.originalUrl}:`, err);
  res.status(500).json({ [key]: 'Internal server error', request_id: requestId });
}

/**
 * Trim and validate a required rejection reason (3-500 chars). Throws a 400
 * HttpError otherwise. Used by every reject endpoint that stores why.
 */
export function parseRejectionReason(value: unknown): string {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (reason.length < 3 || reason.length > 500) {
    throw new HttpError(400, 'A reason of 3 to 500 characters is required');
  }
  return reason;
}

/** Final Express error handler. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  // Malformed JSON bodies from express.json()
  if ((err as { type?: string })?.type === 'entity.parse.failed') {
    res.status(400).json({ detail: 'Malformed JSON body' });
    return;
  }
  // A bad percent-escape in the URL (/track/%ZZ): Express throws a URIError (status 400) while decoding
  // a :param. The client's mistake, not ours.
  if (isMalformedUrl(err)) {
    res.status(400).json({ detail: 'Malformed URL' });
    return;
  }
  sendError(req, res, err);
}

/** True for a URI decode failure that Express raised: a URIError, or a non-HttpError 4xx whose message says it could not decode. */
function isMalformedUrl(err: unknown): boolean {
  if (err instanceof HttpError || typeof err !== 'object' || err === null) return false;
  if (err instanceof URIError) return true;
  const e = err as { status?: unknown; statusCode?: unknown; message?: unknown };
  const status = Number(e.status ?? e.statusCode);
  return status >= 400 && status < 500 && /decode/i.test(String(e.message ?? ''));
}

/** 404 for unmatched routes. */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ detail: 'Not found' });
}
