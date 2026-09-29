/**
 * Service schedules: what is due on a vehicle, by km and by date.
 */
import { supabase } from '../core/supabase';
import { indianDateKey } from '../core/istDate';

export interface ServicePlan {
  id: string;
  vehicle_id: string;
  item: string;
  interval_km: number | null;
  interval_days: number | null;
  last_done_km: number | null;
  last_done_at: string | null;
}

export type ServiceState = 'overdue' | 'due_soon' | 'ok' | 'unknown';

export interface ServiceItemStatus extends ServicePlan {
  status: ServiceState;
  /** Positive: km left. Negative: km past due. Null when it cannot be worked out. */
  km_remaining: number | null;
  days_remaining: number | null;
  next_due_km: number | null;
  next_due_at: string | null;
  /** Plain-language reason, e.g. "Overdue by 320 km". */
  summary: string;
}

const DAY_MS = 86_400_000;
const num = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const km = (n: number) => `${Math.round(Math.abs(n)).toLocaleString('en-IN')} km`;
const days = (n: number) => `${Math.abs(n)} ${Math.abs(n) === 1 ? 'day' : 'days'}`;

/** Days from the Indian calendar day of `now` to a `YYYY-MM-DD` date. */
export function daysUntil(dateStr: string, now: Date): number | null {
  const target = Date.parse(`${dateStr.slice(0, 10)}T00:00:00Z`);
  const today = Date.parse(`${indianDateKey(now)}T00:00:00Z`);
  return Number.isFinite(target) ? Math.round((target - today) / DAY_MS) : null;
}

/**
 * A service is "due soon" within 10% of its interval (by km and by days) and
 * overdue once it is past due. A dimension we cannot measure (no baseline, or an
 * unknown odometer) is left out; if neither can be measured the state is unknown.
 */
export function serviceStatus(plan: ServicePlan, odometerKm: number | null, now: Date = new Date()): ServiceItemStatus {
  const intervalKm = num(plan.interval_km);
  const intervalDays = num(plan.interval_days);
  const lastKm = num(plan.last_done_km);

  let kmRemaining: number | null = null;
  let nextDueKm: number | null = null;
  if (intervalKm != null && lastKm != null && odometerKm != null) {
    nextDueKm = lastKm + intervalKm;
    kmRemaining = nextDueKm - odometerKm;
  }
  let daysRemaining: number | null = null;
  let nextDueAt: string | null = null;
  if (intervalDays != null && plan.last_done_at) {
    const last = Date.parse(`${plan.last_done_at.slice(0, 10)}T00:00:00Z`);
    if (Number.isFinite(last)) {
      nextDueAt = new Date(last + intervalDays * DAY_MS).toISOString().slice(0, 10);
      daysRemaining = daysUntil(nextDueAt, now);
    }
  }

  const parts: { state: ServiceState; text: string }[] = [];
  if (kmRemaining != null && intervalKm != null) {
    const state: ServiceState = kmRemaining < 0 ? 'overdue' : kmRemaining <= intervalKm * 0.1 ? 'due_soon' : 'ok';
    parts.push({ state, text: kmRemaining < 0 ? `overdue by ${km(kmRemaining)}` : `due in ${km(kmRemaining)}` });
  }
  if (daysRemaining != null && intervalDays != null) {
    const state: ServiceState = daysRemaining < 0 ? 'overdue' : daysRemaining <= Math.max(1, Math.round(intervalDays * 0.1)) ? 'due_soon' : 'ok';
    parts.push({ state, text: daysRemaining < 0 ? `overdue by ${days(daysRemaining)}` : `due in ${days(daysRemaining)}` });
  }

  const rank: Record<ServiceState, number> = { unknown: 0, ok: 1, due_soon: 2, overdue: 3 };
  let status: ServiceState = 'unknown';
  for (const p of parts) if (rank[p.state] > rank[status]) status = p.state;

  let summary: string;
  if (parts.length > 0) {
    const worst = parts.filter(p => p.state === status);
    summary = worst.map(p => p.text).join(', ');
    summary = summary.charAt(0).toUpperCase() + summary.slice(1);
  } else if (intervalKm != null && lastKm == null && !plan.last_done_at) {
    summary = 'Log when this was last done to start tracking it';
  } else if (intervalKm != null && lastKm != null && odometerKm == null && intervalDays == null) {
    summary = 'Odometer is not known yet';
  } else {
    summary = 'Log when this was last done to start tracking it';
  }

  return { ...plan, status, km_remaining: kmRemaining, days_remaining: daysRemaining, next_due_km: nextDueKm, next_due_at: nextDueAt, summary };
}

export async function loadPlans(vehicleIds?: string[]): Promise<ServicePlan[]> {
  let q = supabase
    .from('vehicle_service_plans')
    .select('id, vehicle_id, item, interval_km, interval_days, last_done_km, last_done_at');
  if (vehicleIds) q = q.in('vehicle_id', vehicleIds);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ServicePlan[];
}
