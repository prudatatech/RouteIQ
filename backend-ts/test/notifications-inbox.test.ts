import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { supabaseMock } from './support/mock-supabase';
import { testApp } from './support/test-app';
import { createAccessToken } from '../src/core/auth';

const app = testApp();

const CUSTOMER_ID = 'customer-1';
const OTHER_ID = 'customer-2';

const customerToken = createAccessToken({ sub: CUSTOMER_ID, role: 'customer' });

const NOTIF_1 = {
  id: 'n1',
  user_id: CUSTOMER_ID,
  title: 'Shipment picked up',
  body: 'Your shipment TRK-1 was picked up.',
  type: 'shipment_update',
  is_read: false,
  data: { tracking_id: 'TRK-1' },
  created_at: '2026-09-28T00:00:00Z',
};

const NOTIF_2 = {
  id: 'n2',
  user_id: CUSTOMER_ID,
  title: 'Shipment delivered',
  body: 'Your shipment TRK-1 was delivered.',
  type: 'shipment_update',
  is_read: true,
  data: { tracking_id: 'TRK-1' },
  created_at: '2026-09-29T00:00:00Z',
};

const OTHER_NOTIF = {
  id: 'n3',
  user_id: OTHER_ID,
  title: 'Not yours',
  body: 'Belongs to another customer.',
  type: 'shipment_update',
  is_read: false,
  data: {},
  created_at: '2026-09-29T00:00:00Z',
};

beforeEach(() => {
  supabaseMock.reset({
    notifications: [NOTIF_1, NOTIF_2, OTHER_NOTIF],
  });
});

describe('GET /notifications', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/notifications');
    expect(res.status).toBe(401);
  });

  it('returns only the caller own notifications', async () => {
    const res = await request(app).get('/api/v1/notifications').set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(200);
    const ids = res.body.notifications.map((n: any) => n.id);
    expect(ids).toEqual(expect.arrayContaining(['n1', 'n2']));
    expect(ids).not.toContain('n3');
  });

  it('reports an unread count scoped to the caller', async () => {
    const res = await request(app).get('/api/v1/notifications').set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.unread_count).toBe(1);
  });
});

describe('POST /notifications/:id/read', () => {
  it('marks the caller own notification read', async () => {
    const res = await request(app).post('/api/v1/notifications/n1/read').set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.is_read).toBe(true);
    expect(supabaseMock.rows('notifications').find(r => r.id === 'n1')!.is_read).toBe(true);
  });

  it('refuses to mark another user notification read', async () => {
    const res = await request(app).post('/api/v1/notifications/n3/read').set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(404);
    expect(supabaseMock.rows('notifications').find(r => r.id === 'n3')!.is_read).toBe(false);
  });
});

describe('POST /notifications/read-all', () => {
  it('marks every unread notification of the caller read, leaving others untouched', async () => {
    const res = await request(app).post('/api/v1/notifications/read-all').set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(200);
    expect(supabaseMock.rows('notifications').find(r => r.id === 'n1')!.is_read).toBe(true);
    expect(supabaseMock.rows('notifications').find(r => r.id === 'n3')!.is_read).toBe(false);
  });
});
