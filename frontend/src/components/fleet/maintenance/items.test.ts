import { describe, expect, it } from 'vitest'
import { lineTotal, moneyOrNull, recordTotal } from './items'

describe('service item totals', () => {
  it('multiplies quantity by unit cost and rounds to paise', () => {
    expect(lineTotal({ quantity: 2, unit_cost: 1250.5 })).toBe(2501)
    expect(lineTotal({ quantity: 0.5, unit_cost: 333.33 })).toBe(166.67)
  })

  it('makes the record total the items plus labour', () => {
    const items = [{ quantity: 8, unit_cost: 420 }, { quantity: 1, unit_cost: 350 }]
    expect(recordTotal(items, 500, 99)).toBe(4210)
    expect(recordTotal(items, null, 99)).toBe(3710)
  })

  it('uses the typed total only when there are no items and no labour', () => {
    expect(recordTotal([], null, 4200)).toBe(4200)
    expect(recordTotal([], null, null)).toBeNull()
    expect(recordTotal([], 0, 4200)).toBe(0)
  })

  it('reads money boxes', () => {
    expect(moneyOrNull('')).toBeNull()
    expect(moneyOrNull(' 12.5 ')).toBe(12.5)
    expect(moneyOrNull('abc')).toBeUndefined()
    expect(moneyOrNull('-3')).toBeUndefined()
  })
})
