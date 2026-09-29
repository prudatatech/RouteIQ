import { describe, expect, it } from 'vitest';
import {
  ageOn, isAadhaarFormat, isAccountNumber, isCalendarDate, isIfscFormat, isPanFormat, isPassportNumber, isPincode, isUpiId,
  isVoterId, maskAadhaar, maskAccountNumber, normalizeAadhaar, sameName, verhoeffCheckDigit, verhoeffValid,
} from '../src/utils/people-validators';
import { normalizePhone } from '../src/utils/phone';

describe('PAN', () => {
  it('accepts AAAAA9999A and rejects the rest', () => {
    expect(isPanFormat('ABCDE1234F')).toBe(true);
    expect(isPanFormat(' abcde1234f ')).toBe(true);
    expect(isPanFormat('ABCDE12345')).toBe(false);
    expect(isPanFormat('ABCD1234F')).toBe(false);
    expect(isPanFormat(undefined)).toBe(false);
  });
});

describe('IFSC', () => {
  it('needs four letters, a zero and six letters or digits', () => {
    expect(isIfscFormat('HDFC0001234')).toBe(true);
    expect(isIfscFormat('sbin0abc123')).toBe(true);
    expect(isIfscFormat('HDFC1001234')).toBe(false);
    expect(isIfscFormat('HDFC000123')).toBe(false);
    expect(isIfscFormat(12)).toBe(false);
  });
});

describe('Aadhaar, account, UPI, PIN, date', () => {
  it('checks formats', () => {
    const body = '23456789012';
    const valid = `${body}${verhoeffCheckDigit(body)}`;
    expect(verhoeffValid(valid)).toBe(true);
    expect(isAadhaarFormat(valid)).toBe(true);
    expect(isAadhaarFormat(`${valid.slice(0, 4)} ${valid.slice(4, 8)} ${valid.slice(8)}`)).toBe(true);
    expect(isAadhaarFormat(`${body}${(verhoeffCheckDigit(body) + 1) % 10}`)).toBe(false); // wrong check digit
    expect(isAadhaarFormat('123456789012')).toBe(false);
    expect(isAadhaarFormat('2345678901')).toBe(false);
    expect(normalizeAadhaar('2345-6789-0123')).toBe('234567890123');
    expect(isAccountNumber('123456789012')).toBe(true);
    expect(isAccountNumber('12345')).toBe(false);
    expect(isAccountNumber('12345678A')).toBe(false);
    expect(isUpiId('ravi@okhdfc')).toBe(true);
    expect(isUpiId('ravi')).toBe(false);
    expect(isPincode('560001')).toBe(true);
    expect(isPincode('060001')).toBe(false);
    expect(isPincode('56001')).toBe(false);
    expect(isCalendarDate('2026-02-28')).toBe(true);
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(isCalendarDate('28-02-2026')).toBe(false);
  });
});

describe('voter ID, passport, names and age', () => {
  it('checks formats and compares names', () => {
    expect(isVoterId('ABC1234567')).toBe(true);
    expect(isVoterId('AB12345678')).toBe(false);
    expect(isPassportNumber('P1234567')).toBe(true);
    expect(isPassportNumber('12345678')).toBe(false);
    expect(sameName('Ravi  Kumar', 'ravi kumar')).toBe(true);
    expect(sameName('Kumar, Ravi', 'Ravi Kumar')).toBe(true);
    expect(sameName('Ravi Kumar', 'Suresh Rao')).toBe(false);
    expect(ageOn('2000-06-15', '2026-06-14')).toBe(25);
    expect(ageOn('2000-06-15', '2026-06-15')).toBe(26);
  });
});

describe('masking', () => {
  it('keeps only the last four', () => {
    expect(maskAadhaar('234567890123')).toBe('XXXX XXXX 0123');
    expect(maskAadhaar('2345 6789 0123')).toBe('XXXX XXXX 0123');
    expect(maskAadhaar(null)).toBeNull();
    expect(maskAccountNumber('123456789012')).toBe('XXXXXXXX9012');
    expect(maskAccountNumber('1234')).toBe('XXXX1234');
    expect(maskAccountNumber('')).toBeNull();
  });
});

describe('normalizePhone', () => {
  it('matches how driver OTP login writes numbers', () => {
    expect(normalizePhone('98765 00001')).toBe('+919876500001');
    expect(normalizePhone('09876500001')).toBe('+919876500001');
    expect(normalizePhone('919876500001')).toBe('+919876500001');
    expect(normalizePhone('+919876500001')).toBe('+919876500001');
    expect(normalizePhone('12')).toBeNull();
    expect(normalizePhone(9876500001)).toBeNull();
  });
});
