import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invoiceState, invoicesOfBooking, unpaidInvoiceFor } from './invoices.ts';

const inv = (over: Record<string, unknown>): any => ({ id: 'i', booking_id: 'b1', status: 'issued', overdue: false, due_date: '2026-10-20T00:00:00Z', issued_at: '2026-10-01T00:00:00Z', ...over });

test('an invoice is paid, unpaid or overdue', () => {
  assert.equal(invoiceState(inv({ status: 'paid' })), 'paid');
  assert.equal(invoiceState(inv({})), 'unpaid');
  assert.equal(invoiceState(inv({ overdue: true })), 'overdue');
});

test('the unpaid invoice of a booking is the overdue one, else the one due first', () => {
  const list = [inv({ id: 'a', due_date: '2026-10-25T00:00:00Z' }), inv({ id: 'b', due_date: '2026-10-15T00:00:00Z' }), inv({ id: 'c', status: 'paid' }), inv({ id: 'd', booking_id: 'b2', overdue: true })];
  assert.deepEqual(unpaidInvoiceFor(list, 'b1'), { dueDate: '2026-10-15T00:00:00Z', overdue: false });
  assert.deepEqual(unpaidInvoiceFor([...list, inv({ id: 'e', overdue: true, due_date: '2026-10-30T00:00:00Z' })], 'b1'), { dueDate: '2026-10-30T00:00:00Z', overdue: true });
  assert.equal(unpaidInvoiceFor([inv({ status: 'paid' })], 'b1'), null);
  assert.equal(unpaidInvoiceFor(list, 'nobody'), null);
});

test('the invoices of a booking come newest first', () => {
  const list = [inv({ id: 'old', issued_at: '2026-09-01T00:00:00Z' }), inv({ id: 'new', issued_at: '2026-10-05T00:00:00Z' }), inv({ id: 'other', booking_id: 'b2' })];
  assert.deepEqual(invoicesOfBooking(list, 'b1').map((i) => i.id), ['new', 'old']);
});
