import { describe, expect, it } from 'vitest'
import { aadhaarError, dobError, docNumberError, ifscError, maskAadhaar, namesDiffer, panError, verhoeff } from './validators'

describe('people validators', () => {
  it('checks Aadhaar length and the Verhoeff digit', () => {
    expect(verhoeff('2363')).toBe(true)
    expect(aadhaarError('1234')).toMatch(/12 digits/)
    expect(aadhaarError('234123412346')).toBeNull()
    expect(aadhaarError('234123412347')).toMatch(/typing mistake/)
  })
  it('checks PAN, IFSC and other numbers', () => {
    expect(panError('abcde1234f')).toBeNull()
    expect(panError('ABCD12345')).not.toBeNull()
    expect(ifscError('hdfc0001234')).toBeNull()
    expect(ifscError('HDFC1001234')).not.toBeNull()
    expect(docNumberError('voter_id', 'ABC1234567')).toBeNull()
    expect(docNumberError('passport', 'A1234567')).toBeNull()
    expect(docNumberError('passport', '12345678')).not.toBeNull()
  })
  it('always masks Aadhaar to the last four digits', () => {
    expect(maskAadhaar('234123412346')).toBe('XXXX XXXX 2346')
    expect(maskAadhaar(null, '1234')).toBe('XXXX XXXX 1234')
    expect(maskAadhaar(null)).toBeNull()
  })
  it('compares names ignoring case and spacing', () => {
    expect(namesDiffer('Ramesh  Kumar', 'ramesh kumar')).toBe(false)
    expect(namesDiffer('Ramesh Kumar', 'Ramesh K')).toBe(true)
    expect(namesDiffer('', 'Ramesh')).toBe(false)
  })
  it('applies the age rules', () => {
    const today = new Date(2026, 8, 29)
    expect(dobError('2010-01-01', [], today)).toMatch(/at least 18/)
    expect(dobError('2000-01-01', [], today)).toBeNull()
    expect(dobError('2007-01-01', ['TRANS'], today)).toMatch(/at least 20/)
    expect(dobError('2030-01-01', [], today)).toMatch(/future/)
  })
})
