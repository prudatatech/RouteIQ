/**
 * margixindia — client for the Python ML service.
 *
 * The service is optional in production (it is a separate deployment), so every
 * caller must have a fallback. `mlPost` throws MlUnavailableError for any reason
 * the caller should fall back on, and fallbacks are logged with `logFallback`.
 */
import { settings } from '../../core/config';
import { externalHttp } from '../../core/http';

export class MlUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MlUnavailableError';
  }
}

/** A short probe, so an unreachable host costs seconds and not the whole solve budget. */
const HEALTH_TIMEOUT_MS = 2_000;
const HEALTH_UP_TTL_MS = 30_000;
const HEALTH_DOWN_TTL_MS = 15_000;

let health: { ok: boolean; at: number } | null = null;

/** Forgets the last health answer (tests, and after the URL changes). */
export function resetMlHealth(): void {
  health = null;
}

export async function mlHealthy(): Promise<boolean> {
  const now = Date.now();
  if (health && now - health.at < (health.ok ? HEALTH_UP_TTL_MS : HEALTH_DOWN_TTL_MS)) return health.ok;
  try {
    const res = await fetch(`${settings.ML_SERVICE_URL}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    health = { ok: res.ok, at: now };
  } catch {
    health = { ok: false, at: now };
  }
  return health.ok;
}

export interface MlPostOptions {
  timeoutMs: number;
  /** Check /health first (cached). Use for long calls, so a dead host does not use the whole timeout. */
  probe?: boolean;
}

export async function mlPost<T = any>(path: string, body: unknown, options: MlPostOptions): Promise<T> {
  if (options.probe && !(await mlHealthy())) throw new MlUnavailableError('ML service did not answer its health check');
  try {
    return await externalHttp.postJson<T>(`${settings.ML_SERVICE_URL}${path}`, body, options.timeoutMs);
  } catch (e) {
    const err = e as Error;
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    if (options.probe && (timedOut || /fetch failed|ECONN|ENOTFOUND/i.test(err.message))) health = { ok: false, at: Date.now() };
    throw new MlUnavailableError(timedOut ? `ML service timed out after ${options.timeoutMs / 1000}s` : err.message);
  }
}

/** One line in the log each time the in-process fallback replaces the ML service. */
export function logFallback(operation: string, reason: unknown, using: string): void {
  const why = reason instanceof Error ? reason.message : String(reason);
  console.warn(`[optimizer] ${operation}: ML service unavailable (${why}); using ${using}`);
}
