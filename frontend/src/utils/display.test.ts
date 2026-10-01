import { describe, expect, it } from 'vitest'
import { formatDate, formatDateTime, formatDay, formatKg, formatKm, formatMinutes, formatPieces, formatRupees, formatTime } from './display'

describe('money and quantities', () => {
  it('shows whole rupees with lakh grouping and paise only when present', () => {
    expect(formatRupees(125000)).toBe('₹1,25,000')
    expect(formatRupees(1250.5)).toBe('₹1,250.50')
    expect(formatRupees('500.00')).toBe('₹500')
    expect(formatRupees(null)).toBe('—')
  })

  it('formats weight, distance and duration', () => {
    expect(formatKg(1250)).toBe('1,250 kg')
    expect(formatKm(12.34)).toBe('12.3 km')
    expect(formatMinutes(0.2)).toBe('1 min')
    expect(formatMinutes(42.4)).toBe('42 min')
    expect(formatMinutes(65)).toBe('1 h 5 min')
    expect(formatMinutes(120)).toBe('2 h')
    expect(formatMinutes(0)).toBe('—')
    expect(formatMinutes(undefined)).toBe('—')
  })
})

describe('dates in India time', () => {
  it('reads an instant as India local time whatever the machine zone', () => {
    // 08:35 UTC is 14:05 in India
    expect(formatDateTime('2026-09-29T08:35:00Z')).toBe('29 Sep 2026, 2:05 pm')
    expect(formatTime('2026-09-29T08:35:00Z')).toBe('2:05 pm')
    expect(formatTime('2026-09-29T08:35:31Z', { seconds: true })).toBe('2:05:31 pm')
    // 19:00 UTC is already the next morning in India
    expect(formatDate('2026-09-29T19:00:00Z')).toBe('30 Sep 2026')
    expect(formatDateTime('2026-09-29T18:30:00Z')).toBe('30 Sep 2026, 12:00 am')
  })

  it('shows a bare date as the same calendar day', () => {
    expect(formatDate('2026-09-30')).toBe('30 Sep 2026')
    expect(formatDay('2026-09-30')).toBe('30 Sep')
  })

  it('shows a dash for missing or invalid dates', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDateTime('not a date')).toBe('—')
  })
})

describe('formatPieces', () => {
  it('uses the singular for one', () => {
    expect(formatPieces(1)).toBe('1 piece')
    expect(formatPieces(0)).toBe('0 pieces')
    expect(formatPieces(1500)).toBe('1,500 pieces')
    expect(formatPieces(null)).toBe('—')
  })
})
