/**
 * margixindia — Company profile: the seller on every invoice.
 *
 * Every logistic company has its own, entered once in Settings. It lives in the company's organizations row:
 * the name, GSTIN, PAN, state, city, address, pincode, phone and email in their columns and, with the rest
 * (SAC, bank, UPI, payment terms, footer, invoice prefix), in `profile`. An invoice uses the profile of the
 * company that ISSUES it. A company with nothing set yet falls back to the platform-wide profile in
 * system_settings under `company_profile` (value is `{ "value": { ... } }`): migration safety, so issuing never
 * stops while a company is being set up. Nothing here has a default except the payment terms (15 days): an
 * invoice shows exactly what staff entered, and says what is missing.
 *
 * Functions take the company id; left out it is the company the request acts for (company-settings.service.ts),
 * and null means the platform-wide profile.
 */
import { supabase } from '../core/supabase';
import { HttpError } from '../core/errors';
import { checkGstin, normalizeGstin } from '../utils/gstin';
import { DEFAULT_GTA_GST_OPTION, isGtaOption, stateCodeByName, stateOf, type GtaGstOption } from '../core/gst';
import { loadOrg, resolveScope, scopedMemo, type SettingsScope } from './company-settings.service';

export const COMPANY_PROFILE_KEY = 'company_profile';
export const DEFAULT_PAYMENT_TERMS_DAYS = 15;

export interface CompanyProfile {
  legal_name: string | null;
  gstin: string | null;
  pan: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  /** SAC of the freight service the invoice bills, as the company's accountant uses it. */
  sac_code: string | null;
  bank_name: string | null;
  bank_account_no: string | null;
  bank_ifsc: string | null;
  upi_id: string | null;
  payment_terms_days: number;
  /** How freight GST is charged on invoices (core/gst.ts gtaTerms): reverse charge 5% by default. */
  gta_gst_option: GtaGstOption;
  /** Free text under the total, e.g. the jurisdiction line. */
  invoice_footer: string | null;
  /** The letters invoice numbers start with (`MIL-202610-0001`), unique per company. Null until the first invoice or until set. */
  invoice_prefix: string | null;
}

const TEXT_FIELDS = [
  'legal_name', 'address', 'city', 'state', 'pincode', 'phone', 'email', 'sac_code',
  'bank_name', 'bank_account_no', 'bank_ifsc', 'upi_id', 'invoice_footer',
] as const;

const EMPTY: CompanyProfile = {
  legal_name: null, gstin: null, pan: null, address: null, city: null, state: null, pincode: null, phone: null, email: null,
  sac_code: null, bank_name: null, bank_account_no: null, bank_ifsc: null, upi_id: null,
  payment_terms_days: DEFAULT_PAYMENT_TERMS_DAYS, invoice_footer: null, invoice_prefix: null, gta_gst_option: DEFAULT_GTA_GST_OPTION,
};

/** The fields that have a column on organizations as well as a place in `profile`. */
const COLUMN_FIELDS = ['legal_name', 'gstin', 'pan', 'state', 'city', 'address', 'pincode', 'phone', 'email'] as const;

/** What the profile is built from: a row of system_settings.value or an organization's profile jsonb. */
function parseProfile(raw: Record<string, unknown>): CompanyProfile {
  const out: CompanyProfile = { ...EMPTY };
  for (const key of [...TEXT_FIELDS, 'gstin', 'pan'] as const) {
    const v = raw[key];
    out[key] = typeof v === 'string' && v.trim() ? v.trim() : null;
  }
  const days = Number(raw.payment_terms_days);
  if (raw.payment_terms_days != null && Number.isInteger(days) && days >= 0 && days <= 365) out.payment_terms_days = days;
  if (isGtaOption(raw.gta_gst_option)) out.gta_gst_option = raw.gta_gst_option;
  const prefix = typeof raw.invoice_prefix === 'string' ? raw.invoice_prefix.trim().toUpperCase() : '';
  out.invoice_prefix = PREFIX_RE.test(prefix) ? prefix : null;
  return out;
}

/** Whether any detail of the seller is on record (the payment terms alone do not count). */
const hasDetails = (c: CompanyProfile): boolean => [...TEXT_FIELDS, 'gstin', 'pan'].some(k => c[k as keyof CompanyProfile] != null);

const PREFIX_RE = /^[A-Z0-9]{2,6}$/;

const MAX_TEXT = 300;

