/**
 * margixindia — Settings the people features read, kept in system_settings
 * (value is `{ "value": <x> }`), and the keyed hash used to spot duplicate
 * identity numbers without storing them.
 */
import crypto from 'crypto';
import { supabase } from '../core/supabase';
import { settings as appSettings } from '../core/config';
import { HttpError } from '../core/errors';

export const ENFORCEMENT_MODES = ['off', 'warn', 'block'] as const;
export type EnforcementMode = (typeof ENFORCEMENT_MODES)[number];

export interface PeopleSettings {
  /** Days after expiry a driving licence still counts as usable. */
  licence_grace_days: number;
  /** Days after someone leaves before their document files are deleted. */
  document_retention_days: number;
  /** Hours before changed bank details are used for payouts. */
  bank_change_cooldown_hours: number;
  driver_document_enforcement: EnforcementMode;
}

const DEFAULTS: PeopleSettings = {
  licence_grace_days: 0,
  document_retention_days: 365,
  bank_change_cooldown_hours: 24,
  driver_document_enforcement: 'warn',
};

const NUMBER_LIMITS: Record<'licence_grace_days' | 'document_retention_days' | 'bank_change_cooldown_hours', [number, number]> = {
  licence_grace_days: [0, 90],
  document_retention_days: [30, 3650],
  bank_change_cooldown_hours: [0, 720],
};

const KEYS = Object.keys(DEFAULTS) as Array<keyof PeopleSettings>;

export async function getPeopleSettings(): Promise<PeopleSettings> {
  const out: PeopleSettings = { ...DEFAULTS };
  const { data, error } = await supabase.from('system_settings').select('key, value').in('key', KEYS);
  if (error) throw new Error(`Failed to read settings: ${error.message}`);
  for (const row of data ?? []) {
    const raw = (row.value as { value?: unknown } | null)?.value;
    if (row.key === 'driver_document_enforcement') {
      if ((ENFORCEMENT_MODES as readonly string[]).includes(raw as string)) out.driver_document_enforcement = raw as EnforcementMode;
    } else if (row.key in NUMBER_LIMITS) {
      const key = row.key as keyof typeof NUMBER_LIMITS;
      const n = Number(raw);
      if (Number.isInteger(n) && n >= NUMBER_LIMITS[key][0] && n <= NUMBER_LIMITS[key][1]) out[key] = n;
    }
  }
  return out;
}

/** Validates and stores the given settings; unknown keys are a 400. */
export async function savePeopleSettings(patch: Record<string, unknown>): Promise<PeopleSettings> {
  const rows: Array<{ key: string; value: { value: unknown }; updated_at: string }> = [];
  for (const [key, raw] of Object.entries(patch ?? {})) {
    if (!(KEYS as string[]).includes(key)) throw new HttpError(400, `Unknown setting ${key}`);
    if (key === 'driver_document_enforcement') {
      if (!(ENFORCEMENT_MODES as readonly string[]).includes(raw as string)) throw new HttpError(400, 'driver_document_enforcement must be off, warn or block');
    } else {
      const [min, max] = NUMBER_LIMITS[key as keyof typeof NUMBER_LIMITS];
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
      if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${key} must be a whole number from ${min} to ${max}`);
      patch[key] = n;
    }
    rows.push({ key, value: { value: patch[key] }, updated_at: new Date().toISOString() });
  }
  if (rows.length === 0) throw new HttpError(400, 'No settings to update');
  const { error } = await supabase.from('system_settings').upsert(rows, { onConflict: 'key' });
  if (error) throw new Error(`Failed to save settings: ${error.message}`);
  return getPeopleSettings();
}

let warnedAboutSalt = false;

/**
 * Keyed hash of an identity number, so duplicates can be found without keeping
 * the number. The key is PEOPLE_HASH_SALT; production refuses to run without it.
 */
export function hashIdentifier(kind: string, normalized: string): string {
  let salt = appSettings.PEOPLE_HASH_SALT;
  if (!salt) {
    if (appSettings.isProduction) throw new HttpError(503, 'Identity checks are not configured. Set PEOPLE_HASH_SALT.');
    salt = 'development-only-people-salt';
    if (!warnedAboutSalt) {
      warnedAboutSalt = true;
      console.warn('[people] PEOPLE_HASH_SALT is not set; using a development value');
    }
  }
  return crypto.createHmac('sha256', salt).update(`${kind}:${normalized}`).digest('hex');
}
