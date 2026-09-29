/**
 * Format checks and masking for people profiles: PAN, IFSC, Aadhaar,
 * bank account numbers, UPI ids, PIN codes and calendar dates.
 * Every masker keeps only the last four characters.
 */
import { isPanFormat } from './gstin';

const IFSC_FORMAT = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const PINCODE_FORMAT = /^[1-9][0-9]{5}$/;
const AADHAAR_FORMAT = /^[2-9][0-9]{11}$/;
const ACCOUNT_FORMAT = /^[0-9]{9,18}$/;
const UPI_FORMAT = /^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9]{1,63}$/;

/** Upper-cases and removes spaces. */
export const normalizePan = (raw: unknown): string => (typeof raw === 'string' ? raw.replace(/\s+/g, '').toUpperCase() : '');
export const normalizeIfsc = normalizePan;

export { isPanFormat };
export const isIfscFormat = (ifsc: unknown): boolean => IFSC_FORMAT.test(normalizeIfsc(ifsc));
export const isPincode = (pin: unknown): boolean => typeof pin === 'string' && PINCODE_FORMAT.test(pin.trim());

/** Digits only. */
export const normalizeAadhaar = (raw: unknown): string => (typeof raw === 'string' ? raw.replace(/[\s-]+/g, '') : '');
export const isAadhaarFormat = (raw: unknown): boolean => AADHAAR_FORMAT.test(normalizeAadhaar(raw));

export const normalizeAccountNumber = (raw: unknown): string => (typeof raw === 'string' ? raw.replace(/[\s-]+/g, '') : '');
export const isAccountNumber = (raw: unknown): boolean => ACCOUNT_FORMAT.test(normalizeAccountNumber(raw));
export const isUpiId = (raw: unknown): boolean => typeof raw === 'string' && UPI_FORMAT.test(raw.trim());

/** `XXXX XXXX 1234`: only the last four digits of an Aadhaar number. */
export function maskAadhaar(value: string | null | undefined): string | null {
  if (!value) return null;
  return `XXXX XXXX ${normalizeAadhaar(value).slice(-4)}`;
}

/** `XXXXXX1234`: every character but the last four hidden. */
export function maskAccountNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  return 'X'.repeat(Math.max(value.length - 4, 4)) + value.slice(-4);
}

/** True for a real calendar date written YYYY-MM-DD. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