const SETTINGS_CACHE_MS = 30_000;

/** The platform-wide profile in system_settings: what a company with nothing set falls back to. */
async function loadPlatformProfile(): Promise<CompanyProfile> {
  const { data, error } = await supabase.from('system_settings').select('value').eq('key', COMPANY_PROFILE_KEY).maybeSingle();
  if (error) throw new Error(`Failed to read company profile: ${error.message}`);
  const raw = ((data?.value as { value?: Record<string, unknown> } | null)?.value ?? {}) as Record<string, unknown>;
  return parseProfile(raw);
}

/** A company's own profile: the columns win over the copy in `profile`. Null when the company does not exist. */
async function loadOwnProfile(companyId: string): Promise<CompanyProfile | null> {
  const org = await loadOrg(companyId);
  if (!org) return null;
  const merged: Record<string, unknown> = { ...org.profile };
  for (const key of COLUMN_FIELDS) if (org[key] != null && String(org[key]).trim() !== '') merged[key] = org[key];
  return parseProfile(merged);
}

const loadCompanyProfile = scopedMemo(SETTINGS_CACHE_MS, async (scope): Promise<CompanyProfile> => {
  if (scope) {
    const own = await loadOwnProfile(scope);
    if (own && hasDetails(own)) return own;
    // Nothing set for this company yet: the platform-wide profile stands in, but the company keeps its own prefix and terms
    const fallback = await loadPlatformProfile();
    return { ...fallback, invoice_prefix: own?.invoice_prefix ?? null, gta_gst_option: own?.gta_gst_option ?? fallback.gta_gst_option };
  }
  return loadPlatformProfile();
});

/**
 * The profile as it is now: the company's own (`companyId`, else the company the request acts for; null for the
 * platform-wide profile). Anything that decides or snapshots something with it (invoice issuing, the invoice page,
 * Settings) reads it this way; the read also refreshes the cache below.
 */
export async function getCompanyProfile(companyId?: SettingsScope): Promise<CompanyProfile> {
  loadCompanyProfile.clear();
  return { ...(await loadCompanyProfile(await resolveScope(companyId))) };
}

/**
 * Payment terms for lists that show due dates: the same for every user and rarely changed, so read
 * at most every 30 s (saving the profile clears it).
 */
export async function getCachedPaymentTermsDays(companyId?: SettingsScope): Promise<number> {
  return (await loadCompanyProfile(await resolveScope(companyId))).payment_terms_days;
}

/** The payment terms new invoices are issued with. Never fails an invoice: falls back to the default. */
export async function paymentTermsDays(companyId?: SettingsScope): Promise<number> {
  try {
    return await getCachedPaymentTermsDays(companyId);
  } catch (e) {
    console.error('[invoice] could not read payment terms, using the default:', e);
    return DEFAULT_PAYMENT_TERMS_DAYS;
  }
}

/**
 * Validates and stores the profile of a company (null: the platform-wide profile). Every field is optional; an
 * empty string clears it. Changes are applied to what the company has on record itself, never to the platform
 * profile it may be falling back to.
 */
