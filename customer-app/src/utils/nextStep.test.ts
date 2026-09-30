// Run with `npm test` (Node's built-in runner; the helper has no React or network code).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { awaitsRating, needsLiveDetail, nextStep } from './nextStep.ts';

const booking = (status: any, shipment_status: any = null, rated: boolean | null = null) => ({ status, shipment_status, rated });

test('requested and confirmed bookings say what they wait for', () => {
  assert.equal(nextStep({ booking: booking('requested') })?.kind, 'waiting_accept');
  assert.equal(nextStep({ booking: booking('confirmed', 'created') })?.kind, 'truck_being_assigned');
  assert.equal(nextStep({ booking: booking('assigned', 'assigned') })?.kind, 'truck_assigned');
});

test('on the way shows the live ETA, or plain progress without one', () => {
  assert.deepEqual(nextStep({ booking: booking('in_transit', 'in_transit'), etaMinutes: 74.6 }), { kind: 'eta', tone: 'accent', minutes: 75 });
  assert.equal(nextStep({ booking: booking('in_transit', 'in_transit'), etaMinutes: null })?.kind, 'on_the_way');
  assert.equal(nextStep({ booking: booking('in_transit', 'out_for_delivery'), etaMinutes: 0 })?.kind, 'eta');
});

test('a problem tells the server message with the new arrival time, ahead of the ETA', () => {
  const step = nextStep({ booking: booking('in_transit', 'in_transit'), etaMinutes: 30, problem: { message: 'Truck broke down.', revisedEta: '2026-10-01T10:00:00Z' } });
  assert.deepEqual(step, { kind: 'problem', tone: 'warning', message: 'Truck broke down.', revisedEta: '2026-10-01T10:00:00Z' });
  assert.equal(nextStep({ booking: booking('in_transit', 'exception') })?.kind, 'problem_failed');
});

test('a delivered booking asks to confirm and rate until it is rated', () => {
  assert.equal(nextStep({ booking: booking('delivered', 'delivered') })?.kind, 'confirm_and_rate');
  assert.equal(nextStep({ booking: booking('in_transit', 'partially_delivered', false) })?.kind, 'confirm_and_rate');
  assert.equal(nextStep({ booking: booking('delivered', 'delivered', true) }), null);
});

test('after rating, an unpaid invoice is the next step, overdue in red', () => {
  const due = '2026-10-10T00:00:00Z';
  assert.deepEqual(nextStep({ booking: booking('delivered', 'delivered', true), unpaidInvoice: { dueDate: due, overdue: false } }), { kind: 'invoice_due', tone: 'info', dueDate: due });
  assert.equal(nextStep({ booking: booking('delivered', 'delivered', true), unpaidInvoice: { dueDate: due, overdue: true } })?.kind, 'invoice_overdue');
  // Rating comes first
  assert.equal(nextStep({ booking: booking('delivered', 'delivered', false), unpaidInvoice: { dueDate: due, overdue: false } })?.kind, 'confirm_and_rate');
});

test('a cancelled booking has no next step', () => {
  assert.equal(nextStep({ booking: booking('cancelled') }), null);
  assert.equal(awaitsRating(booking('cancelled', 'delivered')), false);
});

test('only moving bookings need live detail, and only delivered unrated ones await a rating', () => {
  assert.equal(needsLiveDetail(booking('in_transit', 'in_transit')), true);
  assert.equal(needsLiveDetail(booking('confirmed', 'created')), false);
  assert.equal(needsLiveDetail(booking('delivered', 'delivered')), false);
  assert.equal(awaitsRating(booking('delivered', 'delivered', null)), true);
  assert.equal(awaitsRating(booking('delivered', 'delivered', true)), false);
});
