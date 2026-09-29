/**
 * margixindia — Scheduler
 *
 * One interval job for the bidding side of the platform:
 *   - closes bidding windows whose end time has passed (resolveExpiredWindows)
 *   - auto-resolves driver confirmations nobody answered (checkConfirmationsTimeout)
 * Both steps only touch rows that are still waiting, so running a tick twice, or
 * two servers ticking at once, does no harm. Started from index.ts only; the
 * test app never starts it.
 */
import { capacityService } from './capacity.service';

export const SCHEDULER_INTERVAL_MS = 60_000;

let running = false;

/** One pass. Never throws; a failure in one step does not stop the other. Skips if the previous pass is still running. */
export async function runSchedulerTick(): Promise<{ windowsClosed: number } | null> {
  if (running) return null;
  running = true;
  try {
    let windowsClosed = 0;
    try {
      windowsClosed = await capacityService.resolveExpiredWindows();
    } catch (e: any) {
      console.error('[scheduler] Closing expired windows failed:', e.message);
    }
    try {
      await capacityService.checkConfirmationsTimeout();
    } catch (e: any) {
      console.error('[scheduler] Confirmation timeout check failed:', e.message);
    }
    return { windowsClosed };
  } finally {
    running = false;
  }
}

/** Starts the interval and returns a function that stops it. */
export function startScheduler(intervalMs = SCHEDULER_INTERVAL_MS): () => void {
  const timer = setInterval(() => { void runSchedulerTick(); }, intervalMs);
  return () => clearInterval(timer);
}