export async function saveCompanyProfile(input: Record<string, unknown>, companyId?: SettingsScope): Promise<CompanyProfile> {
  const scope = await resolveScope(companyId);
  const own = scope ? await loadOwnProfile(scope) : await loadPlatformProfile();
  if (scope && !own) throw new HttpError(404, 'Company not found');
  const next: CompanyProfile = { ...(own as CompanyProfile) };
  const has = (k: string) => input[k] !== undefined;

  for (const key of TEXT_FIELDS) {
    if (!has(key)) continue;
    const v = input[key];
    if (v !== null && typeof v !== 'string') throw new HttpError(400, `${key} must be text`);
    const text = (v ?? '').trim();
    if (text.length > MAX_TEXT) throw new HttpError(400, `${key} can be at most ${MAX_TEXT} characters`);
    next[key] = text || null;
  }
  if (has('gstin')) {
    const gstin = normalizeGstin(input.gstin);
    if (gstin) {
      const check = checkGstin(gstin);
      if (!check.valid) throw new HttpError(400, `GSTIN: ${check.message}`);
    }
    next.gstin = gstin || null;
  }
  if (has('pan')) {
    const pan = typeof input.pan === 'string' ? input.pan.replace(/\s+/g, '').toUpperCase() : '';
    if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) throw new HttpError(400, 'PAN has 10 characters: 5 letters, 4 digits, 1 letter');
    next.pan = pan || null;
  }
  if (has('payment_terms_days')) {
    const days = Number(input.payment_terms_days);
    if (!Number.isInteger(days) || days < 0 || days > 365) throw new HttpError(400, 'Payment terms must be a whole number of days from 0 to 365');
    next.payment_terms_days = days;
  }
  if (has('gta_gst_option')) {
    if (!isGtaOption(input.gta_gst_option)) throw new HttpError(400, 'Choose how GST on freight is charged: reverse charge 5%, 5% forward charge or 18% forward charge');
    next.gta_gst_option = input.gta_gst_option;
  }
  if (has('invoice_prefix')) {
    const raw = input.invoice_prefix;
    if (raw !== null && typeof raw !== 'string') throw new HttpError(400, 'invoice_prefix must be text');
    const prefix = (raw ?? '').replace(/\s+/g, '').toUpperCase();
    if (!scope && prefix) throw new HttpError(400, 'The invoice prefix belongs to a company: act as the company to set it');
    if (prefix && !PREFIX_RE.test(prefix)) throw new HttpError(400, 'The invoice prefix is 2 to 6 letters or digits, e.g. MIL');
    if (scope && prefix && prefix !== own!.invoice_prefix) await assertPrefixFree(prefix, scope);
    next.invoice_prefix = prefix || null;
  }
  if (next.sac_code && !/^\d{4,8}$/.test(next.sac_code)) throw new HttpError(400, 'SAC is 4 to 8 digits');
  if (next.bank_ifsc) next.bank_ifsc = next.bank_ifsc.toUpperCase().replace(/\s+/g, '');
  if (next.bank_ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(next.bank_ifsc)) throw new HttpError(400, 'IFSC has 11 characters: 4 letters, a 0, then 6 letters or digits');
  if (next.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email)) throw new HttpError(400, 'Enter a valid email');

  if (!scope) {
    const { invoice_prefix: _prefix, ...platform } = next;
    const { error } = await supabase
      .from('system_settings')
      .upsert({ key: COMPANY_PROFILE_KEY, value: { value: platform }, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    loadCompanyProfile.clear();
    if (error) throw new Error(`Failed to save company profile: ${error.message}`);
    return next;
  }

  const org = await loadOrg(scope);
  if (!org) throw new HttpError(404, 'Company not found');
  const profile: Record<string, unknown> = { ...org.profile };
  for (const [k, v] of Object.entries(next)) {
    if (k === 'invoice_prefix') { if (v) profile[k] = v; else delete profile[k]; } else profile[k] = v;
  }
  const columns: Record<string, string | null> = {};
  for (const key of COLUMN_FIELDS) columns[key] = next[key];
  const { error } = await supabase
    .from('organizations')
    .update({ ...columns, profile, updated_at: new Date().toISOString() })
    .eq('id', scope);
  loadCompanyProfile.clear();
  if (error) {
    if (error.code === '23505') throw new HttpError(409, 'Another company already uses that invoice prefix');
    throw new Error(`Failed to save company profile: ${error.message}`);
  }
  return next;
}

// ── Invoice prefix ──────────────────────────────────────────

/** No two companies share a prefix (the invoice number is unique across the platform). The database enforces it too. */
async function assertPrefixFree(prefix: string, exceptCompanyId: string): Promise<void> {
  const { data, error } = await supabase.from('organizations').select('id, profile');
  if (error) throw new Error(`Failed to check the invoice prefix: ${error.message}`);
  const taken = (data ?? []).some((o: any) => o.id !== exceptCompanyId && String(o.profile?.invoice_prefix ?? '').toUpperCase() === prefix);
  if (taken) throw new HttpError(409, 'Another company already uses that invoice prefix');
}

/** Initials of the name's words (camel-case words split), e.g. "MargixIndia Logistics" gives MIL; a single word gives its first three letters. */
export function derivePrefix(name: string): string {
  const words = name.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean)
    .filter(w => !['PVT', 'LTD', 'LLP', 'PRIVATE', 'LIMITED', 'THE', 'AND', 'OF'].includes(w.toUpperCase()));
  let letters = words.length > 1 ? words.map(w => w[0]).join('') : (words[0] ?? '').slice(0, 3);
  letters = letters.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  return letters.length >= 2 ? letters : 'INV';
}

