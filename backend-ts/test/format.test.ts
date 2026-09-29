import { describe, it, expect } from 'vitest';
import { formatINR, formatKg, formatISTDate, formatISTDateTime } from '../src/core/format';
import { manifestParcelCode } from '../src/core/parcelCode';

describe('formatINR', () => {
  it('groups digits the Indian way and drops empty paise', () => {
    expect(formatINR(125000)).toBe('₹1,25,000');
    expect(formatINR('9000')).toBe('₹9,000');
    expect(formatINR(0)).toBe('₹0');
  });
  it('shows paise only when there are some', () => {
    expect(formatINR(499.5)).toBe('₹499.50');
    expect(formatINR(1234.56)).toBe('₹1,234.56');
  });
  it('gives nothing for a missing or non-numeric amount', () => {
    expect(formatINR(null)).toBe('');
    expect(formatINR('abc')).toBe('');
  });
});

describe('formatKg and IST dates', () => {
  it('spaces the unit', () => {
    expect(formatKg(500)).toBe('500 kg');
    expect(formatKg(12500)).toBe('12,500 kg');
  });
  it('shows dates in IST, en-IN order', () => {
    expect(formatISTDate('2026-09-29T20:00:00Z')).toMatch(/^30 Sept? 2026$/);
    expect(formatISTDateTime('2026-09-29T10:15:00Z')).toMatch(/^29 Sept? 2026, 3:45\s?pm$/i);
    expect(formatISTDate('nope')).toBe('');
  });
  it('derives the manifest tracking code in one place', () => {
    expect(manifestParcelCode('abcdef12-3456')).toBe('CM-ABCDEF12');
  });
});
