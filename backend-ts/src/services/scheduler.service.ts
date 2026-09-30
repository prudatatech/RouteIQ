/**
 * margixindia — Scheduler
 *
 * One interval job:
 *   - reminds staff about SOS alerts nobody has acknowledged or resolved (escalateStaleSos)
 *   - escalates cargo cases past their SLA (escalateOverdueExceptions), and opens a delay case
 *     for goods whose live ETA slips past CARGO_DELAY_EXCEPTION_MINUTES (detectDelays)
 *   - closes bidding windows whose end time has passed (resolveExpiredWindows)
 *   - auto-resolves driver confirmations nobody answered (checkConfirmationsTimeout)
 *   - once per Indian calendar day, the people job (people-jobs.service): documents past
 *     their expiry become expired and reminders go out, leave and suspensions that ended
 *     return people to active, and old document files are deleted after retention
 *   - every ODOMETER_SYNC_INTERVAL_MINUTES, each vehicle's odometer takes in the distance it has
 *     driven since its last update (odometer-sync.service)
 * The steps only touch rows that are still waiting, so running a tick twice, or
 * two servers ticking at once, does no harm. Started from index.ts only; the
 * test app never starts it.
 */
import { capacityService } from './capacity.service';
import { escalateStaleSos } from './sos.service';
import { detectDelays, escalateOverdueExceptions } from './cargo/exception.service';
import { runPeopleDailyJob } from './people-jobs.service';
import { todayKey } from './people-docs.service';
import { syncAllOdometers } from './odometer-sync.service';
import { settings } from '../core/config';

export const SCHEDULER_INTERVAL_MS = 60_000;

let running = false;
let documentsCheckedOn = '';
let odometersSyncedAt = 0;

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
    try {
      await escalateStaleSos();
    } catch (e: any) {
      console.error('[scheduler] SOS reminder check failed:', e.message);
    }
    try {
      await escalateOverdueExceptions();
    } catch (e: any) {
      console.error('[scheduler] Cargo case escalation failed:', e.message);
    }
    try {
      await detectDelays();
    } catch (e: any) {
      console.error('[scheduler] Cargo delay check failed:', e.message);
    }
    const today = todayKey();
    if (documentsCheckedOn !== today) {
      try {
        const result = await runPeopleDailyJob();
        // A step that failed is tried again on the next tick
        if (result.failed.length === 0) documentsCheckedOn = today;
      } catch (e: any) {
        console.error('[scheduler] People daily job failed:', e.message);
      }
    }
    const intervalMs = Math.max(1, settings.ODOMETER_SYNC_INTERVAL_MINUTES) * 60_000;
    if (Date.now() - odometersSyncedAt >= intervalMs) {
      try {
        await syncAllOdometers();
        odometersSyncedAt = Date.now();
      } catch (e: any) {
        console.error('[scheduler] Odometer sync failed:', e.message);
      }
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
