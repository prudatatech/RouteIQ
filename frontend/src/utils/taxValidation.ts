/**
 * Indian Tax & Identity validation helpers for PAN and GSTIN
 * Provides real-time feedback, structure checks, and cross-matching between PAN and GSTIN.
 */

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

const PAN_4TH_LETTER_NAMES: Record<string, string> = {
  C: 'Company',
  P: 'Individual / Proprietorship',
  H: 'Hindu Undivided Family (HUF)',
  F: 'Partnership Firm / LLP',
  A: 'Association of Persons (AOP)',
  T: 'Trust',
  B: 'Body of Individuals (BOI)',
  L: 'Local Authority',
  J: 'Artificial Juridical Person',
  G: 'Government Agency',
}

export function getPanCategory(pan: string): string | null {
  const clean = pan.trim().toUpperCase()
  if (clean.length < 4) return null
  const char = clean[3]
  return PAN_4TH_LETTER_NAMES[char] || null
}

export function validatePanFormat(pan: string): { valid: boolean; hint?: string } {
  const clean = pan.trim().toUpperCase()
  if (!clean) return { valid: false }
  if (clean.length < 10) {
    return { valid: false, hint: `10 characters required (${clean.length}/10)` }
  }
  if (!PAN_REGEX.test(clean)) {
    return { valid: false, hint: 'Invalid format (format: 5 letters, 4 numbers, 1 letter, e.g. ABCDE1234F)' }
  }
  const category = getPanCategory(clean)
  return { valid: true, hint: category ? `${category} PAN` : 'Valid PAN format' }
}

export function validateGstinFormat(gstin: string, pan?: string): { valid: boolean; error?: string } {
  const clean = gstin.trim().toUpperCase()
  if (!clean) return { valid: true }
  if (clean.length !== 15) {
    return { valid: false, error: `GSTIN must be 15 characters (${clean.length}/15)` }
  }
  if (!GSTIN_REGEX.test(clean)) {
    return { valid: false, error: 'Invalid GSTIN format (e.g. 27ABCDE1234F1Z5)' }
  }
  if (pan) {
    const cleanPan = pan.trim().toUpperCase()
    const panInGst = clean.slice(2, 12)
    if (cleanPan.length === 10 && panInGst !== cleanPan) {
      return { valid: false, error: `GSTIN characters 3–12 (${panInGst}) do not match the PAN (${cleanPan})` }
    }
  }
  return { valid: true }
}
