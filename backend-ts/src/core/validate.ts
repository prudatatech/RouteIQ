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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `value` looks like an id from the database (a uuid). */
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_PATTERN.test(value);

/**
 * A path id that must be a uuid. Anything else cannot name a record, so it is a 404 (not found) and
 * never reaches the database, which would answer a 500 for a malformed uuid.
 */
export function uuidParam(value: unknown, notFound: string): string {
  if (!isUuid(value)) throw new HttpError(404, notFound);
  return value;
}

/** A uuid sent in a body that must be one: a 400 naming the field when it is not. */
export function parseUuid(value: unknown, label: string): string {
  if (!isUuid(value)) throw new HttpError(400, `${label} is not valid`);
  return value;
}
