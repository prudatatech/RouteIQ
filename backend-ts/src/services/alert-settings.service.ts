/**
 * Alarm rule thresholds, stored in system_settings (value is `{ "value": <number> }`).
 * The migration seeds these keys; the defaults here apply only if a row is missing.
 */
import { supabase } from '../core/supabase';

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
let cache: { at: number; value: AlertThresholds } | null = null;

export function clearThresholdCache(): void {
  cache = null;
}

export async function getAlertThresholds(): Promise<AlertThresholds> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const value = Object.fromEntries(THRESHOLD_FIELDS.map(f => [f, KEYS[f].fallback])) as unknown as AlertThresholds;
  const { data, error } = await supabase
    .from('system_settings')
    .select('key, value')
    .in('key', THRESHOLD_FIELDS.map(f => KEYS[f].key));
  if (error) throw error;
  for (const row of data ?? []) {
    const field = THRESHOLD_FIELDS.find(f => KEYS[f].key === row.key);
    const n = Number((row.value as { value?: unknown } | null)?.value);
    if (field && Number.isFinite(n) && n >= KEYS[field].min && n <= KEYS[field].max) value[field] = n;
  }
  cache = { at: Date.now(), value };
  return value;
}

export async function saveAlertThresholds(patch: Partial<AlertThresholds>): Promise<AlertThresholds> {
  const rows = THRESHOLD_FIELDS
    .filter(f => patch[f] !== undefined)
    .map(f => ({ key: KEYS[f].key, value: { value: patch[f] }, updated_at: new Date().toISOString() }));
  if (rows.length > 0) {
    const { error } = await supabase.from('system_settings').upsert(rows, { onConflict: 'key' });
    if (error) throw error;
  }
  clearThresholdCache();
  return getAlertThresholds();
}
