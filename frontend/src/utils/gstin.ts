/**
 * GSTIN validation: format plus the mod-36 check digit.
 *
 * Keep in step with backend-ts/src/utils/gstin.ts (same algorithm, same messages).
 * A GSTIN is 15 characters: 2-digit state code, the holder's 10-character PAN,
 * an entity number, the letter Z, and a check character over the first 14.
 */

const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const FORMAT = /^(0[1-9]|[1-2][0-9]|3[0-8]|97|99)[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const PAN_FORMAT = /^[A-Z]{5}[0-9]{4}[A-Z]$/

/** Upper-cases and removes spaces. */
export function normalizeGstin(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\s+/g, '').toUpperCase()
}

/** The check character for the first 14 characters of a GSTIN, or null when they are not valid characters. */
export function gstinCheckChar(first14: string): string | null {
  if (first14.length !== 14) return null
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const value = CHARSET.indexOf(first14[i])
    if (value < 0) return null
    const product = value * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(product / 36) + (product % 36)
  }
  return CHARSET[(36 - (sum % 36)) % 36]
}

export type GstinProblem = 'empty' | 'format' | 'checksum'

export interface GstinCheck {
  gstin: string
  valid: boolean
  problem?: GstinProblem
  /** Why it failed, in plain language. */
  message?: string
  stateCode?: string
  /** The holder's PAN, which is characters 3 to 12. */
  pan?: string
}

export function checkGstin(raw: string | null | undefined): GstinCheck {
  const gstin = normalizeGstin(raw)
  if (!gstin) return { gstin, valid: false, problem: 'empty', message: 'Enter the GSTIN' }
  if (!FORMAT.test(gstin)) {
    return {
      gstin,
      valid: false,
      problem: 'format',
      message: 'A GSTIN has 15 characters: 2 digits, 5 letters, 4 digits, 1 letter, then 1 letter or digit, Z and a check character',
    }
  }
  if (gstinCheckChar(gstin.slice(0, 14)) !== gstin[14]) {
    return {
      gstin,
      valid: false,
      problem: 'checksum',
      message: 'The last character does not match the rest of the GSTIN. Check for a typing mistake',
    }
  }
  return { gstin, valid: true, stateCode: gstin.slice(0, 2), pan: gstin.slice(2, 12) }
}

/** Error text when the GSTIN is invalid or belongs to a different PAN, else undefined. */
export function gstinError(raw: string | null | undefined, pan?: string | null): string | undefined {
  const check = checkGstin(raw)
  if (!check.valid) return check.message
  const cleanPan = (pan ?? '').trim().toUpperCase()
  if (PAN_FORMAT.test(cleanPan) && check.pan !== cleanPan) return 'This GSTIN belongs to a different PAN than the one entered'
  return undefined
}
