import { describe, expect, it } from 'vitest';
import { hasEwayBill } from '../src/services/cargo/transfer.service';

describe('hasEwayBill', () => {
  it('needs a reference, so goods with no e-way bill never show "Part B due"', () => {
    expect(hasEwayBill('291012345678')).toBe(true);
    expect(hasEwayBill('  ')).toBe(false);
    expect(hasEwayBill(null)).toBe(false);
    expect(hasEwayBill(undefined)).toBe(false);
  });
});
