/**
 * margixindia — Which company a setting belongs to, and the per-company overrides of the platform defaults.
 *
 * Every logistic company keeps its own profile and settings in its organizations row:
 *   organizations.profile            invoicing identity (name, GSTIN, bank, prefix ...), see company.service.ts
 *   organizations.profile.settings   operational settings: fuel price, pricing rates, load multipliers, dispatch phone,
 *                                    document enforcement, licence grace days, document retention, bank-change cooldown
 * The platform-wide values stay in system_settings and are the defaults a company falls back to, key by key.
 *
 * "Scope" is a company id, or null for the platform defaults (system_settings). The scope of a request is the
 * company the caller acts for; acting as the platform organisation is the platform scope. A request with no
 * organisation (the scheduler, a customer) and a database that has organisations works on the default company.
 */
import { supabase } from '../core/supabase';
import { memoize, registerClearable } from '../core/memo';
import { currentOrgContext } from '../core/org-context';

/** A company id, or null for the platform defaults. */
export type SettingsScope = string | null;

/** The default company's id; null before the organisations migration has run. Cached briefly. */
export const defaultCompanyId = memoize(30_000, async (): Promise<string | null> => {
  const { data, error } = await supabase.from('system_settings').select('value').eq('key', 'default_company_org_id').maybeSingle();
  if (error) throw new Error(`Failed to read the default company: ${error.message}`);
  const id = (data?.value as { value?: unknown } | null)?.value;
  return typeof id === 'string' && id ? id : null;
});

/**
 * The scope a read or write applies to: `explicit` when given (a company id, or null for the platform defaults),
 * else the company the request acts for.
 */
export async function resolveScope(explicit?: SettingsScope): Promise<SettingsScope> {
  if (explicit !== undefined) return explicit;
  const ctx = currentOrgContext();
  const org = ctx?.org;
  if (org?.kind === 'platform') return null;
  if (org && (org.kind === 'logistic_company' || org.kind === 'tpl_partner')) return org.id;
  if (ctx && !ctx.configured) return null;
  return defaultCompanyId();
}

/** A small per-scope cache (30 s by default); `clear()` empties it, as a save does. */
export function scopedMemo<T>(ttlMs: number, load: (scope: SettingsScope) => Promise<T>) {
  const entries = new Map<string, { value: T; expiresAt: number }>();
  const inflight = new Map<string, Promise<T>>();
  let generation = 0;
  const key = (s: SettingsScope) => s ?? '';
  const get = async (scope: SettingsScope): Promise<T> => {
    const k = key(scope);
    const hit = entries.get(k);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    let p = inflight.get(k);
    if (!p) {
      const started = generation;
      p = load(scope)
        .then(value => {
          if (started === generation) entries.set(k, { value, expiresAt: Date.now() + ttlMs });
          return value;
        })
        .finally(() => { inflight.delete(k); });
      inflight.set(k, p);
    }
    return p;
  };
  const clear = () => { entries.clear(); inflight.clear(); generation++; };
  registerClearable({ clear });
  return Object.assign(get, { clear });
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export interface OrgRow {
  id: string;
  kind: string;
  name: string;
  legal_name: string | null;
  gstin: string | null;
  pan: string | null;
  state: string | null;
  city: string | null;
  address: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  profile: Record<string, unknown>;
}

export const ORG_COLUMNS = 'id, kind, name, legal_name, gstin, pan, state, city, address, pincode, phone, email, profile';

/** One organisation row, or null when it does not exist (or the organisations migration has not run). */
export async function loadOrg(id: string): Promise<OrgRow | null> {
  const { data, error } = await supabase.from('organizations').select(ORG_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to read the company: ${error.message}`);
  if (!data) return null;
  return { ...(data as unknown as OrgRow), profile: isObject((data as any).profile) ? (data as any).profile : {} };
}

/** A company's own setting overrides (organizations.profile.settings), keyed like system_settings. */
export const loadOverrides = scopedMemo(30_000, async (scope): Promise<Record<string, unknown>> => {
  if (!scope) return {};
  const org = await loadOrg(scope);
  const s = org?.profile.settings;
  return isObject(s) ? { ...s } : {};
});

/**
 * The settings in effect: every system_settings row whose key matches, overlaid with the company's own overrides.
 * Values keep the shape they were stored in (platform rows are `{value}`, `{price}`, `{phone}` or a bare value;
 * company overrides are bare values), so each reader's own parsing handles both.
 */
export async function readEffectiveSettings(match: (key: string) => boolean, scope?: SettingsScope): Promise<Map<string, unknown>> {
  const s = await resolveScope(scope);
  const { data, error } = await supabase.from('system_settings').select('key, value');
  if (error) throw new Error(`Failed to read settings: ${error.message}`);
  const out = new Map<string, unknown>();
  for (const row of data ?? []) if (typeof row.key === 'string' && match(row.key)) out.set(row.key, row.value);
  if (s) for (const [k, v] of Object.entries(await loadOverrides(s))) if (match(k) && v !== null && v !== undefined) out.set(k, v);
  return out;
}

/** One setting in effect, or undefined when neither the company nor the platform has set it. */
export async function readEffectiveSetting(key: string, scope?: SettingsScope): Promise<unknown> {
  return (await readEffectiveSettings(k => k === key, scope)).get(key);
}

/**
 * Sets or clears (null) a company's own overrides. Reads the profile, changes `settings`, writes it back; two
 * admins of one company saving different settings in the same instant is the only way a change could be lost.
 */
export async function saveOverrides(companyId: string, changes: Record<string, unknown>): Promise<void> {
  const org = await loadOrg(companyId);
  if (!org) throw new Error('Company not found');
  const settings: Record<string, unknown> = isObject(org.profile.settings) ? { ...org.profile.settings } : {};
  for (const [k, v] of Object.entries(changes)) {
    if (v === null || v === undefined) delete settings[k];
    else settings[k] = v;
  }
  const { error } = await supabase
    .from('organizations')
    .update({ profile: { ...org.profile, settings }, updated_at: new Date().toISOString() })
    .eq('id', companyId);
  loadOverrides.clear();
  if (error) throw new Error(`Failed to save settings: ${error.message}`);
}

/** Writes platform-wide rows to system_settings: `{ key: { shape } }`, a null value deletes the row. */
export async function savePlatformRows(rows: Record<string, unknown | null>): Promise<void> {
  const now = new Date().toISOString();
  const upserts = Object.entries(rows).filter(([, v]) => v !== null).map(([key, value]) => ({ key, value, updated_at: now }));
  const deletes = Object.entries(rows).filter(([, v]) => v === null).map(([key]) => key);
  if (upserts.length) {
    const { error } = await supabase.from('system_settings').upsert(upserts, { onConflict: 'key' });
    if (error) throw new Error(`Failed to save settings: ${error.message}`);
  }
  if (deletes.length) {
    const { error } = await supabase.from('system_settings').delete().in('key', deletes);
    if (error) throw new Error(`Failed to save settings: ${error.message}`);
  }
}
