import { describe, expect, it } from 'vitest'
import { formatPercent, formatRating } from './stats'

describe('partner statistic formats', () => {
  it('shows a dash before there is data', () => {
    expect(formatPercent(null)).toBe('—')
    expect(formatRating(null)).toBe('—')
  })

  it('formats real values', () => {
    expect(formatPercent(2 / 3)).toBe('67%')
    expect(formatPercent(0)).toBe('0%')
    expect(formatRating(4.25)).toBe('4.3 out of 5')
  })
})
