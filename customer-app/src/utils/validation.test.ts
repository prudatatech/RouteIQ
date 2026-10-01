import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amountError, emailError, gstinError, isDay, paidOnError, parseAmount, pincodeError, queryError, referenceError } from './validation.ts';

test('GSTIN: empty clears, a valid one passes, anything else fails', () => {
  assert.equal(gstinError(''), null);
  assert.equal(gstinError('27ABCDE1234F1Z5'), null);
  assert.equal(gstinError('27abcde1234f1z5'), 'err_gstin');
  assert.equal(gstinError('27ABCDE1234F1Z'), 'err_gstin');
  assert.equal(gstinError('00ABCDE1234F1Z5'), 'err_gstin');
  assert.equal(gstinError('27ABCDE1234F0Z5'), 'err_gstin');
});

test('PIN code is six digits and does not start with 0', () => {
  assert.equal(pincodeError(''), null);
  assert.equal(pincodeError('400001'), null);
  assert.equal(pincodeError('040001'), 'err_pincode');
  assert.equal(pincodeError('4000'), 'err_pincode');
  assert.equal(pincodeError('40000a'), 'err_pincode');
});

test('email needs an at sign and a dot after it', () => {
  assert.equal(emailError(''), null);
  assert.equal(emailError('a@b.in'), null);
  assert.equal(emailError('a@b'), 'err_email');
  assert.equal(emailError('a b@c.in'), 'err_email');
});

test('amount: positive, two decimals at most, not above what is due', () => {
  assert.equal(parseAmount('1180'), 1180);
  assert.equal(parseAmount('1180.5'), 1180.5);
  assert.equal(parseAmount('1180.555'), null);
  assert.equal(parseAmount('0'), null);
  assert.equal(parseAmount('-5'), null);
  assert.equal(parseAmount(''), null);
  assert.equal(amountError('1180', 1180), null);
  assert.equal(amountError('1180.01', 1180), 'err_amount');
  assert.equal(amountError('0.30', 0.3), null);
  assert.equal(amountError('abc', 1180), 'err_amount');
});

test('paid-on date: a real day, not in the future, not before the invoice', () => {
  assert.equal(isDay('2026-02-29'), false);
  assert.equal(isDay('2026-02-28'), true);
  assert.equal(paidOnError('2026-10-01', '2026-10-01', '2026-09-20'), null);
  assert.equal(paidOnError('2026-10-02', '2026-10-01', '2026-09-20'), 'err_date_future');
  assert.equal(paidOnError('2026-09-19', '2026-10-01', '2026-09-20'), 'err_date_before');
  assert.equal(paidOnError('1 Oct', '2026-10-01', null), 'err_date');
  assert.equal(paidOnError('2026-01-01', '2026-10-01', null), null);
});

test('reference is needed except for cash and other', () => {
  assert.equal(referenceError('', 'upi'), 'err_reference');
  assert.equal(referenceError('  ', 'neft'), 'err_reference');
  assert.equal(referenceError('UTR123', 'neft'), null);
  assert.equal(referenceError('', 'cash'), null);
  assert.equal(referenceError('', 'other'), null);
});

test('a question needs 3 characters', () => {
  assert.equal(queryError('hi'), 'err_message');
  assert.equal(queryError(' hi '), 'err_message');
  assert.equal(queryError('why?'), null);
});
