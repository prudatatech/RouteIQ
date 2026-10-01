import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changedFields, greetingName, isPlaceholderName, profileToForm } from './profile.ts';

const profile: any = { id: 'c', phone: '9876543210', full_name: 'Customer 3210', company_name: 'Acme Traders', gstin: null, email: null, billing_address: null, city: 'Pune', state: null, pincode: null, display_name: 'Acme Traders', billing_ready: false };

test('the placeholder name is not shown as a name', () => {
  assert.equal(isPlaceholderName('Customer 3210'), true);
  assert.equal(isPlaceholderName('Customer'), true);
  assert.equal(isPlaceholderName('Customer Care Ltd'), false);
  const form = profileToForm(profile);
  assert.equal(form.full_name, '');
  assert.equal(form.company_name, 'Acme Traders');
  assert.equal(form.city, 'Pune');
  assert.equal(form.gstin, '');
});

test('only changed fields are sent, and an emptied field is sent as empty', () => {
  const initial = profileToForm(profile);
  assert.deepEqual(changedFields(initial, { ...initial }), {});
  assert.deepEqual(changedFields(initial, { ...initial, gstin: '27ABCDE1234F1Z5', city: '  ' }), { gstin: '27ABCDE1234F1Z5', city: '' });
});

test('the greeting uses the person, else the company, never the placeholder', () => {
  assert.equal(greetingName({ full_name: 'ravi kumar' }), 'Ravi');
  assert.equal(greetingName({ full_name: 'Customer 3210', company_name: 'Acme Traders' }), 'Acme Traders');
  assert.equal(greetingName({ full_name: 'Customer 3210' }), null);
  assert.equal(greetingName(null), null);
});
