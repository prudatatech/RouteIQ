/**
 * Vehicle health score, 0 to 100.
 *
 * Starts at 100 and takes points off for what is known:
 *   Service    overdue item -15 (max -40), due-soon item -5 (max -15)
 *   Documents  expired -20 each (max -40), expiring within 30 days -5 each (max -15)
 *   Alarms     alarms in the last 7 days: critical -10, high -5, medium -3 (max -25)
 *   Fuel       device fuel level below the low-fuel level -10, below half of it -20
 *
 * A check whose inputs are missing is "unknown" and takes nothing off: no service
 * plan or no usable baseline, no document dates, a vehicle that has never reported,
 * or no fuel level from a real device in the last 48 hours. If every check is
 * unknown the score is null. Test alarms never count.
 */
import { supabase } from '../core/supabase';
import { getAlertThresholds } from './alert-settings.service';
import { daysUntil, loadPlans, serviceStatus, type ServiceItemStatus } from './service-plans.service';

export type CheckState = 'ok' | 'warning' | 'critical' | 'unknown';
export type HealthBand = 'good' | 'attention' | 'poor' | 'unknown';

export interface HealthCheck {
  key: 'service' | 'documents' | 'alarms' | 'fuel';
  label: string;
  state: CheckState;
  /** Points taken off the score (0 when ok or unknown). */
  penalty: number;
  detail: string;
}

export interface HealthIssue {
  severity: 'warning' | 'critical';
  text: string;
}

export interface VehicleHealth {
  vehicle_id: string;
  plate_number: string;
  status: string | null;
  odometer_km: number | null;
  score: number | null;
  band: HealthBand;
  checks: HealthCheck[];
  checks_known: number;
  issues: HealthIssue[];
  service: ServiceItemStatus[];
}

export interface HealthVehicleRow {
  id: string;
  plate_number: string;
  status: string | null;
  odometer_km: number | null;
  rc_expiry: string | null;
  insurance_expiry: string | null;
  fitness_expiry: string | null;
  permit_expiry: string | null;
  puc_expiry: string | null;
  fuel_level_pct: number | null;
  fuel_reported_at: string | null;
  last_heartbeat: string | null;
  last_sync: string | null;
}

export interface HealthAlert {
  vehicle_id: string;
  alert_type: string;
  severity: string | null;
}

const DOCS: [keyof HealthVehicleRow, string][] = [
  ['rc_expiry', 'RC'], ['insurance_expiry', 'Insurance'], ['fitness_expiry', 'Fitness certificate'],
  ['permit_expiry', 'Permit'], ['puc_expiry', 'PUC'],
];
const EXPIRING_SOON_DAYS = 30;
const FUEL_FRESH_MS = 48 * 3_600_000;
const ALARM_WINDOW_DAYS = 7;
const ALARM_PENALTY: Record<string, number> = { critical: 10, high: 5, medium: 3 };

