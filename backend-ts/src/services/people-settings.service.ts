/**
 * margixindia — Settings the people features read, and the keyed hash used to spot duplicate
 * identity numbers without storing them.
 *
 * Each company has its own (organizations.profile.settings); a setting it has not set falls back to the platform
 * default in system_settings (value is `{ "value": <x> }`), and then to DEFAULTS. Acting as the platform edits
 * the platform defaults.
 */
import crypto from 'crypto';
import { supabase } from '../core/supabase';
import { settings as appSettings } from '../core/config';
import { HttpError } from '../core/errors';
import { readEffectiveSettings, resolveScope, saveOverrides, savePlatformRows, scopedMemo, type SettingsScope } from './company-settings.service';

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

const loadPeopleSettings = scopedMemo(30_000, async (scope): Promise<PeopleSettings> => {
  const out: PeopleSettings = { ...DEFAULTS };
  const rows = await readEffectiveSettings(k => (KEYS as string[]).includes(k), scope);
  for (const [key, stored] of rows) {
    // A platform row is `{ value }`, a company's own override is the bare value
    const raw = stored && typeof stored === 'object' && 'value' in (stored as object) ? (stored as { value?: unknown }).value : stored;
    if (key === 'driver_document_enforcement') {
      if ((ENFORCEMENT_MODES as readonly string[]).includes(raw as string)) out.driver_document_enforcement = raw as EnforcementMode;
    } else if (key in NUMBER_LIMITS) {
      const k = key as keyof typeof NUMBER_LIMITS;
      const n = Number(raw);
      if (Number.isInteger(n) && n >= NUMBER_LIMITS[k][0] && n <= NUMBER_LIMITS[k][1]) out[k] = n;
    }
  }
  return out;
});

/**
 * The settings as they are now, for `orgId` or else the company the request acts for. Pass `{ cached: true }` from
 * read-only screens that run on every page load: the settings are the same for every user of a company and rarely
 * change, so they are read at most every 30 s there (saving clears the cache). Gates such as dispatch blocking
 * always read fresh.
 */
export async function getPeopleSettings(opts: { cached?: boolean; orgId?: SettingsScope } = {}): Promise<PeopleSettings> {
  if (!opts.cached) loadPeopleSettings.clear();
  return { ...(await loadPeopleSettings(await resolveScope(opts.orgId))) };
}

/** Validates and stores the given settings for the company the request acts for (as the platform: the defaults); unknown keys are a 400. */
export async function savePeopleSettings(patch: Record<string, unknown>): Promise<PeopleSettings> {
  const values: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(patch ?? {})) {
    if (!(KEYS as string[]).includes(key)) throw new HttpError(400, `Unknown setting ${key}`);
    if (key === 'driver_document_enforcement') {
      if (!(ENFORCEMENT_MODES as readonly string[]).includes(raw as string)) throw new HttpError(400, 'driver_document_enforcement must be off, warn or block');
      values[key] = raw;
    } else {
      const [min, max] = NUMBER_LIMITS[key as keyof typeof NUMBER_LIMITS];
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
      if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${key} must be a whole number from ${min} to ${max}`);
      values[key] = n;
    }
  }
  if (Object.keys(values).length === 0) throw new HttpError(400, 'No settings to update');
  const scope = await resolveScope();
  try {
    if (scope) await saveOverrides(scope, values);
    else await savePlatformRows(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v }])));
  } finally {
    loadPeopleSettings.clear();
  }
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
