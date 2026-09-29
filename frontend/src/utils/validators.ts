/** Light, client-side format checks shared by forms across the console. None of
 * these replace server-side validation — they just catch obvious typos early. */

/** Strips a typed phone number down to bare digits, dropping a leading country code or trunk 0. */
function normalizeIndianMobileDigits(raw: string): string {
  let digits = raw.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  return digits
}

const INDIAN_MOBILE_RE = /^[6-9]\d{9}$/

/** Error message for a 10-digit Indian mobile number, or undefined if valid or empty. */
export function indianMobileError(raw: string): string | undefined {
  if (!raw.trim()) return undefined
  return INDIAN_MOBILE_RE.test(normalizeIndianMobileDigits(raw)) ? undefined : 'Enter a valid 10-digit Indian mobile number'
}

const RC_NUMBER_RE = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/

/** Error message for a vehicle RC (registration certificate) number, or undefined if valid or empty. */
export function rcNumberError(raw: string): string | undefined {
  if (!raw.trim()) return undefined
  const cleaned = raw.replace(/[\s-]/g, '').toUpperCase()
  return RC_NUMBER_RE.test(cleaned) ? undefined : 'Enter a valid RC number, e.g. MH01AB1234'
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Error message for an email address, or undefined if valid or empty. */
export function emailError(raw: string): string | undefined {
  if (!raw.trim()) return undefined
  return EMAIL_RE.test(raw.trim()) ? undefined : 'Enter a valid email address'
}
