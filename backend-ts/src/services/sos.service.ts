/**
 * margixindia — SOS alerts
 *
 * The life of an alert (sos_alerts.status, plain text):
 *
 *   active ──▶ acknowledged ──▶ resolved      staff handled it
 *      │            │
 *      └────────────┴────────▶ cancelled      false alarm: the driver cancelled it in the
 *                                             app, or staff closed it as a false alarm
 *
 * "Open" means still needing a response: active or acknowledged. Each step only applies from
 * the states listed in SOS_TRANSITIONS, so two people acting at once cannot undo each other,
 * and repeating the step an alert is already in succeeds without doing anything.
 *
 * A stale open alert is never left to linger silently: the scheduler calls
 * `escalateStaleSos`, which reminds staff through the normal notification mechanism (the bell,
 * with a push on the phones) and repeats, marking it escalated from the second reminder.
 */
import { supabase } from '../core/supabase';
import { HttpError } from '../core/errors';
import { notificationService } from './notification.service';
import { OWNED, assertVisible, scopeQuery } from '../core/org-scope';

export const SOS_STATUSES = ['active', 'acknowledged', 'resolved', 'cancelled'] as const;
export type SosStatus = (typeof SOS_STATUSES)[number];

/** Alerts that still need a response. */
export const OPEN_SOS_STATUSES = ['active', 'acknowledged'] as const;

/** The states each step may start from. */
export const SOS_TRANSITIONS: Record<Exclude<SosStatus, 'active'>, readonly SosStatus[]> = {
  acknowledged: ['active'],
  resolved: ['active', 'acknowledged'],
  cancelled: ['active', 'acknowledged'],
};

export interface SosAlertRow {
  id: string;
  driver_id: string | null;
  vehicle_id: string | null;
  alert_type: string | null;
  status: string | null;
  created_at: string;
  updated_at: string | null;
  /** The company that runs the vehicle: the one that is told. */
  carrier_org_id?: string | null;
}

/** A missing status is an alert nobody has touched yet. */
const statusOf = (row: { status: string | null }): string => row.status ?? 'active';

/**
 * Move an alert to `next`. `driverId` limits the change to that driver's own alert (a driver
 * cancelling from the app); staff pass nothing. Throws 404 when the alert does not exist (or is
 * not the driver's) and 409 when it is in a state the step cannot start from.
 */
