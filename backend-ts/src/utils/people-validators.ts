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

// Verhoeff check digit, which the last digit of an Aadhaar number satisfies
const V_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const V_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
const V_INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

/** True when the digit string passes the Verhoeff checksum. */
export function verhoeffValid(digits: string): boolean {
  let c = 0;
  const reversed = digits.split('').reverse().map(Number);
  reversed.forEach((d, i) => { c = V_D[c][V_P[i % 8][d]]; });
  return c === 0;
}

/** The Verhoeff check digit to append to `digits` (used to build test numbers). */
export function verhoeffCheckDigit(digits: string): number {
  let c = 0;
  const reversed = digits.split('').reverse().map(Number);
  reversed.forEach((d, i) => { c = V_D[c][V_P[(i + 1) % 8][d]]; });
  return V_INV[c];
}

export const isAadhaarFormat = (raw: unknown): boolean => {
  const digits = normalizeAadhaar(raw);
  return AADHAAR_FORMAT.test(digits) && verhoeffValid(digits);
};

export const normalizeCode = (raw: unknown): string => (typeof raw === 'string' ? raw.replace(/[\s-]+/g, '').toUpperCase() : '');
/** Voter ID (EPIC): three letters and seven digits. */
export const isVoterId = (raw: unknown): boolean => /^[A-Z]{3}[0-9]{7}$/.test(normalizeCode(raw));
/** Passport: a letter and seven digits. */
export const isPassportNumber = (raw: unknown): boolean => /^[A-Z][0-9]{7}$/.test(normalizeCode(raw));
/** Driving licence: two-letter state code then digits (loose; the shape varies by state and year, so this only warns). */
export const looksLikeDrivingLicence = (raw: unknown): boolean => /^[A-Z]{2}[0-9]{2}[0-9A-Z]{9,13}$/.test(normalizeCode(raw));

/** A name for comparison: lower case, letters and digits only, words in order. */
export const normalizeName = (raw: unknown): string =>
  typeof raw === 'string' ? raw.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).join(' ') : '';
/** True when two names match after normalising case, spacing and punctuation, or one is the other's words in a different order. */
export function sameName(a: unknown, b: unknown): boolean {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return true;
  if (x === y) return true;
  return x.split(' ').sort().join(' ') === y.split(' ').sort().join(' ');
}

/** Whole years between a YYYY-MM-DD birth date and `today` (YYYY-MM-DD). */
export function ageOn(dateOfBirth: string, today: string): number {
  const [by, bm, bd] = dateOfBirth.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

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
