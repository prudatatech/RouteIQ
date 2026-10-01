/**
 * margixindia — Company profile: the seller on every invoice.
 *
 * Staff enter it once in Settings. It is kept in system_settings under `company_profile`
 * (value is `{ "value": { ... } }`, like the other settings). Nothing here has a default except the
 * payment terms (15 days): an invoice shows exactly what staff entered, and says what is missing.
 */
import { supabase } from '../core/supabase';
import { memoize } from '../core/memo';
import { HttpError } from '../core/errors';
import { checkGstin, normalizeGstin } from '../utils/gstin';
import { stateCodeByName, stateOf } from '../core/gst';

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
  /** Free text under the total, e.g. the jurisdiction line. */
  invoice_footer: string | null;
}

const TEXT_FIELDS = [
  'legal_name', 'address', 'city', 'state', 'pincode', 'phone', 'email', 'sac_code',
  'bank_name', 'bank_account_no', 'bank_ifsc', 'upi_id', 'invoice_footer',
] as const;

const EMPTY: CompanyProfile = {
  legal_name: null, gstin: null, pan: null, address: null, city: null, state: null, pincode: null, phone: null, email: null,
  sac_code: null, bank_name: null, bank_account_no: null, bank_ifsc: null, upi_id: null,
  payment_terms_days: DEFAULT_PAYMENT_TERMS_DAYS, invoice_footer: null,
};

const MAX_TEXT = 300;

const SETTINGS_CACHE_MS = 30_000;

const loadCompanyProfile = memoize(SETTINGS_CACHE_MS, async (): Promise<CompanyProfile> => {
  const { data, error } = await supabase.from('system_settings').select('value').eq('key', COMPANY_PROFILE_KEY).maybeSingle();
  if (error) throw new Error(`Failed to read company profile: ${error.message}`);
  const raw = ((data?.value as { value?: Record<string, unknown> } | null)?.value ?? {}) as Record<string, unknown>;
  const out: CompanyProfile = { ...EMPTY };
  for (const key of [...TEXT_FIELDS, 'gstin', 'pan'] as const) {
    const v = raw[key];
    out[key] = typeof v === 'string' && v.trim() ? v.trim() : null;
  }
  const days = Number(raw.payment_terms_days);
  if (raw.payment_terms_days != null && Number.isInteger(days) && days >= 0 && days <= 365) out.payment_terms_days = days;
  return out;
});

/** The profile is the same for every user and changes rarely: read at most every 30 s; saving clears it. */
export async function getCompanyProfile(): Promise<CompanyProfile> {
  return { ...(await loadCompanyProfile()) };
}

/** The payment terms new invoices are issued with. Never fails an invoice: falls back to the default. */
export async function paymentTermsDays(): Promise<number> {
  try {
    return (await getCompanyProfile()).payment_terms_days;
  } catch (e) {
    console.error('[invoice] could not read payment terms, using the default:', e);
    return DEFAULT_PAYMENT_TERMS_DAYS;
  }
}

/** Validates and stores the profile. Every field is optional; an empty string clears it. */
export async function saveCompanyProfile(input: Record<string, unknown>): Promise<CompanyProfile> {
  const current = await getCompanyProfile();
  const next: CompanyProfile = { ...current };
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
  if (next.sac_code && !/^\d{4,8}$/.test(next.sac_code)) throw new HttpError(400, 'SAC is 4 to 8 digits');
  if (next.bank_ifsc) next.bank_ifsc = next.bank_ifsc.toUpperCase().replace(/\s+/g, '');
  if (next.bank_ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(next.bank_ifsc)) throw new HttpError(400, 'IFSC has 11 characters: 4 letters, a 0, then 6 letters or digits');
  if (next.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email)) throw new HttpError(400, 'Enter a valid email');

  const { error } = await supabase
    .from('system_settings')
    .upsert({ key: COMPANY_PROFILE_KEY, value: { value: next }, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  loadCompanyProfile.clear();
  if (error) throw new Error(`Failed to save company profile: ${error.message}`);
  return next;
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

/** Refuses (409, with the link target for the web) unless the company profile can stand as the seller. Returns the profile. */
export async function assertCanIssueInvoices(): Promise<CompanyProfile> {
  const company = await getCompanyProfile();
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

export async function getPaymentDetails(): Promise<PaymentDetails> {
  const c = await getCompanyProfile();
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
