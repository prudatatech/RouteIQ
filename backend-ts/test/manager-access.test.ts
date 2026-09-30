import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { notificationService } from '../src/services/notification.service';

const app = testApp();
const as = (id: string) => ({ Authorization: `Bearer ${supabaseMock.signUserToken(id)}` });

beforeEach(() => {
  supabaseMock.reset({
    users: [
      { id: 'admin-1', role: 'admin', is_active: true },
      { id: 'super-1', role: 'superadmin', is_active: true },
      { id: 'manager-1', role: 'manager', is_active: true },
    ],
    vendor_shipment_requests: [{ id: 'req-1', vendor_id: 'vendor-1', status: 'pending', pickup_location: 'A', drop_location: 'B' }],
    notifications: [],
  });
});

describe('what a manager cannot reach', () => {
  it('finance', async () => {
    for (const path of ['/api/v1/finance/summary', '/api/v1/finance/unpriced', '/api/v1/finance/invoices']) {
      expect((await request(app).get(path).set(as('manager-1'))).status).toBe(403);
    }
  });

  it('finance stays open to admin', async () => {
    expect((await request(app).get('/api/v1/finance/unpriced').set(as('admin-1'))).status).toBe(200);
  });

  it('changing the pricing settings', async () => {
    const res = await request(app).put('/api/v1/pricing/settings').set(as('manager-1')).send({ settings: { rate_per_km: 30 } });
    expect(res.status).toBe(403);
  });

  it('the audit log', async () => {
    expect((await request(app).get('/api/v1/analytics/audit-logs').set(as('manager-1'))).status).toBe(403);
  });
});

describe('what a manager can do in operations', () => {
  it('sees the Today queues', async () => {
    expect((await request(app).get('/api/v1/ops/today').set(as('manager-1'))).status).toBe(200);
  });

  it('accepts and rejects vendor loads', async () => {
    const rejected = await request(app).put('/api/v1/vendor/shipment-request/req-1/reject').set(as('manager-1')).send({ reason: 'No truck on this lane this week' });
    expect(rejected.status).toBe(200);
  });
});

describe('3PL notifications', () => {
  it('reach admin and superadmin, who can open the 3PL pages, but not managers', async () => {
    await notificationService.notifyStaff('New 3PL application', 'A partner applied', 'tpl_application', { partner_id: 'p1' });
    const rows = supabaseMock.rows('notifications');
    expect(rows.map(r => r.user_id).sort()).toEqual(['admin-1', 'super-1']);
  });

  it('other staff notifications still reach admin', async () => {
    await notificationService.notifyStaff('KYC', 'submitted', 'kyc_submitted', {});
    expect(supabaseMock.rows('notifications').map(r => r.user_id).sort()).toEqual(['admin-1', 'super-1']);
  });

  it('bids waiting for a decision are not sent to managers, who cannot open the Bids page', async () => {
    await notificationService.notifyStaff('Bid', 'A bid is waiting', 'capacity_bid', { bid_id: 'b1' });
    expect(supabaseMock.rows('notifications').map(r => r.user_id).sort()).toEqual(['admin-1', 'super-1']);
  });
});
