import { describe, expect, it } from 'vitest'
import { checkGstin, gstinCheckChar, gstinError, normalizeGstin } from './gstin'

describe('GSTIN check', () => {
  it('accepts real GSTINs, in any case and spacing', () => {
    for (const g of ['27AAPFU0939F1ZV', '07AAGFF2194N1Z1', ' 27aapfu0939f1zv ']) {
      expect(checkGstin(g).valid).toBe(true)
    }
    expect(normalizeGstin('27 AAPFU 0939 F1ZV')).toBe('27AAPFU0939F1ZV')
    expect(checkGstin('27AAPFU0939F1ZV')).toMatchObject({ stateCode: '27', pan: 'AAPFU0939F' })
  })

  it('rejects a wrong check character or a changed digit', () => {
    expect(checkGstin('27AAPFU0939F1Z5')).toMatchObject({ valid: false, problem: 'checksum' })
    expect(checkGstin('27AAPFU0938F1ZV')).toMatchObject({ valid: false, problem: 'checksum' })
  })

  it('rejects malformed values', () => {
    for (const g of ['', '27AAPFU0939F1Z', '99AAPFU0939F1ZVX', '00AAPFU0939F1ZV', '27AAPFU0939F1AV']) {
      expect(checkGstin(g).valid).toBe(false)
    }
    expect(checkGstin('').problem).toBe('empty')
  })

  it('computes the check character', () => {
    expect(gstinCheckChar('27AAPFU0939F1Z')).toBe('V')
    expect(gstinCheckChar('short')).toBeNull()
  })

  it('flags a GSTIN that belongs to another PAN', () => {
    expect(gstinError('27AAPFU0939F1ZV', 'AAPFU0939F')).toBeUndefined()
    expect(gstinError('27AAPFU0939F1ZV', 'ABCDE1234F')).toMatch(/different PAN/)
    expect(gstinError('27AAPFU0939F1ZV', 'nope')).toBeUndefined()
  })
})
