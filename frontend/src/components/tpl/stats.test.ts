import { describe, expect, it } from 'vitest'
import { formatMinutes, formatPercent, formatRating } from './stats'

describe('partner statistic formats', () => {
  it('shows a dash before there is data', () => {
    expect(formatPercent(null)).toBe('—')
    expect(formatMinutes(undefined)).toBe('—')
    expect(formatRating(null)).toBe('—')
  })

  it('formats real values', () => {
    expect(formatPercent(2 / 3)).toBe('67%')
    expect(formatPercent(0)).toBe('0%')
    expect(formatMinutes(0.2)).toBe('1 min')
    expect(formatMinutes(42.4)).toBe('42 min')
    expect(formatMinutes(90)).toBe('1.5 h')
    expect(formatRating(4.25)).toBe('4.3 out of 5')
  })
})
