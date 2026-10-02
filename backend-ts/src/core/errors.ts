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
  // A database refusal that is the caller's doing (a value that is not a uuid or date, a duplicate) is a 4xx, never a 500
  const known = clientDatabaseError(err);
  if (known) {
    res.status(known.status).json({ [key]: known.message });
    return;
  }
  const requestId = res.getHeader('X-Request-ID');
  console.error(`[${requestId ?? '-'}] ${req.method} ${req.originalUrl}:`, err);
  res.status(500).json({ [key]: 'Internal server error', request_id: requestId });
}

/**
 * PostgreSQL codes that say the request was wrong rather than the server: 22P02 / 22007 / 22008 / 22003 (a malformed
 * uuid, enum, date or number in the URL or query), 23505 (already exists), 23503 (names a record that is not there).
 */
export function clientDatabaseError(err: unknown): { status: number; message: string } | null {
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
  switch (code) {
    case '22P02': case '22007': case '22008': case '22003':
      return { status: 400, message: 'One of the values sent is not valid' };
    case '23505':
      return { status: 409, message: 'That already exists' };
    case '23503':
      return { status: 409, message: 'It refers to something that does not exist' };
    default:
      return null;
  }
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
