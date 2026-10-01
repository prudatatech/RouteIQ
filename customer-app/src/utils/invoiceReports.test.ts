import { test } from 'node:test';
import assert from 'node:assert/strict';
import { istDay, reportStatus } from './invoiceReports.ts';

test('each report status has its label key and tone', () => {
  assert.deepEqual(reportStatus({ kind: 'payment', status: 'open' }), { labelKey: 'report_status_payment_open', tone: 'warning' });
  assert.deepEqual(reportStatus({ kind: 'payment', status: 'confirmed' }), { labelKey: 'report_status_payment_confirmed', tone: 'success' });
  assert.deepEqual(reportStatus({ kind: 'payment', status: 'rejected' }), { labelKey: 'report_status_payment_rejected', tone: 'danger' });
  assert.deepEqual(reportStatus({ kind: 'query', status: 'open' }), { labelKey: 'report_status_query_open', tone: 'warning' });
  assert.deepEqual(reportStatus({ kind: 'query', status: 'answered' }), { labelKey: 'report_status_query_answered', tone: 'success' });
});

test('an instant late in the UTC day is already the next day in India', () => {
  assert.equal(istDay('2026-09-30T20:00:00Z'), '2026-10-01');
  assert.equal(istDay(null), null);
  assert.equal(istDay('nonsense'), null);
});
