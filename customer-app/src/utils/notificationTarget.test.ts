import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notificationTarget } from './notificationTarget.ts';

test('booking and cargo notifications open the booking', () => {
  assert.deepEqual(notificationTarget('booking', { booking_id: 'b1', status: 'confirmed' }), { screen: 'BookingDetail', params: { id: 'b1' } });
  for (const type of ['cargo_exception_opened', 'cargo_exception_resolved', 'cargo_transfer_completed', 'cargo_partial_delivery', 'cargo_rto_started', 'cargo_at_hub', 'cargo_claim_update']) {
    assert.deepEqual(notificationTarget(type, { booking_id: 'b2', shipment_id: 's1' }), { screen: 'BookingDetail', params: { id: 'b2' } });
  }
});

test('the delivery code opens the booking with its code card', () => {
  assert.deepEqual(notificationTarget('cargo_delivery_otp', { booking_id: 'b3', code: 'RTX-1' }), { screen: 'BookingDetail', params: { id: 'b3', focus: 'otp' } });
});

test('invoice notifications open that invoice, falling back to the booking, then the list', () => {
  assert.deepEqual(notificationTarget('invoice_issued', { invoice_id: 'i1', booking_id: 'b1' }), { screen: 'Invoice', params: { id: 'i1' } });
  assert.deepEqual(notificationTarget('invoice_paid', { invoice_id: 'i1' }), { screen: 'Invoice', params: { id: 'i1' } });
  assert.deepEqual(notificationTarget('invoice_paid', { booking_id: 'b1' }), { screen: 'BookingDetail', params: { id: 'b1' } });
  assert.deepEqual(notificationTarget('invoice_issued', null), { screen: 'Invoices' });
});

test('replies to a payment report or a question open that invoice', () => {
  for (const type of ['payment_report_confirmed', 'payment_report_rejected', 'invoice_query_answered']) {
    assert.deepEqual(notificationTarget(type, { invoice_id: 'i9' }), { screen: 'Invoice', params: { id: 'i9' } });
  }
});

test('nothing opens without the id it needs, or for an unknown type', () => {
  assert.equal(notificationTarget('booking', {}), null);
  assert.equal(notificationTarget('cargo_at_hub', { booking_id: 7 }), null);
  assert.equal(notificationTarget('shipment_update', { booking_id: 'b1' }), null);
  assert.equal(notificationTarget(undefined, { booking_id: 'b1' }), null);
});
