/** Number formats for people documents (docs/people-plan.md, "Number formats"). Each returns an error message or null. */

const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]

/** True when the digit string passes the Verhoeff check (used by Aadhaar). */
export function verhoeff(digits: string): boolean {
  let c = 0
  const rev = digits.split('').reverse()
  for (let i = 0; i < rev.length; i++) c = D[c][P[i % 8][Number(rev[i])]]
  return c === 0
}

export const aadhaarError = (v: string) => {
  const d = v.replace(/[\s-]/g, '')
  if (!/^\d{12}$/.test(d)) return 'Aadhaar is 12 digits.'
  return verhoeff(d) ? null : 'This Aadhaar number does not pass the check. Look for a typing mistake.'
}
export const panError = (v: string) => (/^[A-Z]{5}\d{4}[A-Z]$/.test(v.trim().toUpperCase()) ? null : 'PAN looks like ABCDE1234F.')
export const voterIdError = (v: string) => (/^[A-Z]{3}\d{7}$/.test(v.trim().toUpperCase()) ? null : 'Voter ID is 3 letters and 7 digits, like ABC1234567.')
export const passportError = (v: string) => (/^[A-Z]\d{7}$/.test(v.trim().toUpperCase()) ? null : 'Passport is a letter and 7 digits, like A1234567.')
export const ifscError = (v: string) => (/^[A-Z]{4}0[A-Z0-9]{6}$/.test(v.trim().toUpperCase()) ? null : 'IFSC looks like HDFC0001234.')
/** Driving licence numbers vary by state: only a loose check, so this warns and never refuses. */
export const licenceFormatWarning = (v: string) =>
  /^[A-Z]{2}[\s-]?\d{2}[\s-]?(\d{4})?[\s-]?\d{5,8}$/i.test(v.trim()) ? null : 'This does not look like the usual format (state code plus digits). Check it against the card.'

/** Errors that stop a save. The licence number is only ever a warning. */
export function docNumberError(type: string, value: string): string | null {
  switch (type) {
    case 'aadhaar': return aadhaarError(value)
    case 'pan': return panError(value)
    case 'voter_id': return voterIdError(value)
    case 'passport': return passportError(value)
    default: return null
  }
}

/** "XXXX XXXX 1234", from the last four digits or a full number. */
export function maskAadhaar(value: string | null | undefined, last4?: string | null): string | null {
  const digits = (value ?? '').replace(/\D/g, '')
  const tail = last4 && last4.length === 4 ? last4 : digits.length >= 4 ? digits.slice(-4) : null
  return tail ? `XXXX XXXX ${tail}` : null
}

const normaliseName = (n: string) => n.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
/** True when both names are given and differ after case, spacing and punctuation are ignored. */
export const namesDiffer = (a: string | null | undefined, b: string | null | undefined) =>
  !!a?.trim() && !!b?.trim() && normaliseName(a) !== normaliseName(b)

/** Age in whole years on `today`, from a YYYY-MM-DD date of birth. Null for an unreadable date. */
export function ageOn(dob: string, today: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob)
  if (!m) return null
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  let age = today.getFullYear() - y
  if (today.getMonth() + 1 < mo || (today.getMonth() + 1 === mo && today.getDate() < d)) age -= 1
  return age
}

export const TRANSPORT_CLASSES = ['TRANS']
/** Error for a date of birth: not in the future, 18+ (20+ with a transport licence class). */
export function dobError(dob: string, classes: string[] = [], today: Date = new Date()): string | null {
  if (!dob) return null
  const age = ageOn(dob, today)
  if (age === null) return 'Enter a valid date.'
  if (age < 0) return 'Date of birth cannot be in the future.'
  const needs = classes.some(c => TRANSPORT_CLASSES.includes(c)) ? 20 : 18
  return age < needs ? `They must be at least ${needs}${needs === 20 ? ' to hold a transport licence' : ''}.` : null
}