/**
 * The prefix of a company's invoice numbers. The one set in its profile; else one derived from its name
 * (`MIL`), made unique with a digit when another company has it, and saved so it never changes after.
 */
export async function invoicePrefixFor(companyId: string): Promise<string> {
  const org = await loadOrg(companyId);
  if (!org) return 'INV';
  const set = typeof org.profile.invoice_prefix === 'string' ? org.profile.invoice_prefix.trim().toUpperCase() : '';
  if (PREFIX_RE.test(set)) return set;

  const { data, error } = await supabase.from('organizations').select('id, profile');
  if (error) throw new Error(`Failed to read invoice prefixes: ${error.message}`);
  const used = new Set((data ?? []).filter((o: any) => o.id !== companyId).map((o: any) => String(o.profile?.invoice_prefix ?? '').toUpperCase()));
  const profileName = typeof org.profile.legal_name === "string" ? org.profile.legal_name : '';
  const base = derivePrefix(org.legal_name || profileName || org.name);
  let candidate = base;
  for (let n = 2; used.has(candidate) && n < 100; n++) candidate = `${base.slice(0, 5)}${n}`.slice(0, 6);
  const { error: saveErr } = await supabase
    .from('organizations')
    .update({ profile: { ...org.profile, invoice_prefix: candidate }, updated_at: new Date().toISOString() })
    .eq('id', companyId);
  loadCompanyProfile.clear();
  if (saveErr) {
    // Lost a race for the same prefix: the unique index said so. Whoever won has it; try the next free one.
    if (saveErr.code === '23505') return invoicePrefixFor(companyId);
    throw new Error(`Failed to save the invoice prefix: ${saveErr.message}`);
  }
  return candidate;
}

/** What is missing before an invoice is a complete GST tax invoice. */
export function companyGaps(c: CompanyProfile): string[] {
  const gaps: string[] = [];
  if (!c.legal_name) gaps.push('company name');
  if (!c.gstin) gaps.push('GSTIN');
  if (!c.address) gaps.push('address');
  if (!c.sac_code) gaps.push('SAC code');
  return gaps;
}

export const COMPANY_PROFILE_INCOMPLETE = 'company_profile_incomplete';
export const INVOICE_PROFILE_MESSAGE = 'Set your company name, GSTIN and state in Settings before issuing invoices';

/**
 * What must be on record before any invoice is issued: the seller's name and GSTIN, and the state they
 * are in (the GSTIN's state code counts, since it names the state; it decides CGST + SGST or IGST).
 */
export function invoiceBlockers(c: CompanyProfile): string[] {
  const missing: string[] = [];
  if (!c.legal_name) missing.push('company name');
  if (!c.gstin) missing.push('GSTIN');
  if (!c.state && !stateOf(c.gstin).code) missing.push('state');
  return missing;
}

/** The seller's GST state code, from the GSTIN or else the state named in Settings. */
export const sellerStateCode = (c: CompanyProfile): string | null => stateOf(c.gstin).code ?? stateCodeByName(c.state);

/** Refuses (409, with the link target for the web) unless the issuing company's profile can stand as the seller. Returns the profile. */
export async function assertCanIssueInvoices(companyId?: SettingsScope): Promise<CompanyProfile> {
  const company = await getCompanyProfile(companyId);
  const missing = invoiceBlockers(company);
  if (missing.length > 0) {
    throw new HttpError(409, INVOICE_PROFILE_MESSAGE, { code: COMPANY_PROFILE_INCOMPLETE, missing, settings_path: '/admin/settings' });
  }
  return company;
}

/** The only part of the company profile a vendor or customer may see: where to pay. */
export interface PaymentDetails {
  account_name: string | null;
  bank_name: string | null;
  bank_account_no: string | null;
  bank_ifsc: string | null;
  upi_id: string | null;
  payment_terms_days: number;
  /** True when there is a bank account or a UPI id to pay into. */
  available: boolean;
}

export async function getPaymentDetails(companyId?: SettingsScope): Promise<PaymentDetails> {
  const c = await getCompanyProfile(companyId);
  const bank = Boolean(c.bank_account_no && c.bank_ifsc);
  return {
    account_name: c.legal_name,
    bank_name: c.bank_name,
    bank_account_no: c.bank_account_no,
    bank_ifsc: c.bank_ifsc,
    upi_id: c.upi_id,
    payment_terms_days: c.payment_terms_days,
    available: bank || Boolean(c.upi_id),
  };
}
