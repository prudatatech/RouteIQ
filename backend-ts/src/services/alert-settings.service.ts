/**
 * Alarm rule thresholds, stored in system_settings (value is `{ "value": <number> }`).
 * The migration seeds these keys; the defaults here apply only if a row is missing.
 */
import { supabase } from '../core/supabase';
import { currentOrgContext } from '../core/org-context';

export interface AlertThresholds {
  overspeed_kmph: number;
  idle_minutes: number;
  gps_lost_minutes: number;
  low_fuel_pct: number;
}

const KEYS: Record<keyof AlertThresholds, { key: string; fallback: number; min: number; max: number }> = {
  overspeed_kmph: { key: 'alert_overspeed_kmph', fallback: 80, min: 20, max: 200 },
  idle_minutes: { key: 'alert_idle_minutes', fallback: 30, min: 5, max: 720 },
  gps_lost_minutes: { key: 'alert_gps_lost_minutes', fallback: 15, min: 2, max: 720 },
  low_fuel_pct: { key: 'alert_low_fuel_pct', fallback: 15, min: 1, max: 60 },
};

export const THRESHOLD_FIELDS = Object.keys(KEYS) as (keyof AlertThresholds)[];
export const thresholdLimits = (field: keyof AlertThresholds) => ({ min: KEYS[field].min, max: KEYS[field].max });

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; value: AlertThresholds }>();

export function clearThresholdCache(): void {
  cache.clear();
}

/** The logistic company the request being handled acts for; its alarm rules are its own. */
function activeCompany(): string | null {
  const org = currentOrgContext()?.org;
  return org?.kind === 'logistic_company' ? org.id : null;
}

/** A company's own value of a rule is stored under `<key>@<company id>`; the plain key is the platform default. */
const companyKey = (key: string, companyId: string) => `${key}@${companyId}`;

/**
 * The alarm rules for a company (`companyId`; the company of the request when left out; null for the platform
 * defaults). A rule the company has not set takes the platform's value.
 */
export async function getAlertThresholds(companyId?: string | null): Promise<AlertThresholds> {
  const company = companyId === undefined ? activeCompany() : companyId;
  const cacheKey = company ?? 'default';
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const value = Object.fromEntries(THRESHOLD_FIELDS.map(f => [f, KEYS[f].fallback])) as unknown as AlertThresholds;
  const keys = THRESHOLD_FIELDS.flatMap(f => (company ? [KEYS[f].key, companyKey(KEYS[f].key, company)] : [KEYS[f].key]));
  const { data, error } = await supabase.from('system_settings').select('key, value').in('key', keys);
  if (error) throw error;
  // Platform defaults first, then the company's own values over them
  const rows = [...(data ?? [])].sort((a, b) => Number(String(a.key).includes('@')) - Number(String(b.key).includes('@')));
  for (const row of rows) {
    const baseKey = String(row.key).split('@')[0];
    const field = THRESHOLD_FIELDS.find(f => KEYS[f].key === baseKey);
    const n = Number((row.value as { value?: unknown } | null)?.value);
    if (field && Number.isFinite(n) && n >= KEYS[field].min && n <= KEYS[field].max) value[field] = n;
  }
  cache.set(cacheKey, { at: Date.now(), value });
  return value;
}

/** Save rules for the company the request acts for, or the platform defaults when it acts for none. */
export async function saveAlertThresholds(patch: Partial<AlertThresholds>): Promise<AlertThresholds> {
  const company = activeCompany();
  const rows = THRESHOLD_FIELDS
    .filter(f => patch[f] !== undefined)
    .map(f => ({ key: company ? companyKey(KEYS[f].key, company) : KEYS[f].key, value: { value: patch[f] }, updated_at: new Date().toISOString() }));
  if (rows.length > 0) {
    const { error } = await supabase.from('system_settings').upsert(rows, { onConflict: 'key' });
    if (error) throw error;
  }
  clearThresholdCache();
  return getAlertThresholds();
}
