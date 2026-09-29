import { describe, expect, it } from 'vitest'
import { deriveAmounts, formatKmpl, sendableAmounts, type AmountValues } from './amounts'

const v = (litres = '', price = '', total = ''): AmountValues => ({ litres, price, total })

describe('deriveAmounts', () => {
  it('works out the total from litres and price', () => {
    expect(deriveAmounts(v('40', '95.5'), ['litres', 'price'])).toEqual(v('40', '95.5', '3820'))
  })

  it('works out the price from litres and total, and the litres from price and total', () => {
    expect(deriveAmounts(v('40', '', '3820'), ['litres', 'total']).price).toBe('95.5')
    expect(deriveAmounts(v('', '100', '2500'), ['price', 'total']).litres).toBe('25')
  })

  it('fills in the field that was not one of the last two typed', () => {
    // total was typed first, then price, then litres: the price is now the one worked out
    expect(deriveAmounts(v('40', '1', '4000'), ['total', 'litres']).price).toBe('100')
  })

  it('leaves the values alone until two fields are typed and clears a result that cannot be worked out', () => {
    expect(deriveAmounts(v('40'), ['litres'])).toEqual(v('40'))
    expect(deriveAmounts(v('40', '0'), ['litres', 'price']).total).toBe('')
  })
})

describe('sendableAmounts', () => {
  it('sends the two most recently typed figures only', () => {
    expect(sendableAmounts(v('40', '100', '4000'), ['total', 'litres'])).toEqual({ total_amount: 4000, litres: 40 })
    expect(sendableAmounts(v('40', '100', '4000'), ['litres', 'price', 'total'])).toEqual({ price_per_litre: 100, total_amount: 4000 })
  })

  it('sends nothing when fewer than two valid figures are typed', () => {
    expect(sendableAmounts(v('40'), ['litres'])).toBeNull()
    expect(sendableAmounts(v('40', 'abc'), ['litres', 'price'])).toBeNull()
  })
})

describe('formatKmpl', () => {
  it('shows one decimal at most and a dash when unknown', () => {
    expect(formatKmpl(10)).toBe('10 km/l')
    expect(formatKmpl(6.67)).toBe('6.7 km/l')
    expect(formatKmpl(null)).toBe('—')
  })
})
