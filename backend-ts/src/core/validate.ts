/**
 * margixindia — Small request-body checks shared by the routes.
 * Each throws a 400 HttpError whose message is safe to show to the person.
 */
import { HttpError } from './errors';

/**
 * An optional coordinate: `null` when the client sent none, the number when it
 * is within +/-`limit`, otherwise a 400. Accepts numbers and numeric strings.
 */
export function parseCoordinate(value: unknown, label: string, limit: number): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(n) || Math.abs(n) > limit) {
    throw new HttpError(400, `${label} must be a number between -${limit} and ${limit}`);
  }
  return n;
}

/** A required finite number within [min, max]. */
export function parseNumberInRange(value: unknown, label: string, min: number, max: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new HttpError(400, `${label} must be a number between ${min.toLocaleString('en-IN')} and ${max.toLocaleString('en-IN')}`);
  }
  return n;
}

/** An optional short text; trimmed, `undefined` when blank, a 400 when it is not text or too long. */
export function parseOptionalText(value: unknown, label: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new HttpError(400, `${label} must be text`);
  const text = value.trim();
  if (text.length > max) throw new HttpError(400, `${label} must be at most ${max} characters`);
  return text || undefined;
}

/** An ISO date-time (or a date) as an ISO string, or a 400. */
export function parseDateTime(value: unknown, label: string): string {
  const t = typeof value === 'string' || typeof value === 'number' ? new Date(value).getTime() : NaN;
  if (!Number.isFinite(t)) throw new HttpError(400, `${label} must be a valid date and time`);
  return new Date(t).toISOString();
}