export async function transitionSos(
  id: string,
  next: Exclude<SosStatus, 'active'>,
  opts: { driverId?: string } = {},
): Promise<{ alert: SosAlertRow; changed: boolean }> {
  const { data: existing, error } = await supabase
    .from('sos_alerts')
    .select('id, driver_id, vehicle_id, alert_type, status, created_at, updated_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!existing || (opts.driverId && existing.driver_id !== opts.driverId)) throw new HttpError(404, 'SOS alert not found');
  // Staff act on their own company's alerts only; another company's is a 404
  if (!opts.driverId) await assertVisible('sos_alerts', id, OWNED.carrier, 'SOS alert not found');

  const current = statusOf(existing);
  if (current === next) return { alert: existing as SosAlertRow, changed: false };
  if (!SOS_TRANSITIONS[next].includes(current as SosStatus)) {
    throw new HttpError(409, `This alert is already ${current}, so it cannot be ${next}.`);
  }

  // Service role: staff have no UPDATE policy on sos_alerts. The status filter is what makes
  // two simultaneous changes safe: only one of them matches.
  let update = supabase
    .from('sos_alerts')
    .update({ status: next, updated_at: new Date().toISOString() })
    .eq('id', id);
  update = existing.status == null ? update.is('status', null) : update.eq('status', existing.status);
  const { data, error: uErr } = await update.select('id');
  if (uErr) throw uErr;
  if (!data || data.length === 0) throw new HttpError(409, `This alert changed while you were acting on it. Refresh and check its status.`);
  return { alert: { ...(existing as SosAlertRow), status: next }, changed: true };
}

// ── Counts per vehicle ──────────────────────────────────────

export interface SosCounts {
  /** Every alert ever raised for the vehicle, including cancelled ones. */
  total: number;
  last_30_days: number;
  /** Active or acknowledged. */
  open: number;
  cancelled: number;
}

const DAY_MS = 86_400_000;
export const emptySosCounts = (): SosCounts => ({ total: 0, last_30_days: 0, open: 0, cancelled: 0 });

/** Counts per vehicle id from raw alert rows. Rows without a vehicle are skipped. */
export function summariseSos(
  rows: { vehicle_id: string | null; status: string | null; created_at: string }[],
  nowMs: number = Date.now(),
): Record<string, SosCounts> {
  const out: Record<string, SosCounts> = {};
  const since = nowMs - 30 * DAY_MS;
  for (const r of rows) {
    if (!r.vehicle_id) continue;
    const c = (out[r.vehicle_id] ??= emptySosCounts());
    c.total++;
    if (Date.parse(r.created_at) >= since) c.last_30_days++;
    const status = statusOf(r);
    if (status === 'active' || status === 'acknowledged') c.open++;
    if (status === 'cancelled') c.cancelled++;
  }
  return out;
}

const PAGE = 1000;

/** Counts for every vehicle that has raised an SOS (the database returns 1000 rows a request, so this pages). */
export async function loadSosCounts(vehicleId?: string): Promise<Record<string, SosCounts>> {
  const rows: { vehicle_id: string | null; status: string | null; created_at: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = scopeQuery(supabase.from('sos_alerts').select('vehicle_id, status, created_at'), OWNED.carrier).order('created_at', { ascending: false });
    if (vehicleId) q = q.eq('vehicle_id', vehicleId);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(`Failed to read SOS alerts: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return summariseSos(rows);
}

// ── Stale alerts ────────────────────────────────────────────

/** Minutes an alert may wait before staff are reminded: nobody has picked it up, or nobody has finished it. */
export const SOS_REMIND_AFTER_MIN: Record<'active' | 'acknowledged', number> = { active: 5, acknowledged: 30 };
/** Minutes between reminders once the first has gone out. */
export const SOS_REMIND_EVERY_MIN = 10;
/** Reminders stop after this many; by then it has been in front of everyone repeatedly. */
export const SOS_MAX_REMINDERS = 6;
/** From this reminder on, super admins are also told it has been escalated. */
export const SOS_ESCALATE_AT_REMINDER = 2;

/**
 * Whether an open alert is due a reminder now, and which one it would be. `lastReminderAt` and
 * `reminders` describe the reminders already sent for it.
 */
export function reminderDue(
  alert: { status: string | null; created_at: string; updated_at: string | null },
  sent: { reminders: number; lastReminderAt: number | null },
  nowMs: number = Date.now(),
): number | null {
  const status = statusOf(alert);
  if (status !== 'active' && status !== 'acknowledged') return null;
  if (sent.reminders >= SOS_MAX_REMINDERS) return null;
  // An acknowledged alert has been waiting since it was acknowledged (updated_at), not since it was raised.
  const waitingSince = Date.parse(status === 'acknowledged' ? alert.updated_at ?? alert.created_at : alert.created_at);
  if (!Number.isFinite(waitingSince)) return null;
  if (nowMs - waitingSince < SOS_REMIND_AFTER_MIN[status] * 60_000) return null;
  if (sent.lastReminderAt != null && nowMs - sent.lastReminderAt < SOS_REMIND_EVERY_MIN * 60_000) return null;
  return sent.reminders + 1;
}

/**
 * Remind staff about open alerts nobody has closed. Reminders are ordinary 'sos' notifications
 * carrying { alert_id, reminder: n }, and that is also how they are counted, so no extra column
 * is needed and a second server running the same tick finds the first one's reminder and waits.
 * Returns how many alerts were reminded about. Never throws for one alert's failure.
 */
export async function escalateStaleSos(nowMs: number = Date.now()): Promise<number> {
  const { data: open, error } = await supabase
    .from('sos_alerts')
    .select('id, driver_id, vehicle_id, alert_type, status, created_at, updated_at, carrier_org_id')
    .in('status', [...OPEN_SOS_STATUSES])
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) throw new Error(`Failed to read open SOS alerts: ${error.message}`);
  const alerts = (open ?? []) as SosAlertRow[];
  if (alerts.length === 0) return 0;

  const { data: past, error: nErr } = await supabase
    .from('notifications')
    .select('data, created_at')
    .eq('type', 'sos')
    .gte('created_at', alerts[0].created_at)
    .limit(5000);
  if (nErr) throw new Error(`Failed to read SOS notifications: ${nErr.message}`);
  const history = new Map<string, { reminders: number; lastReminderAt: number | null }>();
  for (const n of past ?? []) {
    const d = (n.data ?? {}) as { alert_id?: string; reminder?: number };
    if (!d.alert_id || !d.reminder) continue;
    const h = history.get(d.alert_id) ?? { reminders: 0, lastReminderAt: null };
    h.reminders = Math.max(h.reminders, d.reminder);
    const at = Date.parse(n.created_at);
    if (Number.isFinite(at)) h.lastReminderAt = Math.max(h.lastReminderAt ?? 0, at);
    history.set(d.alert_id, h);
  }

  const vehicleIds = [...new Set(alerts.map(a => a.vehicle_id).filter((v): v is string => !!v))];
  const plates = new Map<string, string>();
  if (vehicleIds.length > 0) {
    const { data: vehicles } = await supabase.from('vehicles').select('id, plate_number').in('id', vehicleIds);
    for (const v of vehicles ?? []) plates.set(v.id, v.plate_number);
  }

  let reminded = 0;
  for (const alert of alerts) {
    const n = reminderDue(alert, history.get(alert.id) ?? { reminders: 0, lastReminderAt: null }, nowMs);
    if (n == null) continue;
    const plate = (alert.vehicle_id && plates.get(alert.vehicle_id)) || 'a vehicle';
    const minutes = Math.max(1, Math.round((nowMs - Date.parse(alert.created_at)) / 60_000));
    const waiting = statusOf(alert) === 'acknowledged' ? 'acknowledged but not resolved' : 'not acknowledged';
    const data = { alert_id: alert.id, vehicle_id: alert.vehicle_id, reminder: n };
    try {
      await notificationService.notifyStaff(
        n >= SOS_ESCALATE_AT_REMINDER ? 'SOS still open: escalated' : 'SOS still open',
        `The SOS on ${plate} was raised ${minutes} min ago and is ${waiting}. Open Emergencies to handle or close it.`,
        'sos',
        data,
        alert.carrier_org_id,
      );
      reminded++;
    } catch (e) {
      console.error(`[sos] Reminder for alert ${alert.id} failed:`, e);
    }
  }
  return reminded;
}