const cap = (n: number, max: number) => Math.min(n, max);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function computeHealth(
  v: HealthVehicleRow,
  plans: ServiceItemStatus[],
  alerts: HealthAlert[],
  lowFuelPct: number,
  now: Date = new Date(),
): VehicleHealth {
  const issues: HealthIssue[] = [];

  // Service
  const overdue = plans.filter(p => p.status === 'overdue');
  const soon = plans.filter(p => p.status === 'due_soon');
  const measured = plans.filter(p => p.status !== 'unknown');
  let service: HealthCheck;
  if (plans.length === 0) {
    service = { key: 'service', label: 'Service', state: 'unknown', penalty: 0, detail: 'No service schedule set up' };
  } else if (measured.length === 0) {
    service = { key: 'service', label: 'Service', state: 'unknown', penalty: 0, detail: 'Log when each item was last done to start tracking' };
  } else {
    const penalty = cap(overdue.length * 15, 40) + cap(soon.length * 5, 15);
    service = {
      key: 'service', label: 'Service', penalty,
      state: overdue.length ? 'critical' : soon.length ? 'warning' : 'ok',
      detail: overdue.length || soon.length
        ? [overdue.length && `${overdue.length} overdue`, soon.length && `${soon.length} due soon`].filter(Boolean).join(', ')
        : `${plural(measured.length, 'item')} up to date`,
    };
  }
  for (const p of overdue) issues.push({ severity: 'critical', text: `${p.item}: ${p.summary.toLowerCase()}` });
  for (const p of soon) issues.push({ severity: 'warning', text: `${p.item}: ${p.summary.toLowerCase()}` });

  // Documents
  const dated = DOCS.map(([key, label]) => ({ label, date: v[key] as string | null })).filter(d => d.date);
  let documents: HealthCheck;
  if (dated.length === 0) {
    documents = { key: 'documents', label: 'Documents', state: 'unknown', penalty: 0, detail: 'No document expiry dates recorded' };
  } else {
    const left = dated.map(d => ({ ...d, days: daysUntil(d.date!, now) })).filter(d => d.days != null) as { label: string; days: number }[];
    const expired = left.filter(d => d.days < 0);
    const expiring = left.filter(d => d.days >= 0 && d.days <= EXPIRING_SOON_DAYS);
    const penalty = cap(expired.length * 20, 40) + cap(expiring.length * 5, 15);
    documents = {
      key: 'documents', label: 'Documents', penalty,
      state: expired.length ? 'critical' : expiring.length ? 'warning' : 'ok',
      detail: expired.length || expiring.length
        ? [expired.length && `${expired.length} expired`, expiring.length && `${expiring.length} expiring soon`].filter(Boolean).join(', ')
        : `${plural(dated.length, 'document')} valid`,
    };
    for (const d of expired) issues.push({ severity: 'critical', text: `${d.label} expired ${plural(-d.days, 'day')} ago` });
    for (const d of expiring) issues.push({ severity: 'warning', text: d.days === 0 ? `${d.label} expires today` : `${d.label} expires in ${plural(d.days, 'day')}` });
  }

  // Alarms
  const hasReported = !!(v.last_heartbeat || v.last_sync);
  let alarms: HealthCheck;
  if (!hasReported) {
    alarms = { key: 'alarms', label: 'Alarms', state: 'unknown', penalty: 0, detail: 'This vehicle has not reported yet' };
  } else {
    const penalty = cap(alerts.reduce((s, a) => s + (ALARM_PENALTY[a.severity ?? ''] ?? 0), 0), 25);
    alarms = {
      key: 'alarms', label: 'Alarms', penalty,
      state: penalty >= 10 ? 'critical' : penalty > 0 ? 'warning' : 'ok',
      detail: alerts.length ? `${plural(alerts.length, 'alarm')} in the last ${ALARM_WINDOW_DAYS} days` : `No alarms in the last ${ALARM_WINDOW_DAYS} days`,
    };
    if (alerts.length > 0 && penalty > 0) {
      issues.push({ severity: penalty >= 10 ? 'critical' : 'warning', text: `${plural(alerts.length, 'alarm')} in the last ${ALARM_WINDOW_DAYS} days` });
    }
  }

  // Fuel (only a level a real device reported recently)
  const fuelFresh = v.fuel_level_pct != null && !!v.fuel_reported_at && now.getTime() - Date.parse(v.fuel_reported_at) <= FUEL_FRESH_MS;
  let fuel: HealthCheck;
  if (!fuelFresh) {
    fuel = { key: 'fuel', label: 'Fuel', state: 'unknown', penalty: 0, detail: 'No fuel level from a device in the last 48 hours' };
  } else {
    const pct = Number(v.fuel_level_pct);
    const penalty = pct < lowFuelPct / 2 ? 20 : pct < lowFuelPct ? 10 : 0;
    fuel = {
      key: 'fuel', label: 'Fuel', penalty,
      state: penalty >= 20 ? 'critical' : penalty > 0 ? 'warning' : 'ok',
      detail: `${Math.round(pct)}% in the tank`,
    };
    if (penalty > 0) issues.push({ severity: penalty >= 20 ? 'critical' : 'warning', text: `Fuel at ${Math.round(pct)}%` });
  }

  const checks = [service, documents, alarms, fuel];
  const known = checks.filter(c => c.state !== 'unknown');
  const score = known.length === 0 ? null : Math.max(0, 100 - known.reduce((s, c) => s + c.penalty, 0));
  const band: HealthBand = score == null ? 'unknown' : score >= 80 ? 'good' : score >= 50 ? 'attention' : 'poor';
  issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1));

  return {
    vehicle_id: v.id, plate_number: v.plate_number, status: v.status, odometer_km: v.odometer_km ?? null,
    score, band, checks, checks_known: known.length, issues, service: plans,
  };
}

/** Health for every vehicle (or just `vehicleId`), archived vehicles left out. */
export async function loadFleetHealth(vehicleId?: string, now: Date = new Date()): Promise<VehicleHealth[]> {
  let vq = supabase
    .from('vehicles')
    .select('id, plate_number, status, odometer_km, rc_expiry, insurance_expiry, fitness_expiry, permit_expiry, puc_expiry, fuel_level_pct, fuel_reported_at, last_heartbeat, last_sync');
  if (vehicleId) vq = vq.eq('id', vehicleId);
  const { data: vehicles, error } = await vq;
  if (error) throw error;
  const rows = ((vehicles ?? []) as HealthVehicleRow[]).filter(v => vehicleId || v.status !== 'archived');
  if (rows.length === 0) return [];

  const since = new Date(now.getTime() - ALARM_WINDOW_DAYS * 86_400_000).toISOString();
  let aq = supabase.from('maintenance_alerts').select('vehicle_id, alert_type, severity').eq('is_test', false).gte('created_at', since);
  if (vehicleId) aq = aq.eq('vehicle_id', vehicleId);
  const [plans, alertsRes, limits] = await Promise.all([
    loadPlans(vehicleId ? [vehicleId] : undefined),
    aq,
    getAlertThresholds(),
  ]);
  if (alertsRes.error) throw alertsRes.error;

  const alertsBy = new Map<string, HealthAlert[]>();
  for (const a of (alertsRes.data ?? []) as HealthAlert[]) alertsBy.set(a.vehicle_id, [...(alertsBy.get(a.vehicle_id) ?? []), a]);
  const plansBy = new Map<string, typeof plans>();
  for (const p of plans) plansBy.set(p.vehicle_id, [...(plansBy.get(p.vehicle_id) ?? []), p]);

  return rows.map(v => computeHealth(
    v,
    (plansBy.get(v.id) ?? []).map(p => serviceStatus(p, v.odometer_km != null ? Number(v.odometer_km) : null, now)),
    alertsBy.get(v.id) ?? [],
    limits.low_fuel_pct,
    now,
  ));
}
