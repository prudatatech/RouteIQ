import { describe, expect, it } from 'vitest';
import { normalizeIndianMobile } from '../src/utils/phone';

describe('normalizeIndianMobile', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['+91 98765-43210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['6000000000', '+916000000000'],
  ])('accepts %s', (raw, out) => expect(normalizeIndianMobile(raw)).toBe(out));

  it.each(['5876543210', '987654321', '98765432100', '+1 4155550100', '', 'abc', null, 12345])('refuses %s', raw => expect(normalizeIndianMobile(raw)).toBeNull());
});
