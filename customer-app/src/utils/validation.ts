/**
 * Checks for the billing form and the invoice report forms. Pure: each returns the key of the sentence
 * to show (a locale key) or null when the value is fine, so screens translate it. The server checks
 * everything again; these only save a round trip.
 */

const GSTIN = /^(0[1-9]|[12][0-9]|3[0-8]|97|99)[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PIN = /^[1-9][0-9]{5}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** An empty value is fine for the optional billing fields: it clears them. */
export const gstinError = (v: string): string | null => (v === '' || GSTIN.test(v) ? null : 'err_gstin');
export const pincodeError = (v: string): string | null => (v === '' || PIN.test(v) ? null : 'err_pincode');
export const emailError = (v: string): string | null => (v === '' || EMAIL.test(v) ? null : 'err_email');

/** Rupees as typed: more than 0, at most what is due, up to two decimals. */
export function parseAmount(v: string): number | null {
  const text = v.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const n = Number(text);
  return n > 0 ? n : null;
}

export function amountError(v: string, due: number | null): string | null {
  const n = parseAmount(v);
  if (n == null) return 'err_amount';
  // Compare in paise so 0.1 + 0.2 style float noise cannot reject an exact amount.
  return due != null && Math.round(n * 100) > Math.round(due * 100) ? 'err_amount' : null;
}

/** A real calendar day as YYYY-MM-DD. */
export function isDay(v: string): boolean {
  const m = DAY.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** `today` and `earliest` are YYYY-MM-DD days (India time); `earliest` is the invoice date, when known. */
export function paidOnError(v: string, today: string, earliest: string | null): string | null {
  if (!isDay(v)) return 'err_date';
  if (v > today) return 'err_date_future';
  if (earliest && v < earliest) return 'err_date_before';
  return null;
}

export const METHODS_WITHOUT_REFERENCE = ['cash', 'other'];
export const REFERENCE_MAX = 100;

export const referenceError = (v: string, method: string): string | null =>
  METHODS_WITHOUT_REFERENCE.includes(method) || v.trim() !== '' ? null : 'err_reference';

export const QUERY_MIN = 3;
export const QUERY_MAX = 1000;

export const queryError = (v: string): string | null => (v.trim().length >= QUERY_MIN ? null : 'err_message');
