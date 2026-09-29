import { describe, expect, it } from 'vitest';
import { checkGstin, gstinCheckChar, gstinError, normalizeGstin } from '../src/utils/gstin';

describe('GSTIN check', () => {
  it.each(['27AAPFU0939F1ZV', '07AAGFF2194N1Z1'])('accepts %s', gstin => {
    expect(checkGstin(gstin)).toMatchObject({ valid: true, stateCode: gstin.slice(0, 2), pan: gstin.slice(2, 12) });
  });

  it('accepts lower case and spaces', () => {
    expect(checkGstin(' 27aapfu0939f1zv ').valid).toBe(true);
    expect(normalizeGstin('27 AAPFU 0939 F1ZV')).toBe('27AAPFU0939F1ZV');
  });

  it('rejects a wrong check character', () => {
    expect(checkGstin('27AAPFU0939F1Z5')).toMatchObject({ valid: false, problem: 'checksum' });
  });

  it('rejects a changed digit', () => {
    expect(checkGstin('27AAPFU0938F1ZV')).toMatchObject({ valid: false, problem: 'checksum' });
  });

  it.each(['', '27AAPFU0939F1Z', '99AAPFU0939F1ZVX', '00AAPFU0939F1ZV', '27AAPFU0939F1AV'])('rejects malformed %j', gstin => {
    expect(checkGstin(gstin).valid).toBe(false);
  });

  it('computes the check character', () => {
    expect(gstinCheckChar('27AAPFU0939F1Z')).toBe('V');
    expect(gstinCheckChar('short')).toBeNull();
  });

  it('flags a GSTIN that belongs to another PAN', () => {
    expect(gstinError('27AAPFU0939F1ZV', 'AAPFU0939F')).toBeUndefined();
    expect(gstinError('27AAPFU0939F1ZV', 'ABCDE1234F')).toMatch(/different PAN/);
    expect(gstinError('27AAPFU0939F1ZV', 'not a pan')).toBeUndefined();
  });
});
